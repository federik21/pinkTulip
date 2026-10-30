import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { applyAction, createGame, addPlayerToLobby } from '@brw/game-engine';
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

it('restores infinite spell ranges from JSON saves and permits off-axis targeting', () => {
 const file = join(tempDir(), 'infinite-range.json');
 const game = createGame(2);game.phase='ACTION';game.round=1;game.currentPlayerId='p1';
 game.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 game.players[0].wizard.position={q:0,r:0};game.players[1].wizard.position={q:1,r:1};
 const index=game.library[0].cards.findIndex(card=>card.name==='Submission');
 const card=game.library[0].cards.splice(index,1)[0];
 game.players[0].prepared.slot1={card,used:false};
 const store=new SessionStore(file,()=>[{id:'infinite',game}]);
 expect(store.flush()).toEqual(expect.any(String));
 expect(JSON.parse(readFileSync(file,'utf8')).rooms[0].game.players[0].prepared.slot1.card.range).toBeNull();
 const [loaded]=store.load();
 expect(loaded.game.players[0].prepared.slot1!.card.range).toBe(Number.POSITIVE_INFINITY);
 for(const p of loaded.game.players)p.connected=true;
 const result=applyAction(loaded.game,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',targetPlayerId:'p2'});
 expect(result.players[1].wizard.damageCubes).toBe(1);
 expect(result.players[0].wizard.blackDamage).toBe(1);
 expect(result.players[0].prepared.slot1?.used).toBe(true);
});
