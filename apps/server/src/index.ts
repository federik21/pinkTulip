import { WebSocketServer, WebSocket } from 'ws';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { addPlayerToLobby, createGame, GameRuleError, GameState, PlayerId, MAX_MAGES } from '@brw/game-engine';
import { ActionHistory } from './action-history';
import { publicState } from './public-state';
import { isSavable, saveFileFromEnv, SessionStore } from './session-store';
import { BotRunner, canFitBotRoster, configureBot } from './bot-room';

type Client = { ws: WebSocket; playerId: PlayerId | null; roomId: string | null };
type Room = { id: string; game: GameState; clients: Set<Client>; history: ActionHistory; passwordHash?: string; reconnectTokens: Map<PlayerId,string>; bots?: BotRunner };
const rooms = new Map<string,Room>();
const clients = new Set<Client>();
// Saving is opt-in: set SAVE_FILE (the server's npm scripts do) to keep running battles across restarts and empty rooms.
const saveFile=saveFileFromEnv(process.env.SAVE_FILE);
const store=saveFile?new SessionStore(saveFile,()=>[...rooms.values()].filter(r=>isSavable(r.game)).map(r=>({id:r.id,game:r.game,...(r.passwordHash?{passwordHash:r.passwordHash}:{}),reconnectTokens:Object.fromEntries(r.reconnectTokens)}))):null;
if(store) {
 for(const saved of store.load())rooms.set(saved.id,{id:saved.id,game:saved.game,clients:new Set(),history:new ActionHistory(),passwordHash:saved.passwordHash,reconnectTokens:new Map(Object.entries(saved.reconnectTokens??{}) as [PlayerId,string][])});
 console.log(`Session saving on: ${rooms.size} saved battle(s) restored from ${store.file}`);
 for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{store.flush();process.exit(0);});
}
function send(c: Client, message: unknown) { if(c.ws.readyState===WebSocket.OPEN)c.ws.send(JSON.stringify(message)); }
const hashPassword=(password:string,salt=randomBytes(16).toString('hex'))=>`${salt}:${scryptSync(password,salt,32).toString('hex')}`;
const hashReconnectToken=(token:string)=>createHash('sha256').update(token).digest('hex');
function safeHashEqual(a:string,b:string) {
 const left=Buffer.from(a,'hex'),right=Buffer.from(b,'hex');
 return left.length===right.length&&left.length>0&&timingSafeEqual(left,right);
}
function passwordMatches(password:string,stored:string) {
 if(password.length<8)return false;
 const [salt,digest]=stored.split(':');
 if(!salt||!digest||!/^[a-f0-9]{64}$/i.test(digest))return false;
 return safeHashEqual(scryptSync(password,salt,32).toString('hex'),digest);
}
const normalizedName=(name:string)=>name.normalize('NFKC').trim().toLowerCase();
function roomList() {
 // A battle nobody is connected to is a saved session; list its mage names so players know which name resumes which seat.
 return [...rooms.values()].map(r=>r.clients.size===0&&isSavable(r.game)
  ?{id:r.id,players:r.game.players.length,capacity:MAX_MAGES,status:'saved',mages:r.game.players.map(p=>p.name),passwordProtected:!!r.passwordHash}
  :{id:r.id,players:r.game.players.length,capacity:MAX_MAGES,status:r.game.phase==='LOBBY'?'waiting':'playing',passwordProtected:!!r.passwordHash});
}
function broadcastRoomList() { for(const c of clients)send(c,{type:'ROOM_LIST',rooms:roomList()}); }
function broadcast(room: Room) {
 for(const c of room.clients)send(c,{type:'STATE',state:publicState(room.game,c.playerId,room.history)});
 room.bots ??= new BotRunner(room,()=>rooms.get(room.id)===room&&room.clients.size>0,()=>{broadcast(room);broadcastRoomList();store?.schedule();});
 room.bots.wake();
}

function joinRoom(c: Client, roomId: string, name: string, password:string, reconnectToken:string, create: boolean) {
 if(c.roomId) throw new GameRuleError('Already in a room. Reload to join another.');
 if(!roomId || roomId.length>48) throw new GameRuleError('Room name must have 1–48 characters');
 const cleanName=name.normalize('NFKC').trim();
 if(!cleanName)throw new GameRuleError('Mage name is required');
 if(cleanName.length>32)throw new GameRuleError('Mage name must have at most 32 characters');
 if(password.length>128)throw new GameRuleError('Room password must have at most 128 characters');
 if(create&&password&&password.length<8)throw new GameRuleError('Room passwords must have at least 8 characters');
 let room=rooms.get(roomId);
 if(create) {
  if(room)throw new GameRuleError('Room already exists. Join it instead.');
  room={id:roomId,game:createGame(1),clients:new Set(),history:new ActionHistory(),...(password?{passwordHash:hashPassword(password)}:{}),reconnectTokens:new Map()}; rooms.set(roomId,room);
 }
 if(!room)throw new GameRuleError('Room not found. Create it first.');
 if(room.passwordHash&&!passwordMatches(password,room.passwordHash))throw new GameRuleError('Incorrect room password');
 const wanted=normalizedName(cleanName);
 const suppliedTokenHash=reconnectToken?hashReconnectToken(reconnectToken):'';
 const matchingSeat=reconnectToken?room.game.players.find(p=>!p.isBot&&safeHashEqual(room.reconnectTokens.get(p.id)??'',suppliedTokenHash)):undefined;
 if(matchingSeat) {
  if(matchingSeat.connected)throw new GameRuleError('This mage is already connected');
  if(normalizedName(matchingSeat.name)!==wanted)throw new GameRuleError('Reconnect with the original mage name');
 }
 if(!matchingSeat&&room.game.phase!=='LOBBY'&&room.game.players.some(p=>!p.isBot&&!p.connected&&!room.reconnectTokens.has(p.id)&&normalizedName(p.name)===wanted))throw new GameRuleError('This saved seat has no secure reconnect token and cannot be reclaimed by name.');
 if(!matchingSeat&&room.game.players.some(p=>(p.connected||room.reconnectTokens.has(p.id))&&normalizedName(p.name)===wanted))throw new GameRuleError('That mage name is already in this room. Choose another name or use your reconnect token.');
 let seat=matchingSeat??(create?room.game.players.find(p=>!p.isBot&&!p.connected):undefined);
 if(!seat) {
  if(room.game.players.length>=MAX_MAGES)throw new GameRuleError('Room full (4 mages)');
  if(room.game.phase!=='LOBBY')throw new GameRuleError('Cannot join a battle already in progress; only disconnected mages may reconnect');
  if(room.game.players.some(p=>p.isBot)&&!canFitBotRoster(room.game))throw new GameRuleError('Not enough library spells for another mage with AI in this room');
  room.game=addPlayerToLobby(room.game);
  seat=room.game.players.find(p=>!p.connected)!;
 }
 room.history.clear();
 seat.connected=true;
 if(room.game.phase==='LOBBY')seat.ready=false;
 if(!matchingSeat)seat.name=cleanName;
 const issuedToken=matchingSeat?reconnectToken:randomBytes(32).toString('base64url');
 room.reconnectTokens.set(seat.id,hashReconnectToken(issuedToken));
 c.roomId=roomId; c.playerId=seat.id; room.clients.add(c);
 room.game.log.push(`${seat.name} joined the room.`);
 send(c,{type:'WELCOME',playerId:seat.id,roomId,reconnectToken:issuedToken}); broadcast(room); broadcastRoomList(); store?.schedule();
}

const port=Number(process.env.PORT??8080);
const wss=new WebSocketServer({port});
wss.on('listening',()=>{
 const address=wss.address();
 console.log(`WebSocket server listening on ws://localhost:${typeof address==='object'&&address?address.port:port}`);
});
wss.on('error',error=>{console.error(`WebSocket server: ${error.message}`);process.exit(1);});
wss.on('connection',ws=>{
 const c:Client={ws,playerId:null,roomId:null};clients.add(c);
 send(c,{type:'CONNECTED',canSave:!!store});send(c,{type:'ROOM_LIST',rooms:roomList()});
 ws.on('message',raw=>{
  let requestId:string|null=null;
  try {
   const msg=JSON.parse(raw.toString());
   if(!msg || typeof msg!=='object')throw new GameRuleError('Invalid message');
   requestId=typeof msg.requestId==='string'?msg.requestId.slice(0,80):null;
   if(msg.type==='JOIN'||msg.type==='CREATE_ROOM') {
    if(typeof msg.roomId!=='string'||typeof msg.playerName!=='string')throw new GameRuleError('Room name and mage name are required');
    if(msg.password!==undefined&&typeof msg.password!=='string')throw new GameRuleError('Room password must be text');
    if(msg.reconnectToken!==undefined&&typeof msg.reconnectToken!=='string')throw new GameRuleError('Invalid reconnect token');
    joinRoom(c,msg.roomId.trim(),msg.playerName,msg.password??'',msg.reconnectToken??'',msg.type==='CREATE_ROOM');return;
   }
   if(!c.roomId||!c.playerId)throw new GameRuleError('Join a room first');
   const room=rooms.get(c.roomId);
   if(!room || !room.clients.has(c) || !room.game.players.some(p=>p.id===c.playerId&&p.connected))throw new GameRuleError('Join a room first');
   if(msg.type==='SET_AI_SPEED') {
    room.bots ??= new BotRunner(room,()=>rooms.get(room.id)===room&&room.clients.size>0,()=>{broadcast(room);broadcastRoomList();store?.schedule();});
    room.bots.slow=msg.slow===true;return;
   }
   if(msg.type==='SAVE_SESSION') {
    if(!store)throw new GameRuleError('Saving is not enabled on this server (set SAVE_FILE).');
    if(!isSavable(room.game))throw new GameRuleError('Only a battle in progress can be saved.');
    const savedAt=store.flush();
    if(!savedAt)throw new GameRuleError('Could not write the save file. Check the server log.');
    send(c,{type:'SESSION_SAVED',requestId,roomId:room.id,savedAt});return;
   }
   if(!msg.action || typeof msg.action.type!=='string')throw new GameRuleError('Missing action');
   if(msg.action.playerId!==c.playerId)throw new GameRuleError('You cannot act for another player');
   if(room.game.phase!=='LOBBY' && !room.game.players.every(p=>p.connected))throw new GameRuleError('Game paused: waiting for the other mages to reconnect');
  if(msg.action.type==='ADD_BOT'||msg.action.type==='REMOVE_BOT') {
   room.game=configureBot(room.game,msg.action);room.history.clear();
  } else room.game=room.history.apply(room.game,msg.action,c.playerId);
  broadcast(room);broadcastRoomList();store?.schedule();
   if(requestId)send(c,{type:'ACTION_APPLIED',requestId});
  } catch(error) { send(c,{type:'ERROR',requestId,message:error instanceof Error?error.message:'Invalid action'}); }
 });
 ws.on('close',()=>{
  clients.delete(c);
  if(!c.roomId)return;
  const room=rooms.get(c.roomId);if(!room)return;
  room.bots?.stop();
  room.history.clear();
  room.clients.delete(c);
  const p=room.game.players.find(p=>p.id===c.playerId);
  if(p) {
   if(room.game.phase==='LOBBY') {
    room.game.players=room.game.players.filter(player=>player.id!==p.id);
   room.reconnectTokens.delete(p.id);
    if(room.game.hostId===p.id)room.game.hostId=room.game.players.find(player=>!player.isBot)?.id??room.game.hostId;
    room.game.log.push(`${p.name} left the lobby.`);
   } else {
    p.connected=false;room.game.log.push(`${p.name} disconnected. Waiting for reconnection.`);
   }
  }
  // With saving on, an empty battle in progress stays as a saved session; everything else is discarded.
  if(!room.clients.size&&!(store&&isSavable(room.game)))rooms.delete(c.roomId);else if(room.clients.size)broadcast(room);
  broadcastRoomList();store?.schedule();
 });
});