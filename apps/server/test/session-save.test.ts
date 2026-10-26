import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createGame, addPlayerToLobby } from '@brw/game-engine';
import type { GameState } from '@brw/game-engine';
import { isSavable, saveFileFromEnv, SessionStore } from '../src/session-store';

type Message = { type:string; requestId?:string; message?:string; playerId?:string; roomId?:string; canSave?:boolean;
 savedAt?:string; state?:GameState; rooms?:Array<{ id:string; status:string; players:number; mages?:string[] }> };

class Peer {
 ws: WebSocket; state?: GameState; inbox: Message[] = [];
 pending: { predicate:(message:Message) => boolean; resolve:(message:Message) => void }[] = [];
 constructor(url: string) {
  this.ws = new WebSocket(url);
  this.ws.on('message', raw => {
   const message = JSON.parse(raw.toString()) as Message;
   if (message.type === 'STATE') this.state = message.state;
   const index = this.pending.findIndex(wait => wait.predicate(message));
   if (index < 0) this.inbox.push(message); else this.pending.splice(index, 1)[0].resolve(message);
  });
 }
 next(predicate: (message: Message) => boolean): Promise<Message> {
  const index = this.inbox.findIndex(predicate);
  if (index >= 0) return Promise.resolve(this.inbox.splice(index, 1)[0]);
  return new Promise((resolve, reject) => {
   const wait = { predicate, resolve:(message:Message) => { clearTimeout(timer); resolve(message); } };
   const timer = setTimeout(() => { this.pending = this.pending.filter(item => item !== wait); reject(new Error('Timed out waiting for server message')); }, 5000);
   this.pending.push(wait);
  });
 }
 send(message: object) { this.ws.send(JSON.stringify(message)); }
 async action(action: object) {
  const requestId = `save-${Math.random()}`;
  this.send({ requestId, action });
  const reply = await this.next(message => message.requestId === requestId && ['ACTION_APPLIED', 'ERROR'].includes(message.type));
  expect(reply.type).toBe('ACTION_APPLIED');
 }
}

async function startServer(saveFile: string | null): Promise<{ child:ChildProcess; url:string }> {
 const env: NodeJS.ProcessEnv = { ...process.env, PORT:'0' };
 if (saveFile) env.SAVE_FILE = saveFile; else delete env.SAVE_FILE;
 const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../src/index.ts', import.meta.url))], { env, stdio:['ignore', 'pipe', 'pipe'] });
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
async function stop(child: ChildProcess) {
 if (child.exitCode !== null) return;
 const exited = new Promise(resolve => child.once('exit', resolve));
 child.kill('SIGTERM'); await exited;
}

const directories: string[] = [];
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), 'brw-saves-')); directories.push(dir); return dir; };
afterAll(() => { for (const dir of directories) rmSync(dir, { recursive:true, force:true }); });

async function connect(url: string) {
 const peer = new Peer(url);
 const hello = await peer.next(message => message.type === 'CONNECTED');
 return { peer, canSave:hello.canSave };
}

it('saves a running battle on request, keeps it when everyone leaves, and resumes it after a server restart', async () => {
 const file = join(tempDir(), 'nested', 'sessions.json');
 let { child, url } = await startServer(file);
 try {
  const host = await connect(url), guest = await connect(url);
  expect(host.canSave).toBe(true);
  host.peer.send({ type:'CREATE_ROOM', roomId:'later', playerName:'Ayla' });
  expect((await host.peer.next(message => message.type === 'WELCOME')).playerId).toBe('p1');
  guest.peer.send({ type:'JOIN', roomId:'later', playerName:'Borin' });
  expect((await guest.peer.next(message => message.type === 'WELCOME')).playerId).toBe('p2');

  // A lobby cannot be saved.
  host.peer.send({ type:'SAVE_SESSION' });
  expect((await host.peer.next(message => message.type === 'ERROR')).message).toMatch(/battle in progress/);

  for (const [peer, playerId] of [[host.peer, 'p1'], [guest.peer, 'p2']] as const) {
   await peer.action({ type:'SELECT_STARTING_SCHOOL', playerId, schoolId:'cantrip' });
  }
  for (const [peer, playerId] of [[host.peer, 'p1'], [guest.peer, 'p2']] as const) await peer.action({ type:'SET_READY', playerId, ready:true });
  await host.peer.next(message => message.type === 'STATE' && message.state?.phase === 'BLACK_ROSE');

  host.peer.send({ type:'SAVE_SESSION', requestId:'manual-save' });
  const saved = await host.peer.next(message => message.type === 'SESSION_SAVED');
  expect(saved).toMatchObject({ requestId:'manual-save', roomId:'later' });
  const onDisk = JSON.parse(readFileSync(file, 'utf8')) as { version:number; rooms:Array<{ id:string; savedAt:string; game:GameState }> };
  expect(onDisk.version).toBe(1);
  expect(onDisk.rooms.map(room => room.id)).toEqual(['later']);
  expect(onDisk.rooms[0].game.phase).toBe('BLACK_ROSE');
  expect(existsSync(`${file}.tmp`)).toBe(false);

  // Everybody leaves: the battle stays listed as a saved session with its mage names.
  const watcher = await connect(url);
  host.peer.ws.close(); guest.peer.ws.close();
  const listed = await watcher.peer.next(message => message.type === 'ROOM_LIST' && message.rooms?.[0]?.status === 'saved');
  expect(listed.rooms).toEqual([{ id:'later', players:2, capacity:4, status:'saved', mages:['Ayla', 'Borin'] }]);
  watcher.peer.ws.close();
 } finally { await stop(child); }

 // Server restarted from the same file.
 ({ child, url } = await startServer(file));
 try {
  const returning = await connect(url);
  const list = await returning.peer.next(message => message.type === 'ROOM_LIST');
  expect(list.rooms).toEqual([{ id:'later', players:2, capacity:4, status:'saved', mages:['Ayla', 'Borin'] }]);
  const other = await connect(url);
  // The second mage rejoins first and must get their own seat by name, not the first free one.
  other.peer.send({ type:'JOIN', roomId:'later', playerName:'borin' });
  expect((await other.peer.next(message => message.type === 'WELCOME')).playerId).toBe('p2');
  const paused = await other.peer.next(message => message.type === 'STATE');
  expect(paused.state).toMatchObject({ phase:'BLACK_ROSE', round:1 });
  expect(paused.state!.players.map(player => player.connected)).toEqual([false, true]);
  // The game stays paused until the missing mage returns.
  other.peer.send({ requestId:'paused', action:{ type:'ADVANCE_PHASE', playerId:'p2', expectedPhase:'BLACK_ROSE', expectedRound:1 } });
  expect((await other.peer.next(message => message.requestId === 'paused')).message).toMatch(/paused/);
  returning.peer.send({ type:'JOIN', roomId:'later', playerName:'Ayla' });
  expect((await returning.peer.next(message => message.type === 'WELCOME')).playerId).toBe('p1');
  await returning.peer.next(message => message.type === 'STATE' && message.state!.players.every(player => player.connected));
  returning.peer.ws.close(); other.peer.ws.close();
 } finally { await stop(child); }
}, 40000);

it('stays off unless SAVE_FILE is set: no Save control offered, empty rooms are discarded', async () => {
 const { child, url } = await startServer(null);
 try {
  const { peer, canSave } = await connect(url);
  expect(canSave).toBe(false);
  peer.send({ type:'CREATE_ROOM', roomId:'ephemeral', playerName:'Solo' });
  await peer.next(message => message.type === 'WELCOME');
  peer.send({ type:'SAVE_SESSION' });
  expect((await peer.next(message => message.type === 'ERROR')).message).toMatch(/not enabled/);
  peer.ws.close();
 } finally { await stop(child); }
});

it('treats unusable save files safely and only stores battles in progress', () => {
 expect(saveFileFromEnv(undefined)).toBeNull();
 expect(saveFileFromEnv('  ')).toBeNull();
 expect(saveFileFromEnv('OFF')).toBeNull();
 expect(saveFileFromEnv(' saves/a.json ')).toBe('saves/a.json');

 const lobby = addPlayerToLobby(createGame(1));
 expect(isSavable(lobby)).toBe(false);
 expect(isSavable({ ...lobby, phase:'ACTION' })).toBe(true);
 expect(isSavable({ ...lobby, phase:'GAME_OVER' })).toBe(false);

 const dir = tempDir(), file = join(dir, 'sessions.json');
 const running = { ...lobby, phase:'ACTION' as const };
 const store = new SessionStore(file, () => [{ id:'ok', game:running }, { id:'x'.repeat(10), game:running }]);
 expect(store.load()).toEqual([]);
 expect(store.flush()).toEqual(expect.any(String));
 const loaded = store.load();
 expect(loaded.map(room => room.id)).toEqual(['ok', 'xxxxxxxxxx']);
 expect(loaded.every(room => room.game.players.every(player => !player.connected))).toBe(true);

 // Invalid entries (a lobby, a bad id, a broken game) are skipped; unreadable files are kept aside, not overwritten.
 writeFileSync(file, JSON.stringify({ version:1, rooms:[{ id:'lobby', game:lobby }, { id:'', game:running }, { id:'broken', game:{ phase:'ACTION' } }, { id:'fine', game:running }] }));
 expect(store.load().map(room => room.id)).toEqual(['fine']);
 writeFileSync(file, '{not json');
 expect(store.load()).toEqual([]);
 expect(readdirSync(dir).filter(name => name.startsWith('sessions.json.corrupt-'))).toHaveLength(1);
 expect(existsSync(file)).toBe(false);
});

it('upgrades cards saved with flat damage, heal, convert and instability fields to moments on load', () => {
 const file = join(tempDir(), 'legacy.json');
 const running = createGame(2); running.phase = 'ACTION';
 const legacy = { id:'legacy-card', name:'Old Hex', kind:'SPELL', damage:2, instability:1, range:2, target:'MODEL' };
 running.players[0].hand = [legacy as never];
 writeFileSync(file, JSON.stringify({ version:1, rooms:[{ id:'old', savedAt:new Date().toISOString(), game:running }] }));
 const [room] = new SessionStore(file, () => []).load();
 expect(room.game.players[0].hand[0]).toEqual({ id:'legacy-card', name:'Old Hex', kind:'SPELL', range:2, target:'MODEL',
  moments:[{ effect:'INSTABILITY', amount:1 }, { effect:'DAMAGE', amount:2 }] });
});
