import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { GameAction, GameState } from '@brw/game-engine';

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