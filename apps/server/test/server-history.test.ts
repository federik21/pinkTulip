import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { STARTING_SCHOOL_CARDS } from '@brw/game-engine';
import type { Card, GameAction, GameState } from '@brw/game-engine';

type Message = { type:string; requestId?:string; message?:string; playerId?:string; state?:GameState };
class Peer {
 ws: WebSocket;
 state?: GameState;
 inbox: Message[] = [];
 pending: { predicate:(message:Message) => boolean; resolve:(message:Message) => void }[] = [];
 sequence = 0;

 constructor(url: string) {
  this.ws = new WebSocket(url);
  this.ws.on('message', raw => {
   const message = JSON.parse(raw.toString()) as Message;
   if (message.type === 'STATE') this.state = message.state;
   const index = this.pending.findIndex(wait => wait.predicate(message));
   if (index < 0) this.inbox.push(message);
   else this.pending.splice(index, 1)[0].resolve(message);
  });
 }

 async next(predicate: (message: Message) => boolean): Promise<Message> {
  const index = this.inbox.findIndex(predicate);
  if (index >= 0) return this.inbox.splice(index, 1)[0];
  return new Promise((resolve, reject) => {
   const wait = { predicate, resolve:(message:Message) => { clearTimeout(timer); resolve(message); } };
   const timer = setTimeout(() => {
    this.pending = this.pending.filter(item => item !== wait);
    reject(new Error('Timed out waiting for server message'));
   }, 5000);
   this.pending.push(wait);
  });
 }

 async stateWhere(predicate: (game: GameState) => boolean): Promise<GameState> {
  if (this.state && predicate(this.state)) return this.state;
    // Old broadcasts must not satisfy a new disconnect/reconnect transition.
    this.inbox = this.inbox.filter(message => message.type !== 'STATE');
  await this.next(message => message.type === 'STATE' && !!message.state && predicate(message.state));
  return this.state!;
 }

 async action(action: GameAction): Promise<Message> {
  const requestId = `history-${++this.sequence}`;
  this.ws.send(JSON.stringify({ type:'ACTION', requestId, action }));
  return this.next(message => message.requestId === requestId && ['ACTION_APPLIED', 'ERROR'].includes(message.type));
 }
}

async function startServer(): Promise<{ child:ChildProcess; url:string }> {
 const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/index.ts', import.meta.url))], {
  env:{ ...process.env, PORT:'0' }, stdio:['ignore', 'pipe', 'pipe'],
 });
 const url = await new Promise<string>((resolve, reject) => {
  let output = '', errors = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error(`Server did not start: ${errors}`)); }, 10000);
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.stderr!.on('data', data => { errors += data.toString(); });
  child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${errors}`)); });
  child.stdout!.on('data', data => {
   output += data.toString(); const port = output.match(/listening on ws:\/\/localhost:(\d+)/)?.[1];
   if (port) { clearTimeout(timer); resolve(`ws://127.0.0.1:${port}`); }
  });
 });
 return { child, url };
}
const withoutHistory = (state: GameState) => { const copy = structuredClone(state); delete copy.history; return copy; };
function assertNoSnapshots(state: GameState) {
 expect(Object.keys(state.history!).every(key => ['canUndo', 'canRedo', 'undoLabel', 'redoLabel'].includes(key))).toBe(true);
 const json = JSON.stringify(state);
 for (const key of ['before', 'after', 'snapshots', 'undoStack', 'redoStack']) expect(json).not.toContain(`"${key}":`);
}

it('intercepts authenticated history on real sockets, acknowledges only success, masks metadata, and invalidates reconnect history', async () => {
 const { child, url } = await startServer(), peers:Peer[] = [];
 const connect = async () => {
  const peer = new Peer(url); peers.push(peer);
  await peer.next(message => message.type === 'CONNECTED'); return peer;
 };
 const ok = async (peer: Peer, action: GameAction) => expect((await peer.action(action)).type).toBe('ACTION_APPLIED');
 try {
  const host = await connect(), other = await connect();
  host.ws.send(JSON.stringify({ type:'CREATE_ROOM', roomId:'history-test', playerName:'History host' }));
  expect((await host.next(message => message.type === 'WELCOME')).playerId).toBe('p1');
  other.ws.send(JSON.stringify({ type:'JOIN', roomId:'history-test', playerName:'History opponent' }));
  expect((await other.next(message => message.type === 'WELCOME')).playerId).toBe('p2');
  await host.stateWhere(game => game.players.length === 2);
  await ok(host, { type:'SELECT_STARTING_SCHOOL', playerId:'p1', schoolId:'cantrip' });
  await ok(other, { type:'SELECT_STARTING_SCHOOL', playerId:'p2', schoolId:'cantrip' });
  await ok(host, { type:'SET_READY', playerId:'p1', ready:true });
  await ok(other, { type:'SET_READY', playerId:'p2', ready:true });
  await host.stateWhere(game => game.phase === 'BLACK_ROSE');
  await ok(host, { type:'ADVANCE_PHASE', playerId:'p1', expectedPhase:'BLACK_ROSE', expectedRound:1 });
  for (const [peer, playerId] of [[host, 'p1'], [other, 'p2']] as const) {
   await peer.stateWhere(game => game.phase === 'STUDY');
   await ok(peer, { type:'DRAW_STUDY', playerId, deckId:peer.state!.library[0].id });
   const own = peer.state!.players.find(p => p.id === playerId)!;
   await ok(peer, { type:'DISCARD_STUDY', playerId, cardIds:own.hand.slice(0, 2).map(card => card.id) });
  }
  for (const [peer, playerId] of [[host, 'p1'], [other, 'p2']] as const) {
   await peer.stateWhere(game => game.phase === 'PREPARATION');
   const own = peer.state!.players.find(p => p.id === playerId)!;
  expect(own.hand).toHaveLength(4);
  expect(own.personalDeck).toHaveLength(4);
  expect(own.discard).toHaveLength(1);
  expect(await peer.action({ type:'DISCARD_HAND_LIMIT', playerId, cardIds:[] })).toMatchObject({
   type:'ERROR', message:expect.stringMatching(/No cards over/),
  });
   const hand = peer.state!.players.find(p => p.id === playerId)!.hand;
   await ok(peer, { type:'PREPARE_CARDS', playerId, rapidCardId:hand[0].id, preparedCardIds:hand.slice(1, 4).map(card => card.id) });
  }
  await host.stateWhere(game => game.phase === 'ACTION');
  const initial = structuredClone(host.state!);
  await ok(host, { type:'BEGIN_PHYSICAL_ACTION', playerId:'p1', kind:'EXPLORE' });
  const after = structuredClone(host.state!);
  expect(after.history).toEqual({ canUndo:true, canRedo:false, undoLabel:'Begin physical action' });
  await other.stateWhere(game => !!game.activation?.physicalAction);
  expect(other.state!.history).toEqual({ canUndo:false, canRedo:false });
  expect(await other.action({ type:'UNDO_ACTION', playerId:'p2' })).toMatchObject({ type:'ERROR', message:expect.stringMatching(/No action available/) });
  expect(await other.action({ type:'UNDO_ACTION', playerId:'p1' })).toMatchObject({ type:'ERROR', message:expect.stringMatching(/another player/) });
  // A rejected room command must not mutate the existing room's history either.
  other.ws.send(JSON.stringify({ type:'CREATE_ROOM', roomId:'history-test' }));
  expect((await other.next(message => message.type === 'ERROR')).message).toMatch(/Already in a room/);
  await ok(host, { type:'UNDO_ACTION', playerId:'p1' });
  expect(withoutHistory(host.state!)).toEqual(withoutHistory(initial));
  await ok(host, { type:'REDO_ACTION', playerId:'p1' });
  expect(host.state).toEqual(after);
  assertNoSnapshots(host.state!); assertNoSnapshots(other.state!);

  // Clear redo as well as undo on disconnect; pause commands retain requestId errors.
  await ok(host, { type:'UNDO_ACTION', playerId:'p1' });
  expect(host.state!.history?.canRedo).toBe(true);
  other.ws.close(); await host.stateWhere(game => !game.players[1].connected);
  expect(host.state!.history).toEqual({ canUndo:false, canRedo:false });
  expect(await host.action({ type:'REDO_ACTION', playerId:'p1' })).toMatchObject({ type:'ERROR', message:expect.stringMatching(/paused/) });
  const replacement = await connect();
  replacement.ws.send(JSON.stringify({ type:'JOIN', roomId:'history-test', playerName:'Reconnected' }));
  expect((await replacement.next(message => message.type === 'WELCOME')).playerId).toBe('p2');
  await host.stateWhere(game => game.players.every(p => p.connected));
  for (const type of ['UNDO_ACTION', 'REDO_ACTION'] as const) {
   expect(await host.action({ type, playerId:'p1' })).toMatchObject({ type:'ERROR', message:expect.stringMatching(/No action available/) });
  }
  // Fresh history after reconnect is valid, but disconnecting its owner destroys it.
  await ok(host, { type:'BEGIN_PHYSICAL_ACTION', playerId:'p1', kind:'EXPLORE' });
  host.ws.close(); await replacement.stateWhere(game => !game.players[0].connected);
  const newHost = await connect();
  newHost.ws.send(JSON.stringify({ type:'JOIN', roomId:'history-test' }));
  expect((await newHost.next(message => message.type === 'WELCOME')).playerId).toBe('p1');
  await newHost.stateWhere(game => game.players.every(p => p.connected));
  expect(await newHost.action({ type:'UNDO_ACTION', playerId:'p1' })).toMatchObject({ type:'ERROR', message:expect.stringMatching(/No action available/) });
  assertNoSnapshots(newHost.state!);
 } finally {
  for (const peer of peers) peer.ws.terminate();
  if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
 }
}, 30000);

it.each([2, 3, 4].flatMap(count => ['cantrip', 'transmutation', 'enchantment'].map(schoolId => ({ count, schoolId }))))(
 'authenticates public choices and allocates seven personal $schoolId cards once for $count real seats', async ({ count, schoolId }) => {
 const { child, url } = await startServer(), peers:Peer[] = [];
 const connect = async () => {
  const peer = new Peer(url); peers.push(peer);
  await peer.next(message => message.type === 'CONNECTED'); return peer;
 };
 const ok = async (peer: Peer, action: GameAction) => {
  expect(await peer.action(action)).toMatchObject({ type:'ACTION_APPLIED' });
  return peer.state!;
 };
 const reject = async (peer: Peer, action: GameAction, message: RegExp) => {
  const before = peer.state;
  expect(await peer.action(action)).toMatchObject({ type:'ERROR', message:expect.stringMatching(message) });
  expect(peer.state).toBe(before); // A rejection sends no changed STATE or successful ACK.
 };
 const hidden = (index: number): Card => ({ id:`hidden-${index}`, name:'Hidden spell', kind:'SPELL',
  damage:0, instability:0, range:0, target:'MODEL' });
 const roomId = `schools-${count}`;
 try {
  expect(STARTING_SCHOOL_CARDS).toBe(7);
  const mages:Peer[] = [];
  for (let i = 0; i < count; i++) {
   const peer = await connect(); mages.push(peer);
   peer.ws.send(JSON.stringify({ type:i ? 'JOIN' : 'CREATE_ROOM', roomId, playerName:`School mage ${i + 1}` }));
   expect((await peer.next(message => message.type === 'WELCOME')).playerId).toBe(`p${i + 1}`);
   await peer.stateWhere(game => game.players.length === i + 1);
  }
  const host = mages[0], other = mages[1], visitor = await connect();
  await host.stateWhere(game => game.players.length === count);
  expect(host.state!.players.every(p => p.startingSchoolId === null && !p.ready &&
   p.hand.length === 0 && p.personalDeck.length === 0 && p.discard.length === 0 &&
   Object.values(p.prepared).every(slot => slot === null))).toBe(true);
  await reject(visitor, { type:'SELECT_STARTING_SCHOOL', playerId:'p1', schoolId:'cantrip' }, /Join a room first/);
  await reject(other, { type:'SELECT_STARTING_SCHOOL', playerId:'p1', schoolId:'enchantment' }, /another player/);
  await reject(host, { type:'SET_READY', playerId:'p1', ready:true }, /school/i);
  await reject(host, { type:'START_GAME', playerId:'p1' }, /ready|school/i);
  for (const schoolId of [undefined, null, '', 'school-1', 'unknown', 1, {}]) {
   await reject(host, { type:'SELECT_STARTING_SCHOOL', playerId:'p1', schoolId } as unknown as GameAction, /school/i);
  }
  const beforeChoice = structuredClone(host.state!);
  await ok(host, { type:'SELECT_STARTING_SCHOOL', playerId:'p1', schoolId:schoolId === 'transmutation' ? 'enchantment' : 'transmutation' });
  await ok(host, { type:'SET_READY', playerId:'p1', ready:true });
  await reject(host, { type:'SELECT_STARTING_SCHOOL', playerId:'p1', schoolId:'invalid' }, /school/i);
  expect(host.state!.players[0].ready).toBe(true);
  await ok(host, { type:'SELECT_STARTING_SCHOOL', playerId:'p1', schoolId });
  expect(host.state!.players[0]).toMatchObject({ startingSchoolId:schoolId, ready:false, hand:[] });
  expect(host.state!.library).toEqual(beforeChoice.library);
  expect(host.state!.players.map(p => p.personalDeck)).toEqual(beforeChoice.players.map(p => p.personalDeck));
  for (const type of ['UNDO_ACTION', 'REDO_ACTION'] as const)
   await reject(host, { type, playerId:'p1' }, /No action available/);
  for (let i = 1; i < count; i++)
    await ok(mages[i], { type:'SELECT_STARTING_SCHOOL', playerId:`p${i + 1}`, schoolId });
  await host.stateWhere(game => game.players.every(p => p.startingSchoolId === schoolId));
  for (const peer of mages) {
    await peer.stateWhere(game => game.players.every(p => p.startingSchoolId === schoolId));
  expect(peer.state!.players.every(p => p.hand.length === 0 && p.personalDeck.length === 0 && p.discard.length === 0)).toBe(true);
   expect(peer.state!.library.map(deck => deck.cards.length)).toEqual([36, 36, 36]);
   expect(peer.state!.history).toEqual({ canUndo:false, canRedo:false });
   assertNoSnapshots(peer.state!);
  }
  for (let i = 0; i < count - 1; i++) {
   await ok(mages[i], { type:'SET_READY', playerId:`p${i + 1}`, ready:true });
   expect(mages[i].state!.phase).toBe('LOBBY');
  }
  await host.stateWhere(game => game.players.slice(0, -1).every(p => p.ready));
  await reject(host, { type:'START_GAME', playerId:'p1' }, /ready|school/i);
  await ok(mages[count - 1], { type:'SET_READY', playerId:`p${count}`, ready:true });
  const snapshots:GameState[] = [];
  for (let i = 0; i < count; i++) {
   const peer = mages[i];
   const state = await peer.stateWhere(game => game.phase === 'BLACK_ROSE');
   expect(state.round).toBe(1);
    expect(state.library.map(deck => deck.cards.length)).toEqual(state.library.map(deck => 36 - (deck.id === schoolId ? 7 * count : 0)));
   expect(state.library.every(deck => deck.discard.length === 0)).toBe(true);
   expect(state.players.every(p => p.startingSchoolId === schoolId && p.ready &&
    p.hand.length === 0 && p.personalDeck.length === 6 && p.discard.length === 1)).toBe(true);
   expect(state.powerfulDeck).toHaveLength(12);
   expect(state.removedCards).toEqual([]);
   expect(state.history).toEqual({ canUndo:false, canRedo:false });
   assertNoSnapshots(state);
   for (const deck of state.library) expect(deck.cards).toEqual(deck.cards.map((_, j) => hidden(j)));
   for (const p of state.players) {
    expect(p.personalDeck).toEqual(p.personalDeck.map((_, k) => hidden(k)));
    expect(p.hand).toEqual([]);
    expect(p.discard[0]).toMatchObject({ schoolId, kind:'SPELL' });
    expect(p.discard[0].id.startsWith(`${schoolId}-`)).toBe(true);
    expect(p.discard[0].powerful).toBeUndefined();
   }
   snapshots.push(structuredClone(state));
  }
  const publicDiscards = snapshots[0].players.flatMap(p => p.discard);
  expect(new Set(publicDiscards.map(card => card.id)).size).toBe(count);
  expect(snapshots[0].library.reduce((sum, deck) => sum + deck.cards.length, 0) +
   snapshots[0].players.reduce((sum, p) => sum + p.personalDeck.length + p.discard.length, 0)).toBe(108);
  expect(snapshots[0].library.reduce((sum, deck) => sum + deck.cards.length, 0) +
   snapshots[0].players.reduce((sum, p) => sum + p.personalDeck.length + p.discard.length, 0) +
   snapshots[0].powerfulDeck.length).toBe(120);
  for (const state of snapshots) expect(state.players.map(p => p.discard)).toEqual(snapshots[0].players.map(p => p.discard));
  await reject(host, { type:'SELECT_STARTING_SCHOOL', playerId:'p1', schoolId:'enchantment' }, /BLACK_ROSE/);
  await reject(host, { type:'START_GAME', playerId:'p1' }, /BLACK_ROSE/);
  await reject(host, { type:'SET_READY', playerId:'p1', ready:true }, /BLACK_ROSE/);
  for (const type of ['UNDO_ACTION', 'REDO_ACTION'] as const)
   await reject(host, { type, playerId:'p1' }, /No action available/);

  // Reconnect before even entering Study: the original public discard, finite
  // stocks and personal decks must survive exactly, without another deal/event.
  const closed = once(other.ws, 'close'); other.ws.close(); await closed;
  await host.stateWhere(game => !game.players[1].connected);
  const replacement = await connect();
  replacement.ws.send(JSON.stringify({ type:'JOIN', roomId, playerName:'School mage 2' }));
  expect((await replacement.next(message => message.type === 'WELCOME')).playerId).toBe('p2');
  const rejoined = await replacement.stateWhere(game => game.players.every(p => p.connected));
  const original = snapshots[1];
  expect(rejoined.players).toEqual(original.players);
  for (const key of ['library', 'powerfulDeck', 'eventDeck', 'eventDiscard', 'questDeck', 'questDiscard',
   'removedCards', 'readiedSpells', 'ongoingSpells', 'activeSpellOrder', 'board', 'usedEvent', 'round', 'phase'] as const)
   expect(rejoined[key]).toEqual(original[key]);
  expect(rejoined.log.slice(0, original.log.length)).toEqual(original.log);
  expect(rejoined.log.slice(original.log.length)).toEqual([
   'School mage 2 disconnected. Waiting for reconnection.', 'School mage 2 joined the room.',
  ]);
  expect(rejoined.history).toEqual({ canUndo:false, canRedo:false });
  assertNoSnapshots(rejoined);
  await reject(replacement, { type:'SELECT_STARTING_SCHOOL', playerId:'p2', schoolId:'transmutation' }, /BLACK_ROSE/);
  await reject(replacement, { type:'REDO_ACTION', playerId:'p2' }, /No action available/);

  // The first Continue draws only two from the six-card personal draw pile.
  mages[1] = replacement;
  await ok(host, { type:'ADVANCE_PHASE', playerId:'p1', expectedPhase:'BLACK_ROSE', expectedRound:1 });
  const studySchool = schoolId === 'cantrip' ? 'transmutation' : 'cantrip';
  const drawnHands:Card[][] = [];
  for (let i = 0; i < count; i++) {
   const peer = mages[i], playerId = `p${i + 1}`;
   const state = await peer.stateWhere(game => game.phase === 'STUDY');
   expect(state.players.every(p => p.hand.length === 2 && p.personalDeck.length === 4 && p.discard.length === 1)).toBe(true);
   expect(state.players.map(p => p.discard)).toEqual(snapshots[0].players.map(p => p.discard));
   for (const p of state.players) {
    expect(p.personalDeck).toEqual(Array.from({ length:4 }, (_, k) => hidden(k)));
    if (p.id === playerId) {
     expect(p.hand.every(card => card.schoolId === schoolId && card.id.startsWith(`${schoolId}-`))).toBe(true);
     drawnHands.push(p.hand);
    } else expect(p.hand).toEqual(Array.from({ length:2 }, (_, k) => hidden(k)));
   }
  }
  expect(new Set([...drawnHands.flat(), ...publicDiscards].map(card => card.id)).size).toBe(3 * count);
  for (let i = 0; i < count; i++) {
   const peer = mages[i], playerId = `p${i + 1}`;
   await ok(peer, { type:'DRAW_STUDY', playerId, deckId:studySchool });
   const own = peer.state!.players[i];
   expect(own.hand).toHaveLength(6);
   const discard = own.hand.slice(-2);
   await ok(peer, { type:'DISCARD_STUDY', playerId, cardIds:discard.map(card => card.id) });
   expect(peer.state!.players[i].hand).toHaveLength(4);
   expect(peer.state!.players[i].discard).toEqual(publicDiscards.slice(i, i + 1));
   expect(peer.state!.library.find(deck => deck.id === studySchool)!.discard).toEqual(expect.arrayContaining(discard));
  }
  for (let i = 0; i < count; i++) {
   const peer = mages[i], playerId = `p${i + 1}`;
   await peer.stateWhere(game => game.phase === 'PREPARATION');
   const own = peer.state!.players[i];
   expect(own.hand).toHaveLength(4);
   expect(own.personalDeck).toHaveLength(4);
   await reject(peer, { type:'DISCARD_HAND_LIMIT', playerId, cardIds:[] }, /No cards over/);
   await ok(peer, { type:'PREPARE_CARDS', playerId, preparedCardIds:own.hand.slice(0, 3).map(card => card.id), rapidCardId:own.hand[3].id });
  }
  await host.stateWhere(game => game.phase === 'ACTION');
  expect(host.state!.players.every(p => p.hand.length === 0 && p.personalDeck.length === 4 && p.discard.length === 1)).toBe(true);
 } finally {
  for (const peer of peers) peer.ws.terminate();
  if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
 }
}, 30000);