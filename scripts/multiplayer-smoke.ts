import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import type { Card, GameAction, GameState, Hex } from '../packages/game-engine/src/types';

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
const player = (s: GameState, id: string) => {
 const p = s.players.find(p => p.id === id); assert.ok(p); return p;
};
const model = (s: GameState, id: string) => {
 const e = s.evocations.find(e => e.id === id); assert.ok(e); return e;
};
const sameHex = (a: Hex, b: Hex) => a.q === b.q && a.r === b.r;

// Compare public epochs, not just phases/log lengths (movement need not log).
// Private cards/quests differ between viewers; their identities never enter this key.
function epochKey(s: GameState) {
 return JSON.stringify({ ...s, players: s.players.map(p => {
  const { hand, personalDeck, prepared, quest, additionalQuests, ...publicPlayer } = p;
  return { ...publicPlayer, hand: hand.length, personalDeck: personalDeck.length,
   prepared: slots.map(slot => prepared[slot] ? { used: prepared[slot]!.used } : null) };
 }) });
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
 for (const p of s.players) {
  assert.equal(p.cubes.available + p.cubes.onWizard + p.cubes.onEvocations + p.cubes.onBoard, 25);
  assert.equal(p.cubes.onWizard, s.players.reduce((n, victim) => n + (victim.wizard.damageByPlayer[p.id] ?? 0), 0));
  assert.equal(p.cubes.onEvocations, s.evocations.reduce((n, victim) => n + (victim.damageByPlayer[p.id] ?? 0), 0));
  assert.equal(p.cubes.onBoard, s.board.rooms.filter(r => !r.scored).reduce((n, r) => n + (r.cubesByPlayer[p.id] ?? 0), 0));
  assert.ok(s.evocations.filter(e => e.playerId === p.id).length <= 3);
 }
 for (const e of s.evocations) {
  assert.ok(!s.board.rooms.some(r => r.startingFor && r.tiles.some(h => sameHex(h, e.position))));
 }
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
  const a = await connect(), b = await connect();
  const clients = { p1: a, p2: b };
  const client = (id: string) => { assert.ok(id === 'p1' || id === 'p2'); return clients[id]; };
  let epoch = await a.join('smoke', true, 'Ember');
  const command = async (mage: Mage, action: WireAction, error?: RegExp) => {
   await mage.sync(epoch);
   epoch = await mage.send(action, error);
   checkCubes(epoch);
   return epoch;
  };
  const act = (action: GameAction, error?: RegExp) => command(client(action.playerId), action, error);
  const advance = () => act({ type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: epoch.phase, expectedRound: epoch.round });
  const coverage = { spells: 0, futureSlotPassRejections: 0, automaticSkips: 0, onceRejections: 0, ownerSkips: 0,
   freeActivations: 0, greyStart: 0, greyEnd: 0, greyPunch: 0, greyCap: 0, greyReconstructed: 0, legacyRejections: 0 };
  const rejectLegacySummon = async (id: string) => {
   await command(client(id), { type: 'SUMMON_EVOCATION', playerId: id }, /^Unknown game action$/);
   coverage.legacyRejections++;
  };

  assert.equal(epoch.phase, 'LOBBY'); assert.equal(epoch.players[0].name, 'Ember');
  assert.ok(epoch.players.every(p => p.actionTokens === 2));
  assert.deepEqual(epoch.evocations, []); assert.equal(epoch.evocationActivation, null);
  const greyRooms = epoch.board.rooms.filter(r => r.color === 'grey');
  assert.equal(greyRooms.length, 3);
  assert.ok(greyRooms.every(r => r.effect === 'SUMMON_CADAVER'));
  await rejectLegacySummon('p1');
  await act({ type: 'SET_READY', playerId: 'p1', ready: true });
  await act({ type: 'START_GAME', playerId: 'p1' }, /Both players/);
  epoch = await b.join('smoke', false, 'Moon');
  assert.equal(epoch.players[1].name, 'Moon');
  await act({ type: 'START_GAME', playerId: 'p2' }, /Only the creator/);
  await act({ type: 'SET_READY', playerId: 'p2', ready: true });
  await act({ type: 'START_GAME', playerId: 'p1' });
  assert.equal(epoch.phase, 'BLACK_ROSE'); assert.ok(epoch.usedEvent);
  assert.equal(epoch.eventDeck.length, 0); assert.equal(epoch.questDeck.length, 0);
  assert.ok(epoch.library.every(d => d.cards.every(c => c.name === 'Hidden spell')));
  assert.equal(epoch.powerfulDeck.length, 12);
  assert.ok(epoch.powerfulDeck.every(c => c.name === 'Hidden spell' && !c.powerful));

  async function studyAndPrepare() {
   assert.equal(epoch.phase, 'BLACK_ROSE');
   assert.ok(epoch.players.every(p => p.actionTokens === 2), 'Exactly two tokens at every round refresh');
   await advance();
   for (const id of ids) {
    const own = await client(id).sync(epoch); // Never inspect a stale peer hand from a phase-only wait.
    assert.equal(own.phase, 'STUDY'); assert.equal(player(own, id).hand.length, 2);
    assert.equal(player(own, ids.find(other => other !== id)!).quest, null);
    await act({ type: 'DRAW_STUDY', playerId: id, deckId: 'school-1' });
    const hand = player(epoch, id).hand;
    assert.equal(hand.length, 6); assert.ok(hand.every(c => c.name !== 'Hidden spell'));
    const discarded = hand.slice(-2).map(c => c.id);
    await act({ type: 'DISCARD_STUDY', playerId: id, cardIds: discarded });
    assert.ok(discarded.every(cardId => epoch.library[0].discard.some(c => c.id === cardId)));
    assert.ok(player(epoch, id).discard.every(c => !discarded.includes(c.id)));
   }
   for (const id of ids) {
    const own = await client(id).sync(epoch);
    assert.equal(own.phase, 'PREPARATION');
    const hand = player(own, id).hand;
    await act({ type: 'PREPARE_CARDS', playerId: id, rapidCardId: hand[3].id, preparedCardIds: hand.slice(0, 3).map(c => c.id) });
   }
   assert.equal(epoch.phase, 'ACTION'); assert.equal(epoch.currentPlayerId, 'p1');
   const own = await a.sync(epoch);
   assert.equal(player(own, 'p2').prepared.slot1!.card.name, 'Hidden spell');
  }

  async function activateGrey(action: Extract<GameAction, { type: 'EXPLORE' | 'EXPLORE_STEP' | 'END_EXPLORE' | 'PUNCH' }>, position: Hex) {
   const id = action.playerId;
   epoch = await client(id).sync(epoch);
   const before = epoch, p = player(before, id);
   const room = before.board.rooms.find(r => r.tiles.some(h => sameHex(h, position)))!;
   assert.equal(room.color, 'grey'); assert.equal(room.effect, 'SUMMON_CADAVER');
   assert.ok(!room.reconstructed || !room.specialUsed);
   const count = before.evocations.filter(e => e.playerId === id).length;
   const reward = Math.min(room.reconstructed ? 2 : 1, 3 - count);
   const paid = action.type === 'EXPLORE' || action.type === 'PUNCH' ? 1 : 0;
   assert.ok(action.type === 'EXPLORE' && action.activateRoomAtStart ||
    action.type === 'EXPLORE_STEP' && action.activateRoomAtEnd ||
    action.type === 'END_EXPLORE' && action.activateRoomAtEnd ||
    action.type === 'PUNCH' && action.roomEffect);
   await act(action);
   const added = epoch.evocations.filter(e => !before.evocations.some(old => old.id === e.id));
   assert.equal(added.length, reward, 'Grey reward is capped by the three owned living models');
   assert.equal(epoch.evocations.filter(e => e.playerId === id).length, count + reward);
   for (const e of added) {
    assert.equal(e.playerId, id); assert.deepEqual(e.position, position);
    assert.deepEqual([e.name, e.archetype, e.movement, e.attack, e.health, e.passive, e.damageCubes, e.activated],
     ['Cadaver', 'UNDEAD', 2, 2, 2, 'WOUNDED_FURY', 0, false]);
    assert.deepEqual(e.damageByPlayer, {});
   }
   assert.equal(player(epoch, id).actionTokens, p.actionTokens - paid, 'Only Explore/Punch spends a token; Grey summoning is free');
   assert.equal(epoch.activation!.actionsUsed, before.activation!.actionsUsed + paid, 'Grey summoning spends no extra physical action');
   assert.equal(epoch.activation!.roomEffectUsed, true);
   assert.equal(epoch.board.rooms.find(r => r.id === room.id)!.specialUsed, room.reconstructed);
   assert.deepEqual(epoch.library, before.library, 'Grey must not draw from or recycle any school');
   assert.deepEqual(epoch.players.map(p => p.hand), before.players.map(p => p.hand));
   // Punch can change enemy damage, but it cannot otherwise replace existing summons.
   assert.ok(before.evocations.every(e => epoch.evocations.some(after => after.id === e.id)));
   if (action.type !== 'PUNCH') {
    assert.deepEqual(epoch.evocations.filter(e => before.evocations.some(old => old.id === e.id)), before.evocations);
    assert.deepEqual(epoch.players.map(p => p.wizard.damageByPlayer), before.players.map(p => p.wizard.damageByPlayer));
    assert.deepEqual(epoch.players.map(p => p.cubes), before.players.map(p => p.cubes));
   }
   if (action.type === 'EXPLORE') coverage.greyStart++;
   else if (action.type === 'PUNCH') coverage.greyPunch++;
   else coverage.greyEnd++;
   if (count === 3) coverage.greyCap++;
   if (room.reconstructed) coverage.greyReconstructed++;
   return added.map(e => e.id);
  }

  async function paidActivate(id: string, evocationId: string) {
   const before = epoch;
   await act({ type: 'ACTIVATE_EVOCATION', playerId: id, evocationId });
   assert.equal(player(epoch, id).actionTokens, player(before, id).actionTokens - 1);
   assert.equal(epoch.activation!.actionsUsed, before.activation!.actionsUsed + 1);
   assert.equal(epoch.evocationActivation!.returnToAction, true);
   assert.deepEqual(epoch.evocations, before.evocations, 'Paid activation neither summons nor spends the free phase activation');
   assert.deepEqual(epoch.board.rooms, before.board.rooms, 'Paid activation never triggers a Grey room effect');
  }

  const roomTarget = (s: GameState, id: string, card: Card) => {
   const p = player(s, id), room = s.board.rooms.find(r => r.tiles.some(h => sameHex(h, p.wizard.position)))!;
   assert.ok(!room.startingFor);
   // Real room damage must not accidentally kill the other mage's surviving models.
   assert.ok(!s.evocations.some(e => e.playerId !== id && room.tiles.some(h => sameHex(h, e.position))));
   assert.ok(!s.players.some(other => other.id !== id && room.tiles.some(h => sameHex(h, other.wizard.position))));
   return { roomId: room.id, ...(card.target === 'MODEL' ? { dummy: true } : {}) };
  };

  async function drainAction() {
   for (let guard = 0; epoch.phase === 'ACTION'; guard++) {
    assert.ok(guard < 60, 'Action drain did not converge');
    const id = epoch.currentPlayerId!;
    epoch = await client(id).sync(epoch);
    assert.equal(epoch.activation!.exploring, 0); assert.equal(epoch.evocationActivation, null);
    const p = player(epoch, id), a = epoch.activation!;
    const numbered = slots.slice(0, 3).find(slot => p.prepared[slot] && !p.prepared[slot]!.used);
    const slot = !a.sequencedSpellUsed && numbered ? numbered : p.prepared.rapid && !p.prepared.rapid.used ? 'rapid' : null;
    const power = p.hand.find(c => c.powerful);
    if (slot || power) {
     const card = slot ? p.prepared[slot]!.card : power!;
     const before = epoch;
     await act(slot ? { type: 'CAST_SPELL', playerId: id, slot, ...roomTarget(epoch, id, card) }
      : { type: 'CAST_POWERFUL_SPELL', playerId: id, cardId: card.id, ...roomTarget(epoch, id, card) });
     assert.equal(player(epoch, id).actionTokens, p.actionTokens, 'Spells are genuinely free');
      // The last spell can enter EVOCATION and reset phase flags; identities, positions and damage must survive.
      const physicalModels = (s: GameState) => s.evocations.map(({ activated, ...e }) => e);
      assert.deepEqual(physicalModels(epoch), physicalModels(before), 'Own-room/dummy spells must preserve friendly summons');
      if (epoch.phase === 'ACTION') assert.deepEqual(epoch.evocations, before.evocations);
     assert.deepEqual(epoch.players.map(p => p.wizard), before.players.map(p => p.wizard));
     if (slot) assert.equal(player(epoch, id).prepared[slot]!.used, true);
     coverage.spells++;
      // Check while this mage still has a legal free option. With only quota-blocked
      // future slots left, automatic exhaustion already starts the next mage's turn.
      if (epoch.phase === 'ACTION' && epoch.currentPlayerId === id && player(epoch, id).actionTokens === 0 &&
       epoch.activation!.sequencedSpellUsed && slots.slice(0, 3).some(key => !player(epoch, id).prepared[key]!.used)) {
       await act({ type: 'PASS_ROUND', playerId: id }, /no physical tokens and no unused spells/);
       coverage.futureSlotPassRejections++;
      }
     if (epoch.phase !== 'ACTION' || epoch.currentPlayerId !== id) coverage.automaticSkips++;
    } else if (p.actionTokens > 0) {
     const e = epoch.evocations.find(e => e.playerId === id)!; assert.ok(e);
      await paidActivate(id, e.id);
     await act({ type: 'END_EVOCATION', playerId: id });
    } else if (numbered) {
     assert.equal(a.sequencedSpellUsed, true, 'Remaining ordered slots require a later turn, not a round pass');
     await act({ type: 'PASS_ROUND', playerId: id }, /no physical tokens and no unused spells/);
     coverage.futureSlotPassRejections++;
     await act({ type: 'END_ACTIVATION', playerId: id });
    } else {
     assert.fail('An exhausted mage should have been skipped automatically');
    }
   }
   assert.equal(epoch.phase, 'EVOCATION');
   assert.ok(epoch.players.every(p => p.actionTokens === 0 && !p.passed));
   assert.ok(epoch.players.every(p => Object.values(p.prepared).every(c => !c || c.used) && !p.hand.some(c => c.powerful)));
   assert.ok(epoch.evocations.every(e => !e.activated), 'Phase flags reset independently of paid Action activations');
  }

  let woundedId = '', enemyOldId = '';
  async function evocationPhase(round: number) {
   assert.equal(epoch.phase, 'EVOCATION');
   const used = new Set<string>();
   let destroyedWounded = false, onceThisRound = 0, skipsThisRound = 0;
   for (let guard = 0; epoch.phase === 'EVOCATION'; guard++) {
    assert.ok(guard < 12, 'Evocation drain did not converge');
    const id = epoch.currentPlayerId!, opponent = ids.find(other => other !== id)!;
    const unused = epoch.evocations.filter(e => e.playerId === id && !e.activated);
    assert.ok(unused.length > 0, 'Owners without unused models must be skipped');
    const previous = epoch.evocations.find(e => e.playerId === id && e.activated);
    if (previous) {
     await act({ type: 'ACTIVATE_EVOCATION', playerId: id, evocationId: previous.id }, /already activated this phase/);
     coverage.onceRejections++; onceThisRound++;
    }
    const foreign = epoch.evocations.find(e => e.playerId === opponent);
    if (foreign) {
     await act({ type: 'ACTIVATE_EVOCATION', playerId: id, evocationId: foreign.id }, /only your own/);
     await act({ type: 'ACTIVATE_EVOCATION', playerId: opponent, evocationId: foreign.id }, /Not your turn/);
    }
    // Explicit model choice, not an implicit first-model queue. Finish the wounded model before destroying it in round 3.
    const e = round === 3 && id === 'p1' && !used.has(woundedId) ? model(epoch, woundedId) : unused.at(-1)!;
    assert.ok(!used.has(e.id));
    await act({ type: 'ACTIVATE_EVOCATION', playerId: id, evocationId: e.id });
    used.add(e.id); coverage.freeActivations++;
    assert.equal(model(epoch, e.id).activated, true);
    assert.equal(player(epoch, id).actionTokens, 0);
    assert.deepEqual(epoch.evocationActivation, { evocationId: e.id, playerId: id, movesRemaining: 2, returnToAction: false });
    await act({ type: 'ACTIVATE_EVOCATION', playerId: id, evocationId: unused[0].id }, /Finish the active evocation/);
    await act({ type: 'EVOCATION_STEP', playerId: opponent, destination: { q: 0, r: 0 } }, /No active evocation/);
    await act({ type: 'EVOCATION_ATTACK', playerId: id, targetId: player(epoch, id).wizard.id }, /friendly evocations/);
    const friendly = epoch.evocations.find(other => other.playerId === id && other.id !== e.id) ?? e;
    await act({ type: 'EVOCATION_ATTACK', playerId: id, targetId: friendly.id }, /friendly evocations/);
    const beforeFinish = () => {
     const start = ids.indexOf(id as typeof ids[number]);
     return [ids[(start + 1) % 2], id].find(owner => epoch.evocations.some(e => e.playerId === owner && !e.activated)) ?? null;
    };
    let expected: string | null;
    if (round === 1 && id === 'p1') {
     await act({ type: 'EVOCATION_ATTACK', playerId: id, targetId: 'p2' }, /Target not adjacent/);
     await act({ type: 'EVOCATION_STEP', playerId: id, destination: { q: 0, r: 0 } });
     await act({ type: 'EVOCATION_STEP', playerId: id, destination: { q: -1, r: 1 } });
     assert.equal(epoch.evocationActivation!.movesRemaining, 0);
     await act({ type: 'EVOCATION_STEP', playerId: id, destination: { q: -2, r: 1 } }, /No evocation movement/);
     const before = epoch; expected = beforeFinish();
     await act({ type: 'EVOCATION_ATTACK', playerId: id, targetId: player(epoch, 'p2').wizard.id });
     assert.equal(player(epoch, 'p2').wizard.damageCubes, player(before, 'p2').wizard.damageCubes + 2);
     assert.equal(player(epoch, 'p2').wizard.damageByPlayer.p1, 2);
     assert.equal(player(epoch, 'p1').cubes.onWizard, player(before, 'p1').cubes.onWizard + 2);
     await act({ type: 'EVOCATION_ATTACK', playerId: id, targetId: 'p2' }, /No active evocation/);
    } else if (round === 1) {
     await act({ type: 'EVOCATION_STEP', playerId: id, destination: { q: -3, r: 2 } }, /cannot enter starting rooms/);
    await act({ type: 'EVOCATION_STEP', playerId: id, destination: { q: -1, r: 1 } });
     await act({ type: 'EVOCATION_STEP', playerId: id, destination: { q: -1, r: 0 } });
     expected = beforeFinish();
     await act({ type: 'END_EVOCATION', playerId: id });
    } else if (round === 3 && id === 'p2' && !destroyedWounded) {
    await act({ type: 'EVOCATION_STEP', playerId: id, destination: { q: -1, r: 1 } });
     const before = player(epoch, id); assert.equal(before.cubes.onEvocations, 1);
     // Target already activated, so its removal does not change the next-owner calculation.
     expected = beforeFinish();
     await act({ type: 'EVOCATION_ATTACK', playerId: id, targetId: woundedId });
     assert.ok(!epoch.evocations.some(e => e.id === woundedId));
     assert.equal(player(epoch, id).cubes.onEvocations, 0);
     assert.equal(player(epoch, id).cubes.available, before.cubes.available + 1);
     assert.equal(player(epoch, id).victoryPoints, before.victoryPoints);
     assert.equal(player(epoch, id).kills, before.kills);
     destroyedWounded = true;
     await act({ type: 'EVOCATION_ATTACK', playerId: id, targetId: 'p1' }, /No active evocation/);
    } else {
     expected = beforeFinish();
     await act({ type: 'END_EVOCATION', playerId: id });
    }
    assert.equal(epoch.evocationActivation, null);
    if (expected) {
     assert.equal(epoch.phase, 'EVOCATION'); assert.equal(epoch.currentPlayerId, expected);
     if (expected === id) { coverage.ownerSkips++; skipsThisRound++; }
    } else assert.equal(epoch.phase, 'CLEANUP');
   }
   assert.ok(epoch.evocations.every(e => e.activated));
   if (round === 2) { assert.ok(onceThisRound > 0); assert.ok(skipsThisRound > 0); }
   if (round === 3) { assert.ok(used.has(woundedId)); assert.ok(destroyedWounded); }
   assert.equal(epoch.phase, 'CLEANUP');
  }

  // Round 1: Explore-end Grey summons are free; pay only for Explore/model activation.
  await studyAndPrepare();
  await act({ type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: 'ACTION', expectedRound: 1 }, /finishes when all players/);
  await command(b, { type: 'EXPLORE', playerId: 'p1' }, /cannot act for another player/);
  await act({ type: 'EXPLORE', playerId: 'p2' }, /Not your turn/);
  await act({ type: 'PASS_ROUND', playerId: 'p1' }, /no physical tokens and no unused spells/);
  await rejectLegacySummon('p1');
  await act({ type: 'EXPLORE', playerId: 'p1', activateRoomAtStart: true }, /No room effect in a starting room/);
  await act({ type: 'EXPLORE', playerId: 'p1' });
  assert.equal(player(epoch, 'p1').actionTokens, 1);
  await act({ type: 'PASS_ROUND', playerId: 'p1' }, /Finish exploring/);
  await rejectLegacySummon('p1');
  await act({ type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 2, r: -2 } });
  await act({ type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 3, r: -2 } }, /cannot enter or reenter/);
  [woundedId] = await activateGrey({ type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 1, r: -1 }, activateRoomAtEnd: true }, { q: 1, r: -1 });
  assert.ok(woundedId); assert.equal(player(epoch, 'p1').actionTokens, 1);
  await rejectLegacySummon('p1'); // Even on Grey with a token, direct summoning is unknown.
  await paidActivate('p1', woundedId);
  await act({ type: 'END_EVOCATION', playerId: 'p1' });
  assert.equal(player(epoch, 'p1').actionTokens, 0); assert.equal(epoch.activation!.actionsUsed, 2);
  await act({ type: 'PASS_ROUND', playerId: 'p1' }, /no physical tokens and no unused spells/);
  await act({ type: 'END_ACTIVATION', playerId: 'p1' });
  await act({ type: 'EXPLORE', playerId: 'p2' });
  assert.equal(player(epoch, 'p2').actionTokens, 1);
  await act({ type: 'EXPLORE_STEP', playerId: 'p2', destination: { q: -2, r: 2 } });
  const originalQuest = player(epoch, 'p2').quest!.id;
  await act({ type: 'END_EXPLORE', playerId: 'p2', activateRoomAtEnd: true });
  assert.equal(player(epoch, 'p2').quest!.id, originalQuest);
  assert.equal(player(epoch, 'p2').additionalQuests.length, 1);
  const peer = await a.sync(epoch);
  assert.equal(player(peer, 'p2').quest, null); assert.deepEqual(player(peer, 'p2').additionalQuests, []);
  await act({ type: 'EXPLORE', playerId: 'p2' });
  await act({ type: 'EXPLORE_STEP', playerId: 'p2', destination: { q: -2, r: 1 } });
  assert.equal(epoch.evocations.filter(e => e.playerId === 'p2').length, 0, 'Entering Grey without activating must not summon');
  [enemyOldId] = await activateGrey({ type: 'END_EXPLORE', playerId: 'p2', activateRoomAtEnd: true }, { q: -2, r: 1 });
  assert.ok(enemyOldId); assert.equal(player(epoch, 'p2').actionTokens, 0);
  await drainAction(); await evocationPhase(1);

  await advance();
  assert.equal(epoch.round, 2); assert.equal(epoch.phase, 'BLACK_ROSE');
  assert.ok(epoch.players.every(p => p.actionTokens === 2));
  await act({ type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: 'CLEANUP', expectedRound: 1 }, /Stale phase command/);

  // Round 2: central gift, then a fresh Grey destination; two vs three models test owner skipping.
  await studyAndPrepare();
  await act({ type: 'EXPLORE', playerId: 'p1' });
  await act({ type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 0, r: 0 } });
  await act({ type: 'END_EXPLORE', playerId: 'p1', activateRoomAtEnd: true });
  const gift = player(epoch, 'p1').hand.find(c => c.powerful)!; assert.ok(gift && gift.name !== 'Hidden spell');
  const masked = await b.sync(epoch);
  assert.ok(player(masked, 'p1').hand.every(c => c.name === 'Hidden spell' && !c.powerful));
  await act({ type: 'EXPLORE', playerId: 'p1' });
  await act({ type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 0, r: 1 } });
  await activateGrey({ type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 0, r: 2 }, activateRoomAtEnd: true }, { q: 0, r: 2 });
  const castPower: GameAction = { type: 'CAST_POWERFUL_SPELL', playerId: 'p1', cardId: gift.id, ...roomTarget(epoch, 'p1', gift) };
  await act(castPower);
  assert.equal(epoch.activation!.actionsUsed, 2); assert.equal(player(epoch, 'p1').actionTokens, 0);
  assert.equal(epoch.activation!.sequencedSpellUsed, false);
  assert.ok(epoch.removedCards.some(c => c.id === gift.id));
  assert.ok(!player(epoch, 'p1').discard.some(c => c.id === gift.id));
  assert.ok(!epoch.library.some(d => d.discard.some(c => c.id === gift.id)));
  await act(castPower, /Spell unavailable/);
  await act({ type: 'END_ACTIVATION', playerId: 'p1' });
  await activateGrey({ type: 'EXPLORE', playerId: 'p2', activateRoomAtStart: true }, { q: -2, r: 1 });
  await act({ type: 'END_EXPLORE', playerId: 'p2', activateRoomAtEnd: true }, /Room effect already used/);
  await act({ type: 'END_EXPLORE', playerId: 'p2' });
  // Random spell/event instability may have rebuilt this Grey room. Its double
  // reward already fills the cap; never illegally reuse a reconstructed special.
  if (epoch.evocations.filter(e => e.playerId === 'p2').length < 3) {
   await activateGrey({ type: 'EXPLORE', playerId: 'p2', activateRoomAtStart: true }, { q: -2, r: 1 });
   await act({ type: 'END_EXPLORE', playerId: 'p2' });
  } else {
   await act({ type: 'EXPLORE', playerId: 'p2', activateRoomAtStart: true }, /Reconstructed room special already used/);
   await paidActivate('p2', enemyOldId);
   await act({ type: 'END_EVOCATION', playerId: 'p2' });
  }
  assert.equal(epoch.evocations.filter(e => e.playerId === 'p1').length, 2);
  assert.equal(epoch.evocations.filter(e => e.playerId === 'p2').length, 3);
  await drainAction(); await evocationPhase(2);

  await advance(); await studyAndPrepare();
  // Round 3: Grey fills/caps ownership; Punch's Grey effect is a legal no-op at
  // capacity, while paid activation still costs a token and locks mage commands.
  await activateGrey({ type: 'EXPLORE', playerId: 'p1', activateRoomAtStart: true }, { q: 0, r: 2 });
  await act({ type: 'END_EXPLORE', playerId: 'p1' });
  assert.equal(epoch.evocations.filter(e => e.playerId === 'p1').length, 3);
  assert.equal(player(epoch, 'p1').actionTokens, 1);
  await rejectLegacySummon('p1');
  await act({ type: 'ACTIVATE_EVOCATION', playerId: 'p1', evocationId: enemyOldId }, /only your own/);
  await act({ type: 'END_ACTIVATION', playerId: 'p1' });
  assert.equal(player(epoch, 'p2').actionTokens, 2);
  await rejectLegacySummon('p2');
  await activateGrey({ type: 'PUNCH', playerId: 'p2', targetId: woundedId, roomEffect: 'END' }, { q: -2, r: 1 });
  assert.match(epoch.log.join('\n'), /already controls 3 evocations; no Cadaver summoned/);
  assert.equal(model(epoch, woundedId).damageCubes, 1);
  assert.deepEqual(model(epoch, woundedId).damageByPlayer, { p2: 1 });
  assert.equal(player(epoch, 'p2').cubes.onEvocations, 1);
  await paidActivate('p2', enemyOldId);
  assert.equal(player(epoch, 'p2').actionTokens, 0); assert.equal(epoch.activation!.actionsUsed, 2);
  assert.equal(epoch.evocationActivation!.returnToAction, true);
  for (const action of [
    { type: 'EXPLORE', playerId: 'p2' }, { type: 'PUNCH', playerId: 'p2', targetId: woundedId },
   { type: 'END_ACTIVATION', playerId: 'p2' }, { type: 'PASS_ROUND', playerId: 'p2' },
   { type: 'CAST_SPELL', playerId: 'p2', slot: 'rapid', roomId: 'room--2,2' },
   { type: 'ACTIVATE_EVOCATION', playerId: 'p2', evocationId: enemyOldId },
  ] satisfies GameAction[]) await act(action, /Finish the active evocation/);
  await rejectLegacySummon('p2');
  await act({ type: 'END_EVOCATION', playerId: 'p2' });
  assert.equal(epoch.phase, 'ACTION'); assert.equal(epoch.currentPlayerId, 'p2'); assert.equal(epoch.evocationActivation, null);
  await act({ type: 'END_ACTIVATION', playerId: 'p2' });
  const previousPhaseFlag = model(epoch, woundedId).activated;
  await paidActivate('p1', woundedId);
  assert.equal(player(epoch, 'p1').actionTokens, 0); assert.equal(epoch.evocationActivation!.returnToAction, true);
  assert.match(epoch.log.at(-1)!, /attack 3\./, 'Wounded Fury adds the damage cube to base attack 2');
  const beforeKill = player(epoch, 'p1');
  await act({ type: 'EVOCATION_ATTACK', playerId: 'p1', targetId: enemyOldId });
  assert.ok(!epoch.evocations.some(e => e.id === enemyOldId)); assert.equal(epoch.evocationActivation, null);
  assert.equal(epoch.phase, 'ACTION'); assert.equal(epoch.currentPlayerId, 'p1');
  assert.equal(model(epoch, woundedId).activated, previousPhaseFlag, 'Paid activations leave the previous phase flag unchanged until EVOCATION entry');
  assert.deepEqual(player(epoch, 'p1').cubes, beforeKill.cubes, 'Destroyed enemy returns all new cubes, without mage ledger changes');
  assert.equal(player(epoch, 'p1').victoryPoints, beforeKill.victoryPoints); assert.equal(player(epoch, 'p1').kills, beforeKill.kills);
  await act({ type: 'EVOCATION_ATTACK', playerId: 'p1', targetId: 'p2' }, /No active evocation/);
  await drainAction(); await evocationPhase(3);
  assert.equal(coverage.spells, 24);
  assert.ok(coverage.futureSlotPassRejections >= 6); assert.ok(coverage.automaticSkips >= 6);
  assert.ok(coverage.onceRejections > 0); assert.ok(coverage.ownerSkips > 0);
  assert.ok(coverage.greyStart >= 2 && coverage.greyEnd >= 3 && coverage.greyPunch === 1 && coverage.greyCap >= 1);
  assert.ok(coverage.legacyRejections >= 7);
  console.log(`PASS: two real clients completed 3 rounds with exactly 2 tokens/round and ${coverage.spells} actual prepared casts. ` +
   `Strict PASS (tokens, Explore, future ordered slots), automatic exhaustion, Grey summons ` +
   `(${coverage.greyStart} Explore-start/${coverage.greyEnd} Explore-end/${coverage.greyPunch} Punch, ` +
   `${coverage.greyCap} cap no-op, ${coverage.greyReconstructed} reconstructed effects), ` +
   `${coverage.legacyRejections} rejected legacy summon payloads, paid activation locks, ` +
   `${coverage.freeActivations} free EVOCATION activations (choice/alternation/once/owner skipping), movement/start protection, ` +
   `friendly-fire rejection, enemy mage/model attacks, Wounded Fury and cube return/no-score verified. ` +
   `Amber extra-quest privacy and central powerful-card privacy/free cast/permanent removal retained.`);
 } finally {
  for (const ws of sockets) ws.terminate();
  server.kill('SIGTERM');
 }
}
main().catch(error => { console.error(error); process.exitCode = 1; });