import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { canUseSpellDummy, isWithinSpellRange, spellCanTargetModel } from '../packages/game-engine/src/engine';
import type { Card, GameAction, GameState, Hex, Player } from '../packages/game-engine/src/types';

// Standalone real-network coverage: ephemeral port, ordinary wire actions only,
// no engine execution, imported fixtures, state injection, or existing server.
type RoomSummary = { id: string; players: number; capacity: number; status: 'waiting' | 'playing' };
type Message = {
 type: string; state?: GameState; rooms?: RoomSummary[]; playerId?: string;
 roomId?: string; requestId?: string | null; message?: string;
};
const slots = ['slot1', 'slot2', 'slot3', 'rapid'] as const;
const player = (state: GameState, id: string): Player => {
 const found = state.players.find(p => p.id === id); assert.ok(found, `Missing ${id}`); return found;
};
const sameHex = (a: Hex, b: Hex) => a.q === b.q && a.r === b.r;
const distance = (a: Hex, b: Hex) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
type SpellSelection = Pick<Extract<GameAction, { type:'CAST_SPELL' }>, 'roomId' | 'targetPlayerId' | 'targetEvocationId' | 'dummy'>;

function spellTarget(state: GameState, id: string, card: Card): SpellSelection | undefined {
 const p = player(state, id);
 const legal = (owner: string, kind: 'MAGE' | 'EVOCATION', position: Hex) =>
  spellCanTargetModel(card, id, owner, kind) && isWithinSpellRange(p.wizard.position, position, card.range) &&
  !state.board.rooms.some(r => r.startingFor && r.tiles.some(h => sameHex(h, position)));
 if (card.target === 'SELF') return legal(id, 'MAGE', p.wizard.position) ? {} : undefined;
 if (card.target === 'ROOM' || canUseSpellDummy(card)) {
  const rooms = state.board.rooms.filter(r => !r.startingFor && r.tiles.some(h => isWithinSpellRange(p.wizard.position, h, card.range)) &&
   (!card.damage || !state.players.some(t => t.id !== id && r.tiles.some(h => sameHex(h, t.wizard.position))) &&
    !state.evocations.some(e => e.playerId !== id && r.tiles.some(h => sameHex(h, e.position)))));
  // Conversion needs live cubes from another owner; a legal zero-effect cast
  // remains useful when the ordinary game has not produced those cubes yet.
  rooms.sort((a, b) => Number(!!card.convert && !b.scored && !b.reconstructed && Object.entries(b.cubesByPlayer).some(([owner, n]) => owner !== id && n > 0)) -
   Number(!!card.convert && !a.scored && !a.reconstructed && Object.entries(a.cubesByPlayer).some(([owner, n]) => owner !== id && n > 0)));
  const room = rooms[0];
  return room ? { roomId:room.id, ...(canUseSpellDummy(card) ? { dummy:true } : {}) } : undefined;
 }
 const mage = [...state.players].sort((a, b) => b.wizard.damageCubes - a.wizard.damageCubes)
  .find(t => legal(t.id, 'MAGE', t.wizard.position) && (!card.damage || t.id === id));
 if (mage) return { targetPlayerId:mage.id };
 const evocation = [...state.evocations].sort((a, b) => b.damageCubes - a.damageCubes)
  .find(e => legal(e.playerId, 'EVOCATION', e.position) && (!card.damage || e.playerId === id));
 return evocation ? { targetEvocationId:evocation.id } : undefined;
}

function checkCubes(state: GameState) {
 for (const p of state.players) {
  assert.ok(Object.values(p.cubes).every(n => Number.isInteger(n) && n >= 0));
  assert.equal(Object.values(p.cubes).reduce((sum, n) => sum + n, 0), 25);
  assert.equal(p.cubes.onWizard, state.players.reduce((sum, t) => sum + (t.wizard.damageByPlayer[p.id] ?? 0), 0));
  assert.equal(p.cubes.onEvocations, state.evocations.reduce((sum, e) => sum + (e.damageByPlayer[p.id] ?? 0), 0));
  assert.equal(p.cubes.onBoard, state.board.rooms.filter(r => !r.scored).reduce((sum, r) => sum + (r.cubesByPlayer[p.id] ?? 0), 0));
 }
}
const withoutHistory = (state: GameState) => { const copy = structuredClone(state); delete copy.history; return copy; };

function publicEpoch(state: GameState): string {
 const { history, ...shared } = state;
 return JSON.stringify({ ...shared, players: state.players.map(p => {
  const { hand, personalDeck, prepared, quest, additionalQuests, ...visible } = p;
  return { ...visible, hand: hand.length, personalDeck: personalDeck.length,
   prepared: slots.map(slot => prepared[slot] ? { used: prepared[slot]!.used } : null) };
 }) });
}

function checkPrivacy(state: GameState, viewer: string) {
 assert.ok(state.history && typeof state.history.canUndo === 'boolean' && typeof state.history.canRedo === 'boolean');
 assert.ok(Object.keys(state.history).every(key => ['canUndo', 'canRedo', 'undoLabel', 'redoLabel'].includes(key)), 'History contains private flags/labels, never snapshots');
 const hidden = (cards: Card[]) => cards.forEach((card, index) => assert.deepEqual(card, {
  id: `hidden-${index}`, name: 'Hidden spell', kind: 'SPELL', damage: 0,
  instability: 0, range: 0, target: 'MODEL',
 }));
 assert.deepEqual(state.eventDeck, []); assert.deepEqual(state.questDeck, []);
 assert.deepEqual(state.library.map(({ id, name }) => ({ id, name })), [
  { id: 'cantrip', name: 'Cantrip' }, { id: 'transmutation', name: 'Transmutation' },
 ]);
 for (const deck of state.library) {
  assert.ok(deck.cards.length > 0 && deck.cards.length + deck.discard.length <= 36, `Exercise the finite nonempty future ${deck.name} deck`);
  hidden(deck.cards);
 }
 assert.ok(state.powerfulDeck.length > 0); hidden(state.powerfulDeck);
 for (const p of state.players) {
  assert.ok(p.personalDeck.length > 0, `Exercise ${p.id}'s nonempty future deck`); hidden(p.personalDeck);
  if (p.id === viewer) {
   assert.ok(p.hand.every(card => !card.id.startsWith('hidden-')));
   assert.ok(Object.values(p.prepared).every(slot => !slot || !slot.card.id.startsWith('hidden-')));
   continue;
  }
  hidden(p.hand); assert.equal(p.quest, null); assert.deepEqual(p.additionalQuests, []);
  for (const slot of Object.values(p.prepared)) if (slot) hidden([slot.card]);
 }
}

function checkCardSupply(state: GameState, owners: Player[]) {
 assert.equal(owners.length, state.players.length, 'Combine only each mage’s own view at the same epoch');
 // Used preparations reference discarded/removed cards, not additional physical copies.
 const visible = [...state.library.flatMap(deck => deck.discard), ...state.removedCards,
  ...owners.flatMap(p => [...p.hand, ...p.discard, ...Object.values(p.prepared)
   .filter(slot => slot && !slot.used).map(slot => slot!.card)])];
 assert.ok(visible.every(card => !card.id.startsWith('hidden-')));
 assert.equal(new Set(visible.map(card => card.id)).size, visible.length, 'All observable physical cards have globally unique IDs');
 const shared = visible.filter(card => card.schoolId);
 assert.ok(shared.every(card => state.library.some(deck => deck.id === card.schoolId) && !card.powerful && card.id.startsWith(`${card.schoolId}-`)));
 for (const deck of state.library)
  assert.equal(deck.cards.length + shared.filter(card => card.schoolId === deck.id).length, 36, `${deck.name} conserves its own 36 cards`);
 // Hidden future IDs deliberately cannot be compared across private wire views.
 assert.equal(state.library.reduce((sum, deck) => sum + deck.cards.length, 0) + shared.length, 72);
 assert.equal(state.library.reduce((sum, deck) => sum + deck.cards.length, 0) + state.powerfulDeck.length +
  state.players.reduce((sum, p) => sum + p.personalDeck.length, 0) + visible.length, 72 + 12 * state.players.length + 12);
}

class Mage {
 readonly messages: Message[] = [];
 state: GameState | null = null;
 id: string | null = null;
 private readonly listeners = new Set<() => void>();
 constructor(readonly ws: WebSocket) {
  ws.on('error', () => { /* Connection/open failures are handled by once(). */ });
  ws.on('message', raw => {
   const message = JSON.parse(raw.toString()) as Message;
   if (message.type === 'STATE') this.state = message.state!;
   // Capture the STATE preceding this exact request's ACK, not a later broadcast.
   if (message.type === 'ACTION_APPLIED' && this.state) message.state = this.state;
   this.messages.push(message);
   for (const listener of [...this.listeners]) listener();
  });
 }
 async wait(predicate: (message: Message) => boolean, from = 0): Promise<Message> {
  const existing = this.messages.slice(from).find(predicate); if (existing) return existing;
  return new Promise((resolve, reject) => {
   const timer = setTimeout(() => {
    this.listeners.delete(receive);
    reject(new Error(`Timed out for ${this.id ?? 'visitor'}: ${JSON.stringify(this.messages.at(-1))?.slice(0, 240)}`));
   }, 8000);
   const receive = () => {
    const found = this.messages.slice(from).find(predicate);
    if (found) { clearTimeout(timer); this.listeners.delete(receive); resolve(found); }
   };
   this.listeners.add(receive);
  });
 }
 async sync(epoch: GameState): Promise<GameState> {
  return (await this.wait(m => m.type === 'STATE' && !!m.state && publicEpoch(m.state) === publicEpoch(epoch))).state!;
 }
 async join(roomId: string, create = false, error?: RegExp): Promise<GameState | null> {
  const from = this.messages.length, before = this.state, requestId = crypto.randomUUID();
  this.ws.send(JSON.stringify({ type: create ? 'CREATE_ROOM' : 'JOIN', roomId, playerName: 'Mage', requestId }));
  const reply = await this.wait(m => m.type === 'WELCOME' || m.type === 'ERROR' && m.requestId === requestId, from);
  assert.equal(reply.type, error ? 'ERROR' : 'WELCOME', reply.message ?? reply.type);
  if (error) {
   assert.match(reply.message ?? '', error);
   assert.strictEqual(this.state, before, 'Rejected joins must not change membership/state');
   assert.ok(!this.messages.slice(from).some(m => m.type === 'WELCOME' || m.type === 'STATE'));
   return null;
  }
  assert.equal(reply.roomId, roomId); assert.ok(reply.playerId); this.id = reply.playerId;
  return (await this.wait(m => m.type === 'STATE', from)).state!;
 }
 async command(action: GameAction, error?: RegExp): Promise<GameState | null> {
  const from = this.messages.length, before = this.state, requestId = crypto.randomUUID();
  this.ws.send(JSON.stringify({ action, requestId }));
  const reply = await this.wait(m => m.requestId === requestId, from);
  assert.equal(reply.type, error ? 'ERROR' : 'ACTION_APPLIED', `${action.type}: ${reply.message ?? reply.type}`);
  if (error) {
   assert.match(reply.message ?? '', error);
   assert.strictEqual(this.state, before, 'Rejected commands must not broadcast changed state');
   assert.ok(!this.messages.slice(from).some(m => m.type === 'STATE'));
   return before;
  }
  assert.ok(reply.state, 'Successful request must receive its authoritative state before its ACK');
  return reply.state;
 }
 async close() {
  if (this.ws.readyState === WebSocket.CLOSED) return;
  const closed = once(this.ws, 'close'); this.ws.close(); await closed;
 }
}

async function main() {
 const server = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
  cwd: resolve(__dirname, '..'), env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
 });
 const sockets: WebSocket[] = [];
 let stderr = '';
 server.stderr.on('data', chunk => { stderr += chunk.toString(); });
 try {
  const url = await new Promise<string>((resolve, reject) => {
   let output = '';
   const timer = setTimeout(() => reject(new Error(`Server did not start: ${stderr}`)), 10000);
   server.stdout.on('data', chunk => {
    output += chunk.toString(); const match = output.match(/ws:\/\/localhost:\d+/);
    if (match) { clearTimeout(timer); resolve(match[0]); }
   });
   server.once('error', error => { clearTimeout(timer); reject(error); });
   server.once('exit', (code, signal) => {
    clearTimeout(timer); reject(new Error(`Server exited (${code ?? signal}): ${stderr}`));
   });
  });
  const connect = async () => {
   const ws = new WebSocket(url); sockets.push(ws); const mage = new Mage(ws);
   await once(ws, 'open'); await mage.wait(m => m.type === 'CONNECTED'); return mage;
  };
  const observer = await connect();
  let roomCount = 0, autoStarts = 0, pauseRejections = 0, reconnects = 0;
  const roster = async (roomId: string, epoch: GameState, mages: Mage[]) => {
   assert.equal(epoch.players.length, mages.length);
   assert.ok(epoch.players.every(p => p.connected));
   assert.equal(new Set(epoch.players.map(p => p.id)).size, mages.length);
   const expected: RoomSummary = { id: roomId, players: epoch.players.length, capacity: 4,
    status: epoch.phase === 'LOBBY' ? 'waiting' : 'playing' };
  const owners: Player[] = [];
   for (const mage of mages) {
    const state = await mage.sync(epoch); assert.ok(mage.id); checkPrivacy(state, mage.id);
   owners.push(player(state, mage.id));
    // Each roster list must follow this exact STATE, never an earlier equal count.
    let from = mage.messages.length - 1;
    while (from >= 0 && !(mage.messages[from].type === 'STATE' && mage.messages[from].state === state)) from--;
    const list = await mage.wait(m => m.type === 'ROOM_LIST' && !!m.rooms?.some(r => r.id === roomId && JSON.stringify(r) === JSON.stringify(expected)), from);
    assert.equal(list.rooms!.filter(r => r.id === roomId).length, 1);
   }
    checkCardSupply(epoch, owners);
   await observer.wait(m => m.type === 'ROOM_LIST' && !!m.rooms?.some(r => JSON.stringify(r) === JSON.stringify(expected)));
  };
  const act = async (mage: Mage, action: GameAction, error?: RegExp): Promise<GameState> => {
    const state = await mage.command(action, error); assert.ok(state); checkCubes(state); return state;
  };
  const ready = (mage: Mage, value = true) => act(mage, { type: 'SET_READY', playerId: mage.id!, ready: value });
  const advance = (mage: Mage, epoch: GameState, error?: RegExp) => act(mage, {
   type: 'ADVANCE_PHASE', playerId: mage.id!, expectedPhase: epoch.phase, expectedRound: epoch.round,
  }, error);
  const closeRoom = async (roomId: string, mages: Mage[]) => {
   const from = observer.messages.length;
   await Promise.all(mages.map(mage => mage.close()));
   await observer.wait(m => m.type === 'ROOM_LIST' && !!m.rooms && !m.rooms.some(r => r.id === roomId), from);
  };
  const newRoom = async (count: number, name: string) => {
   const mages: Mage[] = []; let epoch: GameState | null = null;
   for (let i = 0; i < count; i++) {
    const mage = await connect(); mages.push(mage); epoch = await mage.join(name, i === 0);
    assert.ok(epoch); assert.equal(epoch.phase, 'LOBBY'); assert.equal(epoch.round, 0);
    assert.deepEqual(epoch.players.map(p => p.id), ['p1', 'p2', 'p3', 'p4'].slice(0, i + 1));
    await roster(name, epoch, mages);
   }
   assert.ok(epoch); roomCount++; return { mages, epoch };
  };

  // An unjoined socket cannot send actions, including a forged host start.
  await observer.command({ type: 'SET_READY', playerId: 'p1', ready: true }, /Join a room first/);
  await observer.command({ type: 'START_GAME', playerId: 'p1' }, /Join a room first/);

  for (const count of [2, 3, 4]) {
   const name = `auto-${count}`;
   const room = await newRoom(count, name), mages = room.mages;
   let epoch = room.epoch;
   await act(mages[1], { type: 'SET_READY', playerId: 'p1', ready: true }, /cannot act for another player/);
   await act(mages[1], { type: 'START_GAME', playerId: mages[1].id! }, /Only the creator/);
   const visitor = await connect();
   if (count === 4) {
    await visitor.join(name, false, /^Room full \(4 mages\)$/);
    await visitor.command({ type: 'SET_READY', playerId: 'p4', ready: true }, /Join a room first/);
    await roster(name, epoch, mages);
   }
   // Readiness is reversible and every currently occupied seat participates.
   epoch = await ready(mages[0]); epoch = await ready(mages[0], false);
   for (let i = mages.length - 1; i >= 1; i--) {
    epoch = await ready(mages[i]); assert.equal(epoch.phase, 'LOBBY'); assert.equal(epoch.round, 0);
    await roster(name, epoch, mages);
    await act(mages[0], { type: 'START_GAME', playerId: mages[0].id! }, /everyone must be ready/);
   }
   const from = mages[0].messages.length;
   epoch = await ready(mages[0]);
   assert.equal(epoch.phase, 'BLACK_ROSE'); assert.equal(epoch.round, 1); autoStarts++;
   assert.ok(mages[0].messages.slice(from).filter(m => m.type === 'STATE').every(m => m.state!.phase === 'BLACK_ROSE'),
    'Final SET_READY must never expose an all-ready lobby before auto-start');
   assert.equal(epoch.log.filter(line => line.includes('Round 1 · BLACK ROSE')).length, 1);
   await roster(name, epoch, mages);
   await visitor.join(name, false, count === 4 ? /^Room full \(4 mages\)$/ : /battle already in progress/);
   await visitor.command({ type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: epoch.phase, expectedRound: epoch.round }, /Join a room first/);
   await roster(name, epoch, mages);
   await visitor.close(); await closeRoom(name, mages);
  }
  console.log('PASS: automatic starts at 2/3/4, every occupied seat gates readiness, capacity/fifth and nonmember/battle-join rejection');

  // One real participant waits even when ready. Removing the only peer returns
  // to that same one-person lobby; the next real join can satisfy the minimum.
  {
   const name = 'minimum', room = await newRoom(1, name), a = room.mages[0];
   let epoch = await ready(a);
   assert.equal(epoch.phase, 'LOBBY'); assert.equal(epoch.round, 0); await roster(name, epoch, [a]);
   await act(a, { type: 'START_GAME', playerId: a.id! }, /At least 2 mages/);
   const b = await connect(); epoch = (await b.join(name))!;
   assert.equal(epoch.phase, 'LOBBY'); assert.equal(player(epoch, 'p2').ready, false);
   await b.close();
   epoch = (await a.wait(m => m.type === 'STATE' && m.state!.players.length === 1 && m.state!.log.some(line => line.includes('left the lobby')))).state!;
   assert.equal(player(epoch, 'p1').ready, true); await roster(name, epoch, [a]);
   epoch = await ready(a); assert.equal(epoch.phase, 'LOBBY');
   const replacement = await connect(); epoch = (await replacement.join(name))!;
   assert.equal(replacement.id, 'p2'); assert.equal(player(epoch, 'p2').ready, false);
   epoch = await ready(replacement); assert.equal(epoch.phase, 'BLACK_ROSE'); autoStarts++;
   await roster(name, epoch, [a, replacement]); await closeRoom(name, [a, replacement]);
  }

  // Remove holes without renumbering survivors or moving their starting rooms.
  // Reuse the lowest free ID, then migrate the host to the first survivor.
  {
   const name = 'migration', room = await newRoom(4, name);
   const [a, b, c, d] = room.mages;
   let epoch = await ready(a); epoch = await ready(c);
   const original = new Map(epoch.players.map(p => [p.id, p]));
   await b.close();
   epoch = (await a.wait(m => m.type === 'STATE' && m.state!.players.length === 3 && !m.state!.players.some(p => p.id === 'p2'))).state!;
   assert.deepEqual(epoch.players.map(p => p.id), ['p1', 'p3', 'p4']); await roster(name, epoch, [a, c, d]);
   const replacement = await connect(); epoch = (await replacement.join(name))!;
   assert.equal(replacement.id, 'p2'); assert.equal(player(epoch, 'p2').ready, false);
   for (const id of ['p1', 'p3', 'p4']) assert.deepEqual(player(epoch, id), original.get(id));
   await roster(name, epoch, [a, c, d, replacement]);
   await a.close();
   epoch = (await c.wait(m => m.type === 'STATE' && m.state!.hostId === 'p3')).state!;
   assert.deepEqual(epoch.players.map(p => p.id), ['p3', 'p4', 'p2']);
   assert.equal(player(epoch, 'p3').ready, true);
   for (const id of ['p3', 'p4']) assert.deepEqual(player(epoch, id).wizard, original.get(id)!.wizard);
   await roster(name, epoch, [c, d, replacement]);
   await act(d, { type: 'START_GAME', playerId: d.id! }, /Only the creator/);
   await act(c, { type: 'START_GAME', playerId: c.id! }, /everyone must be ready/);
   await replacement.close();
   epoch = (await c.wait(m => m.type === 'STATE' && m.state!.players.length === 2)).state!;
   assert.deepEqual(epoch.players.map(p => p.id), ['p3', 'p4']); await roster(name, epoch, [c, d]);
   epoch = await ready(d); assert.equal(epoch.phase, 'BLACK_ROSE'); assert.equal(epoch.hostId, 'p3'); autoStarts++;
   await roster(name, epoch, [c, d]);
   await advance(d, epoch, /Only the creator/); epoch = await advance(c, epoch);
   assert.equal(epoch.phase, 'STUDY'); await roster(name, epoch, [c, d]);
   await closeRoom(name, [c, d]);
   // Deletion removes the old battle and its host/seat history entirely.
   const fresh = await connect(); epoch = (await fresh.join(name, true))!;
   assert.equal(fresh.id, 'p1'); assert.equal(epoch.hostId, 'p1'); assert.equal(epoch.phase, 'LOBBY');
   await roster(name, epoch, [fresh]); await closeRoom(name, [fresh]);
  }
  console.log('PASS: one-mage waiting/minimum, lobby removal/free-ID reuse, stable starts, host migration and empty-room deletion');

  // Four real mages draw, prepare, move, place cubes, and acquire a hidden
  // powerful spell before disconnect/reconnect; no injected running state.
  {
   const name = 'reconnect-four', room = await newRoom(4, name);
   const mages = room.mages; let epoch = room.epoch;
   for (const mage of mages) epoch = await ready(mage);
   assert.equal(epoch.phase, 'BLACK_ROSE'); autoStarts++;
   epoch = await advance(mages[0], epoch); assert.equal(epoch.phase, 'STUDY');
  for (const deck of epoch.library) { assert.equal(deck.cards.length, 36); assert.deepEqual(deck.discard, []); }
  await act(mages[0], { type: 'DRAW_STUDY', playerId: mages[0].id!, deckId: 'school-6' }, /School not found/);
    const schoolDraws = [0, 0], schoolDiscards = [0, 0];
    for (const [i, mage] of mages.entries()) {
     const schoolIndex = i % 2 === 0 ? 1 : 0, otherIndex = 1 - schoolIndex;
     const stock = epoch.library[schoolIndex], untouched = epoch.library[otherIndex];
     epoch = await act(mage, { type:'DRAW_STUDY', playerId:mage.id!, deckId:stock.id });
     schoolDraws[schoolIndex] += 4;
     assert.equal(epoch.library[schoolIndex].cards.length, 36 - schoolDraws[schoolIndex], 'Mages share each finite school independently');
     assert.deepEqual(epoch.library[otherIndex], untouched, 'Draws must not borrow from the other school');
    const own = player(epoch, mage.id!);
     const drawn = own.hand.slice(-4);
     assert.ok(drawn.every(card => card.schoolId === stock.id && card.id.startsWith(`${stock.id}-`)));
     // Preserve a support cast that needs no summon. Eight genuine Transmutation
     // draws across p1/p3 exceed the six EVOCATION-only cards in the school, so
     // at least one legal support cast is guaranteed without seeding randomness.
     const discarded = [...drawn].sort((a, b) => Number(b.target === 'EVOCATION') - Number(a.target === 'EVOCATION')).slice(0, 2).map(card => card.id);
     epoch = await act(mage, { type:'DISCARD_STUDY', playerId:mage.id!, cardIds:discarded });
     schoolDiscards[schoolIndex] += 2;
     assert.equal(epoch.library[schoolIndex].discard.length, schoolDiscards[schoolIndex]);
     assert.ok(discarded.every(id => epoch.library[schoolIndex].discard.some(card => card.id === id && card.schoolId === stock.id)));
     assert.deepEqual(epoch.library[otherIndex], untouched, 'Discards stay out of the other school');
   }
   assert.equal(epoch.phase, 'PREPARATION'); await roster(name, epoch, mages);
   for (const mage of mages) {
    const own = player(await mage.sync(epoch), mage.id!);
     const hand = [...own.hand].sort((a, b) => Number(!!(b.heal || b.convert) && b.target !== 'EVOCATION') - Number(!!(a.heal || a.convert) && a.target !== 'EVOCATION'));
    epoch = await act(mage, { type: 'PREPARE_CARDS', playerId: mage.id!,
      preparedCardIds: hand.slice(0, 3).map(card => card.id), rapidCardId: hand[3].id });
   }
   assert.equal(epoch.phase, 'ACTION'); await roster(name, epoch, mages);
   const pathTo = (state: GameState, id: string, target: Hex): Hex[] => {
    const start = player(state, id).wizard.position, queue: Hex[][] = [[start]], visited = new Set([JSON.stringify(start)]);
    while (queue.length) {
     const path = queue.shift()!, last = path[path.length - 1];
     if (sameHex(last, target)) return path.slice(1);
     for (const tile of state.board.tiles) {
      const key = JSON.stringify(tile);
      if (distance(last, tile) !== 1 || visited.has(key) || state.board.rooms.some(r => r.startingFor && r.tiles.some(h => sameHex(h, tile)))) continue;
      visited.add(key); queue.push([...path, tile]);
     }
    }
    throw new Error('No real movement path');
   };
   const exploreTo = async (mage: Mage, destination: Hex) => {
    const path = pathTo(epoch, mage.id!, destination);
    assert.ok(path.length > 0 && path.length <= player(epoch, mage.id!).wizard.movement);
    epoch = await act(mage, { type: 'BEGIN_PHYSICAL_ACTION', playerId: mage.id!, kind: 'EXPLORE' });
    epoch = await act(mage, { type: 'PERFORM_MOVEMENT', playerId: mage.id! });
    for (const step of path) epoch = await act(mage, { type: 'EXPLORE_STEP', playerId: mage.id!, destination: step });
    if (epoch.activation!.exploring > 0) epoch = await act(mage, { type: 'END_EXPLORE', playerId: mage.id! });
    epoch = await act(mage, { type: 'ACTIVATE_ROOM', playerId: mage.id! });
   };
  let supportCasts = 0;
  const supportTypes = new Set<Card['target']>();
  for (const mage of mages) {
    assert.equal(epoch.currentPlayerId, mage.id);
    const emerald = epoch.board.rooms.filter(r => r.color === 'emerald' && !r.reconstructed)
     .map(r => ({ room: r, path: pathTo(epoch, mage.id!, r.tiles[0]) }))
     .sort((a, b) => a.path.length - b.path.length)[0];
    assert.ok(emerald); await exploreTo(mage, emerald.room.tiles[0]);
    assert.ok(player(epoch, mage.id!).cubes.onBoard > 0, 'Reconnect must preserve real spent cubes');
    if (mage !== mages[3]) {
     const own = player(await mage.sync(epoch), mage.id!), card = own.prepared.slot1!.card;
     const selection = spellTarget(epoch, mage.id!, card);
     if ((card.heal || card.convert) && selection) {
      const before = await mage.sync(epoch), tokens = own.actionTokens;
      epoch = await act(mage, { type:'CAST_SPELL', playerId:mage.id!, slot:'slot1', ...selection });
      const after = structuredClone(epoch);
      assert.equal(epoch.currentPlayerId, mages[mages.indexOf(mage) + 1].id, 'Support is the second shared turn action');
      assert.equal(player(epoch, mage.id!).actionTokens, tokens, 'Support never spends a physical token');
      assert.ok(epoch.library.find(d => d.id === card.schoolId)!.discard.some(c => c.id === card.id));
      assert.equal(epoch.history?.undoLabel, 'Cast spell'); checkPrivacy(epoch, mage.id!);
      epoch = await act(mage, { type:'UNDO_ACTION', playerId:mage.id! });
      assert.deepEqual(withoutHistory(epoch), withoutHistory(before));
      assert.equal(epoch.history?.redoLabel, 'Cast spell'); checkPrivacy(epoch, mage.id!);
      epoch = await act(mage, { type:'REDO_ACTION', playerId:mage.id! });
      assert.deepEqual(epoch, after); supportCasts++; supportTypes.add(card.target);
     } else epoch = await act(mage, { type:'END_ACTIVATION', playerId:mage.id! });
    }
   }
     assert.ok(supportCasts > 0, 'Real independent school draws guarantee at least one non-EVOCATION support cast');
     console.log(`PASS: alternating Cantrip/Transmutation Study, ${supportCasts} real typed support casts (${[...supportTypes].join('/')}) with exact socket undo/redo, private metadata and physical cube conservation`);
   await exploreTo(mages[3], { q: 0, r: 0 });
   assert.equal(epoch.currentPlayerId, 'p1');
   assert.equal(player(epoch, 'p4').actionTokens, 0);
   assert.equal(player(await mages[3].sync(epoch), 'p4').hand.filter(card => card.powerful).length, 1);
   await roster(name, epoch, mages);
   const snapshots = new Map<string, Player>();
   for (const mage of mages) {
    const state = await mage.sync(epoch); snapshots.set(mage.id!, structuredClone(player(state, mage.id!)));
    assert.ok(player(state, mage.id!).quest, 'Own quest remains visible');
    assert.equal(slots.filter(slot => player(state, mage.id!).prepared[slot]).length, 4);
   }
   const before = structuredClone(epoch);
   await mages[2].close(); await mages[3].close();
   epoch = (await mages[0].wait(m => m.type === 'STATE' && m.state!.players.filter(p => !p.connected).length === 2)).state!;
   assert.equal(epoch.hostId, 'p1'); assert.equal(epoch.players.length, 4);
   const pausedLists = async (active: Mage[]) => {
    for (const mage of active) {
     const state = await mage.sync(epoch); checkPrivacy(state, mage.id!);
     const lastState = mage.messages.findIndex(m => m.type === 'STATE' && m.state === state);
     await mage.wait(m => m.type === 'ROOM_LIST' && !!m.rooms?.some(r => r.id === name && r.players === 4 && r.capacity === 4 && r.status === 'playing'), lastState);
     await act(mage, { type: 'BEGIN_PHYSICAL_ACTION', playerId: mage.id!, kind: 'EXPLORE' }, /Game paused:.*reconnect/);
     pauseRejections++;
    }
   };
   await pausedLists(mages.slice(0, 2));
   const c = await connect(); epoch = (await c.join(name))!;
   assert.equal(c.id, 'p3'); assert.deepEqual(player(epoch, 'p3'), snapshots.get('p3')); reconnects++;
   assert.equal(player(epoch, 'p4').connected, false); await pausedLists([mages[0], mages[1], c]);
   const d = await connect(); epoch = (await d.join(name))!;
   assert.equal(d.id, 'p4'); assert.deepEqual(player(epoch, 'p4'), snapshots.get('p4')); reconnects++;
  assert.equal(publicEpoch({ ...epoch, log: [] }), publicEpoch({ ...before, log: [] }));
   const active = [mages[0], mages[1], c, d]; await roster(name, epoch, active);
   // A disconnected host is not a lobby departure: authority stays with p1.
   await mages[0].close();
   epoch = (await c.wait(m => m.type === 'STATE' && !player(m.state!, 'p1').connected)).state!;
   assert.equal(epoch.hostId, 'p1'); await pausedLists([mages[1], c, d]);
   const a = await connect(); epoch = (await a.join(name))!;
   assert.equal(a.id, 'p1'); assert.deepEqual(player(epoch, 'p1'), snapshots.get('p1')); reconnects++;
   await roster(name, epoch, [a, mages[1], c, d]);
   const tokens = player(epoch, 'p1').actionTokens;
   epoch = await act(a, { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
   assert.equal(player(epoch, 'p1').actionTokens, tokens - 1);
   await roster(name, epoch, [a, mages[1], c, d]);
   await closeRoom(name, [a, mages[1], c, d]);
  }
  console.log('PASS: four-mage private hands/preparations/quests/future decks, real cubes/positions/stats preserved, multi-disconnect pause and host reconnect/resume');
  console.log(`Lobby smoke passed: ${roomCount} isolated rooms, ${autoStarts} automatic starts, ${pauseRejections} paused-action rejections, ${reconnects} preserved running reconnects (PORT=0).`);
 } finally {
  for (const ws of sockets) if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
  if (server.exitCode === null && server.signalCode === null) {
   const exited = once(server, 'exit'); server.kill('SIGTERM');
   const timer = setTimeout(() => server.kill('SIGKILL'), 3000);
   try { await exited; } finally { clearTimeout(timer); }
  }
 }
}

main().catch(error => { console.error(error); process.exitCode = 1; });