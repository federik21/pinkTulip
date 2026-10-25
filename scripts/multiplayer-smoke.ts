import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { areInSameRoom, canUseSpellDummy, isWithinSpellRange, spellCanTargetModel } from '../packages/game-engine/src/engine';
import type { ActiveSpell, Card, GameAction, GameState, Hex, Player } from '../packages/game-engine/src/types';
import { checkHealingFacts, checkPublicFeedback } from './public-feedback';

// Real isolated server/clients: no engine fixtures, state mutation or test-only actions.
const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
 env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
});
const sockets: WebSocket[] = [];
type Message = { type: string; state?: GameState; message?: string; requestId?: string };
// The obsolete payload exists only at the untrusted wire boundary, for rejection tests.
type WireAction = GameAction | { type: 'SUMMON_EVOCATION'; playerId: string };
const ids = ['p1', 'p2'] as const;
const slots = ['slot1', 'slot2', 'slot3', 'rapid'] as const;
const hiddenCard = (index: number): Card => ({
 id: `hidden-${index}`, name: 'Hidden spell', kind: 'SPELL', damage: 0,
 instability: 0, range: 0, target: 'MODEL',
});
const player = (s: GameState, id: string) => {
 const p = s.players.find(p => p.id === id); assert.ok(p); return p;
};
const sameHex = (a: Hex, b: Hex) => a.q === b.q && a.r === b.r;
const distance = (a: Hex, b: Hex) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
const quests = (p: Player) => p.quest ? [p.quest, ...p.additionalQuests] : p.additionalQuests;
const roomAt = (s: GameState, position: Hex) => {
 const room = s.board.rooms.find(r => r.tiles.some(h => sameHex(h, position))); assert.ok(room); return room;
};

// Compare public epochs, not just phases/log lengths (movement need not log).
// Private cards/quests differ between viewers; their identities never enter this key.
function epochKey(s: GameState) {
 const { history, ...shared } = s;
 return JSON.stringify({ ...shared, players: s.players.map(p => {
  const { hand, personalDeck, prepared, quest, additionalQuests, studyCardIds, ...publicPlayer } = p;
  return { ...publicPlayer, hand: hand.length, personalDeck: personalDeck.length,
   prepared: slots.map(slot => prepared[slot] ? { used: prepared[slot]!.used } : null) };
 }), readiedSpells: s.readiedSpells?.map(({ id, playerId }) => ({ id, playerId })) });
}

function checkCardSupply(state: GameState, owners: Player[], readied: ActiveSpell[]) {
 assert.equal(owners.length, state.players.length, 'Combine only each mage’s own view at the same epoch');
 assert.deepEqual(owners.map(p => p.id).sort(), state.players.map(p => p.id).sort());
 assert.equal(readied.length, state.readiedSpells?.length ?? 0);
 for (const active of state.readiedSpells ?? []) {
  const owned = readied.filter(a => a.id === active.id && a.playerId === active.playerId);
  assert.equal(owned.length, 1, 'Collect each private readiness from its owner exactly once');
  assert.equal(active.card.spellType, owned[0].card.spellType, 'Public active type matches the private physical card');
 }
 const active = [...readied, ...state.ongoingSpells ?? []];
 assert.equal(new Set(active.map(a => a.id)).size, active.length, 'Active instance IDs are unique across both zones');
 assert.deepEqual([...(state.activeSpellOrder ?? [])].sort(), active.map(a => a.id).sort(), 'Chronology contains each active instance exactly once');
 for (const instance of active) {
  assert.match(instance.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(instance.id, instance.card.id, 'Instance UUIDs are not physical card IDs');
  assert.ok(owners.some(p => p.id === instance.playerId));
 }
 // Used preparations reference discarded/removed/active cards, not additional physical copies.
 const visible = [...state.library.flatMap(deck => deck.discard), ...state.removedCards,
  ...active.map(instance => instance.card),
  ...owners.flatMap(p => [...p.hand, ...p.discard, ...Object.values(p.prepared)
   .filter(slot => slot && !slot.used).map(slot => slot!.card)])];
 assert.ok(visible.every(card => !card.id.startsWith('hidden-')));
 assert.equal(new Set(visible.map(card => card.id)).size, visible.length, 'All observable physical cards have globally unique IDs');
 const shared = visible.filter(card => card.schoolId);
 assert.ok(shared.every(card => state.library.some(deck => deck.id === card.schoolId) && !card.powerful && card.id.startsWith(`${card.schoolId}-`)));
 const hiddenPersonal = state.players.reduce((sum, p) => sum + p.personalDeck.length, 0);
 const unobservedSchool = state.library.map(deck => 36 - deck.cards.length - shared.filter(card => card.schoolId === deck.id).length);
 assert.ok(unobservedSchool.every(n => n >= 0 && n <= hiddenPersonal), 'Each school has exactly 36 physical cards, including masked personal future draws');
 // Deck identities stay masked even to owners, so do not invent their origins.
 const unobservedPower = 12 - state.powerfulDeck.length - visible.filter(card => card.powerful).length;
 assert.ok(unobservedPower >= 0);
 assert.equal(unobservedSchool.reduce((sum, n) => sum + n, 0) + unobservedPower, hiddenPersonal);
 assert.equal(state.library.reduce((sum, deck) => sum + deck.cards.length, 0) + state.powerfulDeck.length +
  hiddenPersonal + visible.length, 120);
}

class Mage {
 state: GameState | null = null;
 messages: Message[] = [];
 constructor(readonly ws: WebSocket) {
  ws.on('message', raw => {
   const msg = JSON.parse(raw.toString()) as Message;
   if (msg.state) this.state = msg.state;
   // Ordered socket: server sends STATE before its request-correlated ACK.
   // Snapshot now; a later opponent broadcast must not become this request's result.
   if (msg.type === 'ACTION_APPLIED') { assert.ok(this.state); msg.state = this.state; }
   this.messages.push(msg);
  });
 }
 async wait(predicate: (m: Message) => boolean, from = 0): Promise<Message> {
  const existing = this.messages.slice(from).find(predicate); if (existing) return existing;
  return new Promise((resolve, reject) => {
   const timer = setTimeout(() => {
    this.ws.off('message', receive);
    reject(new Error(`Timed out waiting for server message. Last: ${JSON.stringify(this.messages.at(-1))?.slice(0, 300)}`));
   }, 8000);
   const receive = (raw: import('ws').RawData) => {
    const msg = JSON.parse(raw.toString()) as Message;
    if (predicate(msg)) { clearTimeout(timer); this.ws.off('message', receive); resolve(msg); }
   };
   this.ws.on('message', receive);
  });
 }
 async sync(epoch: GameState): Promise<GameState> {
  const key = epochKey(epoch);
  const state = this.state && epochKey(this.state) === key ? this.state
   : (await this.wait(m => m.type === 'STATE' && !!m.state && epochKey(m.state) === key)).state!;
  assert.equal(state.log.length, epoch.log.length, 'Peer must receive the acknowledged epoch before hand inspection');
  return state;
 }
 async send(action: WireAction, expectError?: RegExp): Promise<GameState> {
  const from = this.messages.length, before = this.state;
  const requestId = crypto.randomUUID();
  this.ws.send(JSON.stringify({ action, requestId }));
  const reply = await this.wait(m => m.requestId === requestId, from);
  assert.equal(reply.type, expectError ? 'ERROR' : 'ACTION_APPLIED', `${action.type}: ${reply.message ?? reply.type}`);
  if (expectError) {
   assert.match(reply.message ?? '', expectError, action.type);
   assert.strictEqual(this.state, before, 'Rejected commands must not broadcast a changed state');
   assert.ok(before); return before;
  }
  // The ACK has no wire state; the permanent listener attached the exact snapshot.
  const recorded = this.messages.find(m => m.requestId === requestId)!;
  assert.ok(recorded.state, `Missing acknowledged state for ${action.type}`);
  return recorded.state;
 }
 async join(roomId: string, create = false, name = 'Mage'): Promise<GameState> {
  const from = this.messages.length;
  this.ws.send(JSON.stringify({ type: create ? 'CREATE_ROOM' : 'JOIN', roomId, playerName: name }));
  return (await this.wait(m => m.type === 'STATE', from)).state!;
 }
}

function checkCubes(s: GameState) {
 assert.equal(typeof s.blackRoseResolved, 'boolean');
 for (const p of s.players) {
  assert.deepEqual([p.wizard.health, p.wizard.attack, p.wizard.movement, p.cardLimit, p.questLimit], [10, 2, 2, 7, 2]);
  assert.ok(p.wizard.damageCubes >= p.wizard.blackDamage + Object.values(p.wizard.damageByPlayer).reduce((a, b) => a + b, 0), 'Unattributed wounds need not consume physical cubes');
  assert.ok(p.wizard.damageCubes < p.wizard.health, 'health is maximum HP, not remaining HP');
  assert.equal(p.cubes.available + p.cubes.onWizard + p.cubes.onEvocations + p.cubes.onBoard, 25);
  assert.equal(p.cubes.onWizard, s.players.reduce((n, victim) => n + (victim.wizard.damageByPlayer[p.id] ?? 0), 0));
  assert.equal(p.cubes.onEvocations, s.evocations.reduce((n, victim) => n + (victim.damageByPlayer[p.id] ?? 0), 0));
  assert.equal(p.cubes.onBoard, s.board.rooms.filter(r => !r.scored).reduce((n, r) => n + (r.cubesByPlayer[p.id] ?? 0), 0));
  assert.ok(s.evocations.filter(e => e.playerId === p.id).length <= 3);
 }
 for (const e of s.evocations) {
  assert.ok(!s.board.rooms.some(r => r.startingFor && r.tiles.some(h => sameHex(h, e.position))));
 }
 for (const room of s.board.rooms) {
  const capacity = room.id === 'room-0,0' ? 10 : room.color === 'violet' ? 4 : room.color === 'grey' ? 6 : 5;
  assert.equal(room.instabilityLimit, capacity);
  assert.deepEqual(room.rewards, ({ 4: [2, 1, 0], 5: [4, 2, 1], 6: [5, 3, 1], 10: [6, 3, 1] })[capacity]);
  if (room.reconstructed) assert.equal(room.scored, true, 'Real rooms only rebuild and score together in Cleanup');
 }
}

// Independent integration oracle: positive dense ranks, including neutral cubes,
// with a one-point tie deduction only for nonzero prizes.
function awards(counts: Record<string, number>, prizes: readonly number[]) {
 const entries = Object.entries(counts).filter(([, count]) => count > 0);
 const ranks = [...new Set(entries.map(([, count]) => count))].sort((a, b) => b - a);
 return entries.map(([id, count]) => {
  const prize = prizes[ranks.indexOf(count)] ?? 0;
  return { id, points: prize > 0 ? Math.max(1, prize - Number(entries.filter(([, n]) => n === count).length > 1)) : 0 };
 });
}

function checkSettlement(before: GameState, after: GameState) {
 const scores = Object.fromEntries([...before.players.map(p => [p.id, p.victoryPoints]), ['black-rose', before.blackRose.victoryPoints]]);
 // The final cast can place cubes or complete quests before automatically
 // entering Cleanup in the same ACK. Separate those ordinary action rewards
 // from the independent room/endgame score oracle at the logged phase boundary.
 const appended = after.log.slice(before.log.length);
 const cleanupIndex = appended.findIndex(line => line.startsWith('CLEANUP —'));
 assert.ok(cleanupIndex >= 0);
 for (const line of appended.slice(0, cleanupIndex)) {
  for (const competitor of [...before.players, { id: 'black-rose', name: '(not) Black Rose' }]) {
   if (!line.startsWith(`${competitor.name}: +`) && !line.startsWith(`${competitor.name} completes `)) continue;
   const reward = line.match(/\+(\d+) VP/);
   if (reward) scores[competitor.id] += Number(reward[1]);
  }
 }
 for (const settled of after.board.rooms) {
  const room = before.board.rooms.find(r => r.id === settled.id)!;
  if (room.startingFor || room.scored || settled.instability < settled.instabilityLimit) continue;
  assert.equal(room.reconstructed, false, 'Full rooms remain ordinary until Cleanup');
  assert.equal(settled.reconstructed, true); assert.equal(settled.scored, true);
  if (room.instability === room.instabilityLimit) assert.deepEqual(settled.cubesByPlayer, room.cubesByPlayer, 'Historical contributions survive cube returns');
  for (const { id, points } of awards(settled.cubesByPlayer, room.rewards)) scores[id] += points;
 }
 assert.ok(after.board.rooms.every(room => !room.specialUsed));
 if (after.phase === 'GAME_OVER') {
  assert.equal(after.round, 3); assert.equal(after.endgameScored, true);
  for (const counts of [
   { ...Object.fromEntries(before.players.map(p => [p.id, p.kills])), 'black-rose': before.blackRose.kills },
   Object.fromEntries(before.players.map(p => [p.id, p.questsCompleted])),
  ]) for (const { id, points } of awards(counts, [4, 2, 1])) scores[id] += points;
  assert.ok(before.firstPlayerId); scores[before.firstPlayerId]++;
  const winner = [...before.players.map(p => p.id), 'black-rose'].sort((a, b) => scores[b] - scores[a])[0];
  assert.equal(after.winner, winner, 'Final standings include (not) Black Rose and stable seating-order ties');
 } else assert.equal(after.endgameScored, false);
 assert.deepEqual(Object.fromEntries([...after.players.map(p => [p.id, p.victoryPoints]), ['black-rose', after.blackRose.victoryPoints]]), scores);
}

async function main() {
 try {
  const url = await new Promise<string>((resolve, reject) => {
   const timer = setTimeout(() => reject(new Error('Server did not start')), 10000);
   let output = '';
   server.stdout!.on('data', chunk => {
    output += chunk; const match = output.match(/ws:\/\/localhost:\d+/);
    if (match) { clearTimeout(timer); resolve(match[0]); }
   });
   server.once('error', error => { clearTimeout(timer); reject(error); });
   server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
   server.stderr!.on('data', data => process.stderr.write(data));
  });
  const connect = async () => {
   const ws = new WebSocket(url); sockets.push(ws); const mage = new Mage(ws); await once(ws, 'open'); return mage;
  };
  const a = await connect(), b = await connect(), clients = { p1: a, p2: b };
  const client = (id: string) => { assert.ok(id === 'p1' || id === 'p2'); return clients[id]; };
  let epoch = await a.join('smoke', true, 'Ember');
  const coverage = { prepared: 0, powerful: 0, begins: 0, locks: 0, skips: 0, grey: 0, greyCap: 0,
   greyRebuilt: 0, attacks: 0, questDiscards: 0, handDiscards: 0, schoolExceptions: 0, powerExceptions: 0,
    emptyHandLimits: 0, emptyQuestLimits: 0, freeEvocations: 0, once: 0, ownerSkips: 0, destroyed: 0,
    evocationRangeRejections: 0, evocationCombatSteps: 0,
    futurePass: 0, automaticSkips: 0, legacy: 0, offAxisPrepared: 0, offAxisPowerful: 0,
    cappedHandoffs: 0, pendingAtCap: 0, thirdRejected: 0, retainedTokens: 0, retainedSpells: 0,
    numbered: 0, flexible: 0, discardExits: 0, yields: 0, heldPowerRejections: 0, settlements: 0, drawBarriers: 0 };
    const preparedByRound = [0, 0, 0];
    const actionCosts = new Set(['BEGIN_PHYSICAL_ACTION', 'EXPLORE', 'PUNCH', 'ACTIVATE_EVOCATION',
    'CAST_SPELL', 'CAST_POWERFUL_SPELL', 'DISCARD_EXIT']);
    const physicalEffects = new Set(['PERFORM_MOVEMENT', 'EXPLORE_STEP', 'END_EXPLORE',
    'ACTIVATE_ROOM', 'INFLICT_ATTACK', 'SKIP_PHYSICAL_EFFECTS']);
    // The same mage can receive a fresh turn when the opponent is exhausted.
    // Owner equality alone cannot distinguish that handoff from a continuing turn.
    const sameTurn = (before: GameState, id: string) => epoch.phase === 'ACTION' && epoch.currentPlayerId === id &&
    !epoch.log.slice(before.log.length).some(line => line.includes(' takes a turn: '));
  async function privacy() {
    const owners: Player[] = [], readied: ActiveSpell[] = [];
    const hidden = (cards: Card[]) => cards.forEach((card, index) => assert.deepEqual(card, hiddenCard(index)));
   for (const { id, connected } of epoch.players) {
    if (!connected) continue;
    const own = await client(id).sync(epoch);
    owners.push(player(own, id));
    readied.push(...(own.readiedSpells ?? []).filter(active => active.playerId === id));
    assert.equal(epochKey(own), epochKey(epoch));
    assert.ok(own.history && typeof own.history.canUndo === 'boolean' && typeof own.history.canRedo === 'boolean');
    assert.ok(Object.keys(own.history).every(key => ['canUndo', 'canRedo', 'undoLabel', 'redoLabel'].includes(key)), 'History exposes availability only, never snapshots');
    for (const [index, active] of (own.readiedSpells ?? []).entries()) {
     if (active.playerId === id) assert.ok(!active.card.id.startsWith('hidden-'), 'Own readiness remains fully visible');
     else {
      assert.ok(active.card.spellType === 'TRAP' || active.card.spellType === 'PROTECTION');
      assert.deepEqual(active, { id: active.id, playerId: active.playerId, card: { ...hiddenCard(index), spellType:active.card.spellType } },
       'Only active type survives masking; bindings, rules, school and identity remain private');
     }
    }
    assert.deepEqual(own.ongoingSpells, epoch.ongoingSpells);
    assert.deepEqual(own.activeSpellOrder, epoch.activeSpellOrder);
    assert.deepEqual(own.feedbackEvents, epoch.feedbackEvents, 'Resolution facts are public and identical across sockets');
    for (const active of own.ongoingSpells ?? [])
     assert.ok(!active.card.id.startsWith('hidden-') && active.card.ongoing, 'Ongoing cards and bindings remain public');
    for (const other of own.players.filter(p => p.id !== id)) {
      assert.ok(!Object.hasOwn(other, 'studyCardIds'), 'Only the owner receives Study eligibility IDs');
     assert.equal(other.quest, null); assert.deepEqual(other.additionalQuests, []);
     assert.ok(other.hand.every(c => c.name === 'Hidden spell' && !c.schoolId && !c.powerful));
     assert.ok(Object.values(other.prepared).every(c => !c || c.card.name === 'Hidden spell' && !c.card.powerful));
     hidden(other.hand);
     for (const prepared of Object.values(other.prepared)) if (prepared) hidden([prepared.card]);
    }
    for (const p of own.players) {
     hidden(p.personalDeck);
     assert.deepEqual(p.discard, player(epoch, p.id).discard, 'Personal discard is public to both real sockets');
     assert.ok(p.discard.every(card => !card.id.startsWith('hidden-')));
    }
    assert.deepEqual(own.eventDeck, []); assert.deepEqual(own.questDeck, []);
    assert.deepEqual(own.library.map(({ id, name }) => ({ id, name })), [
     { id: 'cantrip', name: 'Cantrip' }, { id: 'transmutation', name: 'Transmutation' },
      { id: 'enchantment', name: 'Enchantment' },
    ]);
    for (const deck of own.library) {
     assert.ok(deck.cards.length + deck.discard.length <= 36);
     hidden(deck.cards);
    }
    hidden(own.powerfulDeck);
   }
  checkCardSupply(epoch, owners, readied);
  }
  const command = async (mage: Mage, action: WireAction, error?: RegExp): Promise<GameState> => {
    await mage.sync(epoch); const before = epoch;
    epoch = await mage.send(action, error); checkCubes(epoch); checkPublicFeedback(epoch); await privacy();
    if (!error && before.phase !== epoch.phase && (epoch.phase === 'CLEANUP' || epoch.phase === 'GAME_OVER')) {
     checkSettlement(before, epoch); coverage.settlements++;
    } else if (!error) {
     for (const room of epoch.board.rooms) {
      const previous = before.board.rooms.find(r => r.id === room.id)!;
      assert.deepEqual([room.reconstructed, room.scored], [previous.reconstructed, previous.scored], 'Room rebuilds, VP settlement and upgraded effects must wait for Cleanup');
     }
     assert.equal(epoch.endgameScored, before.endgameScored);
    }
    if (!error && before.phase === 'ACTION' && before.activation?.playerId === action.playerId &&
     (actionCosts.has(action.type) || physicalEffects.has(action.type))) {
     const used = before.activation.actionsUsed + Number(actionCosts.has(action.type));
     assert.ok(used <= 2, `${action.type} must not start a third turn action`);
     const pending = sameTurn(before, action.playerId) &&
      !!(epoch.activation!.physicalAction || epoch.activation!.exploring || epoch.evocationActivation);
     if (pending || used < 2 && sameTurn(before, action.playerId)) {
      assert.equal(epoch.activation!.actionsUsed, used, `${action.type} must charge exactly its shared action cost`);
      if (pending && used === 2) coverage.pendingAtCap++;
     } else {
      assert.ok(!sameTurn(before, action.playerId), 'A resolved second action must automatically hand off');
      if (epoch.phase === 'ACTION') assert.equal(epoch.activation!.actionsUsed, 0, 'New turns reset only their action counter');
      else assert.equal(epoch.activation, null);
      coverage.automaticSkips++;
      if (used === 2) {
      coverage.cappedHandoffs++;
      const p = player(epoch, action.playerId);
      if (p.actionTokens > 0) coverage.retainedTokens++;
      if (Object.values(p.prepared).some(c => c && !c.used)) coverage.retainedSpells++;
      if (epoch.phase === 'ACTION' && epoch.currentPlayerId !== action.playerId) {
       for (const rejected of [
        { type: 'BEGIN_PHYSICAL_ACTION', playerId: p.id, kind: 'EXPLORE' },
        { type: 'CAST_SPELL', playerId: p.id, slot: 'rapid', roomId: 'room-0,0' },
        { type: 'CAST_POWERFUL_SPELL', playerId: p.id, cardId: 'unavailable', roomId: 'room-0,0' },
        { type: 'DISCARD_EXIT', playerId: p.id, cardId: 'unavailable', destination: { q: 0, r: 0 } },
       ] satisfies GameAction[]) {
        await command(client(p.id), rejected, /Not your turn/); coverage.thirdRejected++;
       }
      }
      }
     }
    }
    return epoch;
  };
  const act = (action: GameAction, error?: RegExp) => command(client(action.playerId), action, error);
  const advance = (error?: RegExp) => act({ type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: epoch.phase, expectedRound: epoch.round }, error);
  const legacy = async (id: string) => {
   await command(client(id), { type: 'SUMMON_EVOCATION', playerId: id }, /^Unknown game action$/); coverage.legacy++;
  };
  const skip = async (id: string) => {
   epoch = await client(id).sync(epoch); const before = epoch;
   await act({ type: 'SKIP_PHYSICAL_EFFECTS', playerId: id }); coverage.skips++;
    assert.deepEqual(epoch.players, before.players);
    assert.deepEqual(epoch.evocations.map(({ activated, ...e }) => e), before.evocations.map(({ activated, ...e }) => e));
    assert.deepEqual(epoch.board, before.board); assert.ok(!epoch.activation?.physicalAction);
   assert.equal(epoch.activation?.exploring ?? 0, 0);
  };
  const begin = async (id: string, kind: 'EXPLORE' | 'ATTACK' = 'EXPLORE') => {
   epoch = await client(id).sync(epoch); const before = epoch, p = player(before, id);
   await act({ type: 'BEGIN_PHYSICAL_ACTION', playerId: id, kind }); coverage.begins++;
   assert.equal(player(epoch, id).actionTokens, p.actionTokens - 1);
   assert.equal(epoch.activation!.actionsUsed, before.activation!.actionsUsed + 1);
   assert.deepEqual(epoch.activation!.physicalAction, { kind, mainEffectUsed: false, movementStarted: false });
   assert.equal(epoch.activation!.roomEffectUsed, false);
   assert.deepEqual(epoch.evocations, before.evocations); assert.deepEqual(epoch.board, before.board);
   assert.deepEqual(epoch.players.map(p => p.wizard), before.players.map(p => p.wizard));
   assert.deepEqual(epoch.players.map(p => p.hand), before.players.map(p => p.hand));
  };
  async function locks(id: string) {
   const p = player(await client(id).sync(epoch), id);
   for (const action of [
    { type: 'BEGIN_PHYSICAL_ACTION', playerId: id, kind: 'ATTACK' },
    { type: 'END_ACTIVATION', playerId: id }, { type: 'PASS_ROUND', playerId: id },
    { type: 'CAST_SPELL', playerId: id, slot: 'slot1', roomId: 'room-0,0' },
    { type: 'CAST_POWERFUL_SPELL', playerId: id, cardId: p.hand.find(c => c.powerful)?.id ?? 'unavailable', roomId: 'room-0,0' },
    { type: 'DISCARD_EXIT', playerId: id, cardId: p.hand[0]?.id ?? 'unavailable', destination: { q: 0, r: 0 } },
    { type: 'ACTIVATE_EVOCATION', playerId: id, evocationId: epoch.evocations.find(e => e.playerId === id)?.id ?? 'unavailable' },
   ] satisfies GameAction[]) {
    if (action.type === 'ACTIVATE_EVOCATION' && !epoch.evocations.some(e => e.id === action.evocationId)) continue;
    await act(action, /pending physical action|Finish exploring/); coverage.locks++;
   }
   const other = id === 'p1' ? 'p2' : 'p1';
   for (const type of ['PERFORM_MOVEMENT', 'ACTIVATE_ROOM', 'SKIP_PHYSICAL_EFFECTS'] as const)
    await act({ type, playerId: other }, /Not your turn/);
   await act({ type: 'INFLICT_ATTACK', playerId: other, targetId: id }, /Not your turn/);
  }
  async function movement(id: string, path: Hex[]) {
   const before = epoch;
   await act({ type: 'PERFORM_MOVEMENT', playerId: id });
   assert.equal(epoch.activation!.exploring, player(epoch, id).wizard.movement);
   await act({ type: 'PERFORM_MOVEMENT', playerId: id }, /already started/);
   await act({ type: 'ACTIVATE_ROOM', playerId: id }, /Finish exploring/); await locks(id);
   for (const destination of path) await act({ type: 'EXPLORE_STEP', playerId: id, destination });
   if (path.length < player(epoch, id).wizard.movement) await act({ type: 'END_EXPLORE', playerId: id });
  assert.equal(epoch.activation?.exploring ?? 0, 0);
   assert.equal(player(epoch, id).actionTokens, player(before, id).actionTokens);
  if (sameTurn(before, id)) assert.equal(epoch.activation!.actionsUsed, before.activation!.actionsUsed);
  if (sameTurn(before, id) && epoch.activation!.physicalAction) {
    assert.equal(epoch.activation!.physicalAction.mainEffectUsed, true);
    await act({ type: 'PERFORM_MOVEMENT', playerId: id }, /already started or resolved/); await locks(id);
   } else assert.equal(before.activation!.roomEffectUsed, true);
  }
  async function activateRoom(id: string) {
    epoch = await client(id).sync(epoch);
   const before = epoch, p = player(before, id), room = roomAt(before, p.wizard.position);
   assert.ok(!room.reconstructed || !room.specialUsed);
   const count = before.evocations.filter(e => e.playerId === id).length;
   await act({ type: 'ACTIVATE_ROOM', playerId: id });
   assert.equal(player(epoch, id).actionTokens, p.actionTokens);
  if (['DRAW_POWERFUL', 'DRAW_GRIMOIRE', 'DRAW_DISCARD', 'DRAW_QUEST'].includes(room.effect ?? '')) {
   assert.deepEqual(epoch.history, { canUndo: false, canRedo: false }, 'Drawing rooms are history barriers, including empty sources');
   await act({ type: 'UNDO_ACTION', playerId: id }, /No action available to undo/);
   coverage.drawBarriers++;
  }
  if (sameTurn(before, id)) assert.equal(epoch.activation!.actionsUsed, before.activation!.actionsUsed);
   assert.equal(epoch.board.rooms.find(r => r.id === room.id)!.specialUsed, room.reconstructed);
   if (room.color === 'grey') {
    coverage.grey++; if (count === 3) coverage.greyCap++; if (room.reconstructed) coverage.greyRebuilt++;
    const added = epoch.evocations.filter(e => !before.evocations.some(old => old.id === e.id));
    assert.equal(added.length, Math.min(room.reconstructed ? 2 : 1, 3 - count));
    for (const e of added) {
     assert.deepEqual([e.playerId, e.position, e.archetype, e.movement, e.attack, e.health, e.passive, e.damageCubes, e.activated],
      [id, p.wizard.position, 'UNDEAD', 2, 2, 2, 'WOUNDED_FURY', 0, false]);
     assert.deepEqual(e.damageByPlayer, {});
    }
    assert.deepEqual(epoch.library, before.library); assert.deepEqual(epoch.players.map(p => p.hand), before.players.map(p => p.hand));
    assert.deepEqual(epoch.players.map(p => p.cubes), before.players.map(p => p.cubes));
   }
  if (sameTurn(before, id) && epoch.activation!.physicalAction) {
    await act({ type: 'ACTIVATE_ROOM', playerId: id }, /Room effect already used/); await locks(id);
   } else assert.equal(before.activation!.physicalAction!.mainEffectUsed, true);
  }
  const maybeRoom = async (id: string) => {
   const room = roomAt(epoch, player(epoch, id).wizard.position);
   if (room.reconstructed && room.specialUsed) {
    await act({ type: 'ACTIVATE_ROOM', playerId: id }, /Reconstructed room special already used/); return false;
   }
   await activateRoom(id); return true;
  };
  assert.equal(epoch.phase, 'LOBBY'); assert.deepEqual(epoch.evocations, []);
  assert.ok(epoch.players.every(p => p.hand.length === 0 && p.personalDeck.length === 0 && p.discard.length === 0));
  assert.deepEqual(epoch.players.map(p => p.id), ['p1'], 'Creating a room must not invent an unjoined second mage');
  for (const deck of epoch.library) { assert.equal(deck.cards.length, 36); assert.deepEqual(deck.discard, []); }
  assert.equal(epoch.board.rooms.filter(r => r.color === 'grey' && r.effect === 'SUMMON_CADAVER').length, 3);
  // This older three-round route deliberately covers all eighteen ordinary
  // rooms. Default two-mage sizing is exercised independently by lobby/socket tests.
  await act({ type:'SET_ROOM_COUNT', playerId:'p1', roomsPerColor:3 });
  await legacy('p1');
  await act({ type:'SET_READY', playerId:'p1', ready:true }, /school/i);
  await act({ type:'SELECT_STARTING_SCHOOL', playerId:'p1', schoolId:'cantrip' });
  await act({ type: 'SET_READY', playerId: 'p1', ready: true });
  assert.equal(epoch.phase, 'LOBBY'); assert.equal(epoch.round, 0, 'A ready solo creator must wait for another mage');
  epoch = await b.join('smoke', false, 'Moon');
  assert.deepEqual(epoch.players.map(p => p.id), [...ids]); assert.ok(epoch.players.every(p => p.connected));
  assert.equal(epoch.phase, 'LOBBY'); assert.equal(player(epoch, 'p1').ready, true); assert.equal(player(epoch, 'p2').ready, false);
  checkCubes(epoch); await privacy();
  await act({ type:'SELECT_STARTING_SCHOOL', playerId:'p2', schoolId:'cantrip' });
  assert.ok(epoch.players.every(p => p.hand.length === 0 && p.personalDeck.length === 0 && p.discard.length === 0), 'Choosing a school allocates nothing early');
  await act({ type: 'SET_READY', playerId: 'p2', ready: true });
  assert.equal(epoch.phase, 'BLACK_ROSE'); assert.equal(epoch.round, 1, 'The final SET_READY must auto-start exactly one real round');
  assert.equal(epoch.roomsPerColor, 3);
  assert.equal(epoch.board.rooms.filter(room => room.color).length, 18);
  assert.deepEqual(epoch.library.map(deck => deck.cards.length), [22, 36, 36]);
  for (const id of ids) {
   const own = player(await client(id).sync(epoch), id);
  assert.equal(own.startingSchoolId, 'cantrip'); assert.equal(own.hand.length, 0);
  assert.equal(own.personalDeck.length, 6); assert.equal(own.discard.length, 1);
  assert.ok(own.discard.every(card => card.schoolId === 'cantrip' && card.id.startsWith('cantrip-')));
  }

  async function studyAndPrepare() {
   assert.equal(epoch.phase, 'BLACK_ROSE'); assert.equal(epoch.blackRoseResolved, false);
   assert.ok(epoch.players.every(p => p.actionTokens === 2));
  await act({ type: 'DISCARD_QUESTS', playerId: 'p1', questIds: [] }, /Resolve \(not\) Black Rose/);
   const before = epoch;
   await advance(); assert.equal(epoch.blackRoseResolved, true);
   if (epoch.phase === 'BLACK_ROSE') {
    assert.deepEqual(epoch.players.map(p => p.hand.length), before.players.map(p => p.hand.length), 'Quest gate delays all grimoire draws');
    assert.deepEqual(epoch.players.map(p => p.personalDeck.length), before.players.map(p => p.personalDeck.length));
    await advance(/Waiting for quest-limit discards/);
    await act({ type: 'DRAW_STUDY', playerId: 'p1', deckId: 'cantrip' }, /BLACK_ROSE/);
    for (const id of ids) {
     const own = player(await client(id).sync(epoch), id), held = quests(own), overflow = held.length - own.questLimit;
     if (overflow <= 0) {
      await act({ type: 'DISCARD_QUESTS', playerId: id, questIds: [] }, /No quests over/); coverage.emptyQuestLimits++; continue;
     }
     const selected = held.slice(0, overflow).map(q => q.id);
     await act({ type: 'DISCARD_QUESTS', playerId: id, questIds: [] }, /Discard exactly/);
     await act({ type: 'DISCARD_QUESTS', playerId: id, questIds: [...selected.slice(0, -1), 'not-owned'] }, /not owned/);
     if (overflow > 1) await act({ type: 'DISCARD_QUESTS', playerId: id, questIds: Array(overflow).fill(selected[0]) }, /different quests/);
     await act({ type: 'DISCARD_QUESTS', playerId: id, questIds: selected }); coverage.questDiscards += overflow;
     const after = player(await client(id).sync(epoch), id);
     assert.deepEqual(quests(after), held.filter(q => !selected.includes(q.id)));
     assert.equal(after.victoryPoints, own.victoryPoints); assert.equal(after.questsCompleted, own.questsCompleted);
     assert.ok(selected.every(q => epoch.questDiscard.some(d => d.id === q)));
    }
   }
   assert.equal(epoch.phase, 'STUDY');
   await act({ type: 'DISCARD_QUESTS', playerId: 'p1', questIds: [] }, /STUDY/);
  await act({ type: 'DRAW_STUDY', playerId: 'p1', deckId: 'school-1' }, /School not found/);
   for (const id of ids) {
    const own = player(await client(id).sync(epoch), id);
    const previous = player(before, id), draws = Math.min(2, previous.personalDeck.length + previous.discard.length);
    assert.equal(own.hand.length, previous.hand.length + draws, 'Continue cannot generate cards when the real personal supply is exhausted');
    if (epoch.round === 1) {
     assert.equal(own.hand.length, 2); assert.equal(own.personalDeck.length, 4); assert.equal(own.discard.length, 1);
     assert.ok(own.hand.every(card => card.schoolId === own.startingSchoolId));
    }
    await act({ type: 'DISCARD_HAND_LIMIT', playerId: id, cardIds: [] }, /STUDY/);
  // Starting personal decks/overflow can lock much of Cantrip in private hands or
  // personal discards. Study must use real available school stock, not assume
  // that the original 36 are still drawable or replenish them with fixtures.
  const preferred = epoch.library.find(deck => deck.id === 'cantrip')!;
  const stock = preferred.cards.length + preferred.discard.length >= 4 ? preferred
   : epoch.library.find(deck => deck.id === 'transmutation' && deck.cards.length + deck.discard.length >= 4);
  assert.ok(stock, 'A real independent school must have four available cards');
  const untouched = epoch.library.filter(deck => deck.id !== stock.id), reshuffles = stock.cards.length < 4;
   await act({ type: 'DRAW_STUDY', playerId: id, deckId: stock.id });
   const drawnStock = epoch.library.find(deck => deck.id === stock.id)!;
   assert.equal(drawnStock.cards.length, stock.cards.length + (reshuffles ? stock.discard.length : 0) - 4);
   assert.equal(drawnStock.discard.length, reshuffles ? 0 : stock.discard.length);
  assert.deepEqual(epoch.library.filter(deck => deck.id !== stock.id), untouched, 'School draws and reshuffles must not borrow from either other school');
   const hand = player(epoch, id).hand;
   assert.equal(hand.length, own.hand.length + 4);
  const studyIds = player(epoch, id).studyCardIds!;
  assert.equal(studyIds.length, 4);
  const drawn = studyIds.map(cardId => hand.find(card => card.id === cardId)!);
  assert.ok(drawn.every(c => c.schoolId === stock.id && c.id.startsWith(`${stock.id}-`)));
  const discarded = [...drawn].sort((a, b) => Number(b.target === 'EVOCATION') - Number(a.target === 'EVOCATION')).slice(0, 2).map(c => c.id);
    assert.equal(discarded.length, 2);
    await act({ type: 'DISCARD_STUDY', playerId: id, cardIds: discarded });
    assert.ok(discarded.every(cardId => epoch.library.find(deck => deck.id === stock.id)!.discard.some(c => c.id === cardId)));
    assert.deepEqual(epoch.library.filter(deck => deck.id !== stock.id), untouched, 'Study discards stay out of both other schools');
   }
   for (const id of ids) {
    let own = player(await client(id).sync(epoch), id);
    if (epoch.round === 1) {
     assert.equal(own.hand.length, 4, 'The first Study produces four held cards, not eleven');
     assert.equal(own.discard.length, 1, 'Only the seventh starting card begins in personal discard');
    }
     const prepare = (): GameAction => {
      const power = own.hand.find(c => c.powerful);
      const ordinary = own.hand.filter(c => !c.powerful).sort((a, b) => Number(a.target === 'EVOCATION') - Number(b.target === 'EVOCATION'));
      return { type: 'PREPARE_CARDS', playerId: id,
       preparedCardIds: ordinary.slice(0, 3).map(c => c.id), rapidCardId: (power ?? ordinary[3]).id };
     };
    const overflow = own.hand.length - own.cardLimit;
    if (overflow > 0) {
     await act(prepare(), /hand limit/);
     await act({ type: 'DISCARD_HAND_LIMIT', playerId: id, cardIds: [] }, /Discard exactly/);
    const selected = [...own.hand].sort((a, b) => Number(!!a.powerful) - Number(!!b.powerful) || Number(!!b.schoolId) - Number(!!a.schoolId)).slice(0, overflow);
     await act({ type: 'DISCARD_HAND_LIMIT', playerId: id, cardIds: [...selected.slice(0, -1).map(c => c.id), 'not-owned'] }, /not in hand/);
     if (overflow > 1) await act({ type: 'DISCARD_HAND_LIMIT', playerId: id, cardIds: Array(overflow).fill(selected[0].id) }, /different spells/);
     const library = epoch.library, removed = epoch.removedCards;
     await act({ type: 'DISCARD_HAND_LIMIT', playerId: id, cardIds: selected.map(c => c.id) });
     const after = player(epoch, id);
     assert.equal(after.hand.length, own.cardLimit);
     assert.deepEqual(after.discard, [...own.discard, ...own.hand.filter(c => selected.some(d => d.id === c.id))]);
     assert.deepEqual(epoch.library, library); assert.deepEqual(epoch.removedCards, removed);
     coverage.handDiscards += overflow; coverage.schoolExceptions += selected.filter(c => c.schoolId).length;
     coverage.powerExceptions += selected.filter(c => c.powerful).length; own = after;
    }
    await act({ type: 'DISCARD_HAND_LIMIT', playerId: id, cardIds: [] }, /No cards over/); coverage.emptyHandLimits++;
    await act(prepare());
   }
   assert.equal(epoch.phase, 'ACTION'); assert.equal(epoch.currentPlayerId, 'p1');
   assert.equal(epoch.activation!.physicalAction, null);
  }

  function spellTarget(id: string, card: Card) {
   const p = player(epoch, id);
   const legal = (owner: string, kind: 'MAGE' | 'EVOCATION', position: Hex) =>
    spellCanTargetModel(card, id, owner, kind) && isWithinSpellRange(p.wizard.position, position, card.range) && !roomAt(epoch, position).startingFor;
   if (card.target === 'SELF') {
    assert.ok(legal(id, 'MAGE', p.wizard.position)); return { targetPlayerId:id };
   }
   if (card.target !== 'ROOM' && !canUseSpellDummy(card)) {
    const mage = [...epoch.players].sort((a, b) => b.wizard.damageCubes - a.wizard.damageCubes)
     .find(t => legal(t.id, 'MAGE', t.wizard.position) && (!card.damage || t.id === id));
    if (mage) return { targetPlayerId:mage.id };
    const model = [...epoch.evocations].sort((a, b) => b.damageCubes - a.damageCubes)
     .find(e => legal(e.playerId, 'EVOCATION', e.position) && (!card.damage || e.playerId === id));
    assert.ok(model, `This planned cast requires a real safe ${card.target} target`);
    return { targetEvocationId:model.id };
   }
    const room = epoch.board.rooms.find(r => !r.startingFor && r.tiles.some(h => isWithinSpellRange(p.wizard.position, h, card.range)) &&
    !epoch.players.some(other => other.id !== id && r.tiles.some(h => sameHex(h, other.wizard.position))) &&
    !epoch.evocations.some(e => e.playerId !== id && r.tiles.some(h => sameHex(h, e.position))));
   assert.ok(room, 'Every planned cast has a real safe room target');
   return { roomId: room.id, ...(canUseSpellDummy(card) ? { dummy: true } : {}) };
  }
  async function castAvailable(id: string, numberedOnly = false) {
   epoch = await client(id).sync(epoch);
   if (epoch.phase !== 'ACTION' || epoch.currentPlayerId !== id) return false;
   const p = player(epoch, id), next = slots.slice(0, 3).find(slot => p.prepared[slot] && !p.prepared[slot]!.used);
   const slot = !epoch.activation!.sequencedSpellUsed && next ? next : !numberedOnly && p.prepared.rapid && !p.prepared.rapid.used ? 'rapid' : null;
    if (!slot) return false;
    const card = p.prepared[slot]!.card, before = epoch;
    const rangeCoverage = card.powerful ? 'offAxisPowerful' : 'offAxisPrepared';
  if (!coverage[rangeCoverage] && (card.target === 'ROOM' || canUseSpellDummy(card))) {
   const origin = p.wizard.position;
   const offLine = epoch.board.rooms.find(r => !r.startingFor && r.tiles.some(h =>
    distance(origin, h) <= card.range && h.q !== origin.q && h.r !== origin.r && h.q + h.r !== origin.q + origin.r));
   if (offLine) {
    const targeting = { roomId: offLine.id, ...(canUseSpellDummy(card) ? { dummy: true } : {}) };
    await act({ type: 'CAST_SPELL', playerId: id, slot, ...targeting }, /Room out of range/);
    assert.deepEqual(epoch, before, 'Rejected off-axis spells must preserve the entire authoritative state');
    coverage[rangeCoverage]++;
   }
  }
  await act({ type: 'CAST_SPELL', playerId: id, slot, ...spellTarget(id, card) });
    if (card.heal) checkHealingFacts(before, epoch, id);
   assert.equal(player(epoch, id).actionTokens, p.actionTokens);
    if (!card.heal && !card.convert) {
     assert.deepEqual(epoch.players.map(p => p.wizard), before.players.map(p => p.wizard));
     assert.deepEqual(epoch.evocations.map(({ activated, ...e }) => e), before.evocations.map(({ activated, ...e }) => e));
    }
   coverage.prepared++; preparedByRound[before.round - 1]++;
   if (slot === 'rapid') coverage.flexible++; else coverage.numbered++;
   assert.equal(player(epoch, id).prepared[slot]!.used, true);
    if (card.powerful) {
    coverage.powerful++; assert.ok(epoch.removedCards.some(c => c.id === card.id));
    assert.ok(!player(epoch, id).discard.some(c => c.id === card.id));
    assert.ok(!epoch.library.some(d => d.discard.some(c => c.id === card.id)));
    if (sameTurn(before, id))
    await act({ type: 'CAST_SPELL', playerId: id, slot, ...spellTarget(id, card) }, /Spell unavailable/);
   }
   if (sameTurn(before, id) && player(epoch, id).actionTokens === 0 && epoch.activation!.sequencedSpellUsed &&
   slots.slice(0, 3).some(key => player(epoch, id).prepared[key] && !player(epoch, id).prepared[key]!.used)) {
   // Check before the flexible spell is spent: afterward automatic exhaustion
   // may hand off immediately, leaving no manual-drain branch to test passing.
   await act({ type: 'PASS_ROUND', playerId: id }, /no physical tokens and no unused spells/); coverage.futurePass++;
  }
   return true;
  }
  async function handTurn(id: string) {
   epoch = await client(id).sync(epoch); const before = epoch;
   assert.equal(before.phase, 'ACTION'); assert.equal(before.currentPlayerId, id);
   assert.equal(before.activation!.actionsUsed, 1, 'Voluntary handoff must follow one real action');
   assert.ok(!before.activation!.physicalAction); assert.equal(before.evocationActivation, null);
   await act({ type: 'END_ACTIVATION', playerId: id });
   assert.ok(!sameTurn(before, id), 'END_ACTIVATION must start a fresh turn');
   assert.deepEqual(epoch.players, before.players, 'Ending a turn must retain round tokens and unused spells');
   if (epoch.phase === 'ACTION') assert.equal(epoch.activation!.actionsUsed, 0);
  }
  async function waitTurn(id: string) {
   assert.equal(epoch.phase, 'ACTION');
   if (epoch.currentPlayerId === id) return;
   const other = epoch.currentPlayerId!;
   // Yield legally without stealing a planned physical token or discarding a spell.
   if (epoch.activation!.actionsUsed === 0) assert.ok(await castAvailable(other), `${other} needs a real spell to yield`);
   if (epoch.phase === 'ACTION' && epoch.currentPlayerId === other) await handTurn(other);
   assert.equal(epoch.phase, 'ACTION'); assert.equal(epoch.currentPlayerId, id);
   assert.equal(epoch.activation!.actionsUsed, 0); coverage.yields++;
  }
  async function drainAction() {
   for (let guard = 0; epoch.phase === 'ACTION'; guard++) {
    assert.ok(guard < 60); const id = epoch.currentPlayerId!;
    assert.ok(!epoch.activation!.physicalAction); assert.equal(epoch.evocationActivation, null);
    if (await castAvailable(id)) continue;
    assert.equal(player(epoch, id).actionTokens, 0);
    await act({ type: 'PASS_ROUND', playerId: id }, /no physical tokens and no unused spells/); coverage.futurePass++;
    await handTurn(id);
   }
  assert.equal(epoch.phase, epoch.evocations.length ? 'EVOCATION' : epoch.round === 3 ? 'GAME_OVER' : 'CLEANUP');
   assert.ok(epoch.players.every(p => p.actionTokens === 0 && !p.passed && Object.values(p.prepared).every(c => !c || c.used)));
   assert.ok(epoch.evocations.every(e => !e.activated));
  }
  function pathIntoRoom(source: Hex, target: Hex, moves: number): Hex[] | undefined {
   const frontier = [{ position: source, path: [] as Hex[] }], seen = new Set<string>();
   for (let i = 0; i < frontier.length; i++) {
    const { position, path } = frontier[i];
    if (areInSameRoom(epoch, position, target)) return path;
    if (path.length === moves) continue;
    for (const tile of epoch.board.tiles) {
     const key = `${tile.q},${tile.r}`;
     if (distance(position, tile) !== 1 || seen.has(key) || roomAt(epoch, tile).startingFor) continue;
     seen.add(key); frontier.push({ position: tile, path: [...path, tile] });
    }
   }
   return undefined;
  }
  async function freePhase(round: number) {
   const used = new Set<string>();
   for (let guard = 0; epoch.phase === 'EVOCATION'; guard++) {
    assert.ok(guard < 12); const id = epoch.currentPlayerId!, other = id === 'p1' ? 'p2' : 'p1';
    const unused = epoch.evocations.filter(e => e.playerId === id && !e.activated); assert.ok(unused.length);
    const previous = epoch.evocations.find(e => e.playerId === id && e.activated);
    if (previous) { await act({ type: 'ACTIVATE_EVOCATION', playerId: id, evocationId: previous.id }, /already activated/); coverage.once++; }
    const foreign = epoch.evocations.find(e => e.playerId === other);
    if (foreign) await act({ type: 'ACTIVATE_EVOCATION', playerId: id, evocationId: foreign.id }, /only your own/);
    const e = unused.at(-1)!; assert.ok(!used.has(e.id)); used.add(e.id);
    await act({ type: 'ACTIVATE_EVOCATION', playerId: id, evocationId: e.id }); coverage.freeEvocations++;
    assert.deepEqual(epoch.evocationActivation, { evocationId: e.id, playerId: id, movesRemaining: e.movement, returnToAction: false });
    assert.equal(player(epoch, id).actionTokens, 0);
    await act({ type: 'ACTIVATE_EVOCATION', playerId: id, evocationId: e.id }, /Finish the active evocation/);
    await act({ type: 'EVOCATION_ATTACK', playerId: id, targetId: id }, /friendly evocations/);
    await act({ type: 'EVOCATION_ATTACK', playerId: id, targetId: e.id }, /friendly evocations/);
    const outOfRoom = [
     ...epoch.players.filter(p => p.id !== id).map(p => ({ id: p.id, position: p.wizard.position })),
     ...epoch.evocations.filter(t => t.playerId !== id),
    ].find(t => !roomAt(epoch, t.position).startingFor && !areInSameRoom(epoch, e.position, t.position));
    if (outOfRoom) {
     await act({ type: 'EVOCATION_ATTACK', playerId: id, targetId: outOfRoom.id }, /^Target must be in the same room$/);
     coverage.evocationRangeRejections++;
    }
    const start = epoch.board.rooms.find(r => r.startingFor && distance(r.tiles[0], e.position) === 1);
    if (start) await act({ type: 'EVOCATION_STEP', playerId: id, destination: start.tiles[0] }, /cannot enter starting rooms/);
    if (round === 2) {
     await act({ type: 'EVOCATION_STEP', playerId: id, destination: { q: 1, r: 0 } });
     await act({ type: 'EVOCATION_STEP', playerId: id, destination: { q: 1, r: -1 } });
     await act({ type: 'EVOCATION_STEP', playerId: id, destination: { q: 0, r: 0 } }, /No evocation movement/);
    }
    // Use the current model position and its actual remaining allowance. A
    // neighboring room is not attack range: first follow legal adjacent steps
    // into that room, rather than silently dropping all summon combat coverage.
    const active = epoch.evocations.find(t => t.id === e.id)!;
    const reachable = round === 3 && id === 'p1' ? epoch.evocations.filter(t => t.playerId !== id)
     .map(target => ({ target, path: pathIntoRoom(active.position, target.position, epoch.evocationActivation!.movesRemaining) }))
     .filter((choice): choice is { target: typeof active; path: Hex[] } => choice.path !== undefined)
     .sort((a, b) => a.path.length - b.path.length) : [];
    const choice = reachable[0], target = choice?.target;
    if (target) {
     for (const destination of choice.path) {
      await act({ type: 'EVOCATION_STEP', playerId: id, destination }); coverage.evocationCombatSteps++;
     }
     assert.ok(areInSameRoom(epoch, epoch.evocations.find(t => t.id === e.id)!.position, target.position));
     const before = player(epoch, id);
     await act({ type: 'EVOCATION_ATTACK', playerId: id, targetId: target.id });
     assert.ok(!epoch.evocations.some(t => t.id === target.id)); coverage.destroyed++;
     assert.equal(player(epoch, id).cubes.onEvocations, before.cubes.onEvocations);
     assert.equal(player(epoch, id).victoryPoints, before.victoryPoints); assert.equal(player(epoch, id).kills, before.kills);
    } else await act({ type: 'END_EVOCATION', playerId: id });
    assert.equal(epoch.evocationActivation, null);
    const next = [other, id].find(owner => epoch.evocations.some(e => e.playerId === owner && !e.activated));
    if (next) { assert.equal(epoch.phase, 'EVOCATION'); assert.equal(epoch.currentPlayerId, next); if (next === id) coverage.ownerSkips++; }
    else assert.equal(epoch.phase, round === 3 ? 'GAME_OVER' : 'CLEANUP');
   }
     assert.equal(epoch.phase, round === 3 ? 'GAME_OVER' : 'CLEANUP'); assert.ok(epoch.evocations.every(e => e.activated));
  }

  // Round 1: discard exit + Explore use the first two-action turn. The
  // second Violet draw belongs to a later turn; discard spends no round token.
  await studyAndPrepare();
  await command(b, { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' }, /cannot act for another player/);
  await act({ type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p2', kind: 'EXPLORE' }, /Not your turn/);
  await act({ type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'ATTACK' }, /starting room/);
  await act({ type: 'PASS_ROUND', playerId: 'p1' }, /no physical tokens and no unused spells/);
  const exit = player(await a.sync(epoch), 'p1').prepared.rapid!.card;
  await act({ type: 'DISCARD_EXIT', playerId: 'p1', cardId: exit.id, destination: { q: 2, r: -2 } });
  coverage.discardExits++;
  assert.equal(player(epoch, 'p1').actionTokens, 2); assert.equal(epoch.activation!.actionsUsed, 1);
  assert.equal(player(epoch, 'p1').prepared.rapid!.used, true);
  const exitDiscard = exit.schoolId ? epoch.library.find(d => d.id === exit.schoolId)!.discard : player(epoch, 'p1').discard;
  assert.ok(exitDiscard.some(c => c.id === exit.id), 'Discard exit must retain normal card-origin routing');
  await begin('p1'); await locks('p1');
  await act({ type: 'INFLICT_ATTACK', playerId: 'p1', targetId: 'p2' }, /pending Attack/);
  await movement('p1', [{ q: 1, r: -1 }, { q: 0, r: -1 }]); await activateRoom('p1');
  assert.equal(epoch.currentPlayerId, 'p2'); assert.equal(player(epoch, 'p1').actionTokens, 1);
  await begin('p2'); await act({ type: 'ACTIVATE_ROOM', playerId: 'p2' }, /starting room/);
  await act({ type: 'PERFORM_MOVEMENT', playerId: 'p2' });
  await act({ type: 'EXPLORE_STEP', playerId: 'p2', destination: { q: -2, r: 2 } });
  await act({ type: 'EXPLORE_STEP', playerId: 'p2', destination: { q: -3, r: 2 } }, /cannot enter or reenter/);
  await act({ type: 'END_EXPLORE', playerId: 'p2' }); await activateRoom('p2');
  await waitTurn('p1');
  const beforeViolet = player(await a.sync(epoch), 'p1').hand.length;
  await begin('p1'); await activateRoom('p1'); await movement('p1', []);
  assert.equal(player(await a.sync(epoch), 'p1').hand.length, beforeViolet + 1, 'The second Violet activation draws one from the finite personal deck');
  await waitTurn('p2');
  await begin('p2'); await movement('p2', [{ q: -1, r: 1 }, { q: 0, r: 0 }]); await activateRoom('p2');
  const heldPower = player(await b.sync(epoch), 'p2').hand.find(c => c.powerful)!;
  assert.ok(heldPower, 'A central-room forgotten spell is held, not prepared');
  await act({ type: 'CAST_POWERFUL_SPELL', playerId: 'p2', cardId: heldPower.id, ...spellTarget('p2', heldPower) }, /cannot be cast from hand/);
  coverage.heldPowerRejections++;
  await legacy('p2'); await drainAction(); await freePhase(1);
  assert.ok(player(await b.sync(epoch), 'p2').hand.some(c => c.id === heldPower.id), 'Held forgotten spells survive automatic Action exhaustion and Cleanup');

  await advance();
  await act({ type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: 'CLEANUP', expectedRound: 1 }, /Stale phase command/);
  await studyAndPrepare();
  // Round 2: Violet/Azure can retrieve only the remaining real personal cards.
  await begin('p1'); await activateRoom('p1'); await movement('p1', [{ q: 0, r: 0 }, { q: 0, r: 1 }]);
  await begin('p1'); await activateRoom('p1');
  await act({ type: 'PERFORM_MOVEMENT', playerId: 'p1' });
  await act({ type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 0, r: 0 } });
  assert.equal(epoch.activation!.exploring, 1); await locks('p1'); await skip('p1');
  assert.deepEqual(player(epoch, 'p1').wizard.position, { q: 0, r: 0 }, 'Mid-movement skip preserves the completed step');
  assert.equal(epoch.currentPlayerId, 'p2', 'Finishing the second physical action must hand off despite unused spells');
  await begin('p2'); await activateRoom('p2'); await skip('p2');
  await begin('p2'); await movement('p2', [{ q: 1, r: -1 }]);
  assert.equal(epoch.evocations.length, 0, 'Entering Grey alone never summons');
  await activateRoom('p2'); await legacy('p2'); await drainAction(); await freePhase(2);

  await advance(); await studyAndPrepare();
  // Spend numbered preparations safely before the mages meet on Grey. Reserve
  // both flexible spells for legal yields; a newly drawn forgotten spell cannot be cast.
  const plannedPreparationsRemain = () => epoch.players.some(p =>
   slots.slice(0, 3).some(slot => p.prepared[slot] && !p.prepared[slot]!.used));
  for (let guard = 0; plannedPreparationsRemain(); guard++) {
   assert.ok(guard < 12); const id: string = epoch.currentPlayerId!;
   const before = epoch;
  assert.ok(await castAvailable(id, true));
   if (sameTurn(before, id)) await handTurn(id);
  }
  assert.equal(epoch.currentPlayerId, 'p1');
  await begin('p1'); await activateRoom('p1'); await movement('p1', []);
  const latePower = player(await a.sync(epoch), 'p1').hand.find(c => c.powerful)!;
  assert.ok(latePower);
  await act({ type: 'CAST_POWERFUL_SPELL', playerId: 'p1', cardId: latePower.id, ...spellTarget('p1', latePower) }, /cannot be cast from hand/);
  coverage.heldPowerRejections++;
  assert.ok(await castAvailable('p1'));
  assert.equal(epoch.currentPlayerId, 'p2', 'Explore + prepared flexible spell must consume both actions, retaining one physical token');
  assert.equal(player(epoch, 'p1').actionTokens, 1);
  await waitTurn('p1');
  await begin('p1'); await locks('p1'); await movement('p1', [{ q: 1, r: -1 }]); await activateRoom('p1');
  assert.equal(player(epoch, 'p1').actionTokens, 0);
  while (epoch.phase === 'ACTION' && epoch.currentPlayerId === 'p1') {
   if (!await castAvailable('p1')) await handTurn('p1');
  }
  assert.equal(epoch.currentPlayerId, 'p2');
  async function attack(roomFirst: boolean) {
   await begin('p2', 'ATTACK'); await locks('p2');
   await act({ type: 'PERFORM_MOVEMENT', playerId: 'p2' }, /pending Explore/);
   await act({ type: 'INFLICT_ATTACK', playerId: 'p2', targetId: 'p2' }, /yourself|own evocations/);
   let roomUsed = false;
   if (roomFirst) roomUsed = await maybeRoom('p2');
   const before = epoch, victim = player(before, 'p1');
   assert.ok(sameHex(victim.wizard.position, player(before, 'p2').wizard.position));
   await act({ type: 'INFLICT_ATTACK', playerId: 'p2', targetId: victim.wizard.id }); coverage.attacks++;
   assert.equal(player(epoch, 'p1').wizard.damageCubes, victim.wizard.damageCubes + 2);
   assert.equal(player(epoch, 'p1').wizard.damageByPlayer.p2, (victim.wizard.damageByPlayer.p2 ?? 0) + 2);
   assert.equal(player(epoch, 'p2').cubes.onWizard, player(before, 'p2').cubes.onWizard + 2);
    if (sameTurn(before, 'p2') && epoch.activation?.physicalAction) {
    await act({ type: 'INFLICT_ATTACK', playerId: 'p2', targetId: 'p1' }, /already used/); await locks('p2');
    if (!roomFirst) roomUsed = await maybeRoom('p2');
    if (!roomUsed) await skip('p2');
   }
  }
  await attack(false); await attack(true);
  assert.equal(epoch.phase, 'EVOCATION'); await freePhase(3);
  assert.equal(epoch.phase, 'GAME_OVER'); assert.equal(epoch.endgameScored, true);
  assert.ok(player(await a.sync(epoch), 'p1').hand.some(c => c.id === latePower.id), 'A newly held forgotten spell neither casts nor prevents final Action exhaustion');
  assert.equal(coverage.settlements, 3, 'Each real round settles once; round three ends rather than starting round four');
  await advance(/The game is over/);
  await privacy();
  assert.equal(epoch.round, 3); assert.equal(coverage.prepared, 23, 'One deliberate prepared discard exit replaces a cast');
  assert.deepEqual(preparedByRound, [7, 8, 8], 'Legal yields must neither lose nor duplicate planned casts');
  assert.deepEqual([coverage.numbered, coverage.flexible, coverage.discardExits], [18, 5, 1]);
  assert.equal(coverage.begins, 12, 'Both round tokens per mage must still resolve as meaningful physical actions');
  assert.ok(coverage.cappedHandoffs > 0 && coverage.pendingAtCap > 0 && coverage.thirdRejected > 0);
  assert.ok(coverage.retainedTokens > 0 && coverage.retainedSpells > 0 && coverage.yields > 0);
  assert.ok(coverage.powerful > 0 && coverage.heldPowerRejections === 2 && coverage.drawBarriers > 0);
  assert.ok(coverage.grey >= 2 && coverage.attacks === 2 && coverage.locks > 30);
  assert.ok(coverage.emptyHandLimits > 0 && coverage.freeEvocations > 0 && coverage.destroyed > 0);
  assert.ok(coverage.evocationRangeRejections > 0, 'Different-room attacks must be rejected over the real socket');
  assert.ok(coverage.futurePass > 0 && coverage.automaticSkips > 0 && coverage.skips >= 2);
  assert.ok(coverage.offAxisPrepared > 0 && coverage.offAxisPowerful > 0, 'Both ordinary and forgotten prepared off-axis casts must be rejected over the real socket');
  console.log(`PASS: joined-only lobby grows from 1 to 2 mages, explicit schools gate readiness, six masked personal cards + one public discard per mage allocate 14/36 Cantrips, no initial hand/overflow; 120 total physical spells; auto-start on final readiness; 3 real two-client rounds; wizard max HP/attack/movement 10/2/2, limits 7/2, exactly 2 physical tokens/round. ` +
    `2 TOTAL actions/turn: ${coverage.prepared} prepared casts (${coverage.numbered} numbered/${coverage.flexible} flexible; rounds ${preparedByRound.join('/')}) ` +
  `including ${coverage.powerful} permanently removed prepared forgotten spells; ${coverage.heldPowerRejections} direct held-forgotten-spell rejections, ${coverage.drawBarriers} no-undo draw barriers + ${coverage.discardExits} discard exit, each 1 action/no physical token. ` +
   `${coverage.cappedHandoffs} automatic two-action handoffs, ${coverage.pendingAtCap} pending-effect checks at the cap, ` +
   `${coverage.thirdRejected} post-handoff action rejections; handoffs retain tokens/spells ${coverage.retainedTokens}/${coverage.retainedSpells}. ` +
   `${coverage.begins} new physical menus, ${coverage.locks} mage-lock rejections, ${coverage.skips} skips, ${coverage.attacks} distance-0 mage attacks. ` +
  `Hand overflow: ${coverage.handDiscards} to PERSONAL discard (${coverage.schoolExceptions} school, ${coverage.powerExceptions} forgotten); ` +
   `quest overflow: ${coverage.questDiscards}; empty-limit checks: ${coverage.emptyHandLimits}/${coverage.emptyQuestLimits}. ` +
   `Grey: ${coverage.grey} effects (${coverage.greyRebuilt} rebuilt, ${coverage.greyCap} cap no-ops); ` +
  `${coverage.freeEvocations} free model activations, ${coverage.ownerSkips} owner skips, ${coverage.destroyed} same-room no-score destructions; ` +
  `${coverage.evocationRangeRejections} different-room attack rejections, ${coverage.evocationCombatSteps} legal steps into enemy rooms. ` +
  `Off-axis ordinary/forgotten prepared casts rejected: ${coverage.offAxisPrepared}/${coverage.offAxisPowerful}. Round 3 GAME_OVER: ${epoch.winner}; independent room/final majority scoring, first-player bonus, privacy/cube ledgers verified.\n` +
  `GAPS: quest overflow depends on random completions; hand-limit overflow is deliberately constructed in server tests rather than fabricated at setup. Forgotten overflow, paid activations, Wounded Fury bonus and remaining combat/menu permutations stay in deterministic engine/server coverage. Rebuilt Grey may prevent one or both Attack room effects. Browser validation is separate.`);
 } finally {
  for (const ws of sockets) ws.terminate();
  if (server.exitCode === null && server.signalCode === null) {
   const exited = once(server, 'exit'); server.kill('SIGTERM');
   const timer = setTimeout(() => server.kill('SIGKILL'), 3000);
   try { await exited; } finally { clearTimeout(timer); }
  }
 }
}
main().catch(error => { console.error(error); process.exitCode = 1; });