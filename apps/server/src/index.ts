import { WebSocketServer, WebSocket } from 'ws';
import { addPlayerToLobby, applyAction, canStartGame, createGame, GameRuleError, GameState, PlayerId, Card, MAX_MAGES } from '@brw/game-engine';

type Client = { ws: WebSocket; playerId: PlayerId | null; roomId: string | null };
type Room = { id: string; game: GameState; clients: Set<Client> };
const rooms = new Map<string,Room>();
const clients = new Set<Client>();
const hiddenCard = (index: number): Card => ({ id:`hidden-${index}`, name:'Hidden spell', kind:'SPELL', damage:0, instability:0, range:0, target:'MODEL' });

function publicState(game: GameState, viewer: PlayerId | null) {
 const copy=structuredClone(game);
 // Never expose future draws, even to the owning player.
 copy.eventDeck=[]; copy.questDeck=[];
 copy.powerfulDeck=copy.powerfulDeck.map((_,i)=>hiddenCard(i));
 for(const deck of copy.library) deck.cards=deck.cards.map((_,i)=>hiddenCard(i));
 for(const p of copy.players) {
  p.personalDeck=p.personalDeck.map((_,i)=>hiddenCard(i));
  if(p.id===viewer) continue;
  p.hand=p.hand.map((_,i)=>hiddenCard(i)); p.quest=null;p.additionalQuests=[];
  for(const key of ['rapid','slot1','slot2','slot3'] as const) {
   if(p.prepared[key]) p.prepared[key]={card:hiddenCard(0),used:p.prepared[key]!.used};
  }
 }
 return copy;
}
function send(c: Client, message: unknown) { if(c.ws.readyState===WebSocket.OPEN)c.ws.send(JSON.stringify(message)); }
function roomList() {
 return [...rooms.values()].map(r=>({id:r.id,players:r.game.players.length,capacity:MAX_MAGES,status:r.game.phase==='LOBBY'?'waiting':'playing'}));
}
function broadcastRoomList() { for(const c of clients)send(c,{type:'ROOM_LIST',rooms:roomList()}); }
function broadcast(room: Room) { for(const c of room.clients)send(c,{type:'STATE',state:publicState(room.game,c.playerId)}); }

function joinRoom(c: Client, roomId: string, name: string, create: boolean) {
 if(c.roomId) throw new GameRuleError('Already in a room. Reload to join another.');
 if(!roomId || roomId.length>48) throw new GameRuleError('Room name must have 1–48 characters');
 let room=rooms.get(roomId);
 if(create) {
  if(room)throw new GameRuleError('Room already exists. Join it instead.');
  room={id:roomId,game:createGame(1),clients:new Set()}; rooms.set(roomId,room);
 }
 if(!room)throw new GameRuleError('Room not found. Create it first.');
 let seat=room.game.players.find(p=>!p.connected);
 if(!seat) {
  if(room.game.players.length>=MAX_MAGES)throw new GameRuleError('Room full (4 mages)');
  if(room.game.phase!=='LOBBY')throw new GameRuleError('Cannot join a battle already in progress; only disconnected mages may reconnect');
  room.game=addPlayerToLobby(room.game);
  seat=room.game.players.find(p=>!p.connected)!;
 }
 seat.connected=true;
 if(room.game.phase==='LOBBY')seat.ready=false;
 seat.name=name.trim().slice(0,32)||seat.name;
 c.roomId=roomId; c.playerId=seat.id; room.clients.add(c);
 room.game.log.push(`${seat.name} joined the room.`);
 send(c,{type:'WELCOME',playerId:seat.id,roomId}); broadcast(room); broadcastRoomList();
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
 send(c,{type:'CONNECTED'});send(c,{type:'ROOM_LIST',rooms:roomList()});
 ws.on('message',raw=>{
  let requestId:string|null=null;
  try {
   const msg=JSON.parse(raw.toString());
   if(!msg || typeof msg!=='object')throw new GameRuleError('Invalid message');
   requestId=typeof msg.requestId==='string'?msg.requestId.slice(0,80):null;
   if(msg.type==='JOIN'||msg.type==='CREATE_ROOM') {
    joinRoom(c,String(msg.roomId??'').trim(),String(msg.playerName??''),msg.type==='CREATE_ROOM');return;
   }
   if(!c.roomId||!c.playerId)throw new GameRuleError('Join a room first');
  const room=rooms.get(c.roomId);
  if(!room || !room.clients.has(c) || !room.game.players.some(p=>p.id===c.playerId&&p.connected))throw new GameRuleError('Join a room first');
   if(!msg.action || typeof msg.action.type!=='string')throw new GameRuleError('Missing action');
   if(msg.action.playerId!==c.playerId)throw new GameRuleError('You cannot act for another player');
  if(room.game.phase!=='LOBBY' && !room.game.players.every(p=>p.connected))throw new GameRuleError('Game paused: waiting for the other mages to reconnect');
   let game=applyAction(room.game,msg.action);
   if(msg.action.type==='SET_READY' && canStartGame(game))game=applyAction(game,{type:'START_GAME',playerId:game.hostId});
   room.game=game;broadcast(room);broadcastRoomList();
  if(requestId)send(c,{type:'ACTION_APPLIED',requestId});
  } catch(error) { send(c,{type:'ERROR',requestId,message:error instanceof Error?error.message:'Invalid action'}); }
 });
 ws.on('close',()=>{
  clients.delete(c);
  if(!c.roomId)return;
  const room=rooms.get(c.roomId);if(!room)return;
  room.clients.delete(c);
  const p=room.game.players.find(p=>p.id===c.playerId);
  if(p) {
   if(room.game.phase==='LOBBY') {
    room.game.players=room.game.players.filter(player=>player.id!==p.id);
    if(room.game.hostId===p.id && room.game.players.length)room.game.hostId=room.game.players[0].id;
    room.game.log.push(`${p.name} left the lobby.`);
   } else {
    p.connected=false;room.game.log.push(`${p.name} disconnected. Waiting for reconnection.`);
   }
  }
  if(!room.clients.size)rooms.delete(c.roomId);else broadcast(room);
  broadcastRoomList();
 });
});