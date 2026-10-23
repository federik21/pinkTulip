import { Activation, Board, Card, Evocation, GameAction, GameState, Hex, Player, PlayerId, Room, RoomColor, RoomEffect } from './types';
import { createEvents, createLibrary, createPowerfulDeck, createQuests, createSpellDeck, shuffle } from './cards';

export class GameRuleError extends Error {}
export const PHYSICAL_TOKENS_PER_ROUND = 2;
export const ACTIONS_PER_TURN = 2;
export const MIN_MAGES = 2;
export const MAX_MAGES = 4;
export const BLACK_ROSE_ID = 'black-rose';
export const ENDGAME_REWARDS = [4,2,1] as const;
export function getRoomRewards(capacity:number):Room['rewards'] {
 switch(capacity) {
  case 4:return [2,1,0];
  case 5:return [4,2,1];
  case 6:return [5,3,1];
  case 10:return [6,3,1];
  default:throw new GameRuleError(`Unsupported room capacity: ${capacity}`);
 }
}
export const MAGE_COLORS: Record<string,string> = {p1:'#fb7185',p2:'#60a5fa',p3:'#fbbf24',p4:'#34d399'};
export const evocationAttack = (e:Evocation) => e.attack+(e.passive==='WOUNDED_FURY'?e.damageCubes:0);
export const hexKey = (h: Hex) => `${h.q},${h.r}`;
export const hexDistance = (a: Hex, b: Hex) => Math.max(Math.abs(a.q-b.q), Math.abs(a.r-b.r), Math.abs(a.q+a.r-b.q-b.r));
// Spell sight follows one straight hex axis; movement may still turn between steps.
export const hexLineDistance = (a: Hex, b: Hex) => {
 const dq = b.q-a.q;
 const dr = b.r-a.r;
 if (dq === 0 || dr === 0 || dq + dr === 0) return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
 return Number.POSITIVE_INFINITY;
};
export const isWithinSpellRange = (a: Hex, b: Hex, range: number): boolean => {
 const distance=hexLineDistance(a,b);
 return Number.isFinite(distance) && distance<=range;
};
export const areAdjacent = (a: Hex, b: Hex) => hexDistance(a,b) === 1;
export function areInSameRoom(game:Pick<GameState,'board'>,a:Hex,b:Hex):boolean {
 return game.board.rooms.some(room=>room.tiles.some(h=>hexKey(h)===hexKey(a)) && room.tiles.some(h=>hexKey(h)===hexKey(b)));
}
const slots = ['slot1', 'slot2', 'slot3'] as const;
const emptyPrepared = () => ({ rapid: null, slot1: null, slot2: null, slot3: null });
const assert = (condition: unknown, message: string): void => { if (!condition) throw new GameRuleError(message); };
const getPlayer = (s: GameState, id: string): Player => {
 const p = s.players.find(p => p.id === id);
 if (!p) throw new GameRuleError('Player not found');
 return p;
};
const getRoom = (s: GameState, id: string): Room => {
 const room = s.board.rooms.find(r => r.id === id);
 if (!room) throw new GameRuleError('Room not found');
 return room;
};
const inRoom = (p: Player, room: Room) => room.tiles.some(h => hexKey(h) === hexKey(p.wizard.position));
export const ROOM_COLORS: RoomColor[] = ['crimson','azure','emerald','amber','violet','grey'];
export const ROOM_EFFECT_LABELS: Record<RoomEffect,string> = {
 ROOM_DAMAGE:'Deal 1 damage to every enemy in this room', DRAW_DISCARD:'Retrieve 1 random spell from your personal discard',
 INSTABILITY:'Place 1 instability in a room within distance 1', DRAW_QUEST:'Draw 1 additional quest',
 DRAW_GRIMOIRE:'Draw 1 grimoire spell', SUMMON_CADAVER:'Summon 1 Cadaver in this room (maximum 3 evocations)',
 DRAW_POWERFUL:'Gain 1 powerful spell; prepare in a later Preparation phase, then remove from the game when cast',
};
const effects: RoomEffect[] = ['ROOM_DAMAGE','DRAW_DISCARD','INSTABILITY','DRAW_QUEST','DRAW_GRIMOIRE','SUMMON_CADAVER'];
export const isInStartingRoom = (s:GameState,p:Player) => s.board.rooms.some(r=>!!r.startingFor && inRoom(p,r));
const requirePhase = (s: GameState, phase: GameState['phase']) => assert(s.phase === phase, `Action unavailable in ${s.phase}`);
const requireActivation = (s: GameState, id: string): Activation => {
 requirePhase(s, 'ACTION');
 assert(s.currentPlayerId === id && s.activation?.playerId === id, 'Not your turn');
 assert(!s.evocationActivation,'Finish the active evocation first');
 return s.activation!;
};

export function createDemoBoard(): Board {
 const names=shuffle([
  'Ember Vault','Moonlit Gallery','Thorn Garden','Whispering Library','Ashen Forge','Silver Observatory',
  'Hollow Chapel','Crimson Atelier','Veiled Archive','Gilded Reliquary','Echoing Crypt','Starlit Hall',
  'Obsidian Study','Dreaming Atrium','Frost Conservatory','Sunken Treasury','Twilight Court','Waning Sanctum',
  'Raven Belfry','Glass Labyrinth','Ivied Vestibule','Candlelit Refuge',
 ]);
 const startingRooms = [
  {playerId:'p1',position:{q:3,r:-2}},
  {playerId:'p2',position:{q:-3,r:2}},
  {playerId:'p3',position:{q:-1,r:-2}},
  {playerId:'p4',position:{q:1,r:2}},
 ];
 const tiles: Hex[] = [];
 for (let r=-2;r<=2;r++) for(let q=-2;q<=2;q++) if(hexDistance({q,r},{q:0,r:0})<=2) tiles.push({q,r});
 tiles.push(...startingRooms.map(start=>start.position));
 let colorIndex=0;
 const rooms: Room[] = tiles.map(h => {
  const regular=hexDistance(h,{q:0,r:0})>0 && hexDistance(h,{q:0,r:0})<=2;
  const index=regular?colorIndex++%6:-1;
  // Three repeats: twelve capacity-5 rooms, three capacity-4 and three capacity-6.
  const capacity=h.q===0 && h.r===0?10:index===4?4:index===5?6:5;
  return {
  id: `room-${h.q},${h.r}`, name: h.q===0 && h.r===0 ? 'Black Rose Chamber' : names.pop()!,
  tiles: [h], instability: 0, instabilityLimit: capacity,
  rewards: getRoomRewards(capacity), cubesByPlayer: {}, reconstructed: false, scored: false,
  color:index<0?null:ROOM_COLORS[index], effect:index<0?(h.q===0&&h.r===0?'DRAW_POWERFUL':null):effects[index], specialUsed:false,
 }; });
 for(const start of startingRooms)rooms.find(r=>r.id===`room-${hexKey(start.position)}`)!.startingFor=start.playerId;
 return { tiles, rooms };
}

function createMage(board:Board,id:PlayerId):Player {
 const start=board.rooms.find(r=>r.startingFor===id)!;
 const names:Record<string,string>={p1:'Crimson Mage',p2:'Azure Mage',p3:'Amber Mage',p4:'Emerald Mage'};
 return {
   id, name:names[id], connected: false, ready: false,
  wizard: { id: `${id}-wizard`, playerId: id, health: 10, attack: 2, movement: 2, damageCubes: 0, blackDamage: 0, damageByPlayer: {}, position: {...start.tiles[0]}, startingRoomId: start.id, alive: true },
   personalDeck: shuffle(createSpellDeck(id).slice(0,12)), hand: [], discard: [], prepared: emptyPrepared(),
  cubes: { available:25, onWizard:0, onBoard:0, onEvocations:0 }, actionTokens:PHYSICAL_TOKENS_PER_ROUND, victoryPoints:0,
  questsCompleted:0, kills:0, quest:null, additionalQuests:[], studyDrawn:false, studyDone:false, preparationDone:false, passed:false, cardLimit:7, questLimit:2,
 };
}

export function canStartGame(s:GameState):boolean {
 return s.phase==='LOBBY' && s.players.length>=MIN_MAGES && s.players.length<=MAX_MAGES && s.players.every(p=>p.connected&&p.ready);
}

export function addPlayerToLobby(state:GameState):GameState {
 assert(state.phase==='LOBBY','Cannot join a battle already in progress');
 assert(state.players.length<MAX_MAGES,'Room full (4 mages)');
 const s=structuredClone(state);
 const id=['p1','p2','p3','p4'].find(id=>!s.players.some(p=>p.id===id))!;
 s.players.push(createMage(s.board,id));
 return s;
}

export function createGame(playerCount=2): GameState {
 assert(Number.isInteger(playerCount)&&playerCount>=1&&playerCount<=MAX_MAGES,'Choose between 1 and 4 mages');
 const board = createDemoBoard();
 const players=['p1','p2','p3','p4'].slice(0,playerCount).map(id=>createMage(board,id));
 return {
  gameId:crypto.randomUUID(), hostId:'p1', round:0, phase:'LOBBY', players, board, library:createLibrary(),
  blackRose:{victoryPoints:0,kills:0}, firstPlayerId:null, endgameScored:false,
  eventDeck:createEvents(), eventDiscard:[], questDeck:createQuests(), questDiscard:[],
  powerfulDeck:createPowerfulDeck(), removedCards:[],
  evocations:[], evocationActivation:null,
  currentPlayerId:null, activation:null, winner:null, log:['Room created. Join and mark yourself ready.'], usedEvent:null, blackRoseResolved:false,
 };
}

export function getRoomMajorityWinners(room: Pick<Room,'cubesByPlayer'>): PlayerId[] {
 const entries=Object.entries(room.cubesByPlayer).filter(([,n])=>n>0);
 const max=Math.max(0,...entries.map(([,n])=>n));
 return entries.filter(([,n])=>n===max).map(([id])=>id);
}

// Dense ranks: tied leaders do not consume the next distinct contribution rank.
// Every tied contributor loses one point (minimum one for a nonzero prize).
// Explicit zero prizes and ranks beyond the table remain zero.
export function getContributionAwards(cubes:Record<PlayerId,number>,rewards:readonly number[]) {
 const entries=Object.entries(cubes).filter(([,n])=>n>0);
 const totals=[...new Set(entries.map(([,n])=>n))].sort((a,b)=>b-a);
 return entries.map(([playerId,cubes])=>{
  const rank=totals.indexOf(cubes);
  const tied=entries.filter(([,n])=>n===cubes).length>1;
  const reward=rewards[rank]??0;
  return {playerId,cubes,rank:rank+1,tied,points:reward>0?Math.max(1,reward-(tied?1:0)):0};
 });
}

function awardVictoryPoints(s:GameState,id:PlayerId,points:number):string {
 if(id===BLACK_ROSE_ID){s.blackRose.victoryPoints+=points;return 'Black Rose';}
 const p=getPlayer(s,id);p.victoryPoints+=points;return p.name;
}

function completeQuest(s: GameState, p: Player, kind: NonNullable<Player['quest']>['kind'], amount=1) {
 const remaining: NonNullable<Player['quest']>[]=[];
 for(const quest of [p.quest,...p.additionalQuests]) {
  if(!quest)continue;
  if(quest.kind!==kind || amount<quest.amount){remaining.push(quest);continue;}
  p.victoryPoints+=quest.reward;p.questsCompleted++;
  s.log.push(`${p.name} completes “${quest.name}”: +${quest.reward} VP.`);
  s.questDiscard.push(quest);
 }
 p.quest=remaining.shift()??null;p.additionalQuests=remaining;
}

function drawQuest(s:GameState) {
 if(!s.questDeck.length){s.questDeck=shuffle(s.questDiscard);s.questDiscard=[];}
 return s.questDeck.shift()??null;
}

function damage(s: GameState, target: Player, amount: number, source?: Player) {
 if(amount<=0 || source?.id===target.id) return;
 // Overkill cannot claim more contribution than the health actually removed.
 const inflicted=Math.min(amount,Math.max(0,target.wizard.health-target.wizard.damageCubes));
 if(inflicted===0)return;
 target.wizard.damageCubes+=inflicted;
 if(source) {
  const cubes=Math.min(inflicted,source.cubes.available);
  if(cubes>0) {
   source.cubes.available-=cubes;
   source.cubes.onWizard+=cubes;
   target.wizard.damageByPlayer[source.id]=(target.wizard.damageByPlayer[source.id]??0)+cubes;
   s.log.push(`${source.name} places ${cubes} damage cubes on ${target.name}.`);
  }
 } else target.wizard.blackDamage+=inflicted;
 s.log.push(`${target.name} suffers ${inflicted} ${source ? 'damage' : 'black damage'}.`);
 if(target.wizard.damageCubes<target.wizard.health) return;
 s.log.push(`${target.name} is defeated and returns to their starting room.`);
 const contributions=Object.fromEntries(Object.entries(target.wizard.damageByPlayer).filter(([id,n])=>id!==target.id && n>0));
 contributions[BLACK_ROSE_ID]=(contributions[BLACK_ROSE_ID]??0)+target.wizard.blackDamage;
 for(const {playerId,cubes,rank,tied,points} of getContributionAwards(contributions,[4,2,1])) {
  const name=awardVictoryPoints(s,playerId,points);
  s.log.push(`${name}: +${points} VP for ${cubes} ${playerId===BLACK_ROSE_ID?'black damage':'damage cubes'} on ${target.name} (rank ${rank}${tied&&points>0?', tied −1 VP':''}).`);
 }
 // Only actual player-owned cubes return; Black Rose damage has no physical supply.
 for(const owner of s.players) {
  const cubes=target.wizard.damageByPlayer[owner.id]??0;
  if(cubes>0) {
   owner.cubes.available+=cubes;owner.cubes.onWizard-=cubes;
   s.log.push(`${owner.name}: ${cubes} damage cubes returned from defeated ${target.name}.`);
  }
 }
 const colored=Object.entries(contributions).filter(([,n])=>n>0);
 if(colored.length===1 && colored[0][0]!==BLACK_ROSE_ID && colored[0][1]===target.wizard.damageCubes) {
  const owner=getPlayer(s,colored[0][0]);owner.victoryPoints++;
  s.log.push(`${owner.name}: +1 VP exclusive-color bonus on defeated ${target.name}.`);
 }
 // The final hitter still receives quest/kill credit, but no separate flat VP bonus.
 if(source) { source.kills++; completeQuest(s,source,'KILL'); }
 else {s.blackRose.kills++;s.log.push(`Black Rose receives kill credit for defeating ${target.name}.`);}
 target.wizard.damageCubes=0;
 target.wizard.blackDamage=0;
 target.wizard.damageByPlayer={};
 target.wizard.position={...getRoom(s,target.wizard.startingRoomId).tiles[0]};
}

function damageEvocation(s:GameState,e:Evocation,amount:number,source:Player) {
 assert(e.playerId!==source.id,'Cannot damage your own evocations');
 const inflicted=Math.min(amount,Math.max(0,e.health-e.damageCubes));
 if(inflicted<=0)return;
 e.damageCubes+=inflicted;
 const cubes=Math.min(inflicted,source.cubes.available);
 source.cubes.available-=cubes;source.cubes.onEvocations+=cubes;
 if(cubes)e.damageByPlayer[source.id]=(e.damageByPlayer[source.id]??0)+cubes;
 s.log.push(`${e.name} suffers ${inflicted} damage; ${source.name} places ${cubes} damage cubes.`);
 if(e.damageCubes<e.health)return;
 for(const [id,n] of Object.entries(e.damageByPlayer)) {
  const owner=getPlayer(s,id);owner.cubes.available+=n;owner.cubes.onEvocations-=n;
 }
 s.evocations=s.evocations.filter(model=>model.id!==e.id);
 s.log.push(`${e.name} is destroyed; its damage cubes return to their owners.`);
}

function modelTarget(s:GameState,id:string) {
 const mage=s.players.find(p=>p.id===id || p.wizard.id===id);
 const evocation=s.evocations.find(e=>e.id===id);
 assert(mage||evocation,'Target model not found');
 return {mage,evocation,playerId:mage?.id??evocation!.playerId,position:mage?.wizard.position??evocation!.position};
}

function damageModel(s:GameState,id:string,amount:number,source:Player) {
 const target=modelTarget(s,id);assert(target.playerId!==source.id,'Cannot damage your own models');
 if(target.mage)damage(s,target.mage,amount,source);else damageEvocation(s,target.evocation!,amount,source);
}

function mageAttackTarget(s:GameState,p:Player,id:string) {
 assert(!isInStartingRoom(s,p),'Leave the starting room before attacking');
 const target=modelTarget(s,id);assert(target.playerId!==p.id,'Cannot attack yourself or your own evocations');
 assert(!s.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(target.position))),'Cannot target a model in its starting room');
 assert(hexDistance(p.wizard.position,target.position)===0,'Target must be in the same hex (distance 0)');
 return target;
}

function placeInstability(s: GameState, room: Room, amount: number, source?: Player) {
 if(room.reconstructed || room.startingFor || room.instability>=room.instabilityLimit) return 0;
 const actual=Math.min(amount,room.instabilityLimit-room.instability,source?.cubes.available ?? amount);
 if(actual<=0) return 0;
 const owner=source?.id ?? BLACK_ROSE_ID;
 room.instability+=actual;
 room.cubesByPlayer[owner]=(room.cubesByPlayer[owner]??0)+actual;
 if(source) { source.cubes.available-=actual; source.cubes.onBoard+=actual; completeQuest(s,source,'INSTABILITY',actual); }
 s.log.push(`${source?.name ?? 'Black Rose'} places ${actual} instability in ${room.name} (${room.instability}/${room.instabilityLimit}).`);
 if(room.instability===room.instabilityLimit) {
  s.log.push(`${room.name} is full and cannot accept more instability; rebuilding, room VP and upgraded actions wait until Cleanup.`);
  if(source && room.cubesByPlayer[source.id]===room.instability) {
   source.victoryPoints++;
   s.log.push(`${source.name}: +1 VP for completing ${room.name} entirely in their color.`);
  }
  if(source) completeQuest(s,source,'REBUILD');
 }
 return actual;
}

function startBlackRose(s: GameState) {
 s.round++; s.phase='BLACK_ROSE'; s.blackRoseResolved=false; s.currentPlayerId=null; s.activation=null;s.evocationActivation=null;
 for(const p of s.players) {
  p.actionTokens=PHYSICAL_TOKENS_PER_ROUND; p.passed=false; p.studyDrawn=false; p.studyDone=false; p.preparationDone=false;
  // Powerful spells stay with the mage until cast, including uncast preparations.
  for(const key of ['rapid',...slots] as const) {
   const prepared=p.prepared[key];
   if(prepared && !prepared.used) {
    if(prepared.card.powerful)p.hand.push(prepared.card);else discardCard(s,p,prepared.card);
   }
  }
  p.prepared=emptyPrepared();
 }
 if(!s.eventDeck.length) { s.eventDeck=shuffle(s.eventDiscard); s.eventDiscard=[]; }
 const event=s.eventDeck.shift()!; s.usedEvent=event; s.eventDiscard.push(event);
 s.log.push(`Round ${s.round} · BLACK ROSE — ${event.name}.`);
 if(event.kind==='BLACK_DAMAGE') for(const p of s.players) damage(s,p,event.amount);
 else {
  const candidates=shuffle(s.board.rooms.filter(r=>!r.startingFor && !r.reconstructed && r.instability<r.instabilityLimit));
  for(const room of candidates.slice(0,event.rooms)) placeInstability(s,room,event.amount);
 }
}

const heldQuests = (p:Player) => p.quest?[p.quest,...p.additionalQuests]:[...p.additionalQuests];

function beginStudyIfQuestsFit(s:GameState) {
 if(s.players.some(p=>heldQuests(p).length>p.questLimit))return;
 for(const p of s.players) {
  let drawn=0;
  while(drawn<2 && p.personalDeck.length+p.discard.length>0) {p.hand.push(drawOne(p.personalDeck,p.discard));drawn++;}
  if(drawn<2)s.log.push(`${p.name} draws ${drawn} grimoire spells; the remaining personal spells are already held.`);
 }
 s.phase='STUDY'; s.log.push('STUDY — each mage draws 2 grimoire spells, chooses a library school, then discards 2.');
}

function finishBlackRose(s: GameState) {
 assert(!s.blackRoseResolved,'Waiting for quest-limit discards');
 for(const p of s.players) {
  const quests=heldQuests(p);p.quest=quests.shift()??null;p.additionalQuests=quests;
  if(!p.quest) {
   p.quest=drawQuest(s);
   if(p.quest)s.log.push(`${p.name} receives a personal quest.`);
  }
 }
 s.blackRoseResolved=true;
 if(s.players.some(p=>heldQuests(p).length>p.questLimit))s.log.push('BLACK ROSE — waiting for quest-limit discards.');
 beginStudyIfQuestsFit(s);
}

function drawOne(deck: Card[], discard: Card[]): Card {
 if(!deck.length) { deck.push(...shuffle(discard)); discard.length=0; }
 const card=deck.shift(); if(!card) throw new GameRuleError('This deck is empty');
 return card;
}

function discardCard(s:GameState,p:Player,card:Card) {
 assert(!card.powerful,'Powerful spells cannot be discarded; keep them until used');
 const school=s.library.find(d=>card.schoolId===d.id || card.id.startsWith(`${d.id}-`));
 (school?school.discard:p.discard).push(card);
}

function activateRoom(s:GameState,p:Player,targetRoomId?:string) {
 const room=s.board.rooms.find(r=>inRoom(p,r));
 assert(room?.effect && !room.startingFor,'No room effect in a starting room');
 assert(!targetRoomId || room!.effect==='INSTABILITY','Only Emerald instability takes a target room');
 const reward=room!.reconstructed?2:1;
 if(room!.reconstructed){assert(!room!.specialUsed,'Reconstructed room special already used this Action phase');room!.specialUsed=true;}
 switch(room!.effect) {
  case 'ROOM_DAMAGE': {
   const targets=s.players.filter(t=>t.id!==p.id && inRoom(t,room!));
  const evocations=s.evocations.filter(e=>e.playerId!==p.id && room!.tiles.some(h=>hexKey(h)===hexKey(e.position)));
  for(const target of targets)damage(s,target,reward,p);
  for(const e of evocations)damageEvocation(s,e,reward,p);
   break;
  }
  case 'DRAW_DISCARD': {
  if(p.discard.length)for(let i=0;i<reward && p.discard.length;i++)p.hand.push(p.discard.splice(Math.floor(Math.random()*p.discard.length),1)[0]);
   else s.log.push(`${p.name}'s personal discard is empty; no spell retrieved.`);
   break;
  }
  case 'INSTABILITY': {
   const target=targetRoomId?getRoom(s,targetRoomId):room!;
   assert(!target.startingFor,'Starting rooms cannot be targeted');
   const lineDistance = Math.min(...target.tiles.flatMap(h => room!.tiles.map(origin => hexLineDistance(origin, h))));
   assert(Number.isFinite(lineDistance) && lineDistance <= 1,'Room effect target out of range (maximum 1)');
  placeInstability(s,target,reward,p);break;
  }
  case 'DRAW_GRIMOIRE':for(let i=0;i<reward && p.personalDeck.length+p.discard.length;i++)p.hand.push(drawOne(p.personalDeck,p.discard));break;
  case 'SUMMON_CADAVER': {
   const count=Math.min(reward,3-s.evocations.filter(e=>e.playerId===p.id).length);
   for(let i=0;i<count;i++) {
    const owned=s.evocations.filter(e=>e.playerId===p.id);
    const number=[1,2,3].find(n=>!owned.some(e=>e.number===n))!;
    s.evocations.push({id:crypto.randomUUID(),playerId:p.id,number,name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:2,passive:'WOUNDED_FURY',position:{...p.wizard.position},damageCubes:0,damageByPlayer:{},activated:false});
    s.log.push(`${p.name} summons a Cadaver from the Grey room (Undead · move 2 · attack 2 · health 2).`);
   }
   if(count===0)s.log.push(`${p.name} already controls 3 evocations; no Cadaver summoned.`);
   break;
  }
  case 'DRAW_QUEST': {
  for(let i=0;i<reward;i++) {
   const quest=drawQuest(s);
   if(quest){if(p.quest)p.additionalQuests.push(quest);else p.quest=quest;}
   else {s.log.push('No quest cards are available.');break;}
  }
   break;
  }
  case 'DRAW_POWERFUL': {
  for(let i=0;i<reward;i++) {
   const card=s.powerfulDeck.shift();
   if(card)p.hand.push(card);else {s.log.push('The powerful spell supply is exhausted.');break;}
  }
   break;
  }
 }
 s.log.push(`${p.name} activates ${room!.name} for free${reward===2?' (reconstructed special: double reward)':''}: ${ROOM_EFFECT_LABELS[room!.effect!]}.`);
}

function endExplore(s:GameState,p:Player,activate:boolean,targetRoomId?:string) {
 const a=s.activation!;
 if(a.physicalAction) {
  assert(!activate,'Use ACTIVATE_ROOM separately for a pending physical action');
  a.exploring=0;a.physicalAction.mainEffectUsed=true;finishPhysicalEffects(s);return;
 }
 a.exploring=0;
 if(activate){assert(!a.roomEffectUsed,'Room effect already used for this Explore');activateRoom(s,p,targetRoomId);a.roomEffectUsed=true;}
 afterAction(s);
}

function requireNoPendingPhysical(a:Activation) {
 assert(!a.physicalAction,'Finish the pending physical action first');
}

function requirePendingPhysical(s:GameState,p:Player) {
 const a=requireActivation(s,p.id);
 assert(a.physicalAction,'Begin a physical action first');
 return {a,physical:a.physicalAction!};
}

function finishPhysicalEffects(s:GameState) {
 const a=s.activation!;
 if(a.physicalAction?.mainEffectUsed && a.roomEffectUsed)a.physicalAction=null;
 afterAction(s);
}

function requirePhysicalAction(s:GameState,p:Player) {
 const a=requireActivation(s,p.id);assert(a.exploring===0,'Finish exploring first');
 requireNoPendingPhysical(a);
 requireTurnAction(a);return a;
}

function requireTurnAction(a:Activation) {
 assert(a.actionsUsed<ACTIONS_PER_TURN,'Already used both turn actions');
}

function validateExitDestination(s:GameState,p:Player,destination:Hex) {
 assert(areAdjacent(p.wizard.position,destination),'Move one adjacent space at a time');
 assert(s.board.tiles.some(h=>hexKey(h)===hexKey(destination)),'Destination outside board');
 assert(!s.board.rooms.some(r=>r.startingFor && r.tiles.some(h=>hexKey(h)===hexKey(destination))),'Mages cannot enter or reenter starting rooms');
}

export function canPlayerAct(s: GameState, p: Player): boolean {
 const a=s.activation?.playerId===p.id?s.activation:null;
 if(a?.physicalAction || a?.exploring)return true;
 if(p.passed)return false;
 if((a?.actionsUsed??0)>=ACTIONS_PER_TURN)return false;
 if(p.actionTokens>0)return true;
 if(isInStartingRoom(s,p))return !a?.discardedExit && (p.hand.some(c=>!c.powerful) || Object.values(p.prepared).some(c=>c&&!c.used&&!c.card.powerful));
 const next=slots.find(slot=>p.prepared[slot] && !p.prepared[slot]!.used);
 const spells=[p.prepared.rapid,next&&!a?.sequencedSpellUsed?p.prepared[next]:null];
 return spells.some(prepared=>{
  if(!prepared || prepared.used)return false;
  const card=prepared.card;
  // Every spell may target a room; model spells can use a harmless dummy there.
  return s.board.rooms.some(r=>!r.startingFor && r.tiles.some(h=>isWithinSpellRange(p.wizard.position,h,card.range)));
 });
}

export function canPassActionPhase(s:GameState,p:Player):boolean {
 const a=s.activation?.playerId===p.id?s.activation:null;
 if(a?.physicalAction || a?.exploring || s.evocationActivation?.playerId===p.id)return false;
 return p.actionTokens===0 && !Object.values(p.prepared).some(c=>c&&!c.used);
}

function startActivation(s: GameState, p: Player) {
 s.currentPlayerId=p.id; s.activation={playerId:p.id,actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false,physicalAction:null};
 s.log.push(`${p.name} takes a turn: 2 actions total across physical actions, spell casts, and discard-to-move.`);
}

function cleanup(s: GameState) {
 s.phase='CLEANUP'; s.activation=null; s.currentPlayerId=null;s.evocationActivation=null;
 s.log.push('CLEANUP — rebuild completed rooms, score contributions and return physical cubes.');
 for(const room of s.board.rooms) {
  room.specialUsed=false;
  // Legacy reconstructed-but-unscored fixtures also settle here.
  if(room.startingFor || room.scored || (!room.reconstructed && room.instability<room.instabilityLimit)) continue;
  room.reconstructed=true;
  s.log.push(`${room.name} is rebuilt; its upgraded room action is now unlocked.`);
  for(const {playerId,rank,tied,points} of getContributionAwards(room.cubesByPlayer,room.rewards)) {
  const name=awardVictoryPoints(s,playerId,points);
  s.log.push(`${name}: +${points} VP for ${room.name} (rank ${rank}${tied&&points>0?', tied −1 VP':''}).`);
  }
  // Return physical cubes, but retain contributions and the locked rebuilt room.
  for(const p of s.players) { const n=room.cubesByPlayer[p.id]??0; p.cubes.available+=n; p.cubes.onBoard-=n; }
  room.scored=true;
 }
 if(s.round>=3 || s.blackRose.victoryPoints>=30 || s.players.some(p=>p.victoryPoints>=30)) {
  s.log.push(`Endgame triggered after Cleanup: ${s.round>=3?'round limit reached':'a competitor reached 30 VP'}.`);
  scoreEndgame(s);
  // Stable player seating order wins equal final scores; Black Rose follows mages.
  const leaders=[...s.players,{id:BLACK_ROSE_ID,name:'Black Rose',victoryPoints:s.blackRose.victoryPoints}].sort((a,b)=>b.victoryPoints-a.victoryPoints);
  s.phase='GAME_OVER';s.winner=leaders[0].id;
  s.log.push(`${leaders[0].name} wins with ${leaders[0].victoryPoints} VP!`);
 }
}

function scoreEndgame(s:GameState) {
 if(s.endgameScored)return;
 s.endgameScored=true;
 const categories=[
  {label:'kills majority',counts:{...Object.fromEntries(s.players.map(p=>[p.id,p.kills])),[BLACK_ROSE_ID]:s.blackRose.kills}},
  {label:'completed quests majority',counts:Object.fromEntries(s.players.map(p=>[p.id,p.questsCompleted]))},
 ];
 for(const {label,counts} of categories) {
  for(const {playerId,cubes:count,rank,tied,points} of getContributionAwards(counts,ENDGAME_REWARDS)) {
   if(points===0)continue;
   const name=awardVictoryPoints(s,playerId,points);
   s.log.push(`${name}: +${points} VP for endgame ${label} (${count}, rank ${rank}${tied?', tied −1 VP':''}).`);
  }
 }
 if(s.firstPlayerId!==null) {
  const name=awardVictoryPoints(s,s.firstPlayerId,1);
  s.log.push(`${name}: +1 VP for holding the first-player token at endgame.`);
 }
}

function finishActivation(s: GameState) {
 const id=s.currentPlayerId!;
 s.activation=null;
 const start=s.players.findIndex(p=>p.id===id);
 for(let offset=1;offset<=s.players.length;offset++) {
  const next=s.players[(start+offset)%s.players.length];
    if(canPlayerAct(s,next)) { startActivation(s,next); return; }
 }
 startEvocationPhase(s);
}

function startEvocationPhase(s:GameState) {
 s.phase='EVOCATION';s.activation=null;s.evocationActivation=null;
 for(const e of s.evocations)e.activated=false;
 s.log.push('EVOCATION — alternate models; every surviving evocation activates once.');
 const first=s.players.find(p=>s.evocations.some(e=>e.playerId===p.id&&!e.activated));
 if(first)s.currentPlayerId=first.id;else cleanup(s);
}

function finishEvocation(s:GameState) {
 const active=s.evocationActivation!;s.evocationActivation=null;
 if(active.returnToAction){afterAction(s);return;}
 const start=s.players.findIndex(p=>p.id===active.playerId);
 for(let offset=1;offset<=s.players.length;offset++) {
  const p=s.players[(start+offset)%s.players.length];
  if(s.evocations.some(e=>e.playerId===p.id&&!e.activated)){s.currentPlayerId=p.id;return;}
 }
 cleanup(s);
}

function requireEvocation(s:GameState,id:string) {
 assert(s.phase==='ACTION'||s.phase==='EVOCATION','Evocation activation unavailable in this phase');
 const active=s.evocationActivation;assert(active&&active.playerId===id&&s.currentPlayerId===id,'No active evocation for this player');
 const e=s.evocations.find(e=>e.id===active!.evocationId);assert(e&&e.playerId===id,'Evocation unavailable');
 return {active:active!,e:e!};
}

function afterAction(s: GameState) {
 const a=s.activation!;
 if(a.physicalAction || a.exploring>0) return;
 if(!canPlayerAct(s,getPlayer(s,a.playerId))) finishActivation(s);
}

function castSpell(s: GameState, p: Player, action: Extract<GameAction,{type:'CAST_SPELL'|'CAST_POWERFUL_SPELL'}>) {
 const a=requireActivation(s,p.id);
 assert(a.exploring===0,'Finish exploring first');
 requireNoPendingPhysical(a);
 requireTurnAction(a);
 assert(!isInStartingRoom(s,p),'Leave the starting room before casting spells');
 if(action.type==='CAST_POWERFUL_SPELL')throw new GameRuleError('Powerful spells cannot be cast from hand; prepare them in a later Preparation phase and use CAST_SPELL');
 const prepared=p.prepared[action.slot];
 const card=prepared&&!prepared.used?prepared.card:undefined;
 assert(card,'Spell unavailable');
 if(action.slot!=='rapid') {
  assert(!a.sequencedSpellUsed,'Only one sequenced spell per turn');
  assert(slots.find(slot=>p.prepared[slot] && !p.prepared[slot]!.used)===action.slot,'Cast numbered spells in order 1 → 2 → 3');
 }
 const spell=card!;
 let targets: string[]=[]; let room: Room | undefined;
 if(spell.target==='ROOM' || action.dummy) {
  assert(!action.dummy || spell.target==='MODEL','Dummy targeting is for single-model spells');
  assert(!action.dummy || (!action.targetPlayerId&&!action.targetEvocationId),'Choose either a model or a dummy');
  assert(action.roomId,'Select a room'); room=getRoom(s,action.roomId!);
  assert(!room.startingFor,'Starting rooms cannot be targeted');
  assert(room.tiles.some(h=>isWithinSpellRange(p.wizard.position,h,spell.range)),'Room out of range');
  if(!action.dummy)targets=[...s.players.filter(t=>t.id!==p.id && inRoom(t,room!)).map(t=>t.id),...s.evocations.filter(e=>e.playerId!==p.id && room!.tiles.some(h=>hexKey(h)===hexKey(e.position))).map(e=>e.id)];
 } else {
  assert(!!action.targetPlayerId!==!!action.targetEvocationId,'Select another mage or evocation');
  const id=action.targetEvocationId??action.targetPlayerId!;
  const target=modelTarget(s,id);assert(target.playerId!==p.id,'Cannot damage your own models; select another mage or evocation');
  room=s.board.rooms.find(r=>r.tiles.some(h=>hexKey(h)===hexKey(target.position)));
  assert(!room?.startingFor,'Cannot target a model in its starting room');
  assert(isWithinSpellRange(p.wizard.position,target.position,spell.range),'Model out of range');targets=[id];
 }
 // Resolve instability before damage so a defeated target's respawn never moves the room effect.
 if(room && spell.instability>0) placeInstability(s,room,spell.instability,p);
 for(const id of targets)damageModel(s,id,spell.damage,p);
 prepared!.used=true;
 if(spell.powerful){s.removedCards.push(spell);s.log.push(`${spell.name} is removed from the game after use.`);}
 else discardCard(s,p,spell);
 a.spellsCast++;a.actionsUsed++;
 if(action.slot!=='rapid')a.sequencedSpellUsed=true;
 s.log.push(`${p.name} casts ${spell.name}${action.dummy?' on a dummy (no damage)':''} for 1 action (no physical token).`); afterAction(s);
}

export function applyAction(state: GameState, action: GameAction): GameState {
 const s=structuredClone(state);
 assert(s.phase!=='GAME_OVER','The game is over');
 const p=getPlayer(s,action.playerId);
 switch(action.type) {
  case 'UNDO_ACTION': case 'REDO_ACTION': throw new GameRuleError('History commands must be intercepted by the server; the engine does not process undo/redo');
  case 'SET_READY': requirePhase(s,'LOBBY'); assert(p.connected,'Join the room first'); p.ready=action.ready; break;
  case 'START_GAME':
   requirePhase(s,'LOBBY'); assert(p.id===s.hostId,'Only the creator can start');
    assert(canStartGame(s),'At least 2 mages must join and everyone must be ready');s.firstPlayerId=s.players[0].id;startBlackRose(s);break;
  case 'ADVANCE_PHASE':
   assert(p.id===s.hostId,'Only the creator can continue the phase');
    assert(action.expectedPhase===s.phase && action.expectedRound===s.round,'Stale phase command; wait for the current phase');
   if(s.phase==='BLACK_ROSE') finishBlackRose(s);
   else if(s.phase==='CLEANUP') startBlackRose(s);
   else throw new GameRuleError('This phase finishes when all players complete it');
   break;
  case 'DRAW_STUDY': {
   requirePhase(s,'STUDY'); assert(!p.studyDrawn,'Already drew library spells');
   const deck=s.library.find(d=>d.id===action.deckId); assert(deck,'School not found');
  assert(deck!.cards.length+deck!.discard.length>=4,`${deck!.name} has fewer than 4 available spells`);
   for(let i=0;i<4;i++) p.hand.push(drawOne(deck!.cards,deck!.discard));
   p.studyDrawn=true; s.log.push(`${p.name} draws 4 spells from ${deck!.name}.`); break;
  }
  case 'DISCARD_STUDY': {
   requirePhase(s,'STUDY'); assert(p.studyDrawn && !p.studyDone,'Draw library spells before discarding');
   assert(action.cardIds.length===2 && new Set(action.cardIds).size===2,'Discard exactly 2 different spells');
   assert(action.cardIds.every(id=>p.hand.some(c=>c.id===id)),'Spell not in hand');
  for(const id of action.cardIds) discardCard(s,p,p.hand.splice(p.hand.findIndex(c=>c.id===id),1)[0]);
   p.studyDone=true;
   if(s.players.every(p=>p.studyDone)) { s.phase='PREPARATION'; s.log.push('PREPARATION — choose spells 1 → 2 → 3 and one flexible spell.'); }
   break;
  }
  case 'DISCARD_QUESTS': {
   requirePhase(s,'BLACK_ROSE');assert(s.blackRoseResolved,'Resolve Black Rose before discarding quests');
   const quests=heldQuests(p),overflow=quests.length-p.questLimit;
   assert(overflow>0,'No quests over the quest limit');
   assert(Array.isArray(action.questIds) && action.questIds.length===overflow && new Set(action.questIds).size===overflow,`Discard exactly ${overflow} different quests`);
   assert(action.questIds.every(id=>quests.some(q=>q.id===id)),'Quest not owned by this player');
   const selected=new Set(action.questIds),remaining=quests.filter(q=>!selected.has(q.id));
   s.questDiscard.push(...quests.filter(q=>selected.has(q.id)));
   p.quest=remaining.shift()??null;p.additionalQuests=remaining;
   s.log.push(`${p.name} discards ${overflow} quests to meet the quest limit.`);
   beginStudyIfQuestsFit(s);break;
  }
  case 'DISCARD_HAND_LIMIT': {
   requirePhase(s,'PREPARATION');assert(!p.preparationDone,'Already prepared');
   const overflow=p.hand.length-p.cardLimit;
   assert(overflow>0,'No cards over the hand limit');
   assert(Array.isArray(action.cardIds) && action.cardIds.length===overflow && new Set(action.cardIds).size===overflow,`Discard exactly ${overflow} different spells`);
   assert(action.cardIds.every(id=>p.hand.some(c=>c.id===id)),'Spell not in hand');
   const selected=new Set(action.cardIds);
   // Explicit hand-limit exception: ALL origins (including powerful spells) go to
   // personal discard, preserving schoolId/powerful for later draws and casts.
   // Ordinary Study/cast/discard-exit routing still uses discardCard unchanged.
   p.discard.push(...p.hand.filter(c=>selected.has(c.id)));p.hand=p.hand.filter(c=>!selected.has(c.id));
   s.log.push(`${p.name} discards ${overflow} spells to meet the hand limit.`);break;
  }
  case 'PREPARE_CARDS': {
   requirePhase(s,'PREPARATION'); assert(!p.preparationDone,'Already prepared');
   assert(p.hand.length<=p.cardLimit,'Discard down to the hand limit before preparing cards');
   const ids=[...action.preparedCardIds,action.rapidCardId];
   assert(action.preparedCardIds.length===3 && new Set(ids).size===4,'Choose 3 ordered spells and 1 flexible spell');
   assert(ids.every(id=>p.hand.some(c=>c.id===id)),'Spell not in hand');
   for(const [i,id] of ids.entries()) {
    const card=p.hand.splice(p.hand.findIndex(c=>c.id===id),1)[0];
    p.prepared[i===3 ? 'rapid' : slots[i]]={card,used:false};
   }
   p.preparationDone=true;
  if(s.players.every(p=>p.preparationDone)) { s.phase='ACTION'; s.log.push('ACTION — up to 2 total actions per turn, including spell casts and discard-to-move; at most one numbered spell per turn.'); startActivation(s,s.players[0]); }
   break;
  }
  case 'END_ACTIVATION': {
   const a=requireActivation(s,p.id); assert(a.exploring===0,'Finish exploring first');
    requireNoPendingPhysical(a);
    assert(a.actionsUsed>=1 || a.spellsCast>0 || a.discardedExit,'Take an action, cast a spell, or pass for the round'); finishActivation(s); break;
  }
  case 'PASS_ROUND': {
   const a=requireActivation(s,p.id);assert(a.exploring===0,'Finish exploring first');
    requireNoPendingPhysical(a);
   assert(canPassActionPhase(s,p),'You may pass permanently only with no physical tokens and no unused spells');
   p.passed=true;s.log.push(`${p.name} passes for the rest of the Action phase.`);finishActivation(s);break;
  }
  case 'ACTIVATE_EVOCATION': {
   assert(!s.evocationActivation,'Finish the active evocation first');
   const e=s.evocations.find(e=>e.id===action.evocationId);assert(e&&e.playerId===p.id,'You may activate only your own evocations');
   if(s.phase==='ACTION') {
    const a=requirePhysicalAction(s,p);assert(p.actionTokens>0,'No action tokens');
    assert(!isInStartingRoom(s,p),'Leave the starting room before activating evocations');p.actionTokens--;a.actionsUsed++;
   } else {
    requirePhase(s,'EVOCATION');assert(s.currentPlayerId===p.id,'Not your turn');assert(!e!.activated,'This evocation already activated this phase');e!.activated=true;
   }
   s.evocationActivation={evocationId:e!.id,playerId:p.id,movesRemaining:e!.movement,returnToAction:s.phase==='ACTION'};
   s.log.push(`${p.name} activates ${e!.name}: move ${e!.movement}, attack ${evocationAttack(e!)}.`);break;
  }
  case 'EVOCATION_STEP': {
   const {active,e}=requireEvocation(s,p.id);assert(active.movesRemaining>0,'No evocation movement remaining');
   assert(areAdjacent(e.position,action.destination),'Move one adjacent space at a time');
   assert(s.board.tiles.some(h=>hexKey(h)===hexKey(action.destination)),'Destination outside board');
   assert(!s.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(action.destination))),'Evocations cannot enter starting rooms');
   e.position={...action.destination};active.movesRemaining--;break;
  }
  case 'EVOCATION_ATTACK': {
   const {e}=requireEvocation(s,p.id);const target=modelTarget(s,action.targetId);
   assert(target.playerId!==p.id,'Evocations cannot damage their mage or friendly evocations');
   assert(!s.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(target.position))),'Cannot target a model in its starting room');
  assert(areInSameRoom(s,e.position,target.position),'Target must be in the same room');
   damageModel(s,action.targetId,evocationAttack(e),p);finishEvocation(s);break;
  }
  case 'END_EVOCATION':requireEvocation(s,p.id);finishEvocation(s);break;
  case 'BEGIN_PHYSICAL_ACTION': {
   const a=requirePhysicalAction(s,p);assert(p.actionTokens>0,'No action tokens');
   assert(action.kind==='EXPLORE'||action.kind==='ATTACK','Unknown physical action kind');
   if(action.kind==='ATTACK')assert(!isInStartingRoom(s,p),'Leave the starting room before attacking');
   p.actionTokens--;a.actionsUsed++;a.roomEffectUsed=false;
   a.physicalAction={kind:action.kind,mainEffectUsed:false,movementStarted:false};
   s.log.push(`${p.name} begins ${action.kind}: resolve the primary and room effects in either order, or skip remaining effects.`);break;
  }
  case 'PERFORM_MOVEMENT': {
   const {a,physical}=requirePendingPhysical(s,p);
   assert(physical.kind==='EXPLORE','Movement requires a pending Explore');
   assert(!physical.mainEffectUsed && !physical.movementStarted,'Movement already started or resolved');
   physical.movementStarted=true;a.exploring=p.wizard.movement;
   if(a.exploring===0){physical.mainEffectUsed=true;finishPhysicalEffects(s);}
   break;
  }
  case 'ACTIVATE_ROOM': {
   const {a}=requirePendingPhysical(s,p);assert(a.exploring===0,'Finish exploring first');
   assert(!a.roomEffectUsed,'Room effect already used for this physical action');
   activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;finishPhysicalEffects(s);break;
  }
  case 'SKIP_PHYSICAL_EFFECTS': {
   const {a}=requirePendingPhysical(s,p);a.physicalAction=null;a.exploring=0;afterAction(s);break;
  }
  case 'INFLICT_ATTACK': {
   const {physical}=requirePendingPhysical(s,p);
   assert(physical.kind==='ATTACK','Attack requires a pending Attack');
   assert(!physical.mainEffectUsed,'Attack primary effect already used');
   mageAttackTarget(s,p,action.targetId);damageModel(s,action.targetId,p.wizard.attack,p);
   physical.mainEffectUsed=true;finishPhysicalEffects(s);break;
  }
  case 'EXPLORE': {
    const a=requirePhysicalAction(s,p);assert(p.actionTokens>0,'No action tokens');
    p.actionTokens--; a.actionsUsed++; a.exploring=p.wizard.movement;a.roomEffectUsed=false;
    if(action.activateRoomAtStart){activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;}
    s.log.push(`${p.name} explores: up to ${p.wizard.movement} one-step moves.`);
    if(a.exploring===0)afterAction(s);break;
  }
  case 'EXPLORE_STEP': {
   const a=requireActivation(s,p.id); assert(a.exploring>0,'Choose Explore first');
  validateExitDestination(s,p,action.destination);
  p.wizard.position={...action.destination}; a.exploring--;
  if(a.exploring===0)endExplore(s,p,!!action.activateRoomAtEnd,action.roomTargetId);break;
  }
  case 'END_EXPLORE': { const a=requireActivation(s,p.id); assert(a.exploring>0,'Not exploring');endExplore(s,p,!!action.activateRoomAtEnd,action.roomTargetId);break; }
  case 'DISCARD_EXIT': {
  const a=requireActivation(s,p.id);assert(a.exploring===0,'Finish exploring first');
  requireNoPendingPhysical(a);
  requireTurnAction(a);
  assert(isInStartingRoom(s,p),'Discard exit is only available in a starting room');
  assert(!a.discardedExit,'Already used a discard exit this turn');
  validateExitDestination(s,p,action.destination);
  const handIndex=p.hand.findIndex(c=>c.id===action.cardId);
  let card:Card;
  if(handIndex>=0)card=p.hand.splice(handIndex,1)[0];
  else {
   const key=(['rapid',...slots] as const).find(key=>p.prepared[key] && !p.prepared[key]!.used && p.prepared[key]!.card.id===action.cardId);
   assert(key,'Choose a held or unused prepared card');
   const prepared=p.prepared[key!]!;card=prepared.card;prepared.used=true;
  }
  discardCard(s,p,card);p.wizard.position={...action.destination};a.discardedExit=true;a.actionsUsed++;
  s.log.push(`${p.name} discards ${card.name} to leave the starting room by 1 space (1 action, no physical token).`);
  afterAction(s);break;
  }
  case 'PUNCH': {
  const a=requirePhysicalAction(s,p);assert(p.actionTokens>0,'No action tokens');
  const target=mageAttackTarget(s,p,action.targetId);
  p.actionTokens--; a.actionsUsed++;a.roomEffectUsed=false;
  const originalPosition=hexKey(target.position);
  if(action.roomEffect==='START'){activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;}
  // A room effect may defeat the intended victim; never punch their respawn.
  if(target.mage?hexKey(target.mage.wizard.position)===originalPosition:s.evocations.some(e=>e.id===target.evocation!.id))damageModel(s,action.targetId,p.wizard.attack,p);
  if(action.roomEffect==='END'){activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;}
  afterAction(s); break;
  }
  case 'CAST_SPELL': case 'CAST_POWERFUL_SPELL': castSpell(s,p,action); break;
  default: throw new GameRuleError('Unknown game action');
 }
 return s;
}