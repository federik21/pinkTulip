import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { hexDistance } from '@brw/game-engine';
import type { Card, GameAction, GameState } from '@brw/game-engine';

// Same production-process / request-correlated socket fixture as server-history.
// Keep the shuffle at identity so this regression always receives the canonical
// Mage/Evocation conversion cards, rather than depending on a random support draw.
async function startServer():Promise<{ child:ChildProcess; url:string }> {
 const entry = new URL('../src/index.ts', import.meta.url).href;
 const child = spawn(process.execPath, ['--import', 'tsx', '--eval',
  `Math.random = () => 1 - Number.EPSILON; import(${JSON.stringify(entry)});`], {
  env:{ ...process.env, PORT:'0' }, stdio:['ignore', 'pipe', 'pipe'],
 });
 const url = await new Promise<string>((resolve, reject) => {
  let output = '', errors = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error(`Server did not start: ${errors}`)); }, 10000);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${errors}`)); });
  child.stderr!.on('data', data => { errors += data.toString(); });
  child.stdout!.on('data', data => {
   output += data.toString(); const port = output.match(/listening on ws:\/\/localhost:(\d+)/)?.[1];
   if (port) { clearTimeout(timer); resolve(`ws://127.0.0.1:${port}`); }
  });
 });
 return { child, url };
}
type Message = { type:string; requestId?:string; message?:string; playerId?:string; state?:GameState };
class Peer {
 readonly ws:WebSocket;
 state?:GameState;
 inbox:Message[] = [];
 pending:{ predicate:(message:Message) => boolean; resolve:(message:Message) => void }[] = [];
 sequence = 0;
 constructor(url:string) {
  this.ws = new WebSocket(url);
  this.ws.on('message', raw => {
   const message = JSON.parse(raw.toString()) as Message;
   if (message.type === 'STATE') this.state = message.state;
   const index = this.pending.findIndex(wait => wait.predicate(message));
   if (index < 0) this.inbox.push(message); else this.pending.splice(index, 1)[0].resolve(message);
  });
 }
 async next(predicate:(message:Message) => boolean):Promise<Message> {
  const index = this.inbox.findIndex(predicate);
  if (index >= 0) return this.inbox.splice(index, 1)[0];
  return new Promise((resolve, reject) => {
   const wait = { predicate, resolve:(message:Message) => { clearTimeout(timer); resolve(message); } };
   const timer = setTimeout(() => {
    this.pending = this.pending.filter(item => item !== wait); reject(new Error('Timed out waiting for server message'));
   }, 5000);
   this.pending.push(wait);
  });
 }
 async stateWhere(predicate:(game:GameState) => boolean):Promise<GameState> {
  if (this.state && predicate(this.state)) return this.state;
  this.inbox = this.inbox.filter(message => message.type !== 'STATE');
  const message = await this.next(m => m.type === 'STATE' && !!m.state && predicate(m.state)); return message.state!;
 }
 async action(action:GameAction) {
  const requestId = `dummy-${++this.sequence}`;
  this.ws.send(JSON.stringify({ type:'ACTION', requestId, action }));
  return this.next(m => m.requestId === requestId && ['ACTION_APPLIED', 'ERROR'].includes(m.type));
 }
}
const withoutHistory = (state:GameState) => { const result = structuredClone(state); delete result.history; return result; };
const hidden = (index:number):Card => ({ id:`hidden-${index}`, name:'Hidden spell', kind:'SPELL',
 damage:0, instability:0, range:0, target:'MODEL' });
function projection(state:GameState, viewer:string) {
 expect(Object.keys(state.history!).every(key => ['canUndo', 'canRedo', 'undoLabel', 'redoLabel'].includes(key))).toBe(true);
 const json = JSON.stringify(state);
 for (const key of ['before', 'after', 'snapshots', 'undoStack', 'redoStack', 'owner']) expect(json).not.toContain(`"${key}":`);
 expect(state.eventDeck).toEqual([]); expect(state.questDeck).toEqual([]);
 for (const deck of state.library) expect(deck.cards).toEqual(deck.cards.map((_, i) => hidden(i)));
 expect(state.powerfulDeck).toEqual(state.powerfulDeck.map((_, i) => hidden(i)));
 for (const p of state.players) {
  expect(p.personalDeck).toEqual(p.personalDeck.map((_, i) => hidden(i)));
  if (p.id === viewer) continue;
  expect(p.hand).toEqual(p.hand.map((_, i) => hidden(i))); expect(p.quest).toBeNull(); expect(p.additionalQuests).toEqual([]);
  expect(p.studyCardIds).toBeUndefined();
  for (const slot of Object.values(p.prepared)) if (slot) expect(slot.card).toEqual(hidden(0));
 }
 // Masked IDs need not be unique, but every physical zone still has its card.
 expect([...state.library.flatMap(d => [...d.cards, ...d.discard]), ...state.powerfulDeck, ...state.removedCards,
  ...[...state.readiedSpells ?? [], ...state.ongoingSpells ?? []].map(a => a.card),
  ...state.players.flatMap(p => [...p.personalDeck, ...p.hand, ...p.discard,
   ...Object.values(p.prepared).flatMap(slot => slot && !slot.used ? [slot.card] : [])])]).toHaveLength(120);
}

it('casts canonical Evocation and Mage dummies on real authenticated sockets with exact undo/redo and no false bindings or effects', async () => {
 const { child, url } = await startServer(), peers:Peer[] = [];
 const connect = async () => {
  const peer = new Peer(url); peers.push(peer); await peer.next(m => m.type === 'CONNECTED'); return peer;
 };
 const ok = async (peer:Peer, action:GameAction) => expect(await peer.action(action)).toMatchObject({ type:'ACTION_APPLIED' });
 const reject = async (peer:Peer, action:GameAction, message:RegExp) => {
  const before = peer.state;
  expect(await peer.action(action)).toMatchObject({ type:'ERROR', message:expect.stringMatching(message) });
  expect(peer.state).toBe(before);
 };
 try {
  const host = await connect(), other = await connect();
  host.ws.send(JSON.stringify({ type:'CREATE_ROOM', roomId:'dummy-targets', playerName:'Dummy host' }));
  expect((await host.next(m => m.type === 'WELCOME')).playerId).toBe('p1');
  other.ws.send(JSON.stringify({ type:'JOIN', roomId:'dummy-targets', playerName:'Dummy opponent' }));
  expect((await other.next(m => m.type === 'WELCOME')).playerId).toBe('p2');
  await host.stateWhere(s => s.players.length === 2);
  await ok(host, { type:'SET_ROOM_COUNT', playerId:'p1', roomsPerColor:3 });
  await ok(host, { type:'SELECT_STARTING_SCHOOL', playerId:'p1', schoolId:'transmutation' });
  await ok(other, { type:'SELECT_STARTING_SCHOOL', playerId:'p2', schoolId:'cantrip' });
  await ok(host, { type:'SET_READY', playerId:'p1', ready:true });
  await ok(other, { type:'SET_READY', playerId:'p2', ready:true });
  await host.stateWhere(s => s.phase === 'BLACK_ROSE');
  await ok(host, { type:'ADVANCE_PHASE', playerId:'p1', expectedPhase:'BLACK_ROSE', expectedRound:1 });
  for (const [peer, playerId, deckId] of [[host, 'p1', 'transmutation'], [other, 'p2', 'cantrip']] as const) {
   await peer.stateWhere(s => s.phase === 'STUDY'); await ok(peer, { type:'DRAW_STUDY', playerId, deckId });
   const own = peer.state!.players.find(p => p.id === playerId)!;
   const discard = playerId === 'p1'
    ? own.hand.filter(c => own.studyCardIds!.includes(c.id) && ['Rewrite the Lodge', "Alchemist's Refuge"].includes(c.name)).map(c => c.id)
    : own.studyCardIds!.slice(0, 2);
   expect(discard).toHaveLength(2); await ok(peer, { type:'DISCARD_STUDY', playerId, cardIds:discard });
  }
  await host.stateWhere(s => s.phase === 'PREPARATION');
  const hand = host.state!.players[0].hand;
  const evocation = hand.find(c => c.name === 'Reclaimed Servant')!, mage = hand.find(c => c.name === "Mage's Due")!;
  expect(evocation).toMatchObject({ target:'EVOCATION', convert:2 }); expect(mage).toMatchObject({ target:'MAGE', convert:3 });
  await ok(host, { type:'PREPARE_CARDS', playerId:'p1', rapidCardId:evocation.id,
   preparedCardIds:[null, mage.id, hand.find(c => c.name === 'Vital Thread')!.id] });
  await other.stateWhere(s => s.phase === 'PREPARATION');
  await ok(other, { type:'PREPARE_CARDS', playerId:'p2', preparedCardIds:other.state!.players[1].hand.slice(0, 2).map(c => c.id) });
  await host.stateWhere(s => s.phase === 'ACTION'); expect(host.state!.evocations).toEqual([]);
  const exit = async (peer:Peer, playerId:string) => {
   const state = peer.state!, own = state.players.find(p => p.id === playerId)!;
   const destination = state.board.rooms.filter(r => !r.startingFor).flatMap(r => r.tiles)
    .filter(h => hexDistance(own.wizard.position, h) === 1)
    .sort((a, b) => hexDistance(a, { q:0, r:0 }) - hexDistance(b, { q:0, r:0 }))[0];
   expect(destination).toBeDefined();
   await ok(peer, { type:'DISCARD_EXIT', playerId, cardId:own.hand[0].id, destination });
  };
  await exit(host, 'p1');
  const dummy = async (slot:'rapid' | 'slot2', card:Card) => {
   const before = structuredClone(host.state!);
   const peerBefore = structuredClone(await other.stateWhere(s => s.log.length === before.log.length));
   const own = before.players[0], roomId = before.board.rooms.find(r => r.tiles.some(h => hexDistance(h, own.wizard.position) === 0))!.id;
   const action:GameAction = { type:'CAST_SPELL', playerId:'p1', slot, dummy:true, roomId };
   await reject(other, action, /another player/);
   await reject(host, { ...action, targetPlayerId:'p2' }, /either/);
   await reject(host, { ...action, targetEvocationId:'forged-model' }, /either/);
   await ok(host, action);
   const after = structuredClone(host.state!);
   const peerAfter = structuredClone(await other.stateWhere(s => s.players[0].prepared[slot]?.used === true));
   expect(after.players.map(p => p.wizard)).toEqual(before.players.map(p => p.wizard));
   expect(after.evocations).toEqual([]); expect(after.board).toEqual(before.board);
   expect(after.players.map(p => p.cubes)).toEqual(before.players.map(p => p.cubes));
   expect(after.players.map(p => p.actionTokens)).toEqual(before.players.map(p => p.actionTokens));
   expect(after.feedbackEvents).toEqual(before.feedbackEvents);
   expect(after.readiedSpells).toEqual([]); expect(after.ongoingSpells).toEqual([]); expect(after.activeSpellOrder).toEqual([]);
   expect(after.players[0].prepared[slot]).toEqual({ card, used:true });
   expect(after.library.find(d => d.id === 'transmutation')!.discard).toContainEqual(card);
   expect(after.log.join('\n')).toContain(`${card.name} on a dummy (no model effects)`);
   expect(after.history).toEqual({ canUndo:true, canRedo:false, undoLabel:'Cast spell' });
   expect(peerAfter.history).toEqual({ canUndo:false, canRedo:false });
   projection(after, 'p1'); projection(peerAfter, 'p2');
   await reject(other, { type:'UNDO_ACTION', playerId:'p2' }, /No action available/);
   await ok(host, { type:'UNDO_ACTION', playerId:'p1' });
   expect(withoutHistory(host.state!)).toEqual(withoutHistory(before));
   const peerUndo = await other.stateWhere(s => s.players[0].prepared[slot]?.used === false);
   expect(withoutHistory(peerUndo)).toEqual(withoutHistory(peerBefore));
   await reject(host, { ...action, targetPlayerId:'p2' }, /either/);
   expect(host.state!.history?.canRedo).toBe(true);
   await ok(host, { type:'REDO_ACTION', playerId:'p1' }); expect(host.state).toEqual(after);
   expect(await other.stateWhere(s => s.players[0].prepared[slot]?.used === true)).toEqual(peerAfter);
  };
  await dummy('rapid', evocation); expect(host.state!.currentPlayerId).toBe('p2');
  await other.stateWhere(s => s.currentPlayerId === 'p2'); await exit(other, 'p2');
  await ok(other, { type:'END_ACTIVATION', playerId:'p2' }); await host.stateWhere(s => s.currentPlayerId === 'p1');
  await dummy('slot2', mage);
  expect(host.state!.activation).toMatchObject({ actionsUsed:1, spellsCast:1, sequencedSpellUsed:true });
 } finally {
  for (const peer of peers) peer.ws.terminate();
  if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
 }
}, 30000);