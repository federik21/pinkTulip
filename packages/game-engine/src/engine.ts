import { Activation, Board, Card, Evocation, GameAction, GameState, Hex, Player, PlayerId, Room, RoomColor, RoomEffect } from './types';
import { createEvents, createLibrary, createPowerfulDeck, createQuests, createSpellDeck, shuffle } from './cards';

export class GameRuleError extends Error {}
export const PHYSICAL_TOKENS_PER_ROUND = 2;
export const evocationAttack = (e:Evocation) => e.attack+(e.passive==='WOUNDED_FURY'?e.damageCubes:0);
export const hexKey = (h: Hex) => `${h.q},${h.r}`;
export const hexDistance = (a: Hex, b: Hex) => Math.max(Math.abs(a.q-b.q), Math.abs(a.r-b.r), Math.abs(a.q+a.r-b.q-b.r));
export const areAdjacent = (a: Hex, b: Hex) => hexDistance(a,b) === 1;
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
 DRAW_POWERFUL:'Gain 1 powerful spell; keep until used, then remove from the game',
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
  return {
  id: `room-${h.q},${h.r}`, name: h.q===0 && h.r===0 ? 'Black Rose Chamber' : `Room ${h.q},${h.r}`,
  tiles: [h], instability: 0, instabilityLimit: h.q===0 && h.r===0 ? 10 : 5,
  rewards: h.q===0 && h.r===0 ? [6,3] : [3,1], cubesByPlayer: {}, reconstructed: false, scored: false,
  color:index<0?null:ROOM_COLORS[index], effect:index<0?(h.q===0&&h.r===0?'DRAW_POWERFUL':null):effects[index], specialUsed:false,
 }; });
 for(const start of startingRooms)rooms.find(r=>r.id===`room-${hexKey(start.position)}`)!.startingFor=start.playerId;
 return { tiles, rooms };
}

export function createGame(): GameState {
 const board = createDemoBoard();
 const players: Player[] = ['p1','p2'].map((id, i) => {
  const start = board.rooms.find(r=>r.startingFor===id)!;
  return {
   id, name: i===0 ? 'Crimson Mage' : 'Azure Mage', connected: false, ready: false,
  wizard: { id: `${id}-wizard`, playerId: id, health: 10, damageCubes: 0, blackDamage: 0, damageByPlayer: {}, position: {...start.tiles[0]}, startingRoomId: start.id, alive: true },
   personalDeck: shuffle(createSpellDeck(id).slice(0,12)), hand: [], discard: [], prepared: emptyPrepared(),
  cubes: { available:25, onWizard:0, onBoard:0, onEvocations:0 }, actionTokens:PHYSICAL_TOKENS_PER_ROUND, victoryPoints:0,
  questsCompleted:0, kills:0, quest:null, additionalQuests:[], studyDrawn:false, studyDone:false, preparationDone:false, passed:false,
  };
 });
 return {
  gameId:crypto.randomUUID(), hostId:'p1', round:0, phase:'LOBBY', players, board, library:createLibrary(),
  eventDeck:createEvents(), eventDiscard:[], questDeck:createQuests(), questDiscard:[],
  powerfulDeck:createPowerfulDeck(), removedCards:[],
  evocations:[], evocationActivation:null,
  currentPlayerId:null, activation:null, winner:null, log:['Room created. Join and mark yourself ready.'], usedEvent:null,
 };
}

export function getRoomMajorityWinners(room: Pick<Room,'cubesByPlayer'>): PlayerId[] {
 const entries=Object.entries(room.cubesByPlayer).filter(([id,n])=>id!=='black-rose' && n>0);
 const max=Math.max(0,...entries.map(([,n])=>n));
 return entries.filter(([,n])=>n===max).map(([id])=>id);
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
 const contributions=Object.entries(target.wizard.damageByPlayer).filter(([id,n])=>id!==target.id && n>0);
 for(const [id,cubes] of contributions) {
  const contributor=getPlayer(s,id);
  // Competition ranks, matching room scoring: ties share a rank and skip the next.
  const rank=contributions.filter(([,other])=>other>cubes).length;
  const points=rank===0?4:rank===1?2:1;
  contributor.victoryPoints+=points;
  contributor.cubes.available+=cubes;
  contributor.cubes.onWizard-=cubes;
  s.log.push(`${contributor.name}: +${points} VP for ${cubes} damage cubes on ${target.name}; ${cubes} cubes returned.`);
 }
 // The final hitter still receives quest/kill credit, but no separate flat VP bonus.
 if(source) { source.kills++; completeQuest(s,source,'KILL'); }
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

function placeInstability(s: GameState, room: Room, amount: number, source?: Player) {
 if(room.reconstructed || room.startingFor) return 0;
 const actual=Math.min(amount,room.instabilityLimit-room.instability,source?.cubes.available ?? amount);
 if(actual<=0) return 0;
 const owner=source?.id ?? 'black-rose';
 room.instability+=actual;
 room.cubesByPlayer[owner]=(room.cubesByPlayer[owner]??0)+actual;
 if(source) { source.cubes.available-=actual; source.cubes.onBoard+=actual; completeQuest(s,source,'INSTABILITY',actual); }
 s.log.push(`${source?.name ?? 'Black Rose'} places ${actual} instability in ${room.name} (${room.instability}/${room.instabilityLimit}).`);
 if(room.instability===room.instabilityLimit) {
  room.reconstructed=true;
  s.log.push(`${room.name} is rebuilt and cannot accept more instability.`);
  if(source) completeQuest(s,source,'REBUILD');
 }
 return actual;
}

function startBlackRose(s: GameState) {
 s.round++; s.phase='BLACK_ROSE'; s.currentPlayerId=null; s.activation=null;s.evocationActivation=null;
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
  const candidates=shuffle(s.board.rooms.filter(r=>!r.startingFor && !r.reconstructed));
  for(const room of candidates.slice(0,event.rooms)) placeInstability(s,room,event.amount);
 }
}

function finishBlackRose(s: GameState) {
 for(const p of s.players) {
  if(!p.quest) {
    p.quest=drawQuest(s);
    if(p.quest)s.log.push(`${p.name} receives a personal quest.`);
  }
  let drawn=0;
  while(drawn<2 && p.personalDeck.length+p.discard.length>0) {p.hand.push(drawOne(p.personalDeck,p.discard));drawn++;}
  if(drawn<2)s.log.push(`${p.name} draws ${drawn} grimoire spells; the remaining personal spells are already held.`);
 }
 s.phase='STUDY'; s.log.push('STUDY — each mage draws 2 grimoire spells, chooses a library school, then discards 2.');
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
   assert(Math.min(...target.tiles.flatMap(h=>room!.tiles.map(origin=>hexDistance(origin,h))))<=1,'Room effect target out of range (maximum 1)');
  placeInstability(s,target,reward,p);break;
  }
  case 'DRAW_GRIMOIRE':for(let i=0;i<reward && p.personalDeck.length+p.discard.length;i++)p.hand.push(drawOne(p.personalDeck,p.discard));break;
  case 'SUMMON_CADAVER': {
   const count=Math.min(reward,3-s.evocations.filter(e=>e.playerId===p.id).length);
   for(let i=0;i<count;i++) {
    s.evocations.push({id:crypto.randomUUID(),playerId:p.id,name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:2,passive:'WOUNDED_FURY',position:{...p.wizard.position},damageCubes:0,damageByPlayer:{},activated:false});
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
 const a=s.activation!;a.exploring=0;
 if(activate){assert(!a.roomEffectUsed,'Room effect already used for this Explore');activateRoom(s,p,targetRoomId);a.roomEffectUsed=true;}
 afterAction(s);
}

function requirePhysicalAction(s:GameState,p:Player) {
 const a=requireActivation(s,p.id);assert(a.exploring===0,'Finish exploring first');
 assert(a.actionsUsed<2,'Already used both physical actions');return a;
}

function validateExitDestination(s:GameState,p:Player,destination:Hex) {
 assert(areAdjacent(p.wizard.position,destination),'Move one adjacent space at a time');
 assert(s.board.tiles.some(h=>hexKey(h)===hexKey(destination)),'Destination outside board');
 assert(!s.board.rooms.some(r=>r.startingFor && r.tiles.some(h=>hexKey(h)===hexKey(destination))),'Mages cannot enter or reenter starting rooms');
}

export function canPlayerAct(s: GameState, p: Player): boolean {
 if(p.passed)return false;
 const a=s.activation?.playerId===p.id?s.activation:null;
 if(a?.exploring)return true;
 if(p.actionTokens>0 && (a?.actionsUsed??0)<2)return true;
 if(isInStartingRoom(s,p))return !a?.discardedExit && (p.hand.some(c=>!c.powerful) || Object.values(p.prepared).some(c=>c&&!c.used&&!c.card.powerful));
 const next=slots.find(slot=>p.prepared[slot] && !p.prepared[slot]!.used);
 const spells=[p.prepared.rapid,next&&!a?.sequencedSpellUsed?p.prepared[next]:null,...p.hand.filter(c=>c.powerful).map(card=>({card,used:false}))];
 return spells.some(prepared=>{
  if(!prepared || prepared.used)return false;
  const card=prepared.card;
  // Every spell may target a room; model spells can use a harmless dummy there.
  return s.board.rooms.some(r=>!r.startingFor && r.tiles.some(h=>hexDistance(h,p.wizard.position)<=card.range));
 });
}

export function canPassActionPhase(s:GameState,p:Player):boolean {
 return p.actionTokens===0 && !Object.values(p.prepared).some(c=>c&&!c.used) && !p.hand.some(c=>c.powerful);
}

function startActivation(s: GameState, p: Player) {
 s.currentPlayerId=p.id; s.activation={playerId:p.id,actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 s.log.push(`${p.name} takes a turn: 2 physical actions, one numbered spell and the flexible spell (free).`);
}

function cleanup(s: GameState) {
 s.phase='CLEANUP'; s.activation=null; s.currentPlayerId=null;s.evocationActivation=null;
 s.log.push('CLEANUP — score rebuilt rooms.');
 for(const room of s.board.rooms) {
  room.specialUsed=false;
  if(!room.reconstructed || room.scored) continue;
  // Competition ranks: tied leaders share first prize; second prize needs rank 2.
  const entries=Object.entries(room.cubesByPlayer).filter(([id,n])=>id!=='black-rose' && n>0).sort((a,b)=>b[1]-a[1]);
  for(const [id,n] of entries) {
   const rank=entries.filter(([,other])=>other>n).length;
   const points=rank===0 ? room.rewards[0] : rank===1 ? room.rewards[1] : 0;
   getPlayer(s,id).victoryPoints+=points;
   s.log.push(`${getPlayer(s,id).name}: +${points} VP for ${room.name}.`);
  }
  // Return physical cubes, but retain contributions and the locked rebuilt room.
  for(const p of s.players) { const n=room.cubesByPlayer[p.id]??0; p.cubes.available+=n; p.cubes.onBoard-=n; }
  room.scored=true;
 }
 const leaders=[...s.players].sort((a,b)=>b.victoryPoints-a.victoryPoints);
 if(leaders[0].victoryPoints>=30) {
  s.phase='GAME_OVER'; s.winner=leaders[0].id;
  s.log.push(`${leaders[0].name} wins with ${leaders[0].victoryPoints} VP!`);
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
 if(a.exploring>0) return;
 if(!canPlayerAct(s,getPlayer(s,a.playerId))) finishActivation(s);
}

function castSpell(s: GameState, p: Player, action: Extract<GameAction,{type:'CAST_SPELL'|'CAST_POWERFUL_SPELL'}>) {
 const a=requireActivation(s,p.id);
 assert(a.exploring===0,'Finish exploring first');
 assert(!isInStartingRoom(s,p),'Leave the starting room before casting spells');
 const prepared=action.type==='CAST_SPELL'?p.prepared[action.slot]:null;
 const card=action.type==='CAST_SPELL'?(prepared&&!prepared.used?prepared.card:undefined):p.hand.find(c=>c.id===action.cardId && c.powerful);
 assert(card,'Spell unavailable');
 if(action.type==='CAST_SPELL' && action.slot!=='rapid') {
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
  assert(Math.min(...room.tiles.map(h=>hexDistance(h,p.wizard.position)))<=spell.range,'Room out of range');
  if(!action.dummy)targets=[...s.players.filter(t=>t.id!==p.id && inRoom(t,room!)).map(t=>t.id),...s.evocations.filter(e=>e.playerId!==p.id && room!.tiles.some(h=>hexKey(h)===hexKey(e.position))).map(e=>e.id)];
 } else {
  assert(!!action.targetPlayerId!==!!action.targetEvocationId,'Select another mage or evocation');
  const id=action.targetEvocationId??action.targetPlayerId!;
  const target=modelTarget(s,id);assert(target.playerId!==p.id,'Cannot damage your own models; select another mage or evocation');
  room=s.board.rooms.find(r=>r.tiles.some(h=>hexKey(h)===hexKey(target.position)));
  assert(!room?.startingFor,'Cannot target a model in its starting room');
  assert(hexDistance(p.wizard.position,target.position)<=spell.range,'Model out of range');targets=[id];
 }
 // Resolve instability before damage so a defeated target's respawn never moves the room effect.
 if(room && spell.instability>0) placeInstability(s,room,spell.instability,p);
 for(const id of targets)damageModel(s,id,spell.damage,p);
 if(prepared)prepared.used=true;
 else p.hand.splice(p.hand.findIndex(c=>c.id===spell.id),1);
 if(spell.powerful){s.removedCards.push(spell);s.log.push(`${spell.name} is removed from the game after use.`);}
 else discardCard(s,p,spell);
 a.spellsCast++;
 if(action.type==='CAST_SPELL' && action.slot!=='rapid')a.sequencedSpellUsed=true;
 s.log.push(`${p.name} casts ${spell.name}${action.dummy?' on a dummy (no damage)':''} for free.`); afterAction(s);
}

export function applyAction(state: GameState, action: GameAction): GameState {
 const s=structuredClone(state);
 assert(s.phase!=='GAME_OVER','The game is over');
 const p=getPlayer(s,action.playerId);
 switch(action.type) {
  case 'SET_READY': requirePhase(s,'LOBBY'); assert(p.connected,'Join the room first'); p.ready=action.ready; break;
  case 'START_GAME':
   requirePhase(s,'LOBBY'); assert(p.id===s.hostId,'Only the creator can start');
   assert(s.players.every(p=>p.connected && p.ready),'Both players must join and mark themselves ready'); startBlackRose(s); break;
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
   assert(deck!.cards.length+deck!.discard.length>=4,'School has fewer than 4 spells; choose another');
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
  case 'PREPARE_CARDS': {
   requirePhase(s,'PREPARATION'); assert(!p.preparationDone,'Already prepared');
   const ids=[...action.preparedCardIds,action.rapidCardId];
   assert(action.preparedCardIds.length===3 && new Set(ids).size===4,'Choose 3 ordered spells and 1 flexible spell');
   assert(ids.every(id=>p.hand.some(c=>c.id===id)),'Spell not in hand');
   for(const [i,id] of ids.entries()) {
    const card=p.hand.splice(p.hand.findIndex(c=>c.id===id),1)[0];
    p.prepared[i===3 ? 'rapid' : slots[i]]={card,used:false};
   }
   p.preparationDone=true;
  if(s.players.every(p=>p.preparationDone)) { s.phase='ACTION'; s.log.push('ACTION — up to 2 physical actions per turn; spells are free, at most one numbered spell per turn. End turn or pass when finished.'); startActivation(s,s.players[0]); }
   break;
  }
  case 'END_ACTIVATION': {
   const a=requireActivation(s,p.id); assert(a.exploring===0,'Finish exploring first');
    assert(a.actionsUsed>=1 || a.spellsCast>0 || a.discardedExit,'Take an action, cast a spell, or pass for the round'); finishActivation(s); break;
  }
  case 'PASS_ROUND': {
   const a=requireActivation(s,p.id);assert(a.exploring===0,'Finish exploring first');
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
   assert(hexDistance(e.position,target.position)<=1,'Target not adjacent');
   damageModel(s,action.targetId,evocationAttack(e),p);finishEvocation(s);break;
  }
  case 'END_EVOCATION':requireEvocation(s,p.id);finishEvocation(s);break;
  case 'EXPLORE': {
    const a=requirePhysicalAction(s,p);assert(p.actionTokens>0,'No action tokens');
    p.actionTokens--; a.actionsUsed++; a.exploring=2;a.roomEffectUsed=false;
    if(action.activateRoomAtStart){activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;}
    s.log.push(`${p.name} explores: up to 2 one-step moves.`); break;
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
  discardCard(s,p,card);p.wizard.position={...action.destination};a.discardedExit=true;
  s.log.push(`${p.name} discards ${card.name} to leave the starting room by 1 space (no token or action).`);
  afterAction(s);break;
  }
  case 'PUNCH': {
  const a=requirePhysicalAction(s,p);assert(p.actionTokens>0,'No action tokens');
  assert(!isInStartingRoom(s,p),'Leave the starting room before punching');
  const target=modelTarget(s,action.targetId);assert(target.playerId!==p.id,'Cannot punch yourself or your own evocations');
  assert(!s.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(target.position))),'Cannot target a model in its starting room');
  assert(hexDistance(p.wizard.position,target.position)<=1,'Model not adjacent');
  p.actionTokens--; a.actionsUsed++;a.roomEffectUsed=false;
  const originalPosition=hexKey(target.position);
  if(action.roomEffect==='START'){activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;}
  // A room effect may defeat the intended victim; never punch their respawn.
  if(target.mage?hexKey(target.mage.wizard.position)===originalPosition:s.evocations.some(e=>e.id===action.targetId))damageModel(s,action.targetId,1,p);
  if(action.roomEffect==='END'){activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;}
  afterAction(s); break;
  }
  case 'CAST_SPELL': case 'CAST_POWERFUL_SPELL': castSpell(s,p,action); break;
  default: throw new GameRuleError('Unknown game action');
 }
 return s;
}