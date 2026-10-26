import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { areAdjacent, createGame, getDiscardMoveCards, hexDistance, hexKey } from '@brw/game-engine';
import type { GameAction, GameState, Hex } from '@brw/game-engine';
import { configureBot } from '../src/bot-room';
import { SessionStore } from '../src/session-store';

type Message = { type: string; requestId?: string; message?: string; playerId?: string; canSave?: boolean;
 state?: GameState; savedAt?: string; rooms?: Array<{ id: string; players: number; capacity: number; status: string; mages?: string[] }> };
type Waiter = { predicate: (message: Message) => boolean; resolve: (message: Message) => void; reject: (error: Error) => void };

class Peer {
 readonly ws: WebSocket;
 state?: GameState;
 readonly states: GameState[] = [];
 readonly messages: Message[] = [];
 private inbox: Message[] = [];
 private pending: Waiter[] = [];
 private sequence = 0;
 constructor(url: string) {
  this.ws = new WebSocket(url);
  this.ws.on('message', raw => {
   const message = JSON.parse(raw.toString()) as Message;
   this.messages.push(message);
   if (message.type === 'STATE') { this.state = message.state!; this.states.push(message.state!); }
   const index = this.pending.findIndex(wait => wait.predicate(message));
   if (index < 0) this.inbox.push(message); else this.pending.splice(index, 1)[0].resolve(message);
  });
  this.ws.on('error', error => { for (const wait of this.pending.splice(0)) wait.reject(error); });
 }
 next(predicate: (message: Message) => boolean): Promise<Message> {
  const index = this.inbox.findIndex(predicate);
  if (index >= 0) return Promise.resolve(this.inbox.splice(index, 1)[0]);
  return new Promise((resolve, reject) => {
   const finish = () => { clearTimeout(timer); this.pending = this.pending.filter(item => item !== wait); };
   const wait: Waiter = { predicate, resolve: message => { finish(); resolve(message); }, reject: error => { finish(); reject(error); } };
   const timer = setTimeout(() => wait.reject(new Error(`Timed out waiting for server message; latest ${this.state?.phase}/${this.state?.currentPlayerId}`)), 8000);
   this.pending.push(wait);
  });
 }
 async stateWhere(predicate: (state: GameState) => boolean): Promise<GameState> {
  if (this.state && predicate(this.state)) return this.state;
  // Never satisfy a transition using a stale STATE queued before the command.
  this.inbox = this.inbox.filter(message => message.type !== 'STATE');
  return (await this.next(message => message.type === 'STATE' && !!message.state && predicate(message.state))).state!;
 }
 send(message: object) { this.ws.send(JSON.stringify(message)); }
 async request(message: object): Promise<Message> {
  const requestId = `bot-${++this.sequence}`;
  this.send({ ...message, requestId });
  return this.next(reply => reply.requestId === requestId && ['ACTION_APPLIED', 'ERROR', 'SESSION_SAVED'].includes(reply.type));
 }
 async action(action: GameAction) {
  const reply = await this.request({ type: 'ACTION', action });
  expect(reply, JSON.stringify(action)).toMatchObject({ type: 'ACTION_APPLIED' });
 }
 async rejected(action: GameAction, message: RegExp) {
  expect(await this.request({ type: 'ACTION', action })).toMatchObject({ type: 'ERROR', message: expect.stringMatching(message) });
 }
 dispose() {
  for (const wait of [...this.pending]) wait.reject(new Error('Peer disposed'));
  this.ws.terminate();
 }
}

const peers: Peer[] = [], children: ChildProcess[] = [], directories: string[] = [];
afterEach(async () => {
 for (const peer of peers.splice(0)) peer.dispose();
 for (const child of children.splice(0)) await stop(child);
 for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
async function stop(child: ChildProcess) {
 if (child.exitCode !== null || child.signalCode !== null) return;
 const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
}
async function startServer(saveFile = 'off') {
 const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/index.ts', import.meta.url))], {
  env: { ...process.env, PORT: '0', SAVE_FILE: saveFile }, stdio: ['ignore', 'pipe', 'pipe'],
 });
 children.push(child);
 let errors = '';
 child.stderr!.on('data', data => { errors += data.toString(); });
 const url = await new Promise<string>((resolve, reject) => {
  let output = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error(`Server did not start: ${errors}`)); }, 10000);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${errors}`)); });
  child.stdout!.on('data', data => {
   output += data.toString(); const port = output.match(/listening on ws:\/\/localhost:(\d+)/)?.[1];
   if (port) { clearTimeout(timer); resolve(`ws://127.0.0.1:${port}`); }
  });
 });
 return { child, url, errors: () => errors };
}
async function connect(url: string, canSave = false) {
 const peer = new Peer(url); peers.push(peer);
 expect(await peer.next(message => message.type === 'CONNECTED')).toMatchObject({ canSave });
 return peer;
}
async function joinRoom(peer: Peer, roomId: string, playerName: string, create = false) {
 peer.send({ type: create ? 'CREATE_ROOM' : 'JOIN', roomId, playerName });
 const welcome = await peer.next(message => message.type === 'WELCOME');
 await peer.stateWhere(() => true); return welcome.playerId!;
}
async function startHumanAndBot(host: Peer, roomId: string) {
 expect(await joinRoom(host, roomId, 'Human host', true)).toBe('p1');
 await host.action({ type: 'ADD_BOT', playerId: 'p1' });
 await host.stateWhere(game => game.players[1].ready);
 expect(host.state!.phase).toBe('LOBBY');
 expect(host.state!.players[1]).toMatchObject({ id: 'p2', isBot: true, connected: true, startingSchoolId: 'agony', ready: true });
 await host.action({ type: 'SELECT_STARTING_SCHOOL', playerId: 'p1', schoolId: 'agony' });
 await host.action({ type: 'SET_READY', playerId: 'p1', ready: true });
 return host.stateWhere(game => game.phase === 'BLACK_ROSE');
}
async function reachAction(host: Peer, roomId: string) {
 const started = await startHumanAndBot(host, roomId);
 expect(started.players.map(p => p.personalDeck.length)).toEqual([6, 6]);
 expect(started.players.every(p => p.hand.length === 0 && p.discard.length === 1)).toBe(true);
 await host.action({ type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: 'BLACK_ROSE', expectedRound: 1 });
 await host.stateWhere(game => game.phase === 'STUDY' && game.players[1].studyDone);
 expect(host.states.some(game => game.phase === 'STUDY' && game.players[1].studyDrawn && !game.players[1].studyDone)).toBe(true);
 expect(host.state!.players[1].hand).toHaveLength(4);
 expect(host.state!.players[1]).not.toHaveProperty('studyCardIds');
 expect(host.state!.players[1].hand.every(card => card.name === 'Hidden spell')).toBe(true);
 await host.action({ type: 'DRAW_STUDY', playerId: 'p1', deckIds: ['agony', 'agony', 'agony', 'agony'] });
 const own = host.state!.players[0]; expect(own.studyCardIds).toHaveLength(4);
 await host.action({ type: 'DISCARD_STUDY', playerId: 'p1', cardIds: own.studyCardIds!.slice(0, 2) });
 await host.stateWhere(game => game.phase === 'PREPARATION' && game.players[1].preparationDone);
 expect(Object.values(host.state!.players[1].prepared).filter(Boolean)).toHaveLength(4);
 expect(host.state!.players[0].preparationDone).toBe(false);
 const hand = host.state!.players[0].hand;
 await host.action({ type: 'PREPARE_CARDS', playerId: 'p1', preparedCardIds: hand.slice(0, 3).map(c => c.id), rapidCardId: hand[3].id });
 return host.stateWhere(game => game.phase === 'ACTION' && game.currentPlayerId === 'p1');
}
function pathTo(game: GameState, origin: Hex, goal: Hex): Hex[] {
 const tiles = game.board.rooms.filter(room => !room.startingFor).flatMap(room => room.tiles);
 const queue: Array<{ position: Hex; path: Hex[] }> = [{ position: origin, path: [] }], seen = new Set([hexKey(origin)]);
 for (let i = 0; i < queue.length; i++) {
  const node = queue[i]; if (hexKey(node.position) === hexKey(goal)) return node.path;
  for (const tile of tiles) if (!seen.has(hexKey(tile)) && areAdjacent(node.position, tile)) {
   seen.add(hexKey(tile)); queue.push({ position: tile, path: [...node.path, tile] });
  }
 }
 throw new Error('No legal board path');
}
async function finishBotTurn(host: Peer) {
 for (let i = 0; i < 30; i++) {
  const state = await host.stateWhere(game => game.currentPlayerId === 'p1' || game.pendingDecision?.playerId === 'p1' || game.phase !== 'ACTION');
  const decision = state.pendingDecision;
  if (decision?.playerId === 'p1') {
   if (decision.kind === 'SOUL_TITHE') await host.action({ type: 'RESPOND_SOUL_TITHE', playerId: 'p1', accept: false });
   else if (decision.kind === 'REACTIVE_SPELL') await host.action({ type: 'RESPOND_REACTIVE_SPELL', playerId: 'p1', key: decision.key });
   else throw new Error('Unexpected masked owner decision');
  } else return;
 }
 throw new Error('AI did not finish its turn');
}

// Real transport checks must span more than two 450ms bot beats. A request ACK
// alone would finish before a mistakenly queued AI callback could fire.
async function expectQuiet(peer: Peer) {
 const before = structuredClone(peer.state), states = peer.states.length;
 await new Promise(resolve => setTimeout(resolve, 1000));
 expect(peer.states).toHaveLength(states); expect(peer.state).toEqual(before);
}

describe('real AI room transport', () => {
 it('authenticates host Add/Remove AI, resets readiness, reuses seats, and rejects guest/spoof commands atomically', async () => {
  const server = await startServer(), host = await connect(server.url), guest = await connect(server.url);
  expect(await joinRoom(host, 'roster', 'Host', true)).toBe('p1');
  expect(await joinRoom(guest, 'roster', 'Guest')).toBe('p2');
  await host.stateWhere(game => game.players.length === 2);
  await host.action({ type: 'SELECT_STARTING_SCHOOL', playerId: 'p1', schoolId: 'agony' });
  await guest.action({ type: 'SELECT_STARTING_SCHOOL', playerId: 'p2', schoolId: 'agony' });
  await host.action({ type: 'SET_READY', playerId: 'p1', ready: true });
  const before = structuredClone(host.state!);
  await guest.rejected({ type: 'ADD_BOT', playerId: 'p2' }, /Only the creator/);
  await guest.rejected({ type: 'ADD_BOT', playerId: 'p1' }, /another player/);
  expect(host.state).toEqual(before);
  await host.action({ type: 'ADD_BOT', playerId: 'p1' });
  expect(host.state!.players.map(p => p.ready)).toEqual([false, false, false]);
  expect(host.state!.players.slice(0, 2).map(p => p.startingSchoolId)).toEqual(['agony', 'agony']);
  await host.stateWhere(game => game.players[2].ready);
  await guest.rejected({ type: 'REMOVE_BOT', playerId: 'p2', botId: 'p3' }, /Only the creator/);
  for (const peer of [host, guest]) for (const action of [
   { type: 'SET_READY', playerId: 'p3', ready: false },
   { type: 'SELECT_STARTING_SCHOOL', playerId: 'p3', schoolId: 'agony' },
   { type: 'REMOVE_BOT', playerId: 'p3', botId: 'p3' },
  ] as const) await peer.rejected(action, /another player/);
  await host.rejected({ type: 'REMOVE_BOT', playerId: 'p1', botId: 'p2' }, /AI opponent not found/);
  await host.action({ type: 'SET_READY', playerId: 'p1', ready: true });
  await host.action({ type: 'REMOVE_BOT', playerId: 'p1', botId: 'p3' });
  expect(host.state!.players.map(p => p.id)).toEqual(['p1', 'p2']); expect(host.state!.players.every(p => !p.ready)).toBe(true);
  await host.action({ type: 'ADD_BOT', playerId: 'p1' });
  expect(host.state!.players[2]).toMatchObject({ id: 'p3', isBot: true, connected: true, ready: false, startingSchoolId: null });
  expect(host.state!.phase).toBe('LOBBY'); expect(server.errors()).toBe('');
 }, 20000);

 it('caps mixed rosters at three for Agony Study supply and never hands an AI seat to a joining socket', async () => {
  const server = await startServer(), host = await connect(server.url);
  await joinRoom(host, 'supply', 'Host', true);
  await host.action({ type: 'ADD_BOT', playerId: 'p1' });
  const human = await connect(server.url);
  expect(await joinRoom(human, 'supply', 'AI Mage 2')).toBe('p3');
  await host.stateWhere(game => game.players.length === 3 && game.players[1].ready);
  expect(host.state!.players[1]).toMatchObject({ id: 'p2', isBot: true, connected: true, name: 'AI Mage 2' });
  const before = structuredClone(host.state!);
  await host.rejected({ type: 'ADD_BOT', playerId: 'p1' }, /Not enough library/);
  const fourth = await connect(server.url);
  fourth.send({ type: 'JOIN', roomId: 'supply', playerName: 'Fourth' });
  expect(await fourth.next(message => message.type === 'ERROR')).toMatchObject({ message: expect.stringMatching(/Not enough library/) });
  expect(host.state).toEqual(before); expect(fourth.messages.some(message => message.type === 'WELCOME')).toBe(false);
  expect(server.errors()).toBe('');
 }, 15000);

 it('migrates a departing lobby host to the remaining human, skipping the earlier AI seat', async () => {
  const server = await startServer(), host = await connect(server.url), guest = await connect(server.url);
  await joinRoom(host, 'migration', 'Host', true); await host.action({ type: 'ADD_BOT', playerId: 'p1' });
  expect(await joinRoom(guest, 'migration', 'Next host')).toBe('p3');
  await guest.stateWhere(game => game.players[1].ready);
  const closed = once(host.ws, 'close'); host.ws.close(); await closed;
  const migrated = await guest.stateWhere(game => game.hostId === 'p3' && game.players.length === 2);
  expect(migrated.players.map(p => p.id)).toEqual(['p2', 'p3']); expect(migrated.players[0].isBot).toBe(true);
  await guest.action({ type: 'REMOVE_BOT', playerId: 'p3', botId: 'p2' });
  await guest.action({ type: 'ADD_BOT', playerId: 'p3' });
  expect(guest.state!.players.at(-1)).toMatchObject({ id: 'p1', isBot: true }); expect(guest.state!.hostId).toBe('p3');
  expect(server.errors()).toBe('');
 }, 15000);

 it('deletes a running SAVE_FILE=off room when the last human leaves despite its connected AI seat', async () => {
  const server = await startServer(), host = await connect(server.url), watcher = await connect(server.url);
  await startHumanAndBot(host, 'ephemeral-bot');
  const closed = once(host.ws, 'close'); host.ws.close(); await closed;
  await watcher.next(message => message.type === 'ROOM_LIST' && message.rooms?.length === 0);
  await expectQuiet(watcher);
  expect(await joinRoom(watcher, 'ephemeral-bot', 'New host', true)).toBe('p1');
  expect(watcher.state!.players).toHaveLength(1); expect(watcher.state!.phase).toBe('LOBBY');
  expect(watcher.state!.players[0].isBot).not.toBe(true); expect(server.errors()).toBe('');
 }, 15000);

 it('runs human + AI school/ready/Pink Tulip/Study/preparation and paced movement and combat on the current catalog', async () => {
  const server = await startServer(), host = await connect(server.url);
  const initial = await reachAction(host, 'live-bot');
  expect(initial.round).toBe(1); expect(initial.players[1].prepared.slot1!.card.name).toBe('Hidden spell');
  expect((await host.request({ type: 'SAVE_SESSION' })).message).toMatch(/not enabled/);
  for (const type of ['ADD_BOT', 'REMOVE_BOT'] as const)
   await host.rejected({ type, playerId: 'p1', botId: 'p2' }, /only.*lobby/);
  const route = pathTo(host.state!, host.state!.players[0].wizard.position, { q: 0, r: 0 });
  expect(route).toHaveLength(2);
  await host.action({ type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
  await host.action({ type: 'PERFORM_MOVEMENT', playerId: 'p1' });
  for (const destination of route) await host.action({ type: 'EXPLORE_STEP', playerId: 'p1', destination });
  await host.action({ type: 'SKIP_PHYSICAL_EFFECTS', playerId: 'p1' });
  expect(host.state!.history?.canUndo).toBe(true);
  const firstBotState = host.states.length;
  await host.action({ type: 'END_ACTIVATION', playerId: 'p1' });
  await host.stateWhere(game => game.activation?.physicalAction?.kind === 'EXPLORE' && game.currentPlayerId === 'p2');
  expect(host.state!.history).toEqual({ canUndo: false, canRedo: false });
  await host.rejected({ type: 'UNDO_ACTION', playerId: 'p1' }, /No action available/);
  await host.rejected({ type: 'PUNCH', playerId: 'p2', targetId: 'p1' }, /another player/);
  await finishBotTurn(host);
  expect(host.states.slice(firstBotState).some(game => !game.board.rooms.some(room => room.startingFor === 'p2' && room.tiles.some(h => hexKey(h) === hexKey(game.players[1].wizard.position))))).toBe(true);

  // A naturally shuffled preparation may use a hidden activation before an
  // attack. Give it further real turns rather than replacing dealt cards.
  const dealtByBot = (game: GameState) => game.feedbackEvents?.some(event => event.kind === 'DAMAGE' && event.sourceId === 'p2' && event.target.id === 'p1');
  for (let turn = 0; turn < 5 && !dealtByBot(host.state!); turn++) {
   expect(host.state!.phase).toBe('ACTION'); expect(host.state!.currentPlayerId).toBe('p1');
   const own = host.state!.players[0];
   if (own.actionTokens > 0) {
    await host.action({ type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'ATTACK' });
    await host.action({ type: 'SKIP_PHYSICAL_EFFECTS', playerId: 'p1' });
   } else {
    const card = getDiscardMoveCards(own,host.state!.activation)[0];
    expect(card).toBeDefined();
    const destination = host.state!.board.rooms.filter(room => !room.startingFor).flatMap(room => room.tiles)
     .filter(h => areAdjacent(own.wizard.position, h)).sort((a, b) => hexDistance(a, { q: 0, r: 0 }) - hexDistance(b, { q: 0, r: 0 }))[0];
    await host.action({ type: 'DISCARD_EXIT', playerId: 'p1', cardId: card.id, destination });
   }
   await host.action({ type: 'END_ACTIVATION', playerId: 'p1' }); await finishBotTurn(host);
  }
  expect(dealtByBot(host.state!)).toBe(true);
  expect(host.state!.players[1].actionTokens).toBeLessThan(2);
  expect(host.messages.filter(message => message.type === 'ERROR').every(message => /not enabled|only.*lobby|No action available|another player/.test(message.message!))).toBe(true);
  expect(server.errors()).toBe('');
 }, 45000);

 it('keeps AI connected across save/restart, requires human rejoin, and never lets a socket reclaim an AI seat', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bot-network-')); directories.push(directory);
  const file = join(directory, 'sessions.json');
  let server = await startServer(file); const host = await connect(server.url, true);
  const started = await startHumanAndBot(host, 'restore-bot');
  expect(await host.request({ type: 'SAVE_SESSION' })).toMatchObject({ type: 'SESSION_SAVED', savedAt: expect.any(String) });
  const saved = JSON.parse(readFileSync(file, 'utf8')).rooms[0].game as GameState;
  expect(saved.players[1]).toMatchObject({ isBot: true, connected: true });
  const watcher = await connect(server.url, true), closed = once(host.ws, 'close'); host.ws.close(); await closed;
  const listed = await watcher.next(message => message.type === 'ROOM_LIST' && message.rooms?.some(room => room.status === 'saved') === true);
  expect(listed.rooms).toContainEqual({ id: 'restore-bot', players: 2, capacity: 4, status: 'saved', mages: ['Human host', 'AI Mage 2'] });
  await stop(server.child); server = await startServer(file);
  const loaded = new SessionStore(file, () => []).load()[0].game;
  expect(loaded.players.map(p => p.connected)).toEqual([false, true]); expect(loaded.players[1].isBot).toBe(true);
  expect(loaded.gameId).toBe(started.gameId); expect(loaded.players[1].personalDeck.map(c => c.id)).toEqual(saved.players[1].personalDeck.map(c => c.id));
  const returning = await connect(server.url, true);
  expect((await returning.next(message => message.type === 'ROOM_LIST')).rooms?.[0].status).toBe('saved');
  // Even an exact bot name must get the open HUMAN seat, never p2.
  expect(await joinRoom(returning, 'restore-bot', 'AI Mage 2')).toBe('p1');
  expect(returning.state!.players.map(p => p.connected)).toEqual([true, true]);
  expect(returning.state!.players[1]).toMatchObject({ id: 'p2', isBot: true, connected: true });
  expect(returning.state!.players[0].isBot).not.toBe(true);
  const intruder = await connect(server.url, true);
  intruder.send({ type: 'JOIN', roomId: 'restore-bot', playerName: 'AI Mage 2' });
  expect(await intruder.next(message => message.type === 'ERROR')).toMatchObject({ message: expect.stringMatching(/already in progress/) });
  expect(intruder.messages.some(message => message.type === 'WELCOME')).toBe(false);
  await returning.rejected({ type: 'SET_READY', playerId: 'p2', ready: true }, /another player/);
  await returning.action({ type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: 'BLACK_ROSE', expectedRound: 1 });
  await returning.stateWhere(game => game.players[1].studyDone);
  expect(returning.state!.phase).toBe('STUDY'); expect(server.errors()).toBe('');
 }, 30000);

 it('does not run AI without human clients or through a disconnected human, and clears history after a restored real attack', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bot-network-')); directories.push(directory);
  const file = join(directory, 'sessions.json'), lobby = createGame(2);
  for (const p of lobby.players) p.connected = true;
  const game = configureBot(lobby, { type: 'ADD_BOT', playerId: 'p1' });
  game.phase = 'ACTION'; game.round = 1; game.currentPlayerId = 'p3'; game.firstPlayerId = 'p1';
  game.activation = { playerId: 'p3', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false, spellsCast: 0, discardedExit: false, roomEffectUsed: false };
  for (const p of game.players) p.wizard.position = { q: 0, r: 0 };
  const store = new SessionStore(file, () => [{ id: 'paused-bot', game }]); expect(store.flush()).toEqual(expect.any(String));
  const server = await startServer(file), first = await connect(server.url, true);
  // No joined clients: the saved authoritative state is unchanged.
    await expectQuiet(first);
  expect(new SessionStore(file, () => []).load()[0].game.log).toEqual(game.log);
  expect(await joinRoom(first, 'paused-bot', game.players[0].name)).toBe('p1');
  expect(first.state!.players.map(p => p.connected)).toEqual([true, false, true]);
  await first.rejected({ type: 'END_ACTIVATION', playerId: 'p1' }, /paused/);
    await expectQuiet(first);
  expect((await first.request({ type: 'SAVE_SESSION' })).type).toBe('SESSION_SAVED');
  expect(JSON.parse(readFileSync(file, 'utf8')).rooms[0].game.players[0].wizard.damageCubes).toBe(0);
  const second = await connect(server.url, true);
  expect(await joinRoom(second, 'paused-bot', game.players[1].name)).toBe('p2');
  const attacked = await first.stateWhere(state => state.players[0].wizard.damageByPlayer.p3 === 2);
  expect(attacked.players[2].actionTokens).toBe(1); expect(attacked.activation?.actionsUsed).toBe(1);
  expect(attacked.history).toEqual({ canUndo: false, canRedo: false });
  await first.rejected({ type: 'UNDO_ACTION', playerId: 'p1' }, /No action available/);
  const closed = once(second.ws, 'close'); second.ws.close(); await closed;
  const paused = await first.stateWhere(state => !state.players[1].connected);
  expect(paused.players[2].connected).toBe(true);
  await first.rejected({ type: 'END_ACTIVATION', playerId: 'p1' }, /paused/);
    await expectQuiet(first);
  expect(server.errors()).toBe('');
 }, 20000);
});