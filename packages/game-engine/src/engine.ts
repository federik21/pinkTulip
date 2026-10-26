import { Activation, ActiveSpell, Board, Card, DecisionAnswer, DecisionDetails, Evocation, EvocationKind, FeedbackTarget, GameAction, GameFeedbackEvent, GameState, Hex, Moment, Player, PlayerId, Room, RoomId, RoomColor, RoomEffect, TriggerCondition, TriggerEvent, TriggeredInstruction } from './types';
import { createEvents, createLibrary, createPowerfulDeck, createQuests, getSpellType, hasMoment, shuffle } from './cards';

export class GameRuleError extends Error {}
export const PHYSICAL_TOKENS_PER_ROUND = 2;
export const ACTIONS_PER_TURN = 2;
export const MIN_MAGES = 2;
export const MAX_MAGES = 4;
export const STARTING_SCHOOL_CARDS = 7;
export const BLACK_ROSE_ID = 'black-rose';
export const FEEDBACK_EVENT_LIMIT = 512;
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
export const MAGE_COLOR_NAMES: Record<string,string> = {p1:'Rose',p2:'Blue',p3:'Amber',p4:'Green'};
export const EVOCATION_MODEL_LIMITS:Readonly<Record<EvocationKind,number>> = {SUCCUBUS:3,CADAVER:6};
export const getEvocationKind = (e:Evocation):EvocationKind => e.kind??(e.archetype==='DEMON'?'SUCCUBUS':'CADAVER');
// Derive the shared remaining counters from live models: destruction, replay and
// undo automatically return miniatures, without a second mutable inventory.
export function getEvocationSupply(s:Pick<GameState,'evocations'>):Record<EvocationKind,number> {
 const supply={...EVOCATION_MODEL_LIMITS};
 for(const e of s.evocations)supply[getEvocationKind(e)]--;
 return {SUCCUBUS:Math.max(0,supply.SUCCUBUS),CADAVER:Math.max(0,supply.CADAVER)};
}
export const evocationAttack = (e:Evocation) => e.attack+(getEvocationKind(e)==='SUCCUBUS'&&e.passive==='WOUNDED_FURY'?e.damageCubes:0);
// Cadaver's effect is blank for now; Succubus retains Wounded Fury and Soul Tithe.
type EvocationTemplate = Pick<Evocation,'name'|'archetype'|'movement'|'attack'|'health'|'ability'|'passive'>;
export const EVOCATION_TYPES = {
 CADAVER:{name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:2},
 SUCCUBUS:{name:'Succubus',archetype:'DEMON',movement:2,attack:1,health:3,ability:'SOUL_TITHE',passive:'WOUNDED_FURY'},
} as const satisfies Record<EvocationKind,EvocationTemplate>;
export type EvocationType = keyof typeof EVOCATION_TYPES;
// Both the owner's three-model cap and the shared miniature supply must allow it.
export function summonEvocation(s:GameState,p:Player,type:EvocationType,position:Hex):Evocation|undefined {
 const owned=s.evocations.filter(e=>e.playerId===p.id);
 if(owned.length>=3){s.log.push(`${p.name} already controls 3 evocations; no ${EVOCATION_TYPES[type].name} summoned.`);return;}
 if(getEvocationSupply(s)[type]===0){s.log.push(`No ${EVOCATION_TYPES[type].name} models remain in the shared supply; no model summoned.`);return;}
 const number=[1,2,3].find(n=>!owned.some(e=>e.number===n))!;
 const template:EvocationTemplate=EVOCATION_TYPES[type];
 const evocation:Evocation={id:resolutionId(s),playerId:p.id,number,kind:type,name:template.name,archetype:template.archetype,movement:template.movement,attack:template.attack,health:template.health,position:{...position},damageCubes:0,damageByPlayer:{},activated:false};
 if(template.passive)evocation.passive=template.passive;
 if(template.ability)evocation.ability=template.ability;
 s.evocations.push(evocation);
 return evocation;
}
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
 if (range === Number.POSITIVE_INFINITY) return true;
 const distance=hexLineDistance(a,b);
 return Number.isFinite(distance) && distance<=range;
};
export function spellCanTargetModel(card:Card,casterId:string,ownerId:string,kind:'MAGE'|'EVOCATION'):boolean {
 if(card.target==='SELF')return kind==='MAGE' && casterId===ownerId;
 // Support, Protection and ongoing cards do not bypass the printed Self target.
 if(kind==='MAGE' && casterId===ownerId)return false;
 if(card.target==='ROOM' || (card.target!=='MODEL' && card.target!==kind))return false;
 return casterId!==ownerId || hasMoment(card,'HEAL') || hasMoment(card,'CONVERT') || getSpellType(card)==='PROTECTION' || (card.ongoing && getSpellType(card)==='CONTINGENCY')===true;
}
export function canUseSpellDummy(card:Card):boolean {
 return card.target==='MODEL' || card.target==='MAGE' || card.target==='EVOCATION';
}
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
 DRAW_GRIMOIRE:'Draw 1 grimoire spell', SUMMON_CADAVER:'Summon 1 Cadaver from the shared supply in this room (6 models total; maximum 3 evocations per mage)',
 DRAW_POWERFUL:'Gain 1 forgotten spell; prepare in a later Preparation phase, then remove from the game when cast',
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

export function getDefaultRoomsPerColor(playerCount:number):1|2|3 {
 assert(Number.isInteger(playerCount)&&playerCount>=1&&playerCount<=MAX_MAGES,'Choose between 1 and 4 mages');
 // A host-only Lobby may preview the two-mage minimum before another seat joins.
 return Math.max(1,playerCount-1) as 1|2|3;
}

export function createDemoBoard(roomsPerColor:1|2|3=3,random:()=>number=Math.random): Board {
 assert([1,2,3].includes(roomsPerColor),'Choose 1, 2 or 3 rooms per color');
 const names=shuffle([
  'Ember Vault','Moonlit Gallery','Thorn Garden','Whispering Library','Ashen Forge','Silver Observatory',
  'Hollow Chapel','Crimson Atelier','Veiled Archive','Gilded Reliquary','Echoing Crypt','Starlit Hall',
  'Obsidian Study','Dreaming Atrium','Frost Conservatory','Sunken Treasury','Twilight Court','Waning Sanctum',
  'Raven Belfry','Glass Labyrinth','Ivied Vestibule','Candlelit Refuge',
 ],random);
 const startingRooms = [
  {playerId:'p1',position:roomsPerColor===1?{q:2,r:-1}:{q:3,r:-2}},
  {playerId:'p2',position:roomsPerColor===1?{q:-2,r:1}:{q:-3,r:2}},
  {playerId:'p3',position:roomsPerColor===1?{q:-1,r:-1}:{q:-1,r:-2}},
  {playerId:'p4',position:roomsPerColor===1?{q:1,r:1}:{q:1,r:2}},
 ];
 const tiles: Hex[] = [];
 for (let r=-2;r<=2;r++) for(let q=-2;q<=2;q++) {
  const distance=hexDistance({q,r},{q:0,r:0});
  // Ring 1 is connected on its own; six ring-2 corners add one of each color.
  if(distance<=1 || (distance===2 && (roomsPerColor===3 || (roomsPerColor===2 && (q===0 || r===0 || q+r===0)))))tiles.push({q,r});
 }
 tiles.push(...startingRooms.map(start=>start.position));
 let colorIndex=0;
 const rooms: Room[] = tiles.map(h => {
  const regular=hexDistance(h,{q:0,r:0})>0 && !startingRooms.some(start=>hexKey(start.position)===hexKey(h));
  const index=regular?colorIndex++%6:-1;
  // Each color retains its printed capacity/effect at every board size.
  const capacity=h.q===0 && h.r===0?10:index===4?4:index===5?6:5;
  return {
  id: `room-${h.q},${h.r}`, name: h.q===0 && h.r===0 ? 'Pink Tulip Chamber' : names.pop()!,
  tiles: [h], instability: 0, instabilityLimit: capacity,
  rewards: getRoomRewards(capacity), cubesByPlayer: {}, reconstructed: false, scored: false,
  color:index<0?null:ROOM_COLORS[index], effect:index<0?(h.q===0&&h.r===0?'DRAW_POWERFUL':null):effects[index], specialUsed:false,
 }; });
 for(const start of startingRooms) {
  const room=rooms.find(r=>r.id===`room-${hexKey(start.position)}`)!;
  room.startingFor=start.playerId;
  room.name=`${MAGE_COLOR_NAMES[start.playerId]} Mage cell`;
 }
 return { tiles, rooms };
}

function createMage(board:Board,id:PlayerId):Player {
 const start=board.rooms.find(r=>r.startingFor===id)!;
 const names:Record<string,string>={p1:'Crimson Mage',p2:'Azure Mage',p3:'Amber Mage',p4:'Emerald Mage'};
 return {
  id, name:names[id], connected: false, ready: false, startingSchoolId: null,
  wizard: { id: `${id}-wizard`, playerId: id, health: 10, attack: 2, movement: 2, damageCubes: 0, blackDamage: 0, damageByPlayer: {}, damageOrder: [], position: {...start.tiles[0]}, startingRoomId: start.id, alive: true },
  personalDeck: [], hand: [], discard: [], prepared: emptyPrepared(),
  cubes: { available:25, onWizard:0, onBoard:0, onEvocations:0 }, actionTokens:PHYSICAL_TOKENS_PER_ROUND, victoryPoints:0,
  questsCompleted:0, kills:0, trophies:[], quest:null, additionalQuests:[], studyDrawn:false, studyDone:false, studyCardIds:[], preparationDone:false, passed:false, cardLimit:7, questLimit:2,
 };
}

function hasStartingSchoolSupply(s:GameState):boolean {
 const required=new Map<string,number>();
 for(const p of s.players) {
  if(p.startingSchoolId==null)continue;
  if(!s.library.some(d=>d.id===p.startingSchoolId))return false;
  required.set(p.startingSchoolId,(required.get(p.startingSchoolId)??0)+STARTING_SCHOOL_CARDS);
 }
 return [...required].every(([id,count])=>{
  const deck=s.library.find(d=>d.id===id)!;
  return deck.cards.length+deck.discard.length>=count;
 });
}

export function canStartGame(s:GameState):boolean {
 return s.phase==='LOBBY' && s.players.length>=MIN_MAGES && s.players.length<=MAX_MAGES
  && s.players.every(p=>p.connected&&p.ready&&typeof p.startingSchoolId==='string'&&s.library.some(d=>d.id===p.startingSchoolId))
  && hasStartingSchoolSupply(s);
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
  powerfulDeck:createPowerfulDeck(), removedCards:[], readiedSpells:[], ongoingSpells:[], activeSpellOrder:[],
  evocations:[], evocationActivation:null, feedbackEvents:[],
  currentPlayerId:null, activation:null, winner:null, log:['Room created. Join, choose a starting school, and mark yourself ready.'], usedEvent:null, blackRoseResolved:false,
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
 if(id===BLACK_ROSE_ID){s.blackRose.victoryPoints+=points;return 'Pink Tulip';}
 const p=getPlayer(s,id);
 const before=p.victoryPoints; p.victoryPoints+=points;
 if(points!==0) {
  const ref=snapshot(s,p.id);
  if(ref) modelEvent(s,'VP_CHANGED',ref,ref,roomAt(s,p.wizard.position)?.id);
  s.log.push(`${p.name} ${points>=0?`gains`:`loses`} ${Math.abs(points)} VP (${before} → ${p.victoryPoints}).`);
 }
 return p.name;
}

function completeQuest(s: GameState, p: Player, kind: NonNullable<Player['quest']>['kind'], amount=1) {
 const remaining: NonNullable<Player['quest']>[]=[];
 for(const quest of [p.quest,...p.additionalQuests]) {
  if(!quest)continue;
  if(quest.kind!==kind || amount<quest.amount){remaining.push(quest);continue;}
  awardVictoryPoints(s,p.id,quest.reward);p.questsCompleted++;
  s.log.push(`${p.name} completes “${quest.name}”: +${quest.reward} VP.`);
  s.questDiscard.push(quest);
 }
 p.quest=remaining.shift()??null;p.additionalQuests=remaining;
}

function progressQuest(s: GameState, p: Player, kind: NonNullable<Player['quest']>['kind'], amount=1) {
 for(const quest of heldQuests(p)) {
  if(!quest || quest.kind!==kind || quest.completed || quest.claimed)continue;
  const before=quest.progress ?? 0;
  const progress=Math.min(quest.amount, before + amount);
  if(progress===before)continue;
  quest.progress=progress;
  s.log.push(`${p.name} advances “${quest.name}” (${progress}/${quest.amount}).`);
  if(progress>=quest.amount) {
   quest.completed=true;
   s.log.push(`${p.name} completes “${quest.name}” and may spend its reward action.`);
  }
 }
}

function resolveQuestRewardAction(s: GameState, p: Player, card: Card, action: { targetPlayerId?: PlayerId; targetEvocationId?: string; roomId?: RoomId; dummy?: boolean } = {}) {
 const targets: ReturnType<typeof modelTarget>[]=[]; let room: Room | undefined;
 if(card.target==='ROOM' || action.dummy) {
  assert(!action.dummy || canUseSpellDummy(card),'Dummy targeting requires a MAGE, EVOCATION or MODEL spell');
  assert(!action.targetPlayerId && !action.targetEvocationId,'Choose either a room or a model for a quest reward');
  assert(action.roomId,'Select a room for the quest reward');
  room=getRoom(s,action.roomId!);
  assert(!room.startingFor,'Starting rooms cannot be targeted by a quest reward');
  assert(room.tiles.some(h=>isWithinSpellRange(p.wizard.position,h,card.range)),'Quest reward room out of range');
  if(!action.dummy) {
   targets.push(...s.players.filter(t=>inRoom(t,room!)).map(t=>modelTarget(s,t.id)), ...s.evocations.filter(e=>room!.tiles.some(h=>hexKey(h)===hexKey(e.position))).map(e=>modelTarget(s,e.id)));
  }
 } else {
  assert(!action.roomId,'Room targets are not valid for this quest reward');
  const inferSelf=card.target==='SELF' && !action.targetPlayerId && !action.targetEvocationId;
  assert(inferSelf || !!action.targetPlayerId!==!!action.targetEvocationId,'Select one mage or evocation for the quest reward');
  const id=inferSelf?p.id:action.targetEvocationId ?? action.targetPlayerId!;
  const target=modelTarget(s,id);
  assert(inferSelf || (action.targetPlayerId?!!target.mage:!!target.evocation),'Target payload does not match the quest reward model kind');
  assert(spellCanTargetModel(card,p.id,target.playerId,target.mage?'MAGE':'EVOCATION'),'Quest reward cannot target this model category or ownership');
  room=s.board.rooms.find(r=>r.tiles.some(h=>hexKey(h)===hexKey(target.position)));
  if (!inferSelf && room?.startingFor) assert(false,'Cannot target a model in its starting room with a quest reward');
  assert(isWithinSpellRange(p.wizard.position,target.position,card.range),'Quest reward target out of range');
  targets.push(target);
 }
 const refs=targets.map(t=>snapshot(s,t.mage?.id ?? t.evocation!.id)!);
 const actor=snapshot(s,p.id)!;
 resolveEffectMoments(s,p,card,room,refs,actor);
}

function drawQuest(s:GameState) {
 if(!s.questDeck.length){s.questDeck=shuffle(s.questDiscard,()=>resolutionRandom(s));s.questDiscard=[];}
 return s.questDeck.shift()??null;
}

// Runtime-only instruction context. Nothing executable, cyclic or private is
// stored in GameState; a root action remains a single clone/commit boundary.
type ModelSnapshot = { id:string; playerId:string; kind:'MAGE'|'EVOCATION'; generation:number };
// Local to a single effect, so a nested spell cannot replace its summoned model.
type EffectResolution = { summoned?:ModelSnapshot; activationIsExplicit:boolean };
type SpellEvent = { event:TriggerEvent; model?:ModelSnapshot; actor?:ModelSnapshot; roomId?:string; target?:FeedbackTarget; afterResolution?:()=>void };
type PendingMageDefeat = { ref:ModelSnapshot; roomId?:string; target:FeedbackTarget; source?:Player; beforeDefeat?: (target:Player)=>void };
type ReplayEntropy={ids:string[];random:number[]};
type InstructionContext = { generations:Map<string,number>; bindings:Map<string,ModelSnapshot>; defeats:Map<string,PendingMageDefeat>; resolutions:number; interruptId?:string; answers:DecisionAnswer[]; cursor:number; momentDepth:number; events:SpellEvent[]; entropy:ReplayEntropy; idCursor:number; randomCursor:number };
const instructionContexts=new WeakMap<GameState,InstructionContext>();
const context=(s:GameState)=>instructionContexts.get(s)!;
// IDs and random outcomes encountered before a pause must be identical on
// replay, including a freshly summoned Succubus which then asks for a cube.
function resolutionId(s:GameState) {
 const ctx=instructionContexts.get(s);if(!ctx)return crypto.randomUUID();
 const i=ctx.idCursor++;return ctx.entropy.ids[i]??(ctx.entropy.ids[i]=crypto.randomUUID());
}
function resolutionRandom(s:GameState) {
 const ctx=instructionContexts.get(s);if(!ctx)return Math.random();
 const i=ctx.randomCursor++;return ctx.entropy.random[i]??(ctx.entropy.random[i]=Math.random());
}
const roomAt=(s:GameState,position:Hex)=>s.board.rooms.find(r=>r.tiles.some(h=>hexKey(h)===hexKey(position)));
type FeedbackPayload = { [K in GameFeedbackEvent['kind']]: Omit<Extract<GameFeedbackEvent,{kind:K}>,'id'|'round'> }[GameFeedbackEvent['kind']];
function appendFeedback(s:GameState,event:FeedbackPayload) {
 const events=s.feedbackEvents??=[];
 const interruptId=context(s).interruptId;
 const fact={...event,id:resolutionId(s),round:s.round,...(interruptId?{interruptId}:{})} as GameFeedbackEvent;
 events.push(fact);
 if(events.length>FEEDBACK_EVENT_LIMIT)events.splice(0,events.length-FEEDBACK_EVENT_LIMIT);
 return fact;
}
function roomFeedbackTarget(room:Room):FeedbackTarget {
 return {kind:'ROOM',id:room.id,name:room.name,roomId:room.id};
}
function modelFeedbackTarget(s:GameState,ref:ModelSnapshot|undefined):FeedbackTarget|undefined {
 const target=liveModel(s,ref);
 if(!target)return;
 const roomId=roomAt(s,target.model.position)?.id;
 return {kind:ref!.kind,id:target.mage?.id??target.evocation!.id,name:target.mage?.name??target.evocation!.name,...(roomId?{roomId}:{})};
}
function snapshot(s:GameState,id:string):ModelSnapshot | undefined {
 const mage=s.players.find(p=>p.id===id || p.wizard.id===id);
 const evocation=s.evocations.find(e=>e.id===id);
 if(!mage&&!evocation)return;
 const modelId=mage?.wizard.id??evocation!.id;
 return {id:modelId,playerId:mage?.id??evocation!.playerId,kind:mage?'MAGE':'EVOCATION',generation:context(s).generations.get(modelId)??0};
}
function liveModel(s:GameState,ref:ModelSnapshot | undefined) {
 if(!ref || (context(s).generations.get(ref.id)??0)!==ref.generation)return;
 if(ref.kind==='MAGE') {
  const mage=s.players.find(p=>p.wizard.id===ref.id && p.wizard.alive);
  if(mage)return {mage,evocation:undefined,model:mage.wizard,location:'onWizard' as const};
 } else {
  const evocation=s.evocations.find(e=>e.id===ref.id);
  if(evocation)return {mage:undefined,evocation,model:evocation,location:'onEvocations' as const};
 }
}
function bindActiveSpell(s:GameState,active:ActiveSpell) {
 const id=active.targetEvocationId??active.targetPlayerId;
 const ref=id?snapshot(s,id):undefined;
 if(ref)context(s).bindings.set(active.id,ref);
}
function removeActiveSpell(s:GameState,active:ActiveSpell) {
 s.readiedSpells=s.readiedSpells!.filter(a=>a.id!==active.id);
 s.ongoingSpells=s.ongoingSpells!.filter(a=>a.id!==active.id);
 s.activeSpellOrder=s.activeSpellOrder!.filter(id=>id!==active.id);
}
function retireActiveSpell(s:GameState,active:ActiveSpell) {
 const revealed=s.readiedSpells!.some(a=>a.id===active.id);
 removeActiveSpell(s,active);
 if(active.card.powerful)s.removedCards.push(active.card);
 else if(revealed)getPlayer(s,active.playerId).discard.push(active.card);
 else discardCard(s,getPlayer(s,active.playerId),active.card);
}
function invalidateModel(s:GameState,ref:ModelSnapshot) {
 context(s).generations.set(ref.id,ref.generation+1);
 // Defeat cancels remaining physical effects, never the remaining spell moments.
 if(ref.kind==='MAGE' && s.activation?.playerId===ref.playerId) {
  s.activation.exploring=0;
  s.activation.physicalAction=null;
  s.activation.roomEffectUsed=true;
 }
 // A model-bound readiness cannot silently rebind to a mage's respawn either.
 for(const active of [...s.readiedSpells!,...s.ongoingSpells!]) {
  if(context(s).bindings.get(active.id)?.id!==ref.id)continue;
  retireActiveSpell(s,active);
  s.log.push(`${active.card.name} expires with its bound model.`);
 }
}
function matchesTrigger(s:GameState,active:ActiveSpell,condition:TriggerCondition,event:SpellEvent) {
 if(condition.event!==event.event)return false;
 if(condition.relation!=='ANY' && (!event.actor || (condition.relation==='SELF')!==(event.actor.playerId===active.playerId)))return false;
 // Hidden spells have no board binding. Evaluate model/room conditions at the
 // event location instead; ongoing spells retain their explicit binding.
 if(s.readiedSpells!.some(a=>a.id===active.id)) {
  const owner=getPlayer(s,active.playerId);
  if(condition.scope==='BOUND_MODEL') {
   if(!event.model)return false;
   if(active.card.target==='SELF' && (event.model.kind!=='MAGE'||event.model.playerId!==owner.id))return false;
   if(active.card.target!=='SELF' && active.card.target!=='MODEL' && active.card.target!==event.model.kind)return false;
  }
  if(condition.scope!=='ANY') {
   const room=event.roomId?s.board.rooms.find(r=>r.id===event.roomId):undefined;
   if(!room || room.startingFor || !room.tiles.some(h=>isWithinSpellRange(owner.wizard.position,h,active.card.range)))return false;
  }
  return true;
 }
 if(condition.scope==='BOUND_ROOM')return !!active.roomId && active.roomId===event.roomId;
 if(condition.scope==='BOUND_COLOR') {
  if(!active.roomId || !event.roomId)return false;
  if(active.roomId===event.roomId)return true;
  const color=s.board.rooms.find(r=>r.id===active.roomId)?.color;
  return !!color && s.board.rooms.find(r=>r.id===event.roomId)?.color===color;
 }
 if(condition.scope==='BOUND_MODEL') {
  const bound=context(s).bindings.get(active.id);
  return !!bound && !!liveModel(s,bound) && bound.id===event.model?.id && bound.generation===event.model.generation;
 }
 return true;
}
function atMomentEnd(s:GameState,resolve:()=>void) {
 const ctx=context(s);ctx.momentDepth++;
 try {resolve();} finally {ctx.momentDepth--;}
 if(ctx.momentDepth===0) {
  const events=ctx.events.splice(0);
  for(const event of events)resolveQueuedEvent(s,event);
 }
}
function resolveInstruction(s:GameState,owner:Player,instruction:TriggeredInstruction,ref:ModelSnapshot|undefined,roomId:string|undefined,actor:ModelSnapshot|undefined,effect?:EffectResolution) {
 atMomentEnd(s,()=>resolveInstructionBody(s,owner,instruction,ref,roomId,actor,effect));
}
function resolveInstructionBody(s:GameState,owner:Player,instruction:TriggeredInstruction,ref:ModelSnapshot|undefined,roomId:string|undefined,actor:ModelSnapshot|undefined,effect?:EffectResolution) {
 const target=liveModel(s,ref),room=roomId?s.board.rooms.find(r=>r.id===roomId):undefined;
 if(instruction.effect==='INSTABILITY') {
  if(room)placeInstability(s,room,instruction.amount,owner);
 } else if(instruction.effect==='CONVERT' && room) {
  if(!room.scored&&!room.reconstructed)convertCubes(s,owner,room.cubesByPlayer,'onBoard',instruction.amount,room.instability,roomFeedbackTarget(room));
 } else if(instruction.effect==='BLACK_ROSE_CONVERT' && target && target.mage) {
  convertRecentDamageToBlackRose(s,target.mage,instruction.amount,modelFeedbackTarget(s,ref)!);
 } else if(instruction.effect==='PAIN') {
  damage(s,owner,instruction.amount);
 } else if(instruction.effect==='SUMMON') {
  const position = instruction.position === 'TARGET' ? target?.model.position??room?.tiles[0] : owner.wizard.position;
  if(!position)return;
  summonForEffect(s,owner,instruction.kind,position,effect);
 } else if(instruction.effect==='ACTIVATE_EVOCATION') {
  activateEffectSummon(s,owner,instruction.kind,effect);
 } else if(room && (instruction.effect==='DAMAGE' || instruction.effect==='HEAL')) {
  const refs=[...s.players.filter(p=>inRoom(p,room)).map(p=>snapshot(s,p.id)!),...s.evocations.filter(e=>room.tiles.some(h=>hexKey(h)===hexKey(e.position))).map(e=>snapshot(s,e.id)!)];
  for(const model of refs)resolveInstruction(s,owner,instruction,model,undefined,actor);
 } else if(target) {
  switch(instruction.effect) {
   case 'DAMAGE':
    if(ref!.playerId===owner.id && instruction.target !== 'EVENT_ACTOR')break;
    if(target.mage) {
      const splash = instruction.splash;
      const position = { ...target.mage.wizard.position };
      const dealActor = ref && actor && ref.id === actor.id && instruction.target === 'EVENT_ACTOR' ? null : actor;
      damage(s,target.mage,instruction.amount,owner,dealActor, splash && splash.when === 'AFTER_DEFEAT' ? (defeated) => {
        const splashAmount = splash.amount ?? instruction.amount;
        for(const other of s.players) {
          if(other.id===defeated.id || !other.wizard.alive)continue;
          if(hexDistance(position,other.wizard.position) <= splash.range) {
            damage(s,other,splashAmount,owner,dealActor);
          }
        }
      } : undefined);
    }
    else damageEvocation(s,target.evocation!,instruction.amount,owner,actor);
    break;
  case 'HEAL':healModel(s,target.model,target.location,instruction.amount,owner.id,modelFeedbackTarget(s,ref)!);break;
  case 'CONVERT':
    // Owned models ignore damage conversion, including triggered instructions.
    if(ref!.playerId===owner.id)break;
   convertCubes(s,owner,target.model.damageByPlayer,target.location,instruction.amount,target.model.damageCubes,modelFeedbackTarget(s,ref)!,target.model);
   break;
  }
 }
}
function emitEvent(s:GameState,event:SpellEvent) {
 const frozen={...event,target:event.target??modelFeedbackTarget(s,event.model)??modelFeedbackTarget(s,event.actor)};
 if(context(s).momentDepth>0)context(s).events.push(frozen);
 else resolveQueuedEvent(s,frozen);
}
function resolveQueuedEvent(s:GameState,event:SpellEvent) {
 // Earlier damage reactions may already have rescued this mage before its
 // defeat window opens. Do not offer defeat spells for a nonlethal model.
 if(event.event==='MAGE_DEFEATED'&&event.afterResolution) {
  const mage=liveModel(s,event.model)?.mage;
  if(!mage||mage.wizard.damageCubes<mage.wizard.health){event.afterResolution();return;}
 }
 resolveEvent(s,event);
 event.afterResolution?.();
}
function reactiveTargets(s:GameState,active:ActiveSpell):FeedbackTarget[] {
 const owner=getPlayer(s,active.playerId),card=active.card;
 if(card.target==='ROOM')return s.board.rooms.filter(r=>!r.startingFor && r.tiles.some(h=>isWithinSpellRange(owner.wizard.position,h,card.range))).map(roomFeedbackTarget);
 const refs=[...s.players.filter(p=>p.wizard.alive).map(p=>snapshot(s,p.id)!),...s.evocations.map(e=>snapshot(s,e.id)!)];
 return refs.filter(ref=>{
  const model=liveModel(s,ref)!,room=roomAt(s,model.model.position);
  return !room?.startingFor && spellCanTargetModel(card,owner.id,ref.playerId,ref.kind) && isWithinSpellRange(owner.wizard.position,model.model.position,card.range);
 }).map(ref=>modelFeedbackTarget(s,ref)!);
}
function chooseReactiveSpell(s:GameState,owner:Player,eligible:ActiveSpell[],event:SpellEvent) {
 const options=eligible.map(active=>({activeSpellId:active.id,card:active.card,targets:reactiveTargets(s,active)})).filter(option=>option.targets.length);
 if(!options.length)return;
 const ctx=context(s),key=`reactive|${event.event}|${owner.id}|${event.model?.id??event.roomId??''}|${ctx.cursor}`;
 const answer=ctx.answers[ctx.cursor];
 if(answer?.key===key){ctx.cursor++;return answer.accept?answer:undefined;}
 throw new DecisionNeeded({kind:'REACTIVE_SPELL',playerId:owner.id,key,event:event.event,options},ctx.answers.slice(0,ctx.cursor));
}
function resolveEvent(s:GameState,event:SpellEvent) {
 // Freeze the actual event model before nested effects can destroy or respawn it.
 const eventTarget=event.target??modelFeedbackTarget(s,event.model)??modelFeedbackTarget(s,event.actor);
 const first=Math.max(0,s.players.findIndex(p=>p.id===s.firstPlayerId));
 const owners=[...s.players.slice(first),...s.players.slice(0,first)];
 const active=[...s.readiedSpells!,...s.ongoingSpells!];
 const eligible=owners.flatMap(owner=>active.filter(a=>a.playerId===owner.id)
  .sort((a,b)=>s.activeSpellOrder!.indexOf(a.id)-s.activeSpellOrder!.indexOf(b.id))
  .filter(a=>{
   const trigger=a.card.ongoing?.trigger??a.card.trigger;
   return trigger && matchesTrigger(s,a,trigger,event);
  }));
 for(const owner of owners) {
 const remaining=eligible.filter(active=>active.playerId===owner.id);
 while(remaining.length) {
  let active=remaining[0],selection:DecisionAnswer|undefined;
  if(s.readiedSpells!.some(a=>a.id===active.id)) {
   const choices=remaining.filter(a=>s.readiedSpells!.some(live=>live.id===a.id));
   selection=chooseReactiveSpell(s,owner,choices,event);
   if(!selection) {
    for(const choice of choices)remaining.splice(remaining.indexOf(choice),1);
    continue;
   }
   active=choices.find(a=>a.id===selection!.activeSpellId)!;
   assert(active,'Reactive spell no longer eligible');
  }
  remaining.splice(remaining.indexOf(active),1);
  if(![...s.readiedSpells!,...s.ongoingSpells!].some(a=>a.id===active.id))continue;
  const selectedRoom=selection?.targetId?s.board.rooms.find(r=>r.id===selection.targetId):undefined;
  const selectedRef=selection?.targetId&&!selectedRoom?snapshot(s,selection.targetId):undefined;
  const bound=selectedRef??context(s).bindings.get(active.id);
  if(bound&&!liveModel(s,bound))continue;
  assert(++context(s).resolutions<=128,'Reactive spell resolution limit exceeded (128); root action cancelled');
  const ongoing=s.ongoingSpells!.some(a=>a.id===active.id);
  // Remove a one-shot BEFORE any nested effects; reveal/discard is physical.
  if(!ongoing)retireActiveSpell(s,active);
  s.log.push(`Interrupt ${event.event}: ${owner.name} ${ongoing?'reacts with':'reveals'} ${active.card.name}.`);
  // A model binding wins over the incidental room binding stored on model spells.
  // Event targets/rooms are public only now, after the canonical reveal above.
  const roomId=selectedRoom?.id??modelFeedbackTarget(s,selectedRef)?.roomId??event.roomId??eventTarget?.roomId??active.roomId;
  const room=roomId?s.board.rooms.find(r=>r.id===roomId):undefined;
  const target=modelFeedbackTarget(s,bound)??eventTarget??(room?roomFeedbackTarget(room):undefined);
  const instructions=ongoing?active.card.ongoing!.effects:active.card.triggerEffects??[];
  const trigger=appendFeedback(s,{kind:'SPELL_TRIGGERED',activeSpellId:active.id,ownerId:owner.id,
   cardName:active.card.name,spellType:getSpellType(active.card),trigger:event.event,ongoing,
  effects:!ongoing&&active.card.moments.length?active.card.moments.map(step=>describeInstruction({...step,target:active.card.target==='ROOM'?'BOUND_ROOM':'BOUND_MODEL'})):instructions.map(describeInstruction),...(target?{target}:{}),...(roomId?{roomId}:{})});
  const ownerRef=snapshot(s,owner.id);
  const previousInterruptId=context(s).interruptId;
  context(s).interruptId=trigger.id;
  try {
    if(!ongoing && active.card.moments.length) {
     const refs=selectedRef?[selectedRef]:selectedRoom?[...s.players.filter(p=>inRoom(p,selectedRoom)).map(p=>snapshot(s,p.id)!),...s.evocations.filter(e=>selectedRoom.tiles.some(h=>hexKey(h)===hexKey(e.position))).map(e=>snapshot(s,e.id)!)]:[];
     resolveEffectMoments(s,owner,active.card,selectedRoom??room,refs,ownerRef!);
    } else {
   const effect:EffectResolution={activationIsExplicit:instructions.some(step=>step.effect==='ACTIVATE_EVOCATION')};
   for(const instruction of instructions) {
    let ref:ModelSnapshot|undefined,roomId:string|undefined;
    switch(instruction.target) {
     case 'BOUND_MODEL':ref=bound;break;
    case 'BOUND_ROOM':roomId=selectedRoom?.id??active.roomId;break;
     case 'EVENT_MODEL':ref=event.model;break;
     case 'EVENT_ACTOR':ref=event.actor;break;
     case 'EVENT_ROOM':roomId=event.roomId;break;
     case 'OWNER':ref=ownerRef;break;
    }
    if(instruction.effect==='SUMMON'&&instruction.position==='TARGET'&&!liveModel(s,ref))roomId??=room?.id;
    resolveInstruction(s,owner,instruction,ref,roomId,ownerRef,effect);
   }
    }
  } finally { context(s).interruptId=previousInterruptId; }
  s.log.push(`Resume ${event.event} after ${active.card.name}.`);
 }
   }
}
function describeInstruction(instruction:TriggeredInstruction):string {
 const targets:Record<TriggeredInstruction['target'],string>={BOUND_MODEL:'the bound model',BOUND_ROOM:'the bound room',EVENT_MODEL:'the triggering model',EVENT_ACTOR:'the acting model',EVENT_ROOM:'the triggering room',OWNER:'the owner’s mage'};
 const target=targets[instruction.target];
 switch(instruction.effect) {
  case 'DAMAGE':return `Deal ${instruction.amount} damage to ${target}.`;
  case 'HEAL':return `Heal up to ${instruction.amount} ${instruction.amount===1?'wound':'wounds'} on ${target}.`;
  case 'CONVERT':return `Convert up to ${instruction.amount} ${instruction.amount===1?'cube':'cubes'} on ${target} to the owner’s color.`;
  case 'BLACK_ROSE_CONVERT':return `Pink Tulip converts up to ${instruction.amount} ${instruction.amount===1?'recent wound':'recent wounds'} on ${target} to Pink Tulip.`;
  case 'INSTABILITY':return `Place up to ${instruction.amount} instability in ${target}.`;
  case 'PAIN':return `The Pink Tulip inflicts ${instruction.amount} ${instruction.amount===1?'damage cube':'damage cubes'} on the resolving mage.`;
  case 'SUMMON':return `Summon a ${instruction.kind} ${instruction.position === 'TARGET' ? 'in the target’s room' : 'at the owner’s position'} and activate it.`;
  case 'ACTIVATE_EVOCATION':return `Activate the summoned ${instruction.kind}: move and attack in either order, or use only one, without spending another action or token.`;
 }
}
function modelEvent(s:GameState,event:TriggerEvent,ref:ModelSnapshot,actor=ref,roomId?:string) {
 const model=liveModel(s,ref);
 emitEvent(s,{event,model:ref,actor,roomId:roomId??(model?roomAt(s,model.model.position)?.id:undefined)});
}
function moveModel(s:GameState,ref:ModelSnapshot,destination:Hex) {
 const target=liveModel(s,ref);if(!target)return;
 const from=roomAt(s,target.model.position)?.id;
 target.model.position={...destination};
 const to=roomAt(s,destination)?.id;
 if(to && from!==to)modelEvent(s,'ENTER_ROOM',ref,ref,to);
}

// Thrown from deep inside resolution when a mage must answer; applyAction turns it
// into a pendingDecision and replays the whole root action once answered.
class DecisionNeeded extends Error {
 constructor(readonly decision:DecisionDetails,readonly answers:DecisionAnswer[]) {super('Decision needed');}
}

function askSoulTithe(s:GameState,e:Evocation,target:Player,amount:number,source?:Player) {
 const key=[e.id,target.id,amount,source?.id??BLACK_ROSE_ID].join('|'),ctx=context(s),given=ctx.answers[ctx.cursor];
 if(given?.key===key){ctx.cursor++;return given.accept;}
 throw new DecisionNeeded({kind:'SOUL_TITHE',playerId:target.id,key,evocationId:e.id,evocationName:`${e.name} #${e.number??1}`,
  evocationWounds:e.damageCubes,evocationHealth:e.health,targetId:target.id,targetName:target.name,
  sourceName:source?.name??'Pink Tulip',amount},ctx.answers.slice(0,ctx.cursor));
}

// Each living Soul Tithe model of the damaged mage (in model-number order) may take one
// of the damage cubes instead, anywhere on the board. Auto models accept without asking.
function soulTithe(s:GameState,target:Player,inflicted:number,source?:Player) {
 const taken:Evocation[]=[];
 const keepers=s.evocations.filter(e=>e.playerId===target.id&&e.ability==='SOUL_TITHE').sort((a,b)=>(a.number??0)-(b.number??0));
 for(const e of keepers) {
  const remaining=inflicted-taken.length;
  if(remaining<=0)break;
  if(e.autoAbility||askSoulTithe(s,e,target,remaining,source))taken.push(e);
 }
 return taken;
}

function damage(s: GameState, target: Player, amount: number, source?: Player, actor?: ModelSnapshot | null, beforeDefeat?: (target: Player) => void) {
 // Direct attacks/events get the same complete-moment reaction boundary as spells.
 if(context(s).momentDepth===0){atMomentEnd(s,()=>damage(s,target,amount,source,actor,beforeDefeat));return;}
 if(amount<=0) return;
 const eventActor = actor === null ? undefined : (actor ?? (source ? snapshot(s,source.id):undefined));
 // Overkill cannot claim more contribution than the health actually removed.
 let inflicted=Math.min(amount,Math.max(0,target.wizard.health-target.wizard.damageCubes));
 if(inflicted===0)return;
 const tithed=soulTithe(s,target,inflicted,source);
 for(const e of tithed) {
  s.log.push(`${e.name} #${e.number??1} takes a damage cube meant for ${target.name}.`);
  damageEvocation(s,e,1,source,eventActor);
 }
 inflicted-=tithed.length;
 if(inflicted===0)return;
 const ref=snapshot(s,target.id)!,roomId=roomAt(s,target.wizard.position)?.id;
 const feedbackTarget=modelFeedbackTarget(s,ref)!;
 target.wizard.damageCubes+=inflicted;
 if(source) {
  const cubes=Math.min(inflicted,source.cubes.available);
  if(cubes>0) {
   source.cubes.available-=cubes;
   source.cubes.onWizard+=cubes;
   target.wizard.damageByPlayer[source.id]=(target.wizard.damageByPlayer[source.id]??0)+cubes;
   appendDamageHistory(target.wizard,source.id,cubes);
   s.log.push(`${source.name} places ${cubes} damage cubes on ${target.name}.`);
  }
 } else {
  target.wizard.blackDamage+=inflicted;
  appendDamageHistory(target.wizard,BLACK_ROSE_ID,inflicted);
 }
 s.log.push(`${target.name} suffers ${inflicted} ${source ? 'damage' : 'black damage'}.`);
 appendFeedback(s,{kind:'DAMAGE',target:feedbackTarget,sourceId:source?.id??BLACK_ROSE_ID,amount:inflicted});
 if(source && eventActor) {
  const actorRef=snapshot(s,source.id)!;
  const actorTarget=modelFeedbackTarget(s,actorRef)!;
  emitEvent(s,{event:'DAMAGE_DEALT',model:actorRef,actor:eventActor,roomId:roomId??roomAt(s,source.wizard.position)?.id,target:actorTarget});
 }
 emitEvent(s,{event:'DAMAGE_TAKEN',model:ref,actor:eventActor,roomId,target:feedbackTarget});
 if(target.wizard.damageCubes<target.wizard.health)return;
 const existing=context(s).defeats.get(ref.id);
 if(existing){existing.source=source;existing.beforeDefeat=beforeDefeat;return;}
 const pending:PendingMageDefeat={ref,roomId,target:feedbackTarget,source,beforeDefeat};
 context(s).defeats.set(ref.id,pending);
 // Keep the original model, wounds and cubes until all defeat reactions finish.
 // Healing may cancel this defeat entirely; conversion may change its rankings.
 emitEvent(s,{event:'MAGE_DEFEATED',model:ref,actor:source?snapshot(s,source.id):undefined,roomId,target:feedbackTarget,
  afterResolution:()=>settleMageDefeat(s,pending)});
}

function settleMageDefeat(s:GameState,pending:PendingMageDefeat) {
 const {ref,source,roomId,target:feedbackTarget}=pending;
 const target=liveModel(s,ref)?.mage;
 context(s).defeats.delete(ref.id);
 if(!target)return;
 if(target.wizard.damageCubes<target.wizard.health) {
  s.log.push(`${target.name} is no longer defeated after reactions; no defeat points, trophy or respawn.`);
  return;
 }
 invalidateModel(s,ref);
 s.log.push(`${target.name} is defeated and returns to their starting room.`);
 const contributions=Object.fromEntries(Object.entries(target.wizard.damageByPlayer).filter(([id,n])=>id!==target.id && n>0));
 const blackContribution=(contributions[BLACK_ROSE_ID]??0)+target.wizard.blackDamage;
 if(blackContribution>0)contributions[BLACK_ROSE_ID]=blackContribution;
 const awards=getContributionAwards(contributions,[4,2,1]);
 for(const {playerId,cubes,rank,tied,points} of awards) {
  const name=awardVictoryPoints(s,playerId,points);
  s.log.push(`${name}: +${points} VP for ${cubes} ${playerId===BLACK_ROSE_ID?'black damage':'damage cubes'} on ${target.name} (rank ${rank}${tied&&points>0?', tied −1 VP':''}).`);
 }
  // Only actual player-owned cubes return; Pink Tulip damage has no physical supply.
 const returnedCubes:Record<string,number>={};
 for(const owner of s.players) {
  const cubes=target.wizard.damageByPlayer[owner.id]??0;
  if(cubes>0) {
    returnedCubes[owner.id]=cubes;
    owner.cubes.available+=cubes;owner.cubes.onWizard-=cubes;
   s.log.push(`${owner.name}: ${cubes} damage cubes returned from defeated ${target.name}.`);
  }
 }
 const colored=Object.entries(contributions).filter(([,n])=>n>0);
 let bonusPlayerId:string|undefined;
 if(colored.length===1 && colored[0][0]!==BLACK_ROSE_ID && colored[0][1]===target.wizard.damageCubes) {
  const owner=getPlayer(s,colored[0][0]);awardVictoryPoints(s,owner.id,1);
  bonusPlayerId=owner.id;
  s.log.push(`${owner.name}: +1 VP exclusive-color bonus on defeated ${target.name}.`);
 }
 // The final hitter receives quest/kill trophy credit, but no separate flat VP bonus.
 if(source) {
  source.trophies=[...source.trophies,target.id];
  source.kills=source.trophies.length;
  completeQuest(s,source,'KILL');
 } else {
  s.blackRose.kills++; awardVictoryPoints(s,target.id,2);
  s.log.push(`${target.name} gains +2 VP for being defeated by Pink Tulip.`);
 }
 appendFeedback(s,{kind:'MAGE_DEFEATED',target:feedbackTarget,sourceId:source?.id??BLACK_ROSE_ID,
  contributions,awards,returnedCubes,respawnRoomId:target.wizard.startingRoomId,...(bonusPlayerId?{bonusPlayerId}:{})});
 target.wizard.damageCubes=0;
 target.wizard.blackDamage=0;
 target.wizard.damageByPlayer={};
 target.wizard.damageOrder=[];
 target.wizard.position={...getRoom(s,target.wizard.startingRoomId).tiles[0]};
 // After-defeat splash only follows a confirmed defeat, never a rescued mage.
 pending.beforeDefeat?.(target);
}

// `source` is absent for Pink Tulip damage redirected onto an evocation: no physical cubes move.
function damageEvocation(s:GameState,e:Evocation,amount:number,source?:Player,actor=source?snapshot(s,source.id):undefined) {
 if(e.playerId===source?.id || !s.evocations.includes(e))return;
 const inflicted=Math.min(amount,Math.max(0,e.health-e.damageCubes));
 if(inflicted<=0)return;
 const ref=snapshot(s,e.id)!,roomId=roomAt(s,e.position)?.id;
 const feedbackTarget=modelFeedbackTarget(s,ref)!;
 e.damageCubes+=inflicted;
 const cubes=source?Math.min(inflicted,source.cubes.available):0;
 if(source){source.cubes.available-=cubes;source.cubes.onEvocations+=cubes;}
 if(source&&cubes)e.damageByPlayer[source.id]=(e.damageByPlayer[source.id]??0)+cubes;
 s.log.push(source?`${e.name} suffers ${inflicted} damage; ${source.name} places ${cubes} damage cubes.`:`${e.name} suffers ${inflicted} black damage.`);
 appendFeedback(s,{kind:'DAMAGE',target:feedbackTarget,sourceId:source?.id??BLACK_ROSE_ID,amount:inflicted});
 if(e.damageCubes<e.health){emitEvent(s,{event:'DAMAGE_TAKEN',model:ref,actor,roomId,target:feedbackTarget});return;}
 invalidateModel(s,ref);
 for(const owner of s.players) {
  const n=e.damageByPlayer[owner.id]??0;owner.cubes.available+=n;owner.cubes.onEvocations-=n;
 }
 s.evocations=s.evocations.filter(model=>model.id!==e.id);
 s.log.push(`${e.name} is destroyed; its damage cubes return to their owners.`);
 emitEvent(s,{event:'DAMAGE_TAKEN',model:ref,actor,roomId,target:feedbackTarget});
}

function modelTarget(s:GameState,id:string) {
 const mage=s.players.find(p=>p.id===id || p.wizard.id===id);
 const evocation=s.evocations.find(e=>e.id===id);
 assert(mage||evocation,'Target model not found');
 return {mage,evocation,playerId:mage?.id??evocation!.playerId,position:mage?.wizard.position??evocation!.position};
}

type CubeLocation = 'onWizard' | 'onEvocations' | 'onBoard';
type WoundedModel = Pick<Player['wizard'],'damageCubes'|'damageByPlayer'> & {blackDamage?:number;damageOrder?:PlayerId[]};
function removeCubes(ledger:Record<PlayerId,number>,id:PlayerId,amount:number) {
 ledger[id]-=amount;
 if(ledger[id]===0)delete ledger[id];
}
function appendDamageHistory(wizard: {damageOrder?:PlayerId[]}, sourceId: PlayerId, amount: number) {
 wizard.damageOrder ??= [];
 for(let i=0;i<amount;i++)wizard.damageOrder.push(sourceId);
}
function removeDamageHistory(wizard: {damageOrder?:PlayerId[]}, amount: number) {
 if(amount<=0)return;
 wizard.damageOrder ??= [];
 wizard.damageOrder.splice(0,Math.min(amount,wizard.damageOrder.length));
}
function convertRecentDamageToBlackRose(s:GameState,target:Player,amount:number,targetFeedback:FeedbackTarget) {
 target.wizard.damageOrder ??= [];
 let remaining=Math.min(amount,target.wizard.damageOrder.length),converted=0;
 for(let index=target.wizard.damageOrder.length-1; index>=0 && remaining>0; index--) {
  const sourceId=target.wizard.damageOrder[index];
  if(sourceId===BLACK_ROSE_ID)continue;
  if((target.wizard.damageByPlayer[sourceId]??0)<=0)continue;
  target.wizard.damageByPlayer[sourceId]-=1;
  if(target.wizard.damageByPlayer[sourceId]===0)delete target.wizard.damageByPlayer[sourceId];
  target.wizard.blackDamage+=1;
  target.wizard.damageOrder[index]=BLACK_ROSE_ID;
  converted++;remaining--;
 }
 if(converted>0) {
  s.log.push(`${target.name} converts ${converted} recent wound${converted===1?'':'s'} to Pink Tulip.`);
  appendFeedback(s,{kind:'CONVERT',target:targetFeedback,sourceId:BLACK_ROSE_ID,amount:converted,total:target.wizard.damageCubes});
 }
 return converted;
}

// Physical sources are always processed in seat order, then Pink Tulip. Neutral
// cubes have no supply to return; unattributed wounds are not convertible cubes.
function convertCubes(s:GameState,p:Player,ledger:Record<PlayerId,number>,location:CubeLocation,amount:number,total:number,target:FeedbackTarget,model?:WoundedModel) {
 let remaining=Math.min(amount,p.cubes.available,total),converted=0;
 for(const id of [...s.players.map(owner=>owner.id),BLACK_ROSE_ID]) {
  if(id===p.id || remaining<=0)continue;
  const n=Math.min(remaining,ledger[id]??0);
  if(n>0) {
   removeCubes(ledger,id,n);
   const owner=s.players.find(owner=>owner.id===id);
   if(owner){owner.cubes.available+=n;owner.cubes[location]-=n;}
   converted+=n;remaining-=n;
  }
  if(id===BLACK_ROSE_ID && model && remaining>0) {
   const black=Math.min(remaining,model.blackDamage??0);
   if(black>0){model.blackDamage!-=black;converted+=black;remaining-=black;}
  }
 }
 if(converted>0) {
  if(model && model.damageOrder) {
   let remainingHistory=converted;
   for(let i=model.damageOrder.length-1; i>=0 && remainingHistory>0; i--) {
    const current=model.damageOrder[i];
    const canConvert = current !== p.id && ((current===BLACK_ROSE_ID && (model.blackDamage ?? 0) >= 0) || (current !== BLACK_ROSE_ID && (model.damageByPlayer[current] ?? 0) > 0));
    if (!canConvert) continue;
    model.damageOrder[i]=p.id;
    remainingHistory--;
   }
  }
  ledger[p.id]=(ledger[p.id]??0)+converted;
  p.cubes.available-=converted;p.cubes[location]+=converted;
  s.log.push(`${p.name} converts ${converted} ${location==='onBoard'?'instability':'damage'} cubes; total ${location==='onBoard'?'instability':'wounds'} is unchanged.`);
  appendFeedback(s,{kind:'CONVERT',target,sourceId:p.id,amount:converted,total});
 }
}

// Healing returns colored cubes in seat order (including safe own-color legacy
// ledgers), then removes Pink Tulip cubes, then any unattributed wounds.
function healModel(s:GameState,model:WoundedModel,location:Exclude<CubeLocation,'onBoard'>,amount:number,sourceId:string,target:FeedbackTarget) {
 const healed=Math.max(0,Math.min(amount,model.damageCubes));
 let remaining=healed;
 for(const owner of s.players) {
  const n=Math.min(remaining,model.damageByPlayer[owner.id]??0);
  if(n>0) {
   removeCubes(model.damageByPlayer,owner.id,n);
   owner.cubes.available+=n;owner.cubes[location]-=n;remaining-=n;
  }
 }
 const black=Math.min(remaining,model.damageByPlayer[BLACK_ROSE_ID]??0);
 if(black>0){removeCubes(model.damageByPlayer,BLACK_ROSE_ID,black);remaining-=black;}
 if(model.blackDamage!==undefined)model.blackDamage-=Math.min(remaining,model.blackDamage);
 model.damageCubes-=healed;
 removeDamageHistory(model,healed);
 if(healed>0) {
  s.log.push(`Healing removes ${healed} wounds and returns their physical cubes.`);
  appendFeedback(s,{kind:'HEAL',target,sourceId,amount:healed});
 }
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
 s.log.push(`${source?.name ?? 'Pink Tulip'} places ${actual} instability in ${room.name} (${room.instability}/${room.instabilityLimit}).`);
 if(room.instability===room.instabilityLimit) {
  s.log.push(`${room.name} is full and cannot accept more instability; rebuilding, room VP and upgraded actions wait until Cleanup.`);
  if(source && room.cubesByPlayer[source.id]===room.instability) {
   awardVictoryPoints(s,source.id,1);
   s.log.push(`${source.name}: +1 VP for completing ${room.name} entirely in their color.`);
  }
  if(source) completeQuest(s,source,'REBUILD');
 }
 return actual;
}

function expireRoundSpells(s:GameState) {
 for(const active of [...s.readiedSpells!]) {
  removeActiveSpell(s,active);
  const owner=getPlayer(s,active.playerId);
  if(active.cleanupDestination==='MEMORIES'&&!active.card.powerful)owner.discard.push(active.card);
  else owner.hand.push(active.card);
 }
 for(const active of [...s.ongoingSpells!])retireActiveSpell(s,active);
 s.activeSpellOrder=[];
}

function startBlackRose(s: GameState) {
 // Also settle legacy Cleanup snapshots, without returning a card twice.
 expireRoundSpells(s);
 s.round++; s.phase='BLACK_ROSE'; s.blackRoseResolved=false; s.currentPlayerId=null; s.activation=null;s.evocationActivation=null;
 for(const p of s.players) {
  p.actionTokens=PHYSICAL_TOKENS_PER_ROUND; p.passed=false; p.studyDrawn=false; p.studyDone=false; p.studyCardIds=[]; p.preparationDone=false;
  // Powerful spells stay with the mage until cast, including uncast preparations.
  for(const key of ['rapid',...slots] as const) {
   const prepared=p.prepared[key];
   if(prepared && !prepared.used) {
    if(prepared.card.powerful)p.hand.push(prepared.card);else discardCard(s,p,prepared.card);
   }
  }
  p.prepared=emptyPrepared();
 }
 if(!s.eventDeck.length) { s.eventDeck=shuffle(s.eventDiscard,()=>resolutionRandom(s)); s.eventDiscard=[]; }
 const event=s.eventDeck.shift()!; s.usedEvent=event; s.eventDiscard.push(event);
 s.log.push(`Round ${s.round} · Pink Tulip — ${event.name}.`);
 if(event.kind==='BLACK_DAMAGE') for(const p of s.players) damage(s,p,event.amount);
 else {
  const candidates=shuffle(s.board.rooms.filter(r=>!r.startingFor && !r.reconstructed && r.instability<r.instabilityLimit),()=>resolutionRandom(s));
  for(const room of candidates.slice(0,event.rooms)) placeInstability(s,room,event.amount);
 }
}

const heldQuests = (p:Player) => p.quest?[p.quest,...p.additionalQuests]:[...p.additionalQuests];

function beginStudyIfQuestsFit(s:GameState) {
 if(s.players.some(p=>heldQuests(p).length>p.questLimit))return;
 for(const p of s.players) {
  let drawn=0;
  while(drawn<2 && p.personalDeck.length+p.discard.length>0) {p.hand.push(drawOne(s,p.personalDeck,p.discard));drawn++;}
  if(drawn<2)s.log.push(`${p.name} draws ${drawn} grimoire spells; the remaining personal spells are already held.`);
 }
 s.phase='STUDY'; s.log.push('STUDY — draw 2 grimoire spells, choose 4 blind library draws across schools, then discard 2 of those library spells.');
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
 if(s.players.some(p=>heldQuests(p).length>p.questLimit))s.log.push('Pink Tulip — waiting for quest-limit discards.');
 beginStudyIfQuestsFit(s);
}

function drawOne(s:GameState,deck: Card[], discard: Card[]): Card {
 if(!deck.length) { deck.push(...shuffle(discard,()=>resolutionRandom(s))); discard.length=0; }
 const card=deck.shift(); if(!card) throw new GameRuleError('This deck is empty');
 return card;
}

function discardCard(s:GameState,p:Player,card:Card) {
 assert(!card.powerful,'Forgotten spells cannot be discarded; keep them until used');
 const school=s.library.find(d=>card.schoolId===d.id || card.id.startsWith(`${d.id}-`));
 (school?school.discard:p.discard).push(card);
}

function activateRoom(s:GameState,p:Player,targetRoomId?:string) {
 atMomentEnd(s,()=>activateRoomBody(s,p,targetRoomId));
}
function activateRoomBody(s:GameState,p:Player,targetRoomId?:string) {
 const room=s.board.rooms.find(r=>inRoom(p,r));
 assert(room?.effect && !room.startingFor,'No room effect in a starting room');
 assert(!targetRoomId || room!.effect==='INSTABILITY','Only Emerald instability takes a target room');
 const reward=room!.reconstructed?2:1;
 if(room!.reconstructed){assert(!room!.specialUsed,'Reconstructed room special already used this Action phase');room!.specialUsed=true;}
 const actor=snapshot(s,p.id)!,position={...p.wizard.position};
 const targets=[...s.players.filter(t=>inRoom(t,room!)).map(t=>snapshot(s,t.id)!),...s.evocations.filter(e=>room!.tiles.some(h=>hexKey(h)===hexKey(e.position))).map(e=>snapshot(s,e.id)!)];
 s.log.push(`${p.name} activates ${room!.name} for free${reward===2?' (reconstructed special: double reward)':''}: ${ROOM_EFFECT_LABELS[room!.effect!]}.`);
 modelEvent(s,'ROOM_ACTIVATED',actor,actor,room!.id);
 progressQuest(s,p,'ROOM_ACTIVATE');
 switch(room!.effect) {
  case 'ROOM_DAMAGE': {
   for(const ref of targets)resolveInstruction(s,p,{effect:'DAMAGE',amount:reward,target:'EVENT_MODEL'},ref,undefined,actor);
   break;
  }
  case 'DRAW_DISCARD': {
  if(p.discard.length)for(let i=0;i<reward && p.discard.length;i++)p.hand.push(p.discard.splice(Math.floor(resolutionRandom(s)*p.discard.length),1)[0]);
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
  case 'DRAW_GRIMOIRE':for(let i=0;i<reward && p.personalDeck.length+p.discard.length;i++)p.hand.push(drawOne(s,p.personalDeck,p.discard));break;
  case 'SUMMON_CADAVER': {
   for(let i=0;i<reward;i++) {
    if(!summonEvocation(s,p,'CADAVER',position))break;
    s.log.push(`${p.name} summons a Cadaver from the Grey room (Undead · move 2 · attack 2 · health 2).`);
   }
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
  if(card)p.hand.push(card);else {s.log.push('The forgotten spell supply is exhausted.');break;}
  }
   break;
  }
 }
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
  if(['TRAP','PROTECTION'].includes(getSpellType(card)))return !!card.trigger;
  if(card.target==='ROOM' || canUseSpellDummy(card))return s.board.rooms.some(r=>!r.startingFor && r.tiles.some(h=>isWithinSpellRange(p.wizard.position,h,card.range)));
  const legal=(ownerId:string,kind:'MAGE'|'EVOCATION',position:Hex)=>spellCanTargetModel(card,p.id,ownerId,kind)
   && !s.board.rooms.some(r=>r.startingFor && r.tiles.some(h=>hexKey(h)===hexKey(position)))
   && isWithinSpellRange(p.wizard.position,position,card.range);
  return s.players.some(t=>legal(t.id,'MAGE',t.wizard.position)) || s.evocations.some(e=>legal(e.playerId,'EVOCATION',e.position));
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
 expireRoundSpells(s);
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
  // Stable player seating order wins equal final scores; Pink Tulip follows mages.
  const leaders=[...s.players,{id:BLACK_ROSE_ID,name:'Pink Tulip',victoryPoints:s.blackRose.victoryPoints}].sort((a,b)=>b.victoryPoints-a.victoryPoints);
  s.phase='GAME_OVER';s.winner=leaders[0].id;
  s.log.push(`${leaders[0].name} wins with ${leaders[0].victoryPoints} VP!`);
 }
}

function scoreEndgame(s:GameState) {
 if(s.endgameScored)return;
 s.endgameScored=true;
 const categories=[
  {label:'trophy tokens majority',counts:{...Object.fromEntries(s.players.map(p=>[p.id,p.trophies.length])),[BLACK_ROSE_ID]:0}},
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
 const a=s.activation;if(!a)return;
 if(s.evocationActivation || a.physicalAction || a.exploring>0) return;
 if(!canPlayerAct(s,getPlayer(s,a.playerId))) finishActivation(s);
}

function summonForEffect(s:GameState,owner:Player,kind:'SUCCUBUS',position:Hex,effect?:EffectResolution) {
 const evocation=summonEvocation(s,owner,kind,position);
 if(effect)effect.summoned=evocation?snapshot(s,evocation.id):undefined;
 if(!evocation)return;
 evocation.activated=!effect?.activationIsExplicit;
 s.log.push(effect?.activationIsExplicit?`${owner.name} summons ${evocation.name}.`:`${owner.name} summons and activates ${evocation.name}.`);
}
function activateEffectSummon(s:GameState,owner:Player,kind:'SUCCUBUS',effect?:EffectResolution) {
 const evocation=liveModel(s,effect?.summoned)?.evocation;
 // A failed summon or a destroyed model must never activate a different servant.
 if(!evocation||evocation.playerId!==owner.id||evocation.name!==EVOCATION_TYPES[kind].name)return;
 assert(s.phase==='ACTION'&&s.currentPlayerId===owner.id,'Resolve the summoned activation during its owner’s Action turn');
 assert(!s.evocationActivation,'Finish the active evocation first');
 evocation.activated=true;
 s.evocationActivation={evocationId:evocation.id,playerId:owner.id,movesRemaining:evocation.movement,returnToAction:true};
 s.log.push(`${owner.name} activates ${evocation.name} #${evocation.number??1} from the spell (no extra action or token): move ${evocation.movement}, attack ${evocationAttack(evocation)}.`);
 modelEvent(s,'EVOCATION_ACTIVATED',snapshot(s,evocation.id)!);
}
function resolveEffectMoments(s:GameState,caster:Player,spell:Card,room:Room|undefined,refs:ModelSnapshot[],actor:ModelSnapshot) {
 const effect:EffectResolution={activationIsExplicit:spell.moments.some(step=>step.effect==='ACTIVATE_EVOCATION')};
 for(const step of spell.moments)atMomentEnd(s,()=>resolveMomentBody(s,caster,spell,step,room,refs,actor,effect));
}
function resolveMomentBody(s:GameState,caster:Player,spell:Card,step:Moment,room:Room|undefined,refs:ModelSnapshot[],actor:ModelSnapshot,effect:EffectResolution) {
 if(step.effect==='PAIN') {
  damage(s,caster,step.amount);
  return;
 }
 if(step.effect==='SUMMON') {
  const target = refs[0] ? liveModel(s, refs[0]) : undefined;
  const position = step.position === 'TARGET' ? target?.model.position??room?.tiles[0] : caster.wizard.position;
  if(!position)return;
  summonForEffect(s,caster,step.kind,position,effect);
  return;
 }
 if(step.effect==='ACTIVATE_EVOCATION') {
  activateEffectSummon(s,caster,step.kind,effect);
  return;
 }
 if(step.amount<=0)return;
 // Instability always lands in the chosen room; conversion of a room spell converts that room's cubes.
 if(step.effect==='INSTABILITY' || (step.effect==='CONVERT' && spell.target==='ROOM')) {
  if(room)resolveInstruction(s,caster,{...step,target:'BOUND_ROOM'},undefined,room.id,actor);
  return;
 }
 for(const ref of refs)resolveInstruction(s,caster,{...step,target:'BOUND_MODEL'},ref,undefined,actor);
}

function castSpell(s: GameState, p: Player, command: Extract<GameAction,{type:'CAST_SPELL'|'CAST_POWERFUL_SPELL'|'ACTIVATE_SPELL'}>) {
 const a=requireActivation(s,p.id);
 assert(a.exploring===0,'Finish exploring first');
 requireNoPendingPhysical(a);
 requireTurnAction(a);
 assert(!isInStartingRoom(s,p),'Leave the starting room before casting spells');
 if(command.type==='CAST_POWERFUL_SPELL')throw new GameRuleError('Forgotten spells cannot be cast from hand; prepare them in a later Preparation phase and use CAST_SPELL');
 const action=command as Extract<GameAction,{type:'CAST_SPELL'}>;
 const prepared=p.prepared[action.slot];
 const card=prepared&&!prepared.used?prepared.card:undefined;
 assert(card,'Spell unavailable');
 if(action.slot!=='rapid') {
  assert(!a.sequencedSpellUsed,'Only one sequenced spell per turn');
  assert(slots.find(slot=>p.prepared[slot] && !p.prepared[slot]!.used)===action.slot,'Cast numbered spells in order 1 → 2 → 3');
 }
 const spell=card!;
 let targets: ReturnType<typeof modelTarget>[]=[]; let room: Room | undefined;
 const reactive=['TRAP','PROTECTION'].includes(getSpellType(spell));
 assert(command.type!=='ACTIVATE_SPELL'||reactive,'Only Trap and Protection spells can be activated');
 // ACTIVATE_SPELL deliberately has no targeting payload, even on the wire.
 if(reactive)assert(!('dummy' in action)&&!('roomId' in action)&&!('targetPlayerId' in action)&&!('targetEvocationId' in action),'Activate without choosing a room, model or dummy');
 if(!reactive) {
  if(spell.target==='ROOM' || action.dummy) {
   assert(!action.dummy || canUseSpellDummy(spell),'Dummy targeting requires a MAGE, EVOCATION or MODEL spell');
   assert(!action.targetPlayerId&&!action.targetEvocationId,'Choose either a room/dummy or a model');
   assert(action.roomId,'Select a room'); room=getRoom(s,action.roomId!);
   assert(!room.startingFor,'Starting rooms cannot be targeted');
   assert(room.tiles.some(h=>isWithinSpellRange(p.wizard.position,h,spell.range)),'Room out of range');
   if(!action.dummy)targets=[...s.players.filter(t=>inRoom(t,room!)).map(t=>modelTarget(s,t.id)),...s.evocations.filter(e=>room!.tiles.some(h=>hexKey(h)===hexKey(e.position))).map(e=>modelTarget(s,e.id))];
  } else {
   assert(!action.roomId,'Individual model spells cannot target a room');
   const inferSelf=spell.target==='SELF' && !action.targetPlayerId && !action.targetEvocationId;
   assert(inferSelf || !!action.targetPlayerId!==!!action.targetEvocationId,'Select one mage or evocation');
   const id=inferSelf?p.id:action.targetEvocationId??action.targetPlayerId!;
   const target=modelTarget(s,id);
   assert(inferSelf || (action.targetPlayerId?!!target.mage:!!target.evocation),'Target payload does not match the model kind');
   assert(spellCanTargetModel(spell,p.id,target.playerId,target.mage?'MAGE':'EVOCATION'),'Spell cannot target this model category or ownership');
   room=s.board.rooms.find(r=>r.tiles.some(h=>hexKey(h)===hexKey(target.position)));
   assert(!room?.startingFor,'Cannot target a model in its starting room');
   assert(isWithinSpellRange(p.wizard.position,target.position,spell.range),'Model out of range');targets=[target];
  }
 } else {
  assert(!action.targetPlayerId&&!action.targetEvocationId,'Reactive spells choose targets only when the trigger resolves');
  assert(!action.roomId || action.dummy,'Reactive spells do not require activation targeting');
 }
 // Commit first, then interrupt SPELL_CAST before printed instructions. Model
 // generations and the chosen room are fixed before any interrupt can respawn.
 const refs=targets.map(t=>snapshot(s,t.mage?.id??t.evocation!.id)!);
 const actor=snapshot(s,p.id)!;
 assert(!reactive || spell.trigger,'Active hidden spells require a trigger');
 assert(!spell.ongoing || action.dummy || refs.length===1,'Ongoing spells must bind one model');
 prepared!.used=true;
 // A dummy is not a real model: consume the card normally without creating
 // hidden/ongoing bindings or redirecting its model effects to room occupants.
 if(!action.dummy && (reactive || spell.ongoing)) {
  const target=targets[0];
  const active:ActiveSpell={id:resolutionId(s),playerId:p.id,card:spell,
   ...(spell.target!=='ROOM' && target?.mage?{targetPlayerId:target.mage.id}:{}),
   ...(spell.target!=='ROOM' && target?.evocation?{targetEvocationId:target.evocation.id}:{}),
   ...(room?{roomId:room.id}:{})};
  (reactive?s.readiedSpells!:s.ongoingSpells!).push(active);
  s.activeSpellOrder!.push(active.id);bindActiveSpell(s,active);
 } else if(spell.powerful){s.removedCards.push(spell);s.log.push(`${spell.name} is removed from the game after use.`);}
 else discardCard(s,p,spell);
 a.spellsCast++;a.actionsUsed++;
 if(action.slot!=='rapid')a.sequencedSpellUsed=true;
 s.log.push(reactive&&!action.dummy?`${p.name} activates a hidden spell for 1 action (no physical token).`:`${p.name} casts ${spell.name}${action.dummy?' on a dummy (no model effects)':''} for 1 action (no physical token).`);
 // Activation is not a cast and cannot trigger "when a spell is cast".
 if(!reactive)modelEvent(s,'SPELL_CAST',actor);
 if(!reactive || action.dummy) {
  // Printed moments resolve strictly in card order, and a card may repeat a moment.
  // Each moment is a complete step: every interrupt it causes (reactive spells, a
  // mage defeat with its scoring and respawn) finishes before the next moment
  // resumes. Models defeated or destroyed meanwhile are skipped by later moments.
  resolveEffectMoments(s,p,spell,room,refs,actor);
 }
 afterAction(s);
}

export function applyAction(state: GameState, action: GameAction): GameState {
 const pending=state.pendingDecision;
 if(action.type==='RESPOND_SOUL_TITHE') {
  if(pending?.kind!=='SOUL_TITHE'||!pending.resume)throw new GameRuleError('No decision is waiting');
  assert(pending.playerId===action.playerId,'This decision belongs to another mage');
  assert(typeof action.accept==='boolean','Choose accept or decline');
  const base=structuredClone(state);delete base.pendingDecision;
  return runWithDecisions(base,pending.resume.action,[...pending.resume.answers,{key:pending.key,accept:action.accept}],pending.resume.entropy);
 }
 if(action.type==='RESPOND_REACTIVE_SPELL') {
  if(pending?.kind!=='REACTIVE_SPELL'||!pending.resume)throw new GameRuleError('No reactive decision is waiting');
  assert(pending.playerId===action.playerId,'This decision belongs to another mage');
  assert(pending.key===action.key,'Stale reactive decision');
  if(action.activeSpellId) {
   const option=pending.options.find(o=>o.activeSpellId===action.activeSpellId);
   assert(option && option.targets.some(t=>t.id===action.targetId),'Choose an eligible spell and target');
  } else assert(!action.targetId,'Declining does not select a target');
  const base=structuredClone(state);delete base.pendingDecision;
  return runWithDecisions(base,pending.resume.action,[...pending.resume.answers,{key:pending.key,accept:!!action.activeSpellId,activeSpellId:action.activeSpellId,targetId:action.targetId}],pending.resume.entropy);
 }
 // The paused action's mage decides first; the owner may still adjust their own switches.
 if(pending)assert(action.type==='SET_EVOCATION_AUTO',`Waiting for ${state.players.find(p=>p.id===pending.playerId)?.name??'a mage'} to decide`);
 return runWithDecisions(state,action,[]);
}

function runWithDecisions(state:GameState,action:GameAction,answers:DecisionAnswer[],entropy:ReplayEntropy={ids:[],random:[]}):GameState {
 const replay=structuredClone(entropy);
 try {return runAction(state,action,answers,replay);}
 catch(error) {
  if(!(error instanceof DecisionNeeded))throw error;
  const paused=structuredClone(state);
  paused.pendingDecision=structuredClone({...error.decision,resume:{action,answers:error.answers,entropy:replay}});
  return paused;
 }
}

function runAction(state: GameState, action: GameAction, answers: DecisionAnswer[],entropy:ReplayEntropy): GameState {
 const s=structuredClone(state);
 s.feedbackEvents??=[];
 s.readiedSpells??=[];s.ongoingSpells??=[];
 s.activeSpellOrder??=[...s.readiedSpells,...s.ongoingSpells].map(a=>a.id);
 instructionContexts.set(s,{generations:new Map(),bindings:new Map(),defeats:new Map(),resolutions:0,answers,cursor:0,momentDepth:0,events:[],entropy,idCursor:0,randomCursor:0});
 for(const active of [...s.readiedSpells,...s.ongoingSpells])bindActiveSpell(s,active);
 assert(s.phase!=='GAME_OVER','The game is over');
 // Wire payloads can include fields excluded by the TypeScript action union.
 assert(!('dummy' in action) || action.type==='CAST_SPELL' || action.type==='CAST_POWERFUL_SPELL','Dummy targeting is only available for spell cards');
 const p=getPlayer(s,action.playerId);
 switch(action.type) {
  case 'UNDO_ACTION': case 'REDO_ACTION': throw new GameRuleError('History commands must be intercepted by the server; the engine does not process undo/redo');
  case 'SELECT_STARTING_SCHOOL':
   requirePhase(s,'LOBBY');assert(p.connected,'Join the room first');
   assert(typeof action.schoolId==='string' && s.library.some(d=>d.id===action.schoolId),'School not found');
   if(p.startingSchoolId!==action.schoolId) {p.startingSchoolId=action.schoolId;p.ready=false;}
   assert(hasStartingSchoolSupply(s),`Not enough school supply for ${STARTING_SCHOOL_CARDS} starting spells per mage`);
   break;
  case 'SET_READY':
   requirePhase(s,'LOBBY');assert(p.connected,'Join the room first');
   if(action.ready)assert(typeof p.startingSchoolId==='string' && s.library.some(d=>d.id===p.startingSchoolId),'Choose a valid starting school before becoming ready');
   p.ready=action.ready;break;
  case 'SET_ROOM_COUNT': {
   requirePhase(s,'LOBBY');assert(p.id===s.hostId,'Only the creator can configure rooms');assert(p.connected,'Join the room first');
   assert(action.roomsPerColor===null || (Number.isInteger(action.roomsPerColor)&&[1,2,3].includes(action.roomsPerColor)),'Choose 1, 2 or 3 rooms per color, or null for automatic');
   const value=action.roomsPerColor===null?undefined:action.roomsPerColor;
   if(s.roomsPerColor!==value) {
    if(value===undefined)delete s.roomsPerColor;else s.roomsPerColor=value;
    for(const mage of s.players)mage.ready=false;
   }
   break;
  }
  case 'START_GAME':
   requirePhase(s,'LOBBY'); assert(p.id===s.hostId,'Only the creator can start');
   assert(canStartGame(s),'At least 2 mages must join and everyone must be ready with a valid starting school and enough school supply');
    s.board=createDemoBoard(s.roomsPerColor??getDefaultRoomsPerColor(s.players.length),()=>resolutionRandom(s));
    for(const mage of s.players) {
     const start=s.board.rooms.find(r=>r.startingFor===mage.id)!;
     mage.wizard.startingRoomId=start.id;mage.wizard.position={...start.tiles[0]};
    }
   for(const mage of s.players) {
    const deck=s.library.find(d=>d.id===mage.startingSchoolId)!;
    // These seven physical school cards are the entire starting grimoire.
    // Keep the last card in personal discard; normal Study draws fill the hand.
    for(let i=0;i<STARTING_SCHOOL_CARDS;i++) {
    const card=drawOne(s,deck.cards,deck.discard);
     (i===STARTING_SCHOOL_CARDS-1?mage.discard:mage.personalDeck).push(card);
    }
   }
   s.firstPlayerId=s.players[0].id;startBlackRose(s);break;
  case 'ADVANCE_PHASE':
   assert(p.id===s.hostId,'Only the creator can continue the phase');
    assert(action.expectedPhase===s.phase && action.expectedRound===s.round,'Stale phase command; wait for the current phase');
   if(s.phase==='BLACK_ROSE') finishBlackRose(s);
   else if(s.phase==='CLEANUP') startBlackRose(s);
   else throw new GameRuleError('This phase finishes when all players complete it');
   break;
  case 'DRAW_STUDY': {
   requirePhase(s,'STUDY'); assert(!p.studyDrawn,'Already drew library spells');
    const hasDeckId=Object.prototype.hasOwnProperty.call(action,'deckId'),hasDeckIds=Object.prototype.hasOwnProperty.call(action,'deckIds');
    assert(hasDeckId!==hasDeckIds,'Choose either deckId or deckIds, not both');
    assert(!('cardIds' in action),'Study draws select schools, never hidden card IDs');
    assert(hasDeckId?typeof action.deckId==='string':Array.isArray(action.deckIds)&&action.deckIds.length===4&&Array.from(action.deckIds).every(id=>typeof id==='string'),'Choose exactly 4 school entries');
    const ids=hasDeckId?Array<string>(4).fill(action.deckId!):action.deckIds!;
    const decks=ids.map(id=>{const deck=s.library.find(d=>d.id===id);assert(deck,'School not found');return deck!;});
    for(const deck of new Set(decks)) {
     const required=decks.filter(d=>d===deck).length;
     assert(deck.cards.length+deck.discard.length>=required,`${deck.name} has fewer than ${required} available spells`);
    }
    const drawn=decks.map(deck=>drawOne(s,deck.cards,deck.discard));
    p.hand.push(...drawn);p.studyCardIds=drawn.map(c=>c.id);
    p.studyDrawn=true;s.log.push(`${p.name} draws 4 library spells from ${[...new Set(decks.map(d=>d.name))].join(', ')}.`);break;
  }
  case 'DISCARD_STUDY': {
   requirePhase(s,'STUDY'); assert(p.studyDrawn && !p.studyDone,'Draw library spells before discarding');
    assert(Array.isArray(action.cardIds) && action.cardIds.length===2 && new Set(action.cardIds).size===2,'Discard exactly 2 different spells');
   assert(action.cardIds.every(id=>p.hand.some(c=>c.id===id)),'Spell not in hand');
    assert(action.cardIds.every(id=>!p.hand.find(c=>c.id===id)!.powerful),'Forgotten spells cannot be discarded during Study');
    assert(Array.isArray(p.studyCardIds) && p.studyCardIds.length===4 && new Set(p.studyCardIds).size===4 && action.cardIds.every(id=>p.studyCardIds!.includes(id)),'Discard only spells drawn from the library this Study');
    for(const id of action.cardIds) discardCard(s,p,p.hand.splice(p.hand.findIndex(c=>c.id===id),1)[0]);
   p.studyDone=true;
  if(s.players.every(p=>p.studyDone)) { s.phase='PREPARATION'; s.log.push('PREPARATION — place 2 to 4 spells: up to 3 numbered slots and 1 optional Quick slot.'); }
   break;
  }
  case 'DISCARD_QUESTS': {
  requirePhase(s,'BLACK_ROSE');assert(s.blackRoseResolved,'Resolve Pink Tulip before discarding quests');
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
    assert(Array.isArray(action.preparedCardIds),'Choose ordered spells');
    assert(Array.from(action.preparedCardIds).every(id=>id===null||typeof id==='string'),'Ordered spells must be card IDs or empty slots');
    assert(action.rapidCardId===undefined || typeof action.rapidCardId==='string','Quick spell must be a card ID');
    // Null placeholders preserve the player's exact numbered destinations.
    // Legacy contiguous string arrays remain valid and unchanged.
    const numbered=action.preparedCardIds.filter((id):id is string=>id!==null);
    const ids=[...numbered,...(action.rapidCardId===undefined?[]:[action.rapidCardId])];
    assert(action.preparedCardIds.length<=3 && ids.length>=2 && ids.length<=4 && new Set(ids).size===ids.length,'Choose 2 to 4 different spells, at most 3 numbered and 1 Quick');
   assert(ids.every(id=>p.hand.some(c=>c.id===id)),'Spell not in hand');
   for(const [i,id] of action.preparedCardIds.entries()) {
    if(id===null)continue;
    const card=p.hand.splice(p.hand.findIndex(c=>c.id===id),1)[0];
    p.prepared[slots[i]]={card,used:false};
   }
   if(action.rapidCardId!==undefined) {
    const card=p.hand.splice(p.hand.findIndex(c=>c.id===action.rapidCardId),1)[0];
    p.prepared.rapid={card,used:false};
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
  s.log.push(`${p.name} activates ${e!.name}: move ${e!.movement}, attack ${evocationAttack(e!)}.`);
  modelEvent(s,'EVOCATION_ACTIVATED',snapshot(s,e!.id)!);break;
  }
  case 'EVOCATION_STEP': {
   const {active,e}=requireEvocation(s,p.id);assert(active.movesRemaining>0,'No evocation movement remaining');
   assert(areAdjacent(e.position,action.destination),'Move one adjacent space at a time');
   assert(s.board.tiles.some(h=>hexKey(h)===hexKey(action.destination)),'Destination outside board');
   assert(!s.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(action.destination))),'Evocations cannot enter starting rooms');
  active.movesRemaining--;moveModel(s,snapshot(s,e.id)!,action.destination);
  if(s.evocationActivation===active&&active.movesRemaining===0&&active.attackUsed)finishEvocation(s);
  break;
  }
  case 'END_EVOCATION_MOVEMENT': {
   const {active}=requireEvocation(s,p.id);assert(active.movesRemaining>0,'No evocation movement remaining');
   active.movesRemaining=0;
   if(active.attackUsed)finishEvocation(s);
   break;
  }
  case 'EVOCATION_ATTACK': {
   const {active,e}=requireEvocation(s,p.id);assert(!active.attackUsed,'Evocation attack already used');
   const target=modelTarget(s,action.targetId);
   assert(target.playerId!==p.id,'Evocations cannot damage their mage or friendly evocations');
   assert(!s.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(target.position))),'Cannot target a model in its starting room');
  assert(areInSameRoom(s,e.position,target.position),'Target must be in the same room');
  const actor=snapshot(s,e.id)!,ref=snapshot(s,action.targetId)!,roomId=roomAt(s,target.position)?.id;
  active.attackUsed=true;
  resolveInstruction(s,p,{effect:'DAMAGE',amount:evocationAttack(e),target:'EVENT_MODEL'},ref,undefined,actor);
  modelEvent(s,'EVOCATION_ATTACK',ref,actor,roomId);
  if(s.evocationActivation===active&&active.movesRemaining===0)finishEvocation(s);
  break;
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
  const target=mageAttackTarget(s,p,action.targetId),ref=snapshot(s,action.targetId)!,actor=snapshot(s,p.id)!,roomId=roomAt(s,target.position)?.id;
  resolveInstruction(s,p,{effect:'DAMAGE',amount:p.wizard.attack,target:'EVENT_MODEL'},ref,undefined,actor);
  modelEvent(s,'MAGE_ATTACK',ref,actor,roomId);
   physical.mainEffectUsed=true;finishPhysicalEffects(s);break;
  }
  case 'EXPLORE': {
    const a=requirePhysicalAction(s,p);assert(p.actionTokens>0,'No action tokens');
    p.actionTokens--; a.actionsUsed++; a.exploring=p.wizard.movement;a.roomEffectUsed=false;
    const actor=snapshot(s,p.id)!;
    if(action.activateRoomAtStart){activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;}
    if(!liveModel(s,actor))a.exploring=0;
    s.log.push(`${p.name} explores: up to ${p.wizard.movement} one-step moves.`);
    if(a.exploring===0)afterAction(s);break;
  }
  case 'EXPLORE_STEP': {
   const a=requireActivation(s,p.id); assert(a.exploring>0,'Choose Explore first');
  validateExitDestination(s,p,action.destination);
  const ref=snapshot(s,p.id)!;a.exploring--;moveModel(s,ref,action.destination);
  if(!liveModel(s,ref))a.exploring=0;
  if(a.exploring===0)endExplore(s,p,!!action.activateRoomAtEnd && !!liveModel(s,ref),action.roomTargetId);break;
  }
  case 'END_EXPLORE': { const a=requireActivation(s,p.id); assert(a.exploring>0,'Not exploring');endExplore(s,p,!!action.activateRoomAtEnd,action.roomTargetId);break; }
  case 'DISCARD_EXIT': {
  const a=requireActivation(s,p.id);assert(a.exploring===0,'Finish exploring first');
  requireNoPendingPhysical(a);
  requireTurnAction(a);
  const leavingStart=isInStartingRoom(s,p);
  assert(!a.discardedExit,'Already used a discard-to-move this turn');
  validateExitDestination(s,p,action.destination);
  const handIndex=p.hand.findIndex(c=>c.id===action.cardId);
  let card:Card;
  if(handIndex>=0)card=p.hand.splice(handIndex,1)[0];
  else {
   const key=(['rapid',...slots] as const).find(key=>p.prepared[key] && !p.prepared[key]!.used && p.prepared[key]!.card.id===action.cardId);
   assert(key,'Choose a held or unused prepared card');
   const prepared=p.prepared[key!]!;card=prepared.card;prepared.used=true;
  }
  discardCard(s,p,card);a.discardedExit=true;a.actionsUsed++;
  s.log.push(`${p.name} discards ${card.name} to ${leavingStart?'leave the starting room':'move'} by 1 space (1 action, no physical token).`);
  moveModel(s,snapshot(s,p.id)!,action.destination);
  afterAction(s);break;
  }
  case 'PUNCH': {
  const a=requirePhysicalAction(s,p);assert(p.actionTokens>0,'No action tokens');
  const target=mageAttackTarget(s,p,action.targetId);
  p.actionTokens--; a.actionsUsed++;a.roomEffectUsed=false;
  const ref=snapshot(s,action.targetId)!,actor=snapshot(s,p.id)!,roomId=roomAt(s,target.position)?.id;
  if(action.roomEffect==='START'){activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;}
  // A room effect may defeat the intended victim; never punch their respawn.
  if(liveModel(s,ref) && liveModel(s,actor)) {
   resolveInstruction(s,p,{effect:'DAMAGE',amount:p.wizard.attack,target:'EVENT_MODEL'},ref,undefined,actor);
   modelEvent(s,'MAGE_ATTACK',ref,actor,roomId);
  }
  if(action.roomEffect==='END' && liveModel(s,actor)){activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;}
  afterAction(s); break;
  }
  case 'ACTIVATE_SPELL': case 'CAST_SPELL': case 'CAST_POWERFUL_SPELL': castSpell(s,p,action); break;
  case 'SET_ACTIVE_SPELL_CLEANUP': {
   const active=s.readiedSpells!.find(a=>a.id===action.activeSpellId&&a.playerId===p.id);
   assert(active,'Choose your own active spell');
   assert(action.destination==='HAND'||action.destination==='MEMORIES','Choose Hand or Memories');
   assert(!active!.card.powerful||action.destination==='HAND','Forgotten spells cannot be discarded');
   active!.cleanupDestination=action.destination;
   break;
  }
  case 'RESPOND_REACTIVE_SPELL': case 'RESPOND_SOUL_TITHE': throw new GameRuleError('No decision is waiting');
  case 'SET_EVOCATION_AUTO': {
   const e=s.evocations.find(model=>model.id===action.evocationId);
   if(!e||e.playerId!==p.id)throw new GameRuleError('Choose one of your own evocations');
   assert(e.ability==='SOUL_TITHE','This evocation has no ability to automate');
   assert(typeof action.auto==='boolean','Choose on or off');
   e.autoAbility=action.auto;
   s.log.push(`${p.name}: ${e.name} #${e.number??1} now ${action.auto?'automatically takes':'asks before taking'} damage cubes.`);
   break;
  }
  case 'USE_QUEST_REWARD': {
   requirePhase(s,'ACTION');
   const a=requireActivation(s,p.id); assert(a.exploring===0,'Finish exploring first'); requireNoPendingPhysical(a);
  const quest=heldQuests(p).find(q=>q.id===action.questId)!;
   assert(quest && quest.completed && !quest.claimed,'Quest reward unavailable');
   if(quest.rewardAction)resolveQuestRewardAction(s,p,quest.rewardAction,{targetPlayerId:action.targetPlayerId,targetEvocationId:action.targetEvocationId,roomId:action.roomId,dummy:action.dummy});
   awardVictoryPoints(s,p.id,quest.reward); p.questsCompleted++; quest.claimed=true;
   modelEvent(s,'QUEST_SOLVED',snapshot(s,p.id)!,snapshot(s,p.id)!,roomAt(s,p.wizard.position)?.id);
   s.log.push(`${p.name} resolves “${quest.name}” for +${quest.reward} VP.`);
  const remaining=heldQuests(p).filter(q=>q.id!==quest.id);
   p.quest=remaining.shift()??null; p.additionalQuests=remaining;
   break;
  }
  default: throw new GameRuleError('Unknown game action');
 }
 // Trigger destruction during activation or movement must release the lock and
 // follow the normal paid-action/free-phase handoff exactly once.
 if(s.evocationActivation && !s.evocations.some(e=>e.id===s.evocationActivation!.evocationId))finishEvocation(s);
 instructionContexts.delete(s);
 return s;
}