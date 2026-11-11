import { Activation, ActiveSpell, AmountScale, Board, Card, DamageOrigin, DecisionAnswer, DecisionDetails, Element, EventCard, Evocation, EvocationKind, FeedbackTarget, GameAction, GameFeedbackEvent, GameState, Hex, Jinx, JinxName, MageDraftId, Moment, Player, PlayerId, PreparedCard, Quest, QuestTrigger, Room, RoomId, RoomColor, RoomEffect, SpellSide, SpellType, TriggerCondition, TriggerEvent, TriggeredInstruction, TurnRecapCard, UpgradeName } from './types';
import { createEvents, createLibrary, createPowerfulDeck, createQuests, getDarkSideSpell, getEffectiveSpell, getPhysicalEffect, getRevealedElements, getAllMoments, getMainMoments, getSpellEffects, getSpellForSide, getSpellType, hasMoment, hasSummonKeyword, isUnstable, mainEffects, shuffle } from './cards';

export class GameRuleError extends Error {}
export const PHYSICAL_TOKENS_PER_ROUND = 2;
export const ACTIONS_PER_TURN = 2;
export const MIN_MAGES = 2;
export const MAX_MAGES = 4;
export const STARTING_SCHOOL_CARDS = 6;
export const MAGE_SPELL_COPIES=3;
export const MAGE_DRAFT_POOL:readonly {id:MageDraftId;name:string}[]=[
 {id:'tizio',name:'Tizio'},{id:'caio',name:'Caio'},{id:'sempronio',name:'Sempronio'},{id:'tiriki',name:'Tiriki'},
];
export const BLACK_ROSE_ID = 'black-rose';
export const FEEDBACK_EVENT_LIMIT = 512;
export const EVENT_BOARD_SIZE = 3;
export const TURN_RECAP_LIMIT = 8;
export const ENDGAME_REWARDS = [4,2,1] as const;
export function getRoomRewards(capacity:number):Room['rewards'] {
 switch(capacity) {
  case 4:return [2,1,0];
  case 5:return [3,1,1];
  case 6:return [4,2,1];
  case 10:return [6,3,1];
  default:throw new GameRuleError(`Unsupported room capacity: ${capacity}`);
 }
}
export const MAGE_COLORS: Record<string,string> = {p1:'#fb7185',p2:'#60a5fa',p3:'#fbbf24',p4:'#34d399'};
export const MAGE_COLOR_NAMES: Record<string,string> = {p1:'Rose',p2:'Blue',p3:'Amber',p4:'Green'};
export const EVOCATION_MODEL_LIMITS:Readonly<Record<EvocationKind,number>> = {SUCCUBUS:3,CADAVER:6,COLOSSUS:3,NIGREDO:3,UMBRA:9,TOTEM:5};
export const UPGRADE_NAMES:readonly UpgradeName[]=['CEREBRAL_IMPLANT','CORROSIVE_PLASMA','MUSCULAR_IMPLANT','REGENERATING_ICHOR','REINFORCED_DERMIS','TENDON_IMPLANT'];
export const UPGRADE_COPIES=3;
export const UPGRADE_LABELS:Readonly<Record<UpgradeName,string>>={CEREBRAL_IMPLANT:'Cerebral implant',CORROSIVE_PLASMA:'Corrosive plasma',MUSCULAR_IMPLANT:'Muscular implant',REGENERATING_ICHOR:'Regenerating ichor',REINFORCED_DERMIS:'Reinforced dermis',TENDON_IMPLANT:'Tendon implant'};
export const UPGRADE_RULES:Readonly<Record<UpgradeName,string>>={
 CEREBRAL_IMPLANT:'Each time this model inflicts damage, its controller gains 1 VP.',
 CORROSIVE_PLASMA:'Its attack targets the room: every model in it not of the controller’s color suffers the damage.',
 MUSCULAR_IMPLANT:'+1 attack.',
 REGENERATING_ICHOR:'When this model suffers damage, ignore 1 of it.',
 REINFORCED_DERMIS:'+2 health.',
 TENDON_IMPLANT:'+1 movement, and at the end of the Black Rose phase it may move up to its movement.',
};
export const getEvocationKind = (e:Evocation):EvocationKind => e.kind??(e.archetype==='ALTAR'?'TOTEM':e.archetype==='DEMON'?'SUCCUBUS':'CADAVER');
// Derive the shared remaining counters from live models: destruction, replay and
// undo automatically return miniatures, without a second mutable inventory.
export function getEvocationSupply(s:Pick<GameState,'evocations'>):Record<EvocationKind,number> {
 const supply={...EVOCATION_MODEL_LIMITS};
 for(const e of s.evocations)supply[getEvocationKind(e)]--;
 return {SUCCUBUS:Math.max(0,supply.SUCCUBUS),CADAVER:Math.max(0,supply.CADAVER),COLOSSUS:Math.max(0,supply.COLOSSUS),NIGREDO:Math.max(0,supply.NIGREDO),UMBRA:Math.max(0,supply.UMBRA),TOTEM:Math.max(0,supply.TOTEM)};
}
// Assigned Nightmares attach to a slot but never occupy it; only real evocations count.
export function getMageEvocationCount(s:Pick<GameState,'evocations'>,mageId:PlayerId):number {
 return s.evocations.filter(e=>e.playerId===mageId).length;
}
// Upgrade cards are finite too: three copies each, derived from attached upgrades.
export function getUpgradeSupply(s:Pick<GameState,'evocations'>):Record<UpgradeName,number> {
 const supply=Object.fromEntries(UPGRADE_NAMES.map(u=>[u,UPGRADE_COPIES])) as Record<UpgradeName,number>;
 for(const e of s.evocations)if(e.upgrade)supply[e.upgrade]=Math.max(0,supply[e.upgrade]-1);
 return supply;
}
// Jinx cards (Hex school): three copies of each, derived from what mages carry. The progress target is
// the same for every jinx; the cubes on a jinx are a plain counter, not taken from the mage's cube supply.
export const JINX_NAMES:readonly JinxName[]=['OBLIVION','SLOWNESS','VULNERABILITY','WEAKNESS'];
export const JINX_COPIES=3;
export const JINX_TARGET=3;
export const JINX_LABELS:Readonly<Record<JinxName,string>>={OBLIVION:'Oblivion',SLOWNESS:'Slowness',VULNERABILITY:'Vulnerability',WEAKNESS:'Weakness'};
export const JINX_RULES:Readonly<Record<JinxName,{effect:string;progress:string}>>={
 OBLIVION:{effect:'Whenever you place cubes in a room, place 1 cube less.',progress:'Place 1 cube here whenever you place any number of cubes in a room.'},
 SLOWNESS:{effect:'Your Mage speed is 1.',progress:'Place 1 cube here each time you use the Explore action or discard a spell to move.'},
 VULNERABILITY:{effect:'After a mage assigns a jinx to you, they also inflict 1 damage to you.',progress:'Place 1 cube here when you discard a jinx or resolve a quest.'},
 WEAKNESS:{effect:'When assigned, and each time you are placed in your starting cell, BR inflicts 2 damage to you.',progress:'Place 1 cube here after you resolve the effect of a yellow or green room.'},
};
export const getMageJinxes=(p:Pick<Player,'jinxes'>):Jinx[]=>p.jinxes??[];
export const hasJinx=(p:Pick<Player,'jinxes'>,name:JinxName)=>getMageJinxes(p).some(j=>j.name===name);
export function getJinxSupply(s:Pick<GameState,'players'>):Record<JinxName,number> {
 const supply=Object.fromEntries(JINX_NAMES.map(n=>[n,JINX_COPIES])) as Record<JinxName,number>;
 for(const p of s.players)for(const j of getMageJinxes(p))supply[j.name]=Math.max(0,supply[j.name]-1);
 return supply;
}
// Slowness caps the Mage's speed at 1.
export const getMageMovement=(p:Pick<Player,'jinxes'|'wizard'>)=>hasJinx(p,'SLOWNESS')?Math.min(1,p.wizard.movement):p.wizard.movement;
const upgradeHealth=(kind:EvocationKind,upgrade?:UpgradeName)=>(upgrade==='REINFORCED_DERMIS'?2:0)+(kind==='CADAVER'&&upgrade?1:0);
export const evocationMovement = (e:Evocation) => e.movement+(e.upgrade==='TENDON_IMPLANT'?1:0)+(e.bonusMovement??0);
export const evocationAttack = (e:Evocation) => e.attack+(getEvocationKind(e)==='SUCCUBUS'&&e.passive==='WOUNDED_FURY'?e.damageCubes:0)+(e.upgrade==='MUSCULAR_IMPLANT'?1:0)+(e.bonusAttack??0);
// Cadaver's effect is blank for now; Succubus retains Wounded Fury and Soul Tithe.
type EvocationTemplate = Pick<Evocation,'name'|'archetype'|'movement'|'attack'|'health'|'ability'|'passive'>;
export const EVOCATION_TYPES = {
 CADAVER:{name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:2},
 SUCCUBUS:{name:'Succubus',archetype:'DEMON',movement:2,attack:1,health:3,ability:'SOUL_TITHE',passive:'WOUNDED_FURY'},
 COLOSSUS:{name:'Colossus',archetype:'UNDEAD',movement:2,attack:3,health:4,ability:'ENTRY_SHOCK'},
 // Instead of damaging its target, its controller may place or convert 1 cube in its room.
 NIGREDO:{name:'Nigredo',archetype:'CONSTRUCT',movement:2,attack:2,health:3,ability:'ALCHEMY'},
 // Black Rose nightmare: assigned to a mage by spells, never summoned; it cannot move.
 UMBRA:{name:'Umbra',archetype:'NIGHTMARE',movement:0,attack:1,health:2},
 TOTEM:{name:'Totem',archetype:'ALTAR',movement:0,attack:0,health:3,ability:'TOTEM'},
} as const satisfies Record<EvocationKind,EvocationTemplate>;
export type EvocationType = keyof typeof EVOCATION_TYPES;
// Both the owner's three-model cap and the shared miniature supply must allow it.
export function summonEvocation(s:GameState,p:Player,type:EvocationType,position:Hex):Evocation|undefined {
 if(type==='UMBRA')return;
 const owned=s.evocations.filter(e=>e.playerId===p.id);
 const template:EvocationTemplate=EVOCATION_TYPES[type];
 const hasNightmare=s.evocations.some(e=>e.assignedTo===p.id);
 const full=owned.length>=3;
 if(full&&!instructionContexts.has(s)){s.log.push(`${p.name} already controls 3 evocations; no ${template.name} summoned.`);return;}
 if(type==='COLOSSUS'&&owned.some(e=>getEvocationKind(e)==='COLOSSUS')){s.log.push(`${p.name} already controls a big evocation; no Colossus summoned.`);return;}
 const free=[1,2,3].filter(n=>!owned.some(e=>e.number===n));
 let number=free[0];
 // A full retinue (or one carrying a Nightmare) lets the caster pick a slot; an occupied slot is replaced.
 if(instructionContexts.has(s)&&(full||(free.length>1&&hasNightmare))) {
  const options=(full?[1,2,3]:free).map(n=>{const o=owned.find(e=>e.number===n);return {id:String(n),label:o?`Slot ${n} · replace ${o.name}`:`Slot ${n}`};});
  number=Number(askChoice(s,p.id,`slot|${p.id}`,`Choose an evocation slot for the new ${template.name}.`,options)!);
 }
 // Replacing is not a removal: the old model leaves silently (cubes return, no EVOCATION_LOST).
 const replaced=owned.find(e=>e.number===number);
 const supplyLeft=getEvocationSupply(s)[type]+(replaced&&getEvocationKind(replaced)===type?1:0);
 if(supplyLeft===0){s.log.push(`No ${template.name} models remain in the shared supply; no model summoned.`);return;}
 if(replaced) {
  invalidateModel(s,snapshot(s,replaced.id)!);
  for(const owner of s.players){const n=replaced.damageByPlayer[owner.id]??0;owner.cubes.available+=n;owner.cubes.onEvocations-=n;}
  s.evocations=s.evocations.filter(model=>model.id!==replaced.id);
  s.log.push(`${p.name} replaces ${replaced.name} #${number} with a new ${template.name}.`);
 }
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
// Cards printed with "in your room" reach by room membership instead of line range.
export const spellReaches = (game:Pick<GameState,'board'>,card:Card,from:Hex,to:Hex): boolean =>
 card.targetFilter?.sameRoom ? areInSameRoom(game,from,to) : isWithinSpellRange(from,to,card.range);
// Printed restrictions on the chosen model (own, construct, low health).
export function spellFilterAllows(card:Card,casterId:string,model:{playerId:string;evocation?:Pick<Evocation,'archetype'|'health'>}):boolean {
 const f=card.targetFilter;
 if(!f)return true;
 if(f.own&&model.playerId!==casterId)return false;
 if(f.archetype&&model.evocation?.archetype!==f.archetype)return false;
 if(f.maxHealth!==undefined&&(!model.evocation||model.evocation.health>f.maxHealth))return false;
 return true;
}
export function spellCanTargetModel(card:Card,casterId:string,ownerId:string,kind:'MAGE'|'EVOCATION'):boolean {
 if(card.target==='SELF')return kind==='MAGE' && casterId===ownerId;
 // Support, Protection and ongoing cards do not bypass the printed Self target.
 if(kind==='MAGE' && casterId===ownerId)return false;
 if(card.target==='ROOM' || (card.target!=='MODEL' && card.target!==kind))return false;
 return casterId!==ownerId || hasMoment(card,'HEAL') || hasMoment(card,'CONVERT') || getSpellType(card)==='PROTECTION' || (card.ongoing && getSpellType(card)==='CONTINGENCY')===true
  || getAllMoments(card).some(m=>m.effect==='ASSIGN_UPGRADE'||m.effect==='DISCARD_UPGRADE'||m.effect==='ACTIVATE_TARGET'||m.effect==='REMOVE_EVOCATION'||m.effect==='ACTIVATE_ROOM'||m.effect==='ATTACK_BONUS');
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
 DRAW_POWERFUL:'Discard 2 cards to gain 1 forgotten spell; prepare in a later Preparation phase, then remove from the game when cast',
 FIRST_PLAYER:'Place 1 instability in this room and take the first-player token: you start the next phase and following rounds',
 BR_STANDARD:'Discard 3 cards to draw 1 Forgotten spell; BR places 1 cube here',
 BR_REBUILT:'Discard 3 cards to draw 2 Forgotten spells, then discard 1 card',
 CEMETERY_STANDARD:'Summon a Cadaver here', CEMETERY_REBUILT:'Summon a Colossus anywhere',
 CRYPT_STANDARD:'Summon a Cadaver here', CRYPT_REBUILT:'Summon 2 Cadavers within range 1',
 ALTAR_STANDARD:'Summon a Cadaver here', ALTAR_REBUILT:'Deal 2 damage to a model anywhere',
 ALCHEMICAL_LAB_STANDARD:'Deal 1 damage to enemies in a room within range 1', ALCHEMICAL_LAB_REBUILT:'Draw 3 grimoire cards, then discard 1',
 ARENA_STANDARD:'Deal 1 damage to enemies in a room within range 1', ARENA_REBUILT:'Cast your next ready numbered spell',
 SUMMONER_STANDARD:'Deal 1 damage to enemies in a room within range 1', SUMMONER_REBUILT:'Summon and activate a Nigredo here',
 BIBLIOTHECA_STANDARD:'Draw 1 quest', BIBLIOTHECA_REBUILT:'Draw 2 cards from different available schools',
 OBSERVATORY_STANDARD:'Draw 1 quest', OBSERVATORY_REBUILT:'Each other mage loses 1 VP',
 SANCTUARY_STANDARD:'Draw 1 quest', SANCTUARY_REBUILT:'Heal yourself for 3, then heal any model for 3',
 FORGE_STANDARD:'Place 1 instability in a room within range 1', FORGE_REBUILT:'Move 1, attack, move 1, attack, move 1, move 1',
 GARDEN_STANDARD:'Place 1 instability in a room within range 1', GARDEN_REBUILT:'Heal yourself for 3, then heal any model for 3',
 TREASURE_STANDARD:'Place 1 instability in a room within range 1', TREASURE_REBUILT:'Gain 2 VP and draw an event',
 ORACLE_STANDARD:'Draw 1 random card from your discard', ORACLE_REBUILT:'Shuffle your discard into your grimoire and choose a card to draw',
 ABYSS_STANDARD:'Draw 1 random card from your discard', ABYSS_REBUILT:'Send every mage to their starting room',
 MIRRORS_STANDARD:'Place 1 instability in a room within range 1', MIRRORS_REBUILT:'Copy the standard or rebuilt effect of another room',
 ARMORY_STANDARD:'Draw 1 grimoire card', ARMORY_REBUILT:'Replace a revealed numbered spell with a card from your hand; BR gains 1 VP',
 PLEASURE_STANDARD:'Draw 1 grimoire card', PLEASURE_REBUILT:'Draw 3 quests, then discard 2 quests',
 THRONE_STANDARD:'Lose 1 VP to take the first-player token', THRONE_REBUILT:'Take the first-player token and gain 1 VP',
};
export const ROOM_TARGET_EFFECTS:ReadonlySet<RoomEffect>=new Set([
 'INSTABILITY','ALCHEMICAL_LAB_STANDARD','ARENA_STANDARD','SUMMONER_STANDARD','FORGE_STANDARD','GARDEN_STANDARD','TREASURE_STANDARD','MIRRORS_STANDARD',
]);
export const roomEffectNeedsTarget=(effect:RoomEffect|null|undefined)=>!!effect&&ROOM_TARGET_EFFECTS.has(effect);
export const getRoomEffect = (room:Pick<Room,'effect'|'rebuiltEffect'|'reconstructed'>):RoomEffect|null =>
 room.reconstructed ? room.rebuiltEffect ?? room.effect : room.effect;
/** Cards discarded from hand to activate the central chamber. */
export const CENTRAL_ROOM_DISCARD_COST=3;
/** Hand cards that may pay the central chamber's cost (Forgotten spells never can). */
export const getCentralDiscardOptions=(p:Player):Card[]=>p.hand.filter(c=>!c.powerful);
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

function assignRoomColors(positions:Hex[],startingPositions:Hex[],roomsPerColor:1|2|3,random:()=>number):Map<string,RoomColor> {
 const remaining=new Map<RoomColor,number>(ROOM_COLORS.map(color=>[color,roomsPerColor]));
 const assigned=new Map<string,RoomColor>();
 const centerRing=positions.filter(position=>hexDistance(position,{q:0,r:0})===1);
 if(centerRing.length!==ROOM_COLORS.length)throw new GameRuleError('Room layout must have one central-adjacent room per color');
 for(const [index,position] of shuffle(centerRing,random).entries()) {
  const color=ROOM_COLORS[index];
  assigned.set(hexKey(position),color);
  remaining.set(color,remaining.get(color)!-1);
 }
 const neighbors=new Map(positions.map(position=>[
  hexKey(position),
  positions.filter(other=>hexDistance(position,other)===1).map(hexKey),
 ]));
 const reachable=startingPositions.map(start=>new Set(positions.filter(position=>hexDistance(start,position)<=2).map(hexKey)));

 const choicesFor=(position:Hex):RoomColor[]=>{
  const key=hexKey(position),adjacent=neighbors.get(key)!;
  return ROOM_COLORS.filter(color=>(remaining.get(color)??0)>0&&!adjacent.some(other=>assigned.get(other)===color));
 };
 const canStillReachEachColor=()=>{
  if(roomsPerColor!==3)return true;
  for(const start of reachable)for(const color of ROOM_COLORS) {
   if([...start].some(key=>assigned.get(key)===color))continue;
   if(!(remaining.get(color)??0))return false;
   if(!positions.some(position=>{
    const key=hexKey(position);
    return start.has(key)&&!assigned.has(key)&&choicesFor(position).includes(color);
   }))return false;
  }
  return true;
 };
 const search=():boolean=>{
  if(assigned.size===positions.length)return canStillReachEachColor();
  const unassigned=shuffle(positions.filter(position=>!assigned.has(hexKey(position))),random);
  let next:Hex|undefined,options:RoomColor[]=[];
  for(const position of unassigned) {
   const choices=choicesFor(position);
   if(!choices.length)return false;
   if(!next||choices.length<options.length) { next=position;options=choices; }
  }
  if(!next)return false;
  for(const color of shuffle(options,random)) {
   const key=hexKey(next);
   assigned.set(key,color);
   remaining.set(color,remaining.get(color)!-1);
   const enoughRooms=[...remaining.values()].every(count=>count<=positions.length-assigned.size);
   if(enoughRooms&&canStillReachEachColor()&&search())return true;
   remaining.set(color,remaining.get(color)!+1);
   assigned.delete(key);
  }
  return false;
 };
 if(!search())throw new GameRuleError('Could not generate a room layout that meets the color and reachability rules');
 return assigned;
}

export function createDemoBoard(roomsPerColor:1|2|3=3,random:()=>number=Math.random): Board {
 assert([1,2,3].includes(roomsPerColor),'Choose 1, 2 or 3 rooms per color');
 const startingPositions=[
  roomsPerColor===1?{q:2,r:-1}:{q:3,r:-2},
  roomsPerColor===1?{q:-2,r:1}:{q:-3,r:2},
  roomsPerColor===1?{q:-1,r:-1}:{q:-1,r:-2},
  roomsPerColor===1?{q:1,r:1}:{q:1,r:2},
 ];
 const startingRooms=shuffle(['p1','p2','p3','p4'],random).map((playerId,index)=>({playerId,position:startingPositions[index]}));
 const tiles: Hex[] = [];
 for (let r=-2;r<=2;r++) for(let q=-2;q<=2;q++) {
  const distance=hexDistance({q,r},{q:0,r:0});
  // Ring 1 is connected on its own; six ring-2 corners add one of each color.
  if(distance<=1 || (distance===2 && (roomsPerColor===3 || (roomsPerColor===2 && (q===0 || r===0 || q+r===0)))))tiles.push({q,r});
 }
 tiles.push(...startingRooms.map(start=>start.position));
 const coloredPositions=tiles.filter(position=>
  hexDistance(position,{q:0,r:0})>0&&!startingRooms.some(start=>hexKey(start.position)===hexKey(position)),
 );
 const roomColors=assignRoomColors(coloredPositions,startingRooms.map(start=>start.position),roomsPerColor,random);
 const thronePosition=coloredPositions.find(position=>
  hexDistance(position,{q:0,r:0})===1&&roomColors.get(hexKey(position))==='violet',
 )!;
 type RoomDefinition=Pick<Room,'name'|'instabilityLimit'|'rewards'|'effect'|'rebuiltEffect'>;
 const definitions:Record<RoomColor,RoomDefinition[]>={
  grey:[
   {name:'Cemetery',instabilityLimit:6,rewards:[4,2,1],effect:'CEMETERY_STANDARD',rebuiltEffect:'CEMETERY_REBUILT'},
   {name:'Crypt',instabilityLimit:6,rewards:[4,2,1],effect:'CRYPT_STANDARD',rebuiltEffect:'CRYPT_REBUILT'},
   {name:'Sacrificial Altar',instabilityLimit:6,rewards:[4,2,1],effect:'ALTAR_STANDARD',rebuiltEffect:'ALTAR_REBUILT'},
  ],
  crimson:[
   {name:'Alchemical Laboratory',instabilityLimit:6,rewards:[4,2,1],effect:'ALCHEMICAL_LAB_STANDARD',rebuiltEffect:'ALCHEMICAL_LAB_REBUILT'},
   {name:'Arena',instabilityLimit:6,rewards:[4,2,1],effect:'ARENA_STANDARD',rebuiltEffect:'ARENA_REBUILT'},
   {name:'Summoner Room',instabilityLimit:6,rewards:[4,2,1],effect:'SUMMONER_STANDARD',rebuiltEffect:'SUMMONER_REBUILT'},
  ],
  amber:[
   {name:'Bibliotheca',instabilityLimit:5,rewards:[3,1,1],effect:'BIBLIOTHECA_STANDARD',rebuiltEffect:'BIBLIOTHECA_REBUILT'},
   {name:'Observatory',instabilityLimit:5,rewards:[3,1,1],effect:'OBSERVATORY_STANDARD',rebuiltEffect:'OBSERVATORY_REBUILT'},
   {name:'Sanctuary',instabilityLimit:5,rewards:[3,1,1],effect:'SANCTUARY_STANDARD',rebuiltEffect:'SANCTUARY_REBUILT'},
  ],
  emerald:[
   {name:'Forge',instabilityLimit:4,rewards:[2,1,0],effect:'FORGE_STANDARD',rebuiltEffect:'FORGE_REBUILT'},
   {name:'Garden',instabilityLimit:4,rewards:[2,1,0],effect:'GARDEN_STANDARD',rebuiltEffect:'GARDEN_REBUILT'},
   {name:'Treasure Room',instabilityLimit:4,rewards:[2,1,0],effect:'TREASURE_STANDARD',rebuiltEffect:'TREASURE_REBUILT'},
  ],
  azure:[
   {name:'Oracle Room',instabilityLimit:6,rewards:[4,2,1],effect:'ORACLE_STANDARD',rebuiltEffect:'ORACLE_REBUILT'},
   {name:'The Abyss',instabilityLimit:6,rewards:[4,2,1],effect:'ABYSS_STANDARD',rebuiltEffect:'ABYSS_REBUILT'},
   {name:'Mirrors Room',instabilityLimit:6,rewards:[4,2,1],effect:'MIRRORS_STANDARD',rebuiltEffect:'MIRRORS_REBUILT'},
  ],
  violet:[
   {name:'Armory Room',instabilityLimit:6,rewards:[4,2,1],effect:'ARMORY_STANDARD',rebuiltEffect:'ARMORY_REBUILT'},
   {name:'Pleasure Room',instabilityLimit:6,rewards:[4,2,1],effect:'PLEASURE_STANDARD',rebuiltEffect:'PLEASURE_REBUILT'},
   {name:'Throne Room',instabilityLimit:10,rewards:[6,3,1],effect:'THRONE_STANDARD',rebuiltEffect:'THRONE_REBUILT'},
  ],
 };
 const roomDefinitionByPosition=new Map<string,RoomDefinition>();
 for(const color of ROOM_COLORS) {
  const positions=shuffle(coloredPositions.filter(position=>roomColors.get(hexKey(position))===color),random);
  const colorDefinitions=shuffle(definitions[color],random);
  const throneIndex=colorDefinitions.findIndex(definition=>definition.name==='Throne Room');
  if(color==='violet') {
   const throne=colorDefinitions.splice(throneIndex,1)[0];
   roomDefinitionByPosition.set(hexKey(thronePosition),throne);
  }
  const remainingPositions=positions.filter(position=>color!=='violet'||hexKey(position)!==hexKey(thronePosition));
  remainingPositions.forEach((position,index)=>roomDefinitionByPosition.set(hexKey(position),colorDefinitions[index]));
 }
 const rooms: Room[] = tiles.map(h => {
  const central=h.q===0&&h.r===0;
  const starting=startingRooms.some(start=>hexKey(start.position)===hexKey(h));
  const color=roomColors.get(hexKey(h))??null;
  const definition=roomDefinitionByPosition.get(hexKey(h));
  const capacity=central?10:definition?.instabilityLimit??5;
  return {
  id: `room-${h.q},${h.r}`, name:central?'BR room':starting?'Starting room':definition!.name,
  tiles: [h], instability: 0, instabilityLimit:capacity,
  rewards:central?[6,3,1]:definition?.rewards?[...definition.rewards]:getRoomRewards(capacity), cubesByPlayer: {}, reconstructed: false, scored: false,
  color,effect:central?'BR_STANDARD':definition?.effect??null,rebuiltEffect:definition?.rebuiltEffect??null,specialUsed:false,
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
  id, name:names[id], connected: false, ready: false, startingSchoolId: null, mageId:null,
  wizard: { id: `${id}-wizard`, playerId: id, health: 10, attack: 2, movement: 2, damageCubes: 0, blackDamage: 0, damageByPlayer: {}, damageOrder: [], position: {...start.tiles[0]}, startingRoomId: start.id, alive: true },
  personalDeck: [], hand: [], discard: [], prepared: emptyPrepared(),
  cubes: { available:25, onWizard:0, onBoard:0, onEvocations:0 }, actionTokens:PHYSICAL_TOKENS_PER_ROUND, victoryPoints:0,
  questsCompleted:0, kills:0, trophies:[], quest:null, additionalQuests:[], studyDrawn:false, studyDone:false, studyCardIds:[], preparationDone:false, passed:false, cardLimit:7, questLimit:2,
 };
}

export function canStartGame(s:GameState):boolean {
 return s.phase==='LOBBY' && s.players.length>=MIN_MAGES && s.players.length<=MAX_MAGES
  && s.players.every(p=>p.connected&&p.ready);
}

function setupDrafter(s:GameState):Player|null {
 const order=s.setupOrder??[];
 const draftOrder=s.setupStage==='MAGE'?[...order].reverse():order;
 for(const id of draftOrder) {
  const player=s.players.find(p=>p.id===id);
  if(player&&(s.setupStage==='SCHOOL'?player.startingSchoolId==null:player.mageId==null))return player;
 }
 return null;
}

function finishSetup(s:GameState) {
 for(const mage of s.players) {
  const grimoire=shuffle(mage.personalDeck,()=>resolutionRandom(s));
  const top=grimoire.shift();
  if(!top)throw new GameRuleError('Every mage needs a complete grimoire before the game begins');
  mage.personalDeck=grimoire;
  mage.discard.push(top);
 }
 s.setupStage=null;
 startBlackRose(s);
}

function mageSpellCopies(mageId:MageDraftId):Card[] {
 const data:Record<MageDraftId,{name:string;range:number;target:Card['target'];moments:Moment[]}>={
  tizio:{name:'Tizio’s Quick Strike',range:1,target:'MODEL',moments:[{effect:'DAMAGE',amount:2}]},
  caio:{name:'Caio’s Arcane Bolt',range:2,target:'MODEL',moments:[{effect:'DAMAGE',amount:1}]},
  sempronio:{name:'Sempronio’s Ward',range:0,target:'SELF',moments:[{effect:'HEAL',amount:1}]},
  tiriki:{name:'Tiriki’s Spark',range:1,target:'ROOM',moments:[{effect:'DAMAGE',amount:1},{effect:'INSTABILITY',amount:1}]},
 };
 const spell=data[mageId];
 return Array.from({length:MAGE_SPELL_COPIES},(_,index)=>({id:`mage-${mageId}-${index+1}`,schoolId:`mage-${mageId}`,name:spell.name,kind:'SPELL' as const,spellType:'COMBAT' as const,range:spell.range,target:spell.target,effects:mainEffects(spell.moments)}));
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
  blackRose:{victoryPoints:0,kills:0,trophies:[]}, firstPlayerId:null, endgameScored:false, moon:1, moonEvents:[],
  eventDeck:createEvents(), eventDiscard:[], questDeck:createQuests(), questDiscard:[],
  powerfulDeck:createPowerfulDeck(), removedCards:[], readiedSpells:[], ongoingSpells:[], activeSpellOrder:[],
  evocations:[], evocationActivation:null, feedbackEvents:[],
  currentPlayerId:null, activation:null, winner:null, log:['Room created. Join the room and mark yourself ready; the game begins with a school and mage draft.'], usedEvent:null, blackRoseResolved:false, eventBoard:Array.from({length:EVENT_BOARD_SIZE},()=>null),
 };
}

export function getRoomMajorityWinners(room: Pick<Room,'cubesByPlayer'>): PlayerId[] {
 const entries=Object.entries(room.cubesByPlayer).filter(([,n])=>n>0);
 const max=Math.max(0,...entries.map(([,n])=>n));
 return entries.filter(([,n])=>n===max).map(([id])=>id);
}

// Dense ranks: tied leaders do not consume the next distinct contribution rank.
// Every tied contributor loses one point (minimum one for a nonzero prize).
// Explicit zero prizes and later distinct ranks beyond the table remain zero.
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

export function compareFinalStanding<T extends {id:string; victoryPoints?:number; finalVP?:number; currentVP?:number; questsCompleted?:number; quests?:number; trophies?:unknown[]|number; firstPlayer?:boolean}>(a:T,b:T,firstPlayerId:string|null=null):number {
 const aScore=a.victoryPoints ?? a.finalVP ?? a.currentVP ?? 0;
 const bScore=b.victoryPoints ?? b.finalVP ?? b.currentVP ?? 0;
 const byPoints=bScore-aScore;
 if(byPoints!==0)return byPoints;
 const aQuests=a.questsCompleted ?? a.quests ?? 0;
 const bQuests=b.questsCompleted ?? b.quests ?? 0;
 if(aQuests!==bQuests)return bQuests-aQuests;
 const aTrophies=Array.isArray(a.trophies)?a.trophies.length:typeof a.trophies==='number'?a.trophies:0;
 const bTrophies=Array.isArray(b.trophies)?b.trophies.length:typeof b.trophies==='number'?b.trophies:0;
 if(aTrophies!==bTrophies)return bTrophies-aTrophies;
 const aCrown = a.firstPlayer===true || (firstPlayerId!==null && a.id===firstPlayerId) ? 1 : 0;
 const bCrown = b.firstPlayer===true || (firstPlayerId!==null && b.id===firstPlayerId) ? 1 : 0;
 if(aCrown!==bCrown)return bCrown-aCrown;
 return 0;
}

function awardVictoryPoints(s:GameState,id:PlayerId,points:number):string {
 // General rule: victory points never go below zero.
 const previousLeader=Math.max(s.blackRose.victoryPoints,...s.players.map(player=>player.victoryPoints));
 if(id===BLACK_ROSE_ID){
  s.blackRose.victoryPoints=Math.max(0,s.blackRose.victoryPoints+points);
  advanceMoon(s,previousLeader);
  return 'BR';
 }
 const p=getPlayer(s,id);
 const before=p.victoryPoints; p.victoryPoints=Math.max(0,p.victoryPoints+points);
 if(p.victoryPoints!==before) {
  const ref=snapshot(s,p.id);
  if(ref) modelEvent(s,'VP_CHANGED',ref,ref,roomAt(s,p.wizard.position)?.id);
  s.log.push(`${p.name} ${p.victoryPoints>=before?`gains`:`loses`} ${Math.abs(p.victoryPoints-before)} VP (${before} → ${p.victoryPoints}).`);
 }
 advanceMoon(s,previousLeader);
 return p.name;
}

function advanceMoon(s:GameState,previousLeader:number) {
 const stage=s.moon??(previousLeader>=15?3:previousLeader>=5?2:1);
 s.moon=stage;
 const leader=Math.max(s.blackRose.victoryPoints,...s.players.map(player=>player.victoryPoints));
 while(s.moon<3&&leader>=(s.moon===1?5:15)) {
  const nextMoon=(s.moon+1) as 2|3;
  s.moon=nextMoon;
  for(const player of s.players) {
   if(!player.mageId)continue;
   player.mageSpellSupply??=mageSpellCopies(player.mageId).slice(1);
   const cardId=`mage-${player.mageId}-${nextMoon}`;
   const index=player.mageSpellSupply.findIndex(card=>card.id===cardId);
   if(index<0)continue;
   player.hand.push(player.mageSpellSupply.splice(index,1)[0]);
  }
  (s.moonEvents??=[]).push(nextMoon);
  s.log.push(`Entering ${nextMoon===2?'second':'third'} moon: every mage gains their next signature spell.`);
 }
}

function completeQuest(s: GameState, p: Player, kind: NonNullable<Player['quest']>['kind'], amount=1) {
 for(const quest of heldQuests(p)) {
  if(quest.kind!==kind || amount<quest.amount || quest.completed || quest.claimed)continue;
  quest.progress=quest.amount;quest.completed=true;
  s.log.push(`${p.name} completes “${quest.name}” and may spend its reward action.`);
 }
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

type QuestProgressEvent =
 | {event:'SPELL_EFFECT';spellType?:SpellType;summon?:boolean;elements?:Element[]}
 | {event:'ROOM_EFFECT';roomColor:RoomColor}
 | {event:'INSTABILITY_EFFECT'};
function progressTriggeredQuests(s:GameState,p:Player,trigger:QuestProgressEvent) {
 for(const quest of heldQuests(p)) {
  const condition=quest.trigger;
  if(!condition||condition.event!==trigger.event||quest.completed||quest.claimed)continue;
  if(condition.event==='SPELL_EFFECT'&&trigger.event==='SPELL_EFFECT') {
   if(condition.spellType&&condition.spellType!==trigger.spellType)continue;
   if(condition.summon&&!trigger.summon)continue;
    if(condition.elementGroup&&(!trigger.elements||trigger.elements.filter(element=>condition.elementGroup!.includes(element)).length<(condition.minimumElements??1)))continue;
  } else if(condition.event==='ROOM_EFFECT'&&trigger.event==='ROOM_EFFECT'&&condition.roomColor!==trigger.roomColor)continue;
  const progress=Math.min(quest.amount,(quest.progress??0)+1);
  quest.progress=progress;
  s.log.push(`${p.name} advances “${quest.name}” (${progress}/${quest.amount}).`);
  if(progress>=quest.amount) {
   quest.completed=true;
   s.log.push(`${p.name} completes “${quest.name}” and may spend its reward action.`);
  }
 }
}

/** Public target choices for the quest panel, with the same printed targeting rules as resolution. */
export function getQuestRewardTargets(s:GameState,p:Player,card:Card):FeedbackTarget[] {
 if(card.target==='ROOM')return s.board.rooms.filter(room=>!room.startingFor && room.tiles.some(h=>isWithinSpellRange(p.wizard.position,h,card.range))).map(roomFeedbackTarget);
 const models=[...s.players.map(m=>({id:m.id,name:m.name,playerId:m.id,position:m.wizard.position,kind:'MAGE' as const})),
  ...s.evocations.map(e=>({id:e.id,name:`${e.name} #${e.number??1} · ${getPlayer(s,e.assignedTo??e.playerId).name}`,playerId:e.playerId,position:e.position,kind:'EVOCATION' as const}))];
 return models.filter(model=>spellCanTargetModel(card,p.id,model.playerId,model.kind)
  && spellFilterAllows(card,p.id,{playerId:model.playerId,evocation:s.evocations.find(e=>e.id===model.id)})
  && (card.target==='SELF' || !roomAt(s,model.position)?.startingFor)
  && spellReaches(s,card,p.wizard.position,model.position))
  .map(model=>({id:model.id,name:model.name,kind:model.kind,roomId:roomAt(s,model.position)?.id}));
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
  assert(spellFilterAllows(card,p.id,target),'Quest reward cannot target this model');
  room=s.board.rooms.find(r=>r.tiles.some(h=>hexKey(h)===hexKey(target.position)));
  if (!inferSelf && room?.startingFor) assert(false,'Cannot target a model in its starting room with a quest reward');
  assert(isWithinSpellRange(p.wizard.position,target.position,card.range),'Quest reward target out of range');
  targets.push(target);
 }
 const refs=targets.map(t=>snapshot(s,t.mage?.id ?? t.evocation!.id)!);
 const actor=snapshot(s,p.id)!;
 resolveEffectMoments(s,p,card,room,refs,actor,'QUEST');
}

function drawQuest(s:GameState) {
 const quest=drawFromDiscard(s,s.questDeck,s.questDiscard);
 // A recycled physical quest starts a new objective, not an already-earned reward.
 if(quest){quest.progress=0;quest.completed=false;quest.claimed=false;}
 return quest;
}

// Runtime-only instruction context. Nothing executable, cyclic or private is
// stored in GameState; a root action remains a single clone/commit boundary.
type ModelSnapshot = { id:string; playerId:string; kind:'MAGE'|'EVOCATION'; generation:number };
// Local to a single effect, so a nested spell cannot replace its summoned model.
type EffectResolution = { casterSeen?:{position:Hex}; choices?:Record<string,string>; assigned?:string[]; eventActor?:ModelSnapshot; summoned?:ModelSnapshot; activationIsExplicit:boolean; upgraded?:boolean; removed?:{position:Hex;attack:number;roomId?:string}; eventPosition?:Hex; eventKind?:EvocationKind; damaged?:ModelSnapshot[]; blackDamaged?:Record<string,number>; moved?:ModelSnapshot; spellEvent?:SpellEvent; unconverted?:number; instabilityPlaced?:number; protectedTargets?:Set<string>; vpLost?:number; healed?:number; upgradeDiscarded?:boolean; painResolved?:boolean; trapsAtStart?:number };
type SpellEvent = { event:TriggerEvent; model?:ModelSnapshot; actor?:ModelSnapshot; roomId?:string; target?:FeedbackTarget; damageOrigin?:DamageOrigin; amount?:number; position?:Hex; kind?:EvocationKind; spellType?:Card['spellType']; sourceCard?:Card; moment?:string; prevented?:{value:boolean}; afterResolution?:()=>void };
type PendingMageDefeat = { ref:ModelSnapshot; roomId?:string; target:FeedbackTarget; source?:Player; liquefyThePain?:boolean };
type ReplayEntropy={ids:string[];random:number[]};
type InstructionContext = { generations:Map<string,number>; bindings:Map<string,ModelSnapshot>; defeats:Map<string,PendingMageDefeat>; resolutions:number; interruptId?:string; answers:DecisionAnswer[]; cursor:number; momentDepth:number; events:SpellEvent[]; entropy:ReplayEntropy; idCursor:number; randomCursor:number; suppress?:boolean; trapsTriggered?:number; resolving?:{sourceCard?:Card;moment?:string}; frames?:GameState[]; frameKey?:string };
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
 // A dark-side spell resolves from a derived face; the physical card is the printed one.
 const card=active.printed??active.card;
 if(card.powerful)s.removedCards.push(card);
 else if(revealed)getPlayer(s,active.playerId).discard.push(card);
 else discardCard(s,getPlayer(s,active.playerId),card);
}
// Total wounds a model carries from BR (black damage on a mage, BR cubes on an evocation).
function blackWounds(model:WoundedModel) {
 return Math.max(model.blackDamage??0,0)+(model.damageByPlayer[BLACK_ROSE_ID]??0);
}
// Printed amount plus 1 `each` per `per` units of the scale source (optionally capped).
function scaledAmount(s:GameState,owner:Player,step:{amount?:number;scale?:AmountScale},target?:ModelSnapshot,effect?:EffectResolution,card?:Card):number {
 const base=step.amount??0,scale=step.scale;
 if(!scale)return base;
 let count=0;
 switch(scale.from) {
  case 'CASTER_BLACK_DAMAGE':count=blackWounds(owner.wizard);break;
  case 'CASTER_DAMAGE':count=owner.wizard.damageCubes;break;
  case 'TARGET_DAMAGE':count=liveModel(s,target)?.model.damageCubes??0;break;
  case 'EVENT_AMOUNT':count=effect?.spellEvent?.amount??0;break;
  case 'DAMAGED_BLACK_DAMAGE':count=Object.values(effect?.blackDamaged??{}).reduce((total,n)=>total+n,0);break;
  case 'REVEALED_ELEMENT':count=card&&scale.element?getRevealedElements(s,owner,card).filter(element=>element===scale.element||element==='wild').length:0;break;
  case 'HEALED':count=effect?.healed??0;break;
  case 'TARGET_NIGHTMARES':{const mage=liveModel(s,target)?.mage;count=mage?nightmaresOf(s,mage.id).length:0;break;}
 }
 const extra=Math.floor(count/scale.per)*scale.each;
 return base+(scale.max===undefined?extra:Math.min(extra,scale.max));
}
// Remove the wounds that were just suffered (the most recent cubes from `sourceId`, BR when none are left).
function takeBackDamage(s:GameState,mage:Player,amount:number,sourceId:PlayerId) {
 const wizard=mage.wizard;
 const physical=sourceId===BLACK_ROSE_ID?0:Math.min(amount,wizard.damageByPlayer[sourceId]??0);
 if(physical>0) {
  removeCubes(wizard.damageByPlayer,sourceId,physical);
  const owner=s.players.find(p=>p.id===sourceId);
  if(owner){owner.cubes.available+=physical;owner.cubes.onWizard-=physical;}
 }
 const black=Math.min(amount-physical,wizard.blackDamage);
 wizard.blackDamage-=black;
 const taken=physical+black;
 wizard.damageCubes-=taken;
 if(taken>0&&wizard.damageOrder)wizard.damageOrder.splice(Math.max(0,wizard.damageOrder.length-taken),taken);
 return taken;
}
function invalidateModel(s:GameState,ref:ModelSnapshot) {
 context(s).generations.set(ref.id,ref.generation+1);
 // Defeat interrupts the Explore/Attack Effect and it never resumes; every other Effect (spells, rooms,
 // quest rewards) resumes with its remaining Moments.
 if(ref.kind==='MAGE' && s.activation?.playerId===ref.playerId && s.activation.physicalAction && !getPhysicalEffect(s.activation.physicalAction.kind,0).resumeAfterDefeat) {
  s.activation.exploring=0;
  s.activation.physicalAction=null;
  s.activation.roomEffectUsed=true;
 } else if(ref.kind==='MAGE' && s.activation?.playerId===ref.playerId) {
  // Legacy flows (e.g. Explore/Punch without a pending physical action) still stop moving.
  s.activation.exploring=0;
  s.activation.roomEffectUsed=true;
 }
 // One-shot legacy bindings expire, but ongoing cards survive defeat. Their
 // old-generation references stay invalid until the mage has actually respawned.
 for(const active of s.readiedSpells!.slice()) {
  if(context(s).bindings.get(active.id)?.id!==ref.id)continue;
  retireActiveSpell(s,active);
  s.log.push(`${active.card.name} expires with its target model.`);
 }
}
function matchesTrigger(s:GameState,active:ActiveSpell,condition:TriggerCondition,event:SpellEvent) {
 if(condition.event!==event.event)return false;
 if(condition.spellTypes&&(!event.spellType||!condition.spellTypes.includes(event.spellType)))return false;
 // Legacy in-flight Pain Marks may predate the declarative source filter.
 const damageOrigins=condition.damageOrigins??(active.card.name==='Pain Mark'&&active.card.ongoing&&condition.event==='DAMAGE_DEALT'?['MAGE_PHYSICAL','SPELL']:undefined);
 if(damageOrigins&&(!event.damageOrigin||!damageOrigins.includes(event.damageOrigin)))return false;
 if(condition.modelKind&&event.model?.kind!==condition.modelKind)return false;
 if(condition.actorKind&&event.actor?.kind!==condition.actorKind)return false;
 if(condition.modelRelation&&(!event.model||(condition.modelRelation==='SELF')!==(event.model.playerId===active.playerId)))return false;
 if(condition.roomColors) {
  const color=event.roomId?s.board.rooms.find(r=>r.id===event.roomId)?.color:undefined;
  if(!color||!condition.roomColors.includes(color))return false;
 }
 const related=condition.relationTo==='EVENT_MODEL'?event.model:event.actor;
 if(condition.relation!=='ANY' && (!related || (condition.relation==='SELF')!==(related.playerId===active.playerId)))return false;
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
   if(!room || room.startingFor || !room.tiles.some(h=>spellReaches(s,active.card,owner.wizard.position,h)))return false;
  }
  if(active.card.triggerSight!==undefined) {
   const seen=event.model?.kind==='MAGE'?liveModel(s,event.model)?.model.position:undefined;
   if(!seen||!isWithinSpellRange(owner.wizard.position,seen,active.card.triggerSight))return false;
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
  // Opt-in: snapshot the settled board so observers can show each moment.
  if(ctx.frames) {
   // A moment that changed nothing visible is not worth a frame.
   const key=JSON.stringify(s);
   if(key!==ctx.frameKey){ctx.frameKey=key;ctx.frames.push(structuredClone(s));}
  }
 }
}
function resolveInstruction(s:GameState,owner:Player,instruction:TriggeredInstruction,ref:ModelSnapshot|undefined,roomId:string|undefined,actor:ModelSnapshot|undefined,effect?:EffectResolution,damageOrigin:DamageOrigin='SPELL') {
 atMomentEnd(s,()=>resolveInstructionBody(s,owner,instruction,ref,roomId,actor,effect,damageOrigin));
}
function resolveInstructionBody(s:GameState,owner:Player,instruction:TriggeredInstruction,ref:ModelSnapshot|undefined,roomId:string|undefined,actor:ModelSnapshot|undefined,effect?:EffectResolution,damageOrigin:DamageOrigin='SPELL') {
 const target=liveModel(s,ref),room=roomId?s.board.rooms.find(r=>r.id===roomId):undefined;
 if(instruction.effect==='INSTABILITY') {
  if(room&&effect)effect.instabilityPlaced=(effect.instabilityPlaced??0)+placeInstability(s,room,instruction.amount,owner);
  else if(room)placeInstability(s,room,instruction.amount,owner);
 } else if(instruction.effect==='CONVERT' && room) {
  if(!room.scored&&!room.reconstructed)convertRoomCubes(s,owner,room,instruction.amount);
 } else if(instruction.effect==='BLACK_ROSE_CONVERT' && target && target.mage) {
  const casterScoped=instruction.scope==='CASTER'&&ref?.id===actor?.id&&ref?.playerId===owner.id;
  convertRecentDamageToBlackRose(s,owner,target.mage,instruction.amount,modelFeedbackTarget(s,ref)!,casterScoped);
 } else if(instruction.effect==='PAIN') {
  damage(s,owner,instruction.amount);
 } else if(instruction.effect==='SUMMON') {
  const kind=resolveSummonKind(s,owner,instruction,effect);
  const position=instruction.position==='EVENT'?effect?.eventPosition:instruction.position==='TARGET'?target?.model.position??room?.tiles[0]:owner.wizard.position;
  if(!position||!kind)return;
  summonForEffect(s,owner,kind,position,effect);
 } else if(instruction.effect==='ACTIVATE_CHOICE') {
  activateChoice(s,owner,instruction,'Reaction',target?.model.position);
 } else if(instruction.effect==='ACTIVATE_EVOCATION') {
  activateEffectSummon(s,owner,instruction.kind,effect);
 } else if(instruction.effect==='ASSIGN_UPGRADE') {
  const evocation=instruction.to==='SUMMONED'?liveModel(s,effect?.summoned)?.evocation:target?.evocation;
  const done=assignUpgrade(s,evocation,instruction.upgrade,owner);
  if(effect)effect.upgraded=done;
 } else if(instruction.effect==='MOVE_TARGET') {
  // Reactive movement of the bound model (e.g. a model that just entered the owner's room).
  const source=context(s).resolving?.sourceCard;
  if(target&&ref&&source&&(target.mage||instruction.models))chooseMove(s,owner,source,ref,instruction.distance);
 } else if(instruction.effect==='ACTIVATE_NIGHTMARES'&&instruction.of==='TARGET') {
  // Recurring Nightmare: every Nightmare assigned to the bound mage activates under the owner's control.
  const mage=target?.mage;
  const list=mage?nightmaresOf(s,mage.id):[];
  if(!list.length)s.log.push('No Nightmare to activate.');
  for(const umbra of list)activateNightmare(s,umbra,owner,instruction.attackBonus??0);
 } else if(instruction.effect==='STEAL_CROWN_OR_VP') {
  // Persecution: take the first player token; a mage that does not hold it loses victory points instead.
  const mage=target?.mage;
  if(!mage||mage.id===owner.id)return;
  if(s.firstPlayerId===mage.id){s.firstPlayerId=owner.id;s.log.push(`${owner.name} steals the first player token from ${mage.name}.`);}
  else stealVictoryPoints(s,owner,mage,instruction.amount);
 } else if(instruction.effect==='ACTIVATE_TARGET'||instruction.effect==='REMOVE_EVOCATION'||instruction.effect==='REMOVED_BLAST'||instruction.effect==='LOOK_LIBRARY'||instruction.effect==='ACTIVATE_ROOM'||instruction.effect==='ATTACK_BONUS'||instruction.effect==='MOVE_DAMAGED'||instruction.effect==='LOSE_VP'||instruction.effect==='ASSIGN_NIGHTMARE'||instruction.effect==='ASSIGN_PER_EVENT'||instruction.effect==='ACTIVATE_NIGHTMARES'||instruction.effect==='REASSIGN_NIGHTMARES'||instruction.effect==='STEAL_VP'||instruction.effect==='FIRST_PLAYER'||instruction.effect==='DISCARD_CARDS'||instruction.effect==='ACTIVATE_ROOM_IF_NIGHTMARE'||instruction.effect==='INSTABILITY_PER_NIGHTMARE'||instruction.effect==='DRAW_EVENT'||instruction.effect==='GAIN_VP_PER_NIGHTMARE'||instruction.effect==='MOVE_ROOM_MAGE'||instruction.effect==='GAIN_VP_PER_TRAP'||instruction.effect==='DEFEAT_TARGET'||instruction.effect==='DRAW_QUESTS_PER_NIGHTMARE') {
  // Spell moments only; triggered instructions never use these.
 } else if(instruction.effect==='PREVENT_SPELL') {
  if(effect?.spellEvent?.prevented)effect.spellEvent.prevented.value=true;
 } else if(instruction.effect==='BLACK_ROSE_ALTAR_TITHE') {
  const altars=s.evocations.filter(e=>e.playerId===owner.id&&e.archetype==='ALTAR'&&e.damageCubes<e.health);
  if(!altars.length)return;
  const selected=askChoice(s,owner.id,`channeling-energy|${owner.id}|${effect?.spellEvent?.event??''}`,
   'Channeling Energy: allow the Black Rose to damage one of your Altars for 1 VP?',altars.map(e=>({id:e.id,label:`${e.name} #${e.number??1}`})),true);
  const altar=altars.find(e=>e.id===selected);
  if(altar) {
   const before=altar.damageCubes;
   damageEvocation(s,altar,1);
   if(altar.damageCubes>before)awardVictoryPoints(s,BLACK_ROSE_ID,1);
  }
 } else if(instruction.effect==='GAIN_VP') {
  if(instruction.amount<=0)return;
  awardVictoryPoints(s,owner.id,instruction.amount);
  s.log.push(`${owner.name} gains ${instruction.amount} VP.`);
 } else if(instruction.effect==='REDIRECT_DAMAGE') {
  // Pain Mark: one of the owner's evocations suffers the wounds just inflicted on the mage instead.
  const event=effect?.spellEvent;
  if(!target?.mage||target.mage.id!==owner.id||!event?.amount)return;
  const options=s.evocations.filter(e=>e.playerId===owner.id&&!isNightmare(e)&&e.damageCubes<e.health);
  if(!options.length)return;
  const chosen=askChoice(s,owner.id,`pain-mark|${owner.id}|${event.amount}`,`Pain Mark: let one of your evocations suffer ${event.amount} damage instead of ${owner.name}?`,
   options.map(e=>({id:e.id,label:`${e.name} #${e.number??1} (${e.health-e.damageCubes} health left)`})),true);
  const taker=options.find(e=>e.id===chosen);
  if(!taker)return;
  const culprit=event.actor?s.players.find(p=>p.id===event.actor!.playerId):undefined;
  const taken=takeBackDamage(s,owner,event.amount,culprit?.id??BLACK_ROSE_ID);
  if(taken<=0)return;
  s.log.push(`Pain Mark: ${taker.name} #${taker.number??1} suffers ${taken} damage instead of ${owner.name}.`);
  appendFeedback(s,{kind:'HEAL',target:modelFeedbackTarget(s,ref)!,sourceId:owner.id,amount:taken});
  // Transferred wounds are not inflicted again: no source (no cubes, no DAMAGE_DEALT or on-inflict triggers),
  // but the actor stays on the DAMAGE_TAKEN event for reactions to the evocation's wounds.
  damageEvocation(s,taker,taken,undefined,event.actor,event.damageOrigin??'NEUTRAL');
 } else if(instruction.effect==='IGNORE_DAMAGE') {
  // Persecution: heal the wounds just suffered, then return each ignored point to the damage's source.
  if(!target?.mage)return;
  const before=target.model.damageCubes;
  healModel(s,target.model,target.location,instruction.amount,owner.id,modelFeedbackTarget(s,ref)!);
  const ignored=before-target.model.damageCubes,culprit=effect?.eventActor;
  if(ignored>0&&culprit)resolveInstruction(s,owner,{effect:'DAMAGE',amount:ignored,target:'EVENT_ACTOR'},culprit,undefined,actor,effect,'SPELL');
 } else if(room && (instruction.effect==='DAMAGE' || instruction.effect==='HEAL')) {
  const refs=[...s.players.filter(p=>inRoom(p,room)).map(p=>snapshot(s,p.id)!),...s.evocations.filter(e=>room.tiles.some(h=>hexKey(h)===hexKey(e.position))).map(e=>snapshot(s,e.id)!)];
  for(const model of refs)if(!effect?.protectedTargets?.has(model.id))resolveInstruction(s,owner,instruction,model,undefined,actor,effect,damageOrigin);
 } else if(target) {
  if(effect?.protectedTargets?.has(ref!.id))return;
  switch(instruction.effect) {
   case 'DAMAGE':
    if(ref!.playerId===owner.id)break;
    {
    const wounds=target.model.damageCubes;
    if(target.mage) {
      const dealActor = ref && actor && ref.id === actor.id && instruction.target === 'EVENT_ACTOR' ? null : actor;
      damage(s,target.mage,instruction.amount,owner,dealActor,damageOrigin);
    }
    else damageEvocation(s,target.evocation!,instruction.amount,owner,actor,damageOrigin);
    // Remember who suffered, for "each model that suffered damage from this effect".
    if(effect&&target.model.damageCubes>wounds&&!effect.damaged?.some(d=>d.id===ref!.id))(effect.damaged??=[]).push(ref!);
    if(effect&&target.model.damageCubes>wounds)(effect.blackDamaged??={})[ref!.id]=blackWounds(target.model);
    }
    break;
  case 'HEAL': {
   const before=target.model.damageCubes;
   healDamageWithChoice(s,owner,target.model,target.location,instruction.amount,modelFeedbackTarget(s,ref)!);
   if(effect)effect.healed=(effect.healed??0)+Math.max(0,before-target.model.damageCubes);
   break;
  }
  case 'CONVERT':
    // Damage can be converted on the caster's own mage, but not on friendly evocations.
    if(ref!.playerId===owner.id&&!target.mage)break;
   {
   const converted=convertDamageWithChoice(s,owner,target.model,target.location,instruction.amount,modelFeedbackTarget(s,ref)!);
   if(effect)effect.unconverted=Math.max(0,instruction.amount-converted);
   }
   break;
  }
 }
}
function emitEvent(s:GameState,event:SpellEvent) {
 const resolving=context(s).resolving;
 const frozen={...event,...(!event.sourceCard&&resolving?.sourceCard?{sourceCard:resolving.sourceCard}:{}),...(!event.moment&&resolving?.moment?{moment:resolving.moment}:{}),target:event.target??modelFeedbackTarget(s,event.model)??modelFeedbackTarget(s,event.actor)};
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
 if(event.event==='EVOCATION_LOST'&&s.phase==='ACTION'&&event.roomId&&hasActiveEvent(s,'PUPPETEER')) {
  const room=s.board.rooms.find(candidate=>candidate.id===event.roomId);
  if(room)placeInstability(s,room,1);
 }
 event.afterResolution?.();
}
function reactiveTargets(s:GameState,active:ActiveSpell,event:SpellEvent):FeedbackTarget[] {
 const owner=getPlayer(s,active.playerId),card=active.card;
 if(card.target==='ROOM')return s.board.rooms.filter(r=>!r.startingFor && (!card.triggerTarget || card.triggerTarget==='EVENT_ROOM' && r.id===event.roomId) && r.tiles.some(h=>isWithinSpellRange(owner.wizard.position,h,card.range))).map(roomFeedbackTarget);
 if(card.triggerTarget==='EVENT_ROOM')return [];
 if(card.targetFrom==='EVENT_MODEL') {
  const from=liveModel(s,event.model)?.model.position;
  if(!from)return [];
  return s.evocations.filter(e=>isWithinSpellRange(from,e.position,card.range)&&!roomAt(s,e.position)?.startingFor&&spellCanTargetModel(card,owner.id,e.playerId,'EVOCATION')).map(e=>modelFeedbackTarget(s,snapshot(s,e.id))!);
 }
 const forced=card.triggerTarget==='EVENT_ACTOR'?event.actor:event.model;
 const refs=card.triggerTarget?(forced?[forced]:[]):[...s.players.filter(p=>p.wizard.alive).map(p=>snapshot(s,p.id)!),...s.evocations.map(e=>snapshot(s,e.id)!)];
 return refs.filter(ref=>{
  const model=liveModel(s,ref);if(!model)return false;
  const room=roomAt(s,model.model.position);
  return !room?.startingFor && spellCanTargetModel(card,owner.id,ref.playerId,ref.kind) && spellReaches(s,card,owner.wizard.position,model.model.position);
 }).map(ref=>modelFeedbackTarget(s,ref)!);
}
function chooseReactiveSpell(s:GameState,owner:Player,eligible:ActiveSpell[],event:SpellEvent) {
 const options=eligible.map(active=>({activeSpellId:active.id,card:active.card,targets:reactiveTargets(s,active,event)})).filter(option=>option.targets.length);
 if(!options.length)return;
 const ctx=context(s),key=`reactive|${event.event}|${owner.id}|${event.model?.id??event.roomId??''}|${ctx.cursor}`;
 const answer=ctx.answers[ctx.cursor];
 if(answer?.key===key){ctx.cursor++;return answer.accept?answer:undefined;}
 const actor=modelFeedbackTarget(s,event.actor),model=modelFeedbackTarget(s,event.model),room=event.roomId?s.board.rooms.find(r=>r.id===event.roomId):undefined;
 const card=event.sourceCard??ctx.resolving?.sourceCard;
 let summary:string;
 switch(event.event) {
  case 'SPELL_CAST':summary=`${actor?.name??'A mage'} casts ${card?.name??'a spell'}.`;break;
  case 'ENTER_ROOM':summary=`${model?.name??actor?.name??'A model'} enters ${room?.name??'a room'}.`;break;
  case 'ROOM_ACTIVATED': {
   const effect=room?getRoomEffect(room):null;
   summary=`${actor?.name??'A mage'} activates ${room?.name??'a room'}${effect?`: ${ROOM_EFFECT_LABELS[effect]}`:''}.`;break;
  }
  case 'DAMAGE_TAKEN':summary=card?`${actor?.name??'An effect'} resolves ${card.name} against ${model?.name??'a model'}.`:`${actor?.name??'The Black Rose'} deals damage to ${model?.name??'a model'}.`;break;
  case 'DAMAGE_DEALT':summary=`${actor?.name??'A model'} deals damage${event.target&&event.target.id!==actor?.id?` to ${event.target.name}`:''}.`;break;
  case 'MAGE_ATTACK':case 'EVOCATION_ATTACK':summary=`${actor?.name??'A model'} attacks ${model?.name??'a target'}.`;break;
  default:summary=`${actor?.name??model?.name??'A model'} resolves ${event.event.toLowerCase().replace(/_/g,' ')}.`;
 }
 throw new DecisionNeeded({kind:'REACTIVE_SPELL',playerId:owner.id,key,event:event.event,recap:{summary,...(card?{sourceCard:card}:{}),...(event.moment??ctx.resolving?.moment?{moment:event.moment??ctx.resolving?.moment}:{})},options},ctx.answers.slice(0,ctx.cursor));
}
function resolveEvent(s:GameState,event:SpellEvent) {
 // Enhanced Athanor Eruption: Traps and Protections do not trigger while it resolves.
 if(context(s).suppress)return;
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
  if(active.card.ongoing&&(active.targetPlayerId||active.targetEvocationId)&&!bound)continue;
  if(bound&&!liveModel(s,bound))continue;
  assert(++context(s).resolutions<=128,'Reactive spell resolution limit exceeded (128); root action cancelled');
  const ongoing=s.ongoingSpells!.some(a=>a.id===active.id);
  if(event.event==='MAGE_DEFEATED'&&active.card.name==='Liquefy the Pain'&&!active.printed&&event.model) {
   const defeat=context(s).defeats.get(event.model.id);
   if(defeat)defeat.liquefyThePain=true;
  }
  // Remove a one-shot BEFORE any nested effects; reveal/discard is physical.
  if(!ongoing)retireActiveSpell(s,active);
  s.log.push(`Interrupt ${event.event}: ${owner.name} ${ongoing?'reacts with':'reveals'} ${active.card.name}.`);
  recordRecapCard(s,'TRIGGERED',owner.id,active.printed??active.card,event.event,active.side);
  // A model binding wins over the incidental room binding stored on model spells.
  // Event targets/rooms are public only now, after the canonical reveal above.
  const roomId=selectedRoom?.id??modelFeedbackTarget(s,selectedRef)?.roomId??event.roomId??eventTarget?.roomId??active.roomId;
  const room=roomId?s.board.rooms.find(r=>r.id===roomId):undefined;
  const target=modelFeedbackTarget(s,bound)??(selectedRoom?roomFeedbackTarget(selectedRoom):eventTarget)??(room?roomFeedbackTarget(room):undefined);
  const instructions=ongoing?active.card.ongoing!.effects:active.card.triggerEffects??[];
  const trigger=appendFeedback(s,{kind:'SPELL_TRIGGERED',activeSpellId:active.id,ownerId:owner.id,
   cardName:active.card.name,spellType:getSpellType(active.card),trigger:event.event,ongoing,
  effects:[...(!ongoing&&isUnstable(active.card)?[describeInstruction(PRINTED_INSTABILITY)]:[]),...(!ongoing&&getMainMoments(active.card).length?getMainMoments(active.card).map(step=>describeInstruction({...step,target:active.card.target==='ROOM'?'BOUND_ROOM':'BOUND_MODEL'})):instructions.map(describeInstruction))],...(target?{target}:{}),...(roomId?{roomId}:{})});
  const ownerRef=snapshot(s,owner.id);
  const isTrap=!ongoing&&getSpellType(active.card)==='TRAP';
  if(isTrap)context(s).trapsTriggered=(context(s).trapsTriggered??0)+1;
  const previousInterruptId=context(s).interruptId;
  context(s).interruptId=trigger.id;
  try {
    // A Trap targets every enemy model it resolves against; Protections may ignore that.
    const trapProtected=new Set<string>();
    if(isTrap) {
     const affected=bound?[bound]:room?roomOccupants(s,room):[];
     for(const model of affected) {
      if(model.playerId===owner.id||!liveModel(s,model))continue;
      const prevented={value:false};
      emitEvent(s,{event:'SPELL_TARGETED',actor:ownerRef,model,roomId:modelFeedbackTarget(s,model)?.roomId,spellType:'TRAP',sourceCard:active.card,prevented});
      if(prevented.value)trapProtected.add(model.id);
     }
    }
    if(!ongoing && getMainMoments(active.card).length) {
     const refs=selectedRef?[selectedRef]:selectedRoom?[...s.players.filter(p=>inRoom(p,selectedRoom)).map(p=>snapshot(s,p.id)!),...s.evocations.filter(e=>selectedRoom.tiles.some(h=>hexKey(h)===hexKey(e.position))).map(e=>snapshot(s,e.id)!)]:[];
     const preventMain=active.card.target!=='ROOM'&&refs.length===1&&trapProtected.has(refs[0].id);
     resolveEffectMoments(s,owner,active.card,selectedRoom??room,refs,ownerRef!,'SPELL',trapProtected,preventMain,event);
    } else {
   const effect:EffectResolution={activationIsExplicit:instructions.some(step=>step.effect==='ACTIVATE_EVOCATION'),eventPosition:event.position,eventKind:event.kind,eventActor:event.actor,spellEvent:event};
  if(!ongoing&&isUnstable(active.card)) {
   const effects=1+(instructions.length?1:0);
   resolveInstabilityEffect(s,owner,active.card,ownerRef,effects,{position:{...owner.wizard.position}});
   if(instructions.length)s.log.push(`Effect 2/${effects} · ${active.card.name}: main effect.`);
  }
  const protectedTargets=new Set<string>(trapProtected);
  const spellTargets=ongoing&&getSpellType(active.card)==='COMBAT'&&instructions.some(step=>step.effect==='DAMAGE')
   ?bound?[bound]:room?roomOccupants(s,room).map(model=>snapshot(s,model.id)!):[]
   :[];
  for(const protectedTarget of spellTargets) {
   const prevented={value:false};
   emitEvent(s,{event:'SPELL_TARGETED',actor:ownerRef,model:protectedTarget,roomId:modelFeedbackTarget(s,protectedTarget)?.roomId,spellType:'COMBAT',prevented});
   if(prevented.value)protectedTargets.add(protectedTarget.id);
  }
  if(protectedTargets.size)effect.protectedTargets=protectedTargets;
  const ongoingPrevented=!!bound&&protectedTargets.has(bound.id);
  if(ongoingPrevented)s.log.push(`${active.card.name}: its effect on ${modelFeedbackTarget(s,bound!)!.name} is ignored.`);
  for(const [index,instruction] of (ongoingPrevented?[]:instructions).entries()) {
   // Choose-one group: the owner picks an option when the group is first reached; other options are skipped.
   if(instruction.choose) {
    const {group,option}=instruction.choose;
    let picked=effect.choices?.[group];
    if(picked===undefined) {
     const options=[...new Map(instructions.filter(step=>step.choose?.group===group).map(step=>[step.choose!.option,step.choose!] as const)).values()];
     picked=options.length===1?options[0].option:askChoice(s,owner.id,`choose|${owner.id}|${active.id}|${group}`,`${active.card.name}: choose one.`,options.map(o=>({id:o.option,label:o.label})))!;
     (effect.choices??={})[group]=picked;
    }
    if(picked!==option)continue;
   }
   s.log.push(`Moment ${index+1}/${instructions.length} · ${active.card.name}: ${describeInstruction(instruction)}`);
    const ctx=context(s),previous=ctx.resolving;ctx.resolving={sourceCard:active.card,moment:describeInstruction(instruction)};
    let ref:ModelSnapshot|undefined,roomId:string|undefined;
    switch(instruction.target) {
     case 'BOUND_MODEL':ref=bound;break;
    case 'BOUND_ROOM':roomId=selectedRoom?.id??active.roomId;break;
     case 'EVENT_MODEL':ref=event.model;break;
     case 'EVENT_ACTOR':ref=event.actor;break;
     case 'EVENT_ROOM':roomId=event.roomId;break;
     case 'OWNER':ref=ownerRef;break;
    }
    if(instruction.effect==='INSTABILITY'&&instruction.scope==='CASTER_ROOM')roomId=roomAt(s,owner.wizard.position)?.id;
    if(instruction.effect==='SUMMON'&&instruction.position==='TARGET'&&!liveModel(s,ref))roomId??=room?.id;
    const resolved:TriggeredInstruction=instruction.scale?{...instruction,amount:scaledAmount(s,owner,instruction,ref,effect,active.card)} as TriggeredInstruction:instruction;
    if(instruction.scale&&'amount' in resolved&&(resolved.amount??0)<=0){
     s.log.push(`${active.card.name}: nothing to apply.`);ctx.resolving=previous;continue;
    }
    try{resolveInstruction(s,owner,resolved,ref,roomId,ownerRef,effect);}finally{ctx.resolving=previous;}
     }
     if(!ongoingPrevented&&instructions.length) {
    if((effect.instabilityPlaced??0)>0)progressTriggeredQuests(s,owner,{event:'INSTABILITY_EFFECT'});
      const elements=getRevealedElements(s,owner,active.card);
      if(active.card.element)elements.push(active.card.element);
      progressTriggeredQuests(s,owner,{event:'SPELL_EFFECT',spellType:getSpellType(active.card),summon:!!effect.summoned,elements});
     }
    }
  } finally { context(s).interruptId=previousInterruptId; }
  s.log.push(`Resume ${event.event} after ${active.card.name}.`);
 }
   }
}
function amountLabel(instruction:{amount?:number;scale?:AmountScale},unit:string):string {
 const scale=instruction.scale,base=instruction.amount??0;
 if(!scale)return `${base} ${unit}`;
 const sources:Record<AmountScale['from'],string>={CASTER_BLACK_DAMAGE:'BR damage on the caster’s mage',CASTER_DAMAGE:'damage on the caster’s mage',TARGET_DAMAGE:'damage on the target',EVENT_AMOUNT:'damage suffered',DAMAGED_BLACK_DAMAGE:'BR damage on the models damaged by this effect',REVEALED_ELEMENT:`${scale.element??'matching'} symbol (or wild) on the caster’s other revealed spells`,HEALED:'damage healed by this effect',TARGET_NIGHTMARES:'Nightmare assigned to the target'};
 const source=sources[scale.from];
 return `${base>0?`${base} plus `:''}${scale.each} ${unit} for each ${scale.per>1?`${scale.per} `:''}${source}${scale.max!==undefined?` (up to ${scale.max} in total)`:''}`;
}
function describeInstruction(instruction:TriggeredInstruction):string {
 const text=describeInstructionBody(instruction);
 return instruction.choose?`If you choose “${instruction.choose.label}”: ${text}`:text;
}
function describeInstructionBody(instruction:TriggeredInstruction):string {
 const targets:Record<TriggeredInstruction['target'],string>={BOUND_MODEL:'the target model',BOUND_ROOM:'the bound room',EVENT_MODEL:'the triggering model',EVENT_ACTOR:'the acting model',EVENT_ROOM:'the triggering room',OWNER:'the owner’s mage'};
 const target=instruction.scope==='CASTER'?'the caster’s mage':instruction.scope==='ALL_MAGES'?'each mage':instruction.scope==='DAMAGED'?'each model damaged by this effect':instruction.scope==='CASTER_ROOM'?(instruction.effect==='INSTABILITY'?'the caster’s room':instruction.effect==='DAMAGE'?'enemy models in the caster’s room':'every model in the caster’s room'):instruction.effect==='DAMAGE'&&instruction.target==='BOUND_ROOM'?'enemy models in the selected room':targets[instruction.target];
 switch(instruction.effect) {
  case 'DAMAGE':return `${instruction.when==='TARGET_DEFEATED'?'If the target is defeated: d':'D'}eal ${amountLabel(instruction,'damage')} to ${instruction.area?`${instruction.area.choose?'one different model':'each other mage'} within range ${instruction.area.range} of the target’s position`:target}.`;
  case 'HEAL':return `Heal up to ${instruction.amount} ${instruction.amount===1?'wound':'wounds'} on ${target}.`;
  case 'CONVERT':return `Convert up to ${instruction.amount} ${instruction.amount===1?'cube':'cubes'} on ${instruction.scope==='TARGET_ROOM'?'every model in the target room':target} to the owner’s color.`;
  case 'BLACK_ROSE_CONVERT':return `Convert the last ${instruction.amount} damage cubes received from other mages on ${target} to BR black${instruction.scope==='CASTER'?'':' (ignored on friendly models)'}.`;
  case 'INSTABILITY':return `Place up to ${amountLabel(instruction,'instability')} in ${target}.`;
  case 'PAIN':return `${instruction.optional?'You may let ':''}BR inflict${instruction.optional?'':'s'} ${amountLabel(instruction,instruction.amount===1&&!instruction.scale?'damage cube':'damage cubes')} on the resolving mage.`;
  case 'SUMMON':return `Summon ${instruction.kind==='EVENT_MODEL'?'the lost model':instruction.kind==='CHOICE'?`an evocation of your choice${instruction.maxHealth!==undefined?` with at most ${instruction.maxHealth} health`:''}`:`a ${EVOCATION_TYPES[instruction.kind].name}`} ${instruction.position==='TARGET'?'in the target’s room':instruction.position==='EVENT'?'where it stood':instruction.position==='REMOVED'?'in the same room':instruction.position==='CHOICE'?'in a room of your choice':'at the owner’s position'}${instruction.kind==='SUCCUBUS'?' and activate it':''}.`;
  case 'ACTIVATE_EVOCATION':return `Activate the summoned ${instruction.kind==='EVENT_MODEL'?'model':EVOCATION_TYPES[instruction.kind].name}: move and attack in either order, or use only one, without spending another action or token.`;
  case 'ACTIVATE_TARGET':return 'Activate the chosen evocation under your control: it takes your color, may attack its owner, and you and your evocations are immune to that damage.';
  case 'ASSIGN_UPGRADE':return `Assign ${instruction.upgrade==='RANDOM'?'a random upgrade':instruction.upgrade==='CHOICE'?'an upgrade of your choice':UPGRADE_LABELS[instruction.upgrade]} to ${instruction.to==='SUMMONED'?'the summoned model':'the chosen evocation'}; the owner keeps one if it already has an upgrade.`;
  case 'DISCARD_UPGRADE':return 'The chosen evocation discards its upgrade and loses the health it gave.';
  case 'REMOVE_EVOCATION':return instruction.chosen?'Remove the chosen evocation.':`You may remove one of your ${instruction.archetype==='UNDEAD'?'undead ':instruction.archetype==='CONSTRUCT'?'construct ':''}evocations in the target’s room.`;
  case 'REMOVED_BLAST':return instruction.amount!==undefined?`Inflict ${instruction.amount} damage on every ${instruction.models?'model':'mage'} in the removed model’s room and up to 1 room away.`:'Inflict damage equal to the removed model’s attack on every mage in its room and up to 1 room away.';
  case 'LOSE_VP':return `${targets[instruction.target]} loses ${instruction.amount} victory ${instruction.amount===1?'point':'points'} (never below zero).`;
  case 'ATTACK_BONUS':return `The chosen evocation gets +${instruction.amount} attack on its next activation.`;
  case 'MOVE_DAMAGED':return `Move one model damaged by this effect up to ${instruction.distance} ${instruction.distance===1?'space':'spaces'}.`;
  case 'ACTIVATE_ROOM':return 'Activate the room effect where the chosen evocation stands.';
  case 'ACTIVATE_CHOICE':return `Activate one of your ${instruction.archetype==='CONSTRUCT'?'constructs':instruction.archetype==='UNDEAD'?'undead evocations':'evocations'}${instruction.attackBonus?` with +${instruction.attackBonus} attack`:''}${instruction.movementBonus?`${instruction.attackBonus?' and':' with'} +${instruction.movementBonus} movement`:''}${instruction.endDamage?`; when it ends BR inflicts ${instruction.endDamage} damage on it`:''}${instruction.near?` (only one within range ${instruction.near.range} of ${target})`:''}.`;
  case 'LOOK_LIBRARY':return `Look at ${instruction.cards} cards of one school, take 1 and discard the rest.`;
  case 'SEARCH_GRIMOIRE':return instruction.keyword==='SUMMON'?'Search your grimoire for a card with the Summon keyword, draw it, then shuffle it.':'Search your grimoire, draw one card, then shuffle it.';
  case 'DRAW_SCHOOL':return `Draw ${instruction.amount} card${instruction.amount===1?'':'s'} from any shared school.`;
  case 'RETURN_REVEALED':return `Return a revealed ${instruction.elements.map(element=>element[0].toUpperCase()+element.slice(1)).join(' or ')} spell to your hand.`;
  case 'IF_UNWOUNDED':return `If you have no damage, draw ${instruction.draw}; otherwise heal ${instruction.otherwiseHeal}.`;
  case 'MOVE_TARGET':return `Move ${target} up to ${instruction.distance} ${instruction.distance===1?'space':'spaces'}${instruction.models?' (mage or evocation)':''}.`;
  case 'ASSIGN_NIGHTMARE':return `Assign ${instruction.count??1} Umbra${(instruction.count??1)===1?'':'s'} to ${instruction.scope==='TARGET_ROOM'?`each ${instruction.others?'other ':''}mage in the target room`:target}; you choose each Umbra’s evocation slot.`;
  case 'ASSIGN_PER_EVENT':return 'For each event on the event board, assign an Umbra to a mage of your choice.';
  case 'MOVE_ROOM_MAGE':return `Choose a mage in the target room and move it up to ${instruction.distance} ${instruction.distance===1?'space':'spaces'}.`;
  case 'GAIN_VP_PER_TRAP':return 'Gain 1 victory point for each Trap triggered during this effect.';
  case 'STEAL_CROWN_OR_VP':return `Steal the first player token from ${targets[instruction.target]}; if it does not hold it, steal ${instruction.amount} victory ${instruction.amount===1?'point':'points'} from it instead.`;
  case 'DEFEAT_TARGET':return `Defeat ${target}.`;
  case 'DRAW_QUESTS_PER_NIGHTMARE':return 'Draw 1 quest for each Nightmare in the game, then discard one of the quests just drawn.';
  case 'ACTIVATE_NIGHTMARES':return `Activate ${instruction.of==='ASSIGNED'?'the Umbra just assigned':instruction.of==='ALL'?'each Nightmare in the game':'each Nightmare assigned to the target'} under your control${instruction.attackBonus?` with +${instruction.attackBonus} attack`:''}.`;
  case 'REASSIGN_NIGHTMARES':return 'Reassign every other Umbra to the target.';
  case 'STEAL_VP':return `Steal ${instruction.amount} victory ${instruction.amount===1?'point':'points'} from ${target}.`;
  case 'FIRST_PLAYER':return `${target} gets the first player token.`;
  case 'DISCARD_CARDS':return `${target} discards ${instruction.amount} cards${instruction.stealVp?'; steal 1 victory point for each it cannot discard':''}.`;
  case 'ACTIVATE_ROOM_IF_NIGHTMARE':return 'If a Nightmare is in the target room, activate that room even if it was already used.';
  case 'INSTABILITY_PER_NIGHTMARE':return 'Place 1 instability in the target room for each Nightmare in it.';
  case 'DRAW_EVENT':return 'Draw a new event.';
  case 'GAIN_VP_PER_NIGHTMARE':return `Gain 1 victory point for each Nightmare in the game, up to ${instruction.max}.`;
  case 'GAIN_VP':return `Gain ${amountLabel(instruction,'VP')}.`;
  case 'REDIRECT_DAMAGE':return 'One of your evocations may suffer the damage just inflicted on you instead.';
  case 'GAIN_VP_PER_ALTAR':return `Gain 1 VP for each Altar in play, up to ${instruction.max}.`;
  case 'COMPLETE_QUEST':return 'Choose an active quest and lose VP equal to the moon level to complete it.';
  case 'RESHUFFLE_DRAW':return `Shuffle your discard into your grimoire, choose ${instruction.amount} cards from it, then shuffle your grimoire.`;
  case 'DRAW_QUEST':return 'Draw 1 quest.';
  case 'ACTIVATE_TARGET_ROOM':return instruction.used?'Activate that room, even if it was already used.':'Activate the target room.';
  case 'ASSIGN_JINX':return instruction.jinx==='CHOICE'?`Assign a jinx of your choice to ${target}.`:`Assign ${JINX_LABELS[instruction.jinx]} to ${target}.`;
  case 'DISCARD_QUEST_OR_JINX':return 'Discard one active quest or one jinx of yours.';
  case 'DRAW_SPELLS':return `Draw ${instruction.amount} spells.`;
  case 'INSTABILITY_PER_UNCONVERTED':return 'Place 1 instability in the target\u2019s room for each damage cube you could not convert.';
  case 'INSTABILITY_PER_JINX':return 'Place 1 instability in the target\u2019s room for each jinx it carries.';
  case 'LOSE_VP_OR_PREVENT':return `${target} loses ${instruction.amount} VP, or you ignore that spell effect.`;
  case 'MOVE_MODEL':return `Move any model to a room within range ${instruction.distance} of the target room.`;
  case 'PLACE_ALTAR_CUBES':return 'Place cubes in the target room equal to the number of Altars in play.';
  case 'PREVENT_SPELL':return 'Ignore that spell effect.';
  case 'BLACK_ROSE_ALTAR_TITHE':return 'You may let the Black Rose inflict 1 damage on one of your Altars to gain 1 VP.';
  case 'IGNORE_DAMAGE':return `Ignore up to ${instruction.amount} of that damage; inflict 1 damage on the source for each point ignored.`;
 }
}
function modelEvent(s:GameState,event:TriggerEvent,ref:ModelSnapshot,actor=ref,roomId?:string,damageOrigin?:DamageOrigin,target?:FeedbackTarget) {
 const model=liveModel(s,ref);
 emitEvent(s,{event,model:ref,actor,roomId:roomId??(model?roomAt(s,model.model.position)?.id:undefined),damageOrigin,target});
}
function moveModel(s:GameState,ref:ModelSnapshot,destination:Hex) {
 const target=liveModel(s,ref);if(!target)return;
 const from=roomAt(s,target.model.position)?.id;
 target.model.position={...destination};
 if(target.mage)syncNightmares(s,target.mage.id);
 if(target.mage&&s.activation?.playerId===target.mage.id&&!isInStartingRoom(s,target.mage))delete s.activation.mustExitCell;
 const to=roomAt(s,destination)?.id;
 if(target.mage&&roomAt(s,destination)?.startingFor===target.mage.id)onMagePlacedInCell(s,target.mage);
 if(to && from!==to)modelEvent(s,'ENTER_ROOM',ref,ref,to);
 if(to && from!==to && target.mage)entryShock(s,target.mage.id);
}
// While another mage controls an evocation (borrowed activation, including suspended ones), its owner
// cannot use its abilities (Entry shock, Soul tithe) or activate it again.
function isControlledByOther(s:GameState,e:Evocation):boolean {
 for(let a:GameState['evocationActivation']|undefined=s.evocationActivation;a;a=a.resume?.evocationActivation)
  if(a.evocationId===e.id&&a.playerId!==e.playerId)return true;
 return false;
}
// Colossus Entry shock: any mage that ends up in a room with an enemy Colossus (walked, discarded to exit,
// respawned or relocated by an effect) takes 3. Never the owner, other summons, or the Colossus's own moves.
// Re-read the mage's current position: reactions to the entry may already have moved or defeated it.
function entryShock(s:GameState,mageId:string) {
 const mage=s.players.find(p=>p.id===mageId);if(!mage||!mage.wizard.alive)return;
 for(const e of s.evocations.filter(x=>x.ability==='ENTRY_SHOCK'&&x.playerId!==mage.id&&!isControlledByOther(s,x)&&areInSameRoom(s,x.position,mage.wizard.position))) {
  if(!s.evocations.includes(e))continue;
  resolveInstruction(s,getPlayer(s,e.playerId),{effect:'DAMAGE',amount:3,target:'EVENT_MODEL'},snapshot(s,mage.id),undefined,snapshot(s,e.id),undefined,'EVOCATION');
 }
}

// Thrown from deep inside resolution when a mage must answer; applyAction turns it
// into a pendingDecision and replays the whole root action once answered.
class DecisionNeeded extends Error {
 constructor(readonly decision:DecisionDetails,readonly answers:DecisionAnswer[]) {super('Decision needed');}
}

function askChoice(s:GameState,playerId:PlayerId,keyBase:string,prompt:string,options:Array<{id:string;label:string;roomId?:string}>,optional=false):string|undefined {
 const ctx=context(s),key=`choice|${keyBase}|${ctx.cursor}`,given=ctx.answers[ctx.cursor];
 if(given?.key===key){ctx.cursor++;return given.accept?given.targetId:undefined;}
 throw new DecisionNeeded({kind:'CHOICE',playerId,key,prompt,optional,options},ctx.answers.slice(0,ctx.cursor));
}

function askSoulTithe(s:GameState,e:Evocation,target:Player,amount:number,source?:Player) {
 const key=[e.id,target.id,amount,source?.id??BLACK_ROSE_ID].join('|'),ctx=context(s),given=ctx.answers[ctx.cursor];
 if(given?.key===key){ctx.cursor++;return given.accept;}
 throw new DecisionNeeded({kind:'SOUL_TITHE',playerId:target.id,key,evocationId:e.id,evocationName:`${e.name} #${e.number??1}`,
  evocationWounds:e.damageCubes,evocationHealth:e.health,targetId:target.id,targetName:target.name,
  sourceName:source?.name??'BR',amount},ctx.answers.slice(0,ctx.cursor));
}

// Each living Soul Tithe model of the damaged mage (in model-number order) may take one
// of the damage cubes instead, anywhere on the board. Auto models accept without asking.
function soulTithe(s:GameState,target:Player,inflicted:number,source?:Player) {
 const taken:Evocation[]=[];
 const keepers=s.evocations.filter(e=>e.playerId===target.id&&e.ability==='SOUL_TITHE'&&!isControlledByOther(s,e)).sort((a,b)=>(a.number??0)-(b.number??0));
 for(const e of keepers) {
  const remaining=inflicted-taken.length;
  if(remaining<=0)break;
  if(e.autoAbility||askSoulTithe(s,e,target,remaining,source))taken.push(e);
 }
 return taken;
}

function damage(s: GameState, target: Player, amount: number, source?: Player, actor?: ModelSnapshot | null, damageOrigin:DamageOrigin='NEUTRAL') {
 if(source?.id===target.id)return;
 // Direct attacks/events get the same complete-moment reaction boundary as spells.
 if(context(s).momentDepth===0){atMomentEnd(s,()=>damage(s,target,amount,source,actor,damageOrigin));return;}
 if(amount<=0) return;
 // Mages inside a starting cell are untouchable by other players, including
 // ongoing, reactive, room and splash effects; only Pink Tulip damage reaches them.
 if(source&&isInStartingRoom(s,target)) {
  s.log.push(`${target.name} is protected from ${source.name}'s damage in the starting cell.`);
  return;
 }
 const eventActor = actor === null ? undefined : (actor ?? (source ? snapshot(s,source.id):undefined));
 // Overkill cannot claim more contribution than the health actually removed.
 let inflicted=Math.min(amount,Math.max(0,target.wizard.health-target.wizard.damageCubes));
 if(inflicted===0)return;
 const tithed=soulTithe(s,target,inflicted,source);
 for(const e of tithed) {
  s.log.push(`${e.name} #${e.number??1} takes a damage cube meant for ${target.name}.`);
  damageEvocation(s,e,1,source,eventActor,damageOrigin);
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
  // Wounds without an available cube are not unassigned: they default to BR.
  if(inflicted>cubes) {
   target.wizard.blackDamage+=inflicted-cubes;
   appendDamageHistory(target.wizard,BLACK_ROSE_ID,inflicted-cubes);
  }
 } else {
  target.wizard.blackDamage+=inflicted;
  appendDamageHistory(target.wizard,BLACK_ROSE_ID,inflicted);
 }
 s.log.push(`${target.name} suffers ${inflicted} ${source ? 'damage' : 'black damage'}.`);
 appendFeedback(s,{kind:'DAMAGE',target:feedbackTarget,sourceId:source?.id??BLACK_ROSE_ID,amount:inflicted});
 if(source && eventActor)cerebralImplant(s,source,eventActor);
 if(source && eventActor)modelEvent(s,'DAMAGE_DEALT',eventActor,eventActor,undefined,damageOrigin,feedbackTarget);
 emitEvent(s,{event:'DAMAGE_TAKEN',model:ref,actor:eventActor,roomId,target:feedbackTarget,damageOrigin,amount:inflicted});
 if(target.wizard.damageCubes<target.wizard.health)return;
 const existing=context(s).defeats.get(ref.id);
 if(existing){existing.source=source;return;}
 const pending:PendingMageDefeat={ref,roomId,target:feedbackTarget,source};
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
 removeNightmares(s,target);
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
 if(source && source.id!==target.id) {
  source.trophies=[...source.trophies,target.id];
  source.kills=source.trophies.length;
  completeQuest(s,source,'KILL');
 } else if(!source) {
  s.blackRose.trophies=[...s.blackRose.trophies,target.id];
  s.blackRose.kills=s.blackRose.trophies.length;
  if(pending.liquefyThePain) {
   awardVictoryPoints(s,target.id,2);
   s.log.push(`${target.name} gains +2 VP for being defeated by BR with Liquefy the Pain.`);
  }
 }
 appendFeedback(s,{kind:'MAGE_DEFEATED',target:feedbackTarget,sourceId:source?.id??BLACK_ROSE_ID,
  contributions,awards,returnedCubes,respawnRoomId:target.wizard.startingRoomId,...(bonusPlayerId?{bonusPlayerId}:{})});
 target.wizard.damageCubes=0;
 target.wizard.blackDamage=0;
 target.wizard.damageByPlayer={};
 target.wizard.damageOrder=[];
 target.wizard.position={...getRoom(s,target.wizard.startingRoomId).tiles[0]};
 onMagePlacedInCell(s,target);
 for(const active of s.ongoingSpells!)if(active.targetPlayerId && [target.id,target.wizard.id].includes(active.targetPlayerId))bindActiveSpell(s,active);
 if(hasJinx(target,'WEAKNESS')) {
  s.log.push(`${target.name} is placed in their starting cell: Weakness lets BR inflict 2 damage.`);
  damage(s,target,2);
 }
}

// `source` is absent for Pink Tulip damage redirected onto an evocation: no physical cubes move.
function damageEvocation(s:GameState,e:Evocation,amount:number,source?:Player,actor=source?snapshot(s,source.id):undefined,damageOrigin:DamageOrigin='NEUTRAL') {
 if(e.playerId===source?.id || !s.evocations.includes(e))return;
 if(context(s).momentDepth===0){atMomentEnd(s,()=>damageEvocation(s,e,amount,source,actor,damageOrigin));return;}
 if(e.upgrade==='REGENERATING_ICHOR'&&amount>0){amount--;s.log.push(`${e.name} #${e.number??1} ignores 1 damage (Regenerating ichor).`);}
 const inflicted=Math.min(amount,Math.max(0,e.health-e.damageCubes));
 if(inflicted<=0)return;
 const ref=snapshot(s,e.id)!,roomId=roomAt(s,e.position)?.id;
 const feedbackTarget=modelFeedbackTarget(s,ref)!;
 e.damageCubes+=inflicted;
 const cubes=source?Math.min(inflicted,source.cubes.available):0;
 if(source){source.cubes.available-=cubes;source.cubes.onEvocations+=cubes;}
 if(source&&cubes)e.damageByPlayer[source.id]=(e.damageByPlayer[source.id]??0)+cubes;
 // No cube (no source or empty supply): the wound defaults to BR.
 if(inflicted>cubes)e.damageByPlayer[BLACK_ROSE_ID]=(e.damageByPlayer[BLACK_ROSE_ID]??0)+inflicted-cubes;
 s.log.push(source?`${e.name} suffers ${inflicted} damage; ${source.name} places ${cubes} damage cubes.`:`${e.name} suffers ${inflicted} black damage.`);
 appendFeedback(s,{kind:'DAMAGE',target:feedbackTarget,sourceId:source?.id??BLACK_ROSE_ID,amount:inflicted});
 if(source && actor)cerebralImplant(s,source,actor);
 if(source && actor)modelEvent(s,'DAMAGE_DEALT',actor,actor,undefined,damageOrigin,feedbackTarget);
 if(e.damageCubes<e.health){emitEvent(s,{event:'DAMAGE_TAKEN',model:ref,actor,roomId,target:feedbackTarget,damageOrigin,amount:inflicted});return;}
 invalidateModel(s,ref);
 for(const owner of s.players) {
  const n=e.damageByPlayer[owner.id]??0;owner.cubes.available+=n;owner.cubes.onEvocations-=n;
 }
 s.evocations=s.evocations.filter(model=>model.id!==e.id);
 s.log.push(`${e.name} is destroyed; its damage cubes return to their owners.`);
 emitEvent(s,{event:'DAMAGE_TAKEN',model:ref,actor,roomId,target:feedbackTarget,damageOrigin,amount:inflicted});
 emitEvent(s,{event:'EVOCATION_LOST',model:ref,roomId,target:feedbackTarget,position:{...e.position},kind:getEvocationKind(e)});
}

// Each time an upgraded evocation inflicts damage, its controller gains 1 VP.
function cerebralImplant(s:GameState,source:Player,actor:ModelSnapshot) {
 if(actor.kind!=='EVOCATION')return;
 const model=liveModel(s,actor)?.evocation;
 if(model?.upgrade!=='CEREBRAL_IMPLANT')return;
 awardVictoryPoints(s,source.id,1);
 s.log.push(`${source.name}: +1 VP from ${model.name} #${model.number??1} (Cerebral implant).`);
}

// Remove a model from play without damage; its cubes return and EVOCATION_LOST fires.
function removeEvocation(s:GameState,e:Evocation,verb:'removed'|'destroyed') {
 if(!s.evocations.includes(e))return;
 const ref=snapshot(s,e.id)!,roomId=roomAt(s,e.position)?.id,target=modelFeedbackTarget(s,ref);
 invalidateModel(s,ref);
 for(const owner of s.players) {
  const n=e.damageByPlayer[owner.id]??0;owner.cubes.available+=n;owner.cubes.onEvocations-=n;
 }
 s.evocations=s.evocations.filter(model=>model.id!==e.id);
 s.log.push(`${e.name} #${e.number??1} is ${verb}; its damage cubes return to their owners.`);
 emitEvent(s,{event:'EVOCATION_LOST',model:ref,roomId,...(target?{target}:{}),position:{...e.position},kind:getEvocationKind(e)});
}

// The evocation's owner decides which upgrade stays when a second one arrives.
// Returns whether the requested upgrade is now attached.
function assignUpgrade(s:GameState,e:Evocation|undefined,wanted:UpgradeName|'RANDOM'|'CHOICE',chooser?:Player):boolean {
 if(!e||!s.evocations.includes(e))return false;
 const supply=getUpgradeSupply(s);
 let upgrade:UpgradeName|undefined;
 if(wanted==='RANDOM') {
  const pool=UPGRADE_NAMES.filter(u=>supply[u]>0);
  if(pool.length)upgrade=pool[Math.floor(resolutionRandom(s)*pool.length)];
 } else if(wanted==='CHOICE') {
  const pool=UPGRADE_NAMES.filter(u=>supply[u]>0);
  if(pool.length===1)upgrade=pool[0];
  else if(pool.length)upgrade=askChoice(s,(chooser??getPlayer(s,e.playerId)).id,`upgrade-choice|${e.id}`,`Choose an upgrade for ${e.name} #${e.number??1}.`,
   pool.map(u=>({id:u,label:`${UPGRADE_LABELS[u]} — ${UPGRADE_RULES[u]}`})))as UpgradeName;
 } else if(supply[wanted]>0)upgrade=wanted;
 if(!upgrade){s.log.push('No upgrade card of that kind remains in the deck; nothing is assigned.');return false;}
 const old=e.upgrade;
 if(old===upgrade)return true;
 if(old) {
  const keep=askChoice(s,e.playerId,`upgrade|${e.id}|${old}|${upgrade}`,`${e.name} #${e.number??1} already has ${UPGRADE_LABELS[old]}. Keep one upgrade; the other returns to the deck.`,
   [{id:upgrade,label:`${UPGRADE_LABELS[upgrade]} — ${UPGRADE_RULES[upgrade]}`},{id:old,label:`${UPGRADE_LABELS[old]} — ${UPGRADE_RULES[old]}`}])!;
  if(keep===old){s.log.push(`${getPlayer(s,e.playerId).name} keeps ${UPGRADE_LABELS[old]} on ${e.name} #${e.number??1}; ${UPGRADE_LABELS[upgrade]} returns to the deck.`);return false;}
 }
 const kind=getEvocationKind(e);
 e.health+=upgradeHealth(kind,upgrade)-upgradeHealth(kind,old);
 e.upgrade=upgrade;
 s.log.push(`${e.name} #${e.number??1} gains ${UPGRADE_LABELS[upgrade]}: ${UPGRADE_RULES[upgrade]}`);
 if(e.damageCubes>=e.health)removeEvocation(s,e,'destroyed');
 return true;
}
// The evocation loses its upgrade and the health it gave; it is destroyed if its wounds now exceed that health.
function discardUpgrade(s:GameState,e:Evocation|undefined):boolean {
 if(!e||!e.upgrade||!s.evocations.includes(e))return false;
 const old=e.upgrade;
 e.health-=upgradeHealth(getEvocationKind(e),old);
 delete e.upgrade;
 s.log.push(`${e.name} #${e.number??1} discards ${UPGRADE_LABELS[old]}.`);
 if(e.damageCubes>=e.health)removeEvocation(s,e,'destroyed');
 return true;
}
// Nightmares: Black Rose evocations attached to a mage (slot = the assigned mage's evocation slot they strike).
const isNightmare=(e:Evocation)=>e.archetype==='NIGHTMARE';
const nightmaresOf=(s:GameState,mageId:PlayerId)=>s.evocations.filter(e=>e.assignedTo===mageId);
// A Nightmare counts as an evocation in its mage's room and travels with it; this is not an entry, so no trigger fires.
function syncNightmares(s:GameState,mageId:PlayerId) {
 const mage=s.players.find(p=>p.id===mageId);
 if(!mage)return;
 for(const e of nightmaresOf(s,mageId))e.position={...mage.wizard.position};
}
function removeNightmares(s:GameState,mage:Player) {
 for(const e of nightmaresOf(s,mage.id)) {
  s.log.push(`${e.name} #${e.number??1} leaves ${mage.name}.`);
  removeEvocation(s,e,'removed');
 }
}
function assignNightmare(s:GameState,caster:Player,mage:Player,effect?:EffectResolution):Evocation|undefined {
 if(!mage.wizard.alive)return;
 const availableSlots=[1,2,3].filter(slot=>!s.evocations.some(e=>isNightmare(e)&&e.assignedTo===mage.id&&e.slot===slot));
 if(!availableSlots.length){s.log.push(`${mage.name} has an Umbra in every evocation slot; none assigned.`);return;}
 if(s.evocations.filter(e=>e.assignedTo===mage.id).length>=3){s.log.push(`${mage.name} already carries 3 Umbras; none assigned.`);return;}
 if(getEvocationSupply(s).UMBRA<=0){s.log.push('No Umbra models remain in the supply; none assigned.');return;}
 const options=availableSlots.map(n=>{
  const occupant=s.evocations.find(e=>e.playerId===mage.id&&e.number===n);
  return {id:String(n),label:`Slot ${n} · ${occupant?occupant.name:'empty'}`};
 });
 const slot=Number(askChoice(s,caster.id,`nightmare-slot|${caster.id}|${mage.id}`,`Assign an Umbra to ${mage.name}: choose the evocation slot it strikes.`,options)!);
 const template=EVOCATION_TYPES.UMBRA;
 const umbra:Evocation={id:resolutionId(s),playerId:BLACK_ROSE_ID,assignedTo:mage.id,slot,number:slot,kind:'UMBRA',name:template.name,archetype:template.archetype,movement:template.movement,attack:template.attack,health:template.health,position:{...mage.wizard.position},damageCubes:0,damageByPlayer:{},activated:true};
 s.evocations.push(umbra);
 if(effect)(effect.assigned??=[]).push(umbra.id);
 s.log.push(`${caster.name} assigns an Umbra to ${mage.name} (slot ${slot}).`);
 return umbra;
}
// Attack the assigned mage, then 1 damage to the evocation in the assigned slot. `controller` is undefined for BR.
function activateNightmare(s:GameState,umbra:Evocation,controller?:Player,bonus=0) {
 if(!s.evocations.includes(umbra))return;
 const mage=s.players.find(p=>p.id===umbra.assignedTo);
 if(!mage||!mage.wizard.alive)return;
 const attack=evocationAttack(umbra)+bonus;
 s.log.push(`${controller?.name??'BR'} activates ${umbra.name} on ${mage.name}: ${attack} damage to the mage and 1 to slot ${umbra.slot}.`);
 const ref=snapshot(s,umbra.id)!;
 modelEvent(s,'EVOCATION_ACTIVATED',ref);
 damage(s,mage,attack,controller,ref,'EVOCATION');
 if(!s.evocations.includes(umbra))return;
 const occupant=s.evocations.find(e=>e.playerId===mage.id&&e.number===umbra.slot);
 if(occupant)damageEvocation(s,occupant,1,controller,ref,'EVOCATION');
}
function activateNightmaresAtPhaseStart(s:GameState) {
 let pending=s.evocations.filter(isNightmare);
 if(!pending.length)return;
 const chooser=s.players.find(p=>p.id===s.firstPlayerId)??s.players[0];
 s.log.push('Nightmares activate first, in the order chosen by the first player.');
 while(pending.length) {
  let next=pending[0];
  if(pending.length>1) {
   const id=askChoice(s,chooser.id,`nightmare-order|${pending.length}`,'Choose the next Nightmare to activate.',
    pending.map(e=>({id:e.id,label:`${e.name} #${e.number??1} on ${getPlayer(s,e.assignedTo!).name}`})))!;
   next=pending.find(e=>e.id===id)??next;
  }
  activateNightmare(s,next);
  pending=pending.filter(e=>e!==next&&s.evocations.includes(e));
 }
}
function stealVictoryPoints(s:GameState,caster:Player,mage:Player,amount:number) {
 if(mage.id===caster.id)return;
 const before=mage.victoryPoints;
 awardVictoryPoints(s,mage.id,-amount);
 const stolen=before-mage.victoryPoints;
 if(stolen>0){awardVictoryPoints(s,caster.id,stolen);s.log.push(`${caster.name} steals ${stolen} VP from ${mage.name}.`);}
 else s.log.push(`${mage.name} has no victory points to steal.`);
}

// The target discards cards of its own choice; each card it cannot discard may cost it a victory point.
function discardFromHand(s:GameState,caster:Player,mage:Player,spell:Card,amount:number,stealVp:boolean) {
 for(let i=0;i<amount;i++) {
  const eligible=mage.hand.filter(c=>!c.powerful);
  if(!eligible.length){
   s.log.push(`${mage.name} cannot discard a card.`);
   if(stealVp)stealVictoryPoints(s,caster,mage,1);
   continue;
  }
  const id=eligible.length===1?eligible[0].id:askChoice(s,mage.id,`discard|${mage.id}|${spell.id}|${i}`,`${spell.name}: discard a card.`,eligible.map(c=>({id:c.id,label:c.name})))!;
  const card=eligible.find(c=>c.id===id)??eligible[0];
  mage.hand.splice(mage.hand.indexOf(card),1);
  discardCard(s,mage,card);
  s.log.push(`${mage.name} discards ${card.name}.`);
 }
}

function modelTarget(s:GameState,id:string) {
 const mage=s.players.find(p=>p.id===id || p.wizard.id===id);
 const evocation=s.evocations.find(e=>e.id===id);
 assert(mage||evocation,'Target model not found');
 return {mage,evocation,playerId:mage?.id??evocation!.playerId,position:mage?.wizard.position??evocation!.position};
}

type CubeLocation = 'onWizard' | 'onEvocations' | 'onBoard';
type WoundedModel = Pick<Player['wizard'],'damageCubes'|'damageByPlayer'> & {blackDamage?:number;damageOrder?:PlayerId[]};
type DamageCubeOption = { token: string; sourceId?: PlayerId; label: string; cubeToken?: string };
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
function damageCubeOptions(s:GameState,model:WoundedModel,eligible:(sourceId:PlayerId|undefined)=>boolean):DamageCubeOption[] {
 const history=model.damageOrder??[],seen:Record<string,number>={},options:DamageCubeOption[]=[];
 const available:Record<string,number>={...model.damageByPlayer};
 if((model.blackDamage??0)>0)available[BLACK_ROSE_ID]=(available[BLACK_ROSE_ID]??0)+model.blackDamage!;
 for(let index=0;index<history.length;index++) {
  const sourceId=history[index],count=seen[sourceId]??0;
  if(count>=(available[sourceId]??0))continue;
  seen[sourceId]=count+1;
  if(!eligible(sourceId))continue;
  const source=s.players.find(p=>p.id===sourceId);
  const label=source?.name??(sourceId===BLACK_ROSE_ID?'Black Rose':'Unattributed');
  options.push({token:`history:${index}`,sourceId,label:`${label} damage`});
 }
 for(const [sourceId,total] of Object.entries(available)) {
  const missing=Math.max(0,total-(seen[sourceId]??0));
  if(!eligible(sourceId))continue;
  for(let i=0;i<missing;i++) {
   const source=s.players.find(p=>p.id===sourceId),label=source?.name??(sourceId===BLACK_ROSE_ID?'Black Rose':'Unattributed');
   options.push({token:`missing:${sourceId}:${i}`,sourceId,label:`${label} damage`});
  }
 }
 return options;
}
function selectableDamageOptions(options:DamageCubeOption[]) {
 const bySource=new Map<string,DamageCubeOption>();
 for(const option of options) {
  const key=option.sourceId??'untracked';
  if(!bySource.has(key))bySource.set(key,{...option,token:`source:${key}`,cubeToken:option.token});
 }
 return [...bySource.values()];
}
function removeDamageCube(s:GameState,model:WoundedModel,location:Exclude<CubeLocation,'onBoard'>,option:DamageCubeOption) {
 const token=option.cubeToken??option.token;
 const index=token.startsWith('history:')?Number(token.slice(8)):-1;
 if(index>=0)model.damageOrder?.splice(index,1);
 const sourceId=option.sourceId;
 if(sourceId && (model.damageByPlayer[sourceId]??0)>0) {
  removeCubes(model.damageByPlayer,sourceId,1);
  const owner=s.players.find(p=>p.id===sourceId);
  if(owner){owner.cubes.available++;owner.cubes[location]--;}
 } else if(sourceId===BLACK_ROSE_ID && (model.blackDamage??0)>0)model.blackDamage!--;
 model.damageCubes--;
}
function convertRecentDamageToBlackRose(s:GameState,caster:Player,target:Player,amount:number,targetFeedback:FeedbackTarget,casterScoped=false) {
 if(caster.id===target.id&&!casterScoped)return 0;
 target.wizard.damageOrder ??= [];
 let remaining=Math.min(amount,target.wizard.damageOrder.length),converted=0;
 for(let index=target.wizard.damageOrder.length-1; index>=0 && remaining>0; index--) {
  const sourceId=target.wizard.damageOrder[index];
  if(sourceId===BLACK_ROSE_ID || sourceId===target.id)continue;
  const owner=s.players.find(p=>p.id===sourceId);
  if(!owner)continue;
  if((target.wizard.damageByPlayer[sourceId]??0)<=0)continue;
  target.wizard.damageByPlayer[sourceId]-=1;
  if(target.wizard.damageByPlayer[sourceId]===0)delete target.wizard.damageByPlayer[sourceId];
  owner.cubes.available++;owner.cubes.onWizard--;
  target.wizard.blackDamage+=1;
  target.wizard.damageOrder[index]=BLACK_ROSE_ID;
  converted++;remaining--;
 }
 if(converted>0) {
  s.log.push(`${target.name} converts ${converted} recent wound${converted===1?'':'s'} to BR.`);
  appendFeedback(s,{kind:'CONVERT',target:targetFeedback,sourceId:BLACK_ROSE_ID,amount:converted,total:target.wizard.damageCubes});
 }
 return converted;
}

function convertDamageWithChoice(s:GameState,p:Player,model:WoundedModel,location:Exclude<CubeLocation,'onBoard'>,amount:number,target:FeedbackTarget) {
 const selected:DamageCubeOption[]=[];
 const limit=Math.min(amount,p.cubes.available,model.damageCubes);
 while(selected.length<limit) {
  const options=selectableDamageOptions(damageCubeOptions(s,model,sourceId=>!!sourceId&&sourceId!==p.id
   && (sourceId===BLACK_ROSE_ID?((model.damageByPlayer[sourceId]??0)>0||(model.blackDamage??0)>0):(model.damageByPlayer[sourceId]??0)>0)));
  if(!options.length)break;
  const choice=options.length===1?options[0].token:askChoice(s,p.id,`convert-damage|${target.id}|${selected.length}`,
   `Choose a damage cube on ${target.name} to convert.`,options.map(option=>({id:option.token,label:option.label})))!;
  const option=options.find(candidate=>candidate.token===choice);
  if(!option)break;
  selected.push(option);
  const sourceId=option.sourceId!;
  const cubeToken=option.cubeToken??option.token;
  if(cubeToken.startsWith('history:'))model.damageOrder?.splice(Number(cubeToken.slice(8)),1,p.id);
  else (model.damageOrder??=[]).push(p.id);
  const physicalSource=sourceId===BLACK_ROSE_ID
   ? (model.damageByPlayer[sourceId]??0)>0
   : (model.damageByPlayer[sourceId]??0)>0;
  if(physicalSource) {
   removeCubes(model.damageByPlayer,sourceId,1);
   const source=s.players.find(owner=>owner.id===sourceId);
   if(source){source.cubes.available++;source.cubes[location]--;}
  } else if(sourceId===BLACK_ROSE_ID)model.blackDamage!--;
  model.damageByPlayer[p.id]=(model.damageByPlayer[p.id]??0)+1;
  p.cubes.available--;p.cubes[location]++;
 }
 const converted=selected.length;
 if(converted>0) {
  s.log.push(`${p.name} converts ${converted} damage cubes; total wounds is unchanged.`);
  appendFeedback(s,{kind:'CONVERT',target,sourceId:p.id,amount:converted,total:model.damageCubes});
 }
 return converted;
}

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
function healDamageWithChoice(s:GameState,p:Player,model:WoundedModel,location:Exclude<CubeLocation,'onBoard'>,amount:number,target:FeedbackTarget) {
 const healedOptions:DamageCubeOption[]=[];
 while(healedOptions.length<amount) {
  const options=selectableDamageOptions(damageCubeOptions(s,model,()=>true));
  if(!options.length) {
   const untracked=Math.min(amount-healedOptions.length,model.damageCubes);
   model.damageCubes-=untracked;
   healedOptions.push(...Array.from({length:untracked},()=>({token:'untracked',label:'Unattributed damage'})));
   break;
  }
  const choice=options.length===1?options[0].token:askChoice(s,p.id,`heal-damage|${target.id}|${healedOptions.length}`,
   `Choose a damage cube on ${target.name} to heal.`,options.map(option=>({id:option.token,label:option.label})))!;
  const option=options.find(candidate=>candidate.token===choice);
  if(!option)break;
  removeDamageCube(s,model,location,option);
  healedOptions.push(option);
 }
 const healed=healedOptions.length;
 if(healed>0) {
  s.log.push(`Healing removes ${healed} wounds and returns their physical cubes.`);
  appendFeedback(s,{kind:'HEAL',target,sourceId:p.id,amount:healed});
 }
}

function mageAttackTarget(s:GameState,p:Player,id:string) {
 assert(!isInStartingRoom(s,p),'Leave the starting room before attacking');
 const target=modelTarget(s,id);assert(target.playerId!==p.id,'Cannot attack yourself or your own evocations');
 assert(!s.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(target.position))),'Cannot target a model in its starting room');
 assert(hexDistance(p.wizard.position,target.position)===0,'Target must be in the same hex (distance 0)');
 return target;
}

function discardJinx(s:GameState,mage:Player,jinx:Jinx,reason:string) {
 mage.jinxes=getMageJinxes(mage).filter(j=>j.id!==jinx.id);
 // The physical cubes on the jinx return to the mage's available supply.
 if(jinx.cubes>0){
  mage.cubes.available+=jinx.cubes;
  const left=(mage.cubes.onJinxes??0)-jinx.cubes;
  if(left>0)mage.cubes.onJinxes=left;else delete mage.cubes.onJinxes;
 }
 s.log.push(`${mage.name} discards ${JINX_LABELS[jinx.name]} (${reason}).`);
 progressJinx(s,mage,'VULNERABILITY');
}
// Each progress trigger adds one cube; a jinx with three cubes is discarded (which itself feeds Vulnerability).
function progressJinx(s:GameState,mage:Player,name:JinxName) {
 const jinx=getMageJinxes(mage).find(j=>j.name===name);
 if(!jinx)return;
 if(mage.cubes.available<=0){s.log.push(`${mage.name} has no available cubes; ${JINX_LABELS[name]} cannot progress.`);return;}
 mage.cubes.available--;mage.cubes.onJinxes=(mage.cubes.onJinxes??0)+1;
 jinx.cubes++;
 s.log.push(`${mage.name}'s ${JINX_LABELS[name]} gains a cube (${Math.min(jinx.cubes,JINX_TARGET)}/${JINX_TARGET}).`);
 if(jinx.cubes>=JINX_TARGET)discardJinx(s,mage,jinx,'fully progressed');
}
function assignJinx(s:GameState,caster:Player,mage:Player,name:JinxName):boolean {
 if(!mage.wizard.alive)return false;
 if(hasJinx(mage,name)){s.log.push(`${mage.name} already carries ${JINX_LABELS[name]}; no jinx assigned.`);return false;}
 if(getJinxSupply(s)[name]<=0){s.log.push(`No ${JINX_LABELS[name]} cards remain; no jinx assigned.`);return false;}
 const hadVulnerability=hasJinx(mage,'VULNERABILITY');
 (mage.jinxes??=[]).push({id:resolutionId(s),name,cubes:0});
 s.log.push(`${caster.name} assigns ${JINX_LABELS[name]} to ${mage.name}.`);
 if(name==='WEAKNESS')damage(s,mage,2);
 if(hadVulnerability&&caster.id!==mage.id)damage(s,mage,1,caster,snapshot(s,caster.id),'SPELL');
 return true;
}

function placeInstability(s: GameState, room: Room, amount: number, source?: Player) {
 if(room.reconstructed || room.startingFor || room.instability>=room.instabilityLimit) return 0;
 if(source&&amount>0&&hasJinx(source,'OBLIVION')) {
  // Oblivion: one cube less lands in the room, and the placement itself progresses the jinx.
  amount--;
  s.log.push(`${source.name}'s Oblivion removes 1 cube from the placement.`);
  progressJinx(s,source,'OBLIVION');
 }
 const actual=Math.min(amount,room.instabilityLimit-room.instability,source?.cubes.available ?? amount);
 if(actual<=0) return 0;
 const owner=source?.id ?? BLACK_ROSE_ID;
 room.instability+=actual;
 room.cubesByPlayer[owner]=(room.cubesByPlayer[owner]??0)+actual;
 room.instabilityOrder??=[];
 for(let i=0;i<actual;i++)room.instabilityOrder.push(owner);
 if(source) { source.cubes.available-=actual; source.cubes.onBoard+=actual; completeQuest(s,source,'INSTABILITY',actual); }
 if(source&&hasActiveEvent(s,'BLACK_OVERLOAD'))placeInstability(s,room,1);
 s.log.push(`${source?.name ?? 'BR'} places ${actual} instability in ${room.name} (${room.instability}/${room.instabilityLimit}).`);
 if(room.instability===room.instabilityLimit) {
  s.log.push(`${room.name} is full and cannot accept more instability; rebuilding, room VP and upgraded actions wait until Cleanup.`);
  const contributors=Object.entries(room.cubesByPlayer).filter(([,count])=>count>0);
  if(contributors.length===1&&contributors[0][0]!==BLACK_ROSE_ID) {
   const ownerId=contributors[0][0];
   const owner=s.players.find(player=>player.id===ownerId);
   if(owner) {
    awardVictoryPoints(s,ownerId,1);
    s.log.push(`${owner.name}: +1 VP for completing ${room.name} entirely in their color.`);
   }
  }

  if(source) completeQuest(s,source,'REBUILD');
 }
 if(source){const ref=snapshot(s,source.id);if(ref)modelEvent(s,'CUBE_PLACED',ref,ref,room.id);}
 return actual;
}
function convertRoomCubes(s:GameState,p:Player,room:Room,amount:number) {
 room.instabilityOrder??=Object.entries(room.cubesByPlayer).flatMap(([id,n])=>Array.from({length:n},()=>id));
 let converted=0;
 const limit=Math.min(amount,p.cubes.available,room.instability);
 while(converted<limit) {
  const sourceIds=[...new Set(room.instabilityOrder.filter(id=>id!==p.id&&(room.cubesByPlayer[id]??0)>0))];
  if(!sourceIds.length)break;
  const sourceId=sourceIds.length===1?sourceIds[0]:askChoice(s,p.id,`convert-room|${room.id}|${converted}`,
   `Choose a color of cube in ${room.name} to convert.`,sourceIds.map(id=>{
    const source=s.players.find(owner=>owner.id===id);
    const label=id===BLACK_ROSE_ID?'Pink Tulip':`${MAGE_COLOR_NAMES[id]??'Mage'} (${source?.name??id})`;
    return {id,label};
   }))!;
  const index=room.instabilityOrder.lastIndexOf(sourceId);
  if(index<0)break;
  room.instabilityOrder.splice(index,1);
  const source=s.players.find(owner=>owner.id===sourceId);
  if((room.cubesByPlayer[sourceId]??0)>0) {
   removeCubes(room.cubesByPlayer,sourceId,1);
   if(source){source.cubes.available++;source.cubes.onBoard--;}
  }
  room.cubesByPlayer[p.id]=(room.cubesByPlayer[p.id]??0)+1;
  room.instabilityOrder.push(p.id);
  p.cubes.available--;p.cubes.onBoard++;converted++;
 }
 if(converted>0) {
  s.log.push(`${p.name} converts ${converted} instability cubes; total instability is unchanged.`);
  appendFeedback(s,{kind:'CONVERT',target:roomFeedbackTarget(room),sourceId:p.id,amount:converted,total:room.instability});
 }
}

function expireRoundSpells(s:GameState) {
 for(const active of [...s.readiedSpells!]) {
  removeActiveSpell(s,active);
  const owner=getPlayer(s,active.playerId),card=active.printed??active.card;
  if(active.cleanupDestination==='MEMORIES'&&!card.powerful)owner.discard.push(card);
  else owner.hand.push(card);
 }
 for(const active of [...s.ongoingSpells!])retireActiveSpell(s,active);
 s.activeSpellOrder=[];
}

function eventBoardOf(s:GameState):(EventCard|null)[] {
 const board=(s.eventBoard??=[]);
 while(board.length<EVENT_BOARD_SIZE)board.push(null);
 return board;
}

function hasActiveEvent(s:GameState,effect:NonNullable<EventCard['effect']>) {
 return eventBoardOf(s).some(event=>event?.effect===effect);
}

function onMagePlacedInCell(s:GameState,mage:Player) {
 if(!hasActiveEvent(s,'HIDDEN_RESOURCES'))return;
 awardVictoryPoints(s,mage.id,1);
 s.log.push(`${mage.name} gains 1 VP from Hidden Resources in their starting cell.`);
}

function playerOrder(s:GameState):Player[] {
 const first=Math.max(0,s.players.findIndex(player=>player.id===s.firstPlayerId));
 return [...s.players.slice(first),...s.players.slice(0,first)];
}

function crownLastPlayer(s:GameState,event:EventCard) {
 if(!event.crown)return;
 const order=playerOrder(s),last=order[order.length-1];
 if(!last)return;
 s.firstPlayerId=last.id;
 s.log.push(`${last.name} becomes first from ${event.name}'s crown.`);
}

function eventPoints(event:EventCard,which:'entry'|'exit') {
 return which==='entry'
  ? event.entryPoints??event.ongoing?.entryPoints??0
  : event.exitPoints??event.ongoing?.exitPoints??0;
}

function leaveEventBoard(s:GameState,event:EventCard) {
 s.eventDiscard.push(event);
 const points=eventPoints(event,'exit');
 s.log.push(`BR — ${event.name} leaves the event board${points?`, BR gains ${points} VP`:''}.`);
 if(points)awardVictoryPoints(s,BLACK_ROSE_ID,points);
}

// Every ongoing event moves one place along; the last one leaves the board.
function shiftEventBoard(s:GameState) {
 const board=eventBoardOf(s);
 const out=board.pop();
 board.unshift(null);
 if(out)leaveEventBoard(s,out);
}

// New event takes its printed slot; any occupant is pushed toward the exit.
function enterEventBoard(s:GameState,event:EventCard,slot=0) {
 const board=eventBoardOf(s);
 const points=eventPoints(event,'entry');
 s.log.push(`BR — ${event.name} enters the event board${points?`, BR gains ${points} VP`:''}.`);
 if(points)awardVictoryPoints(s,BLACK_ROSE_ID,points);
 const insertion=event.boardSlot??slot;
 let carry:EventCard|null=event;
 for(let i=insertion;i<board.length&&carry;i++) { const next:EventCard|null=board[i]; board[i]=carry; carry=next; }
 if(carry)leaveEventBoard(s,carry);
 crownLastPlayer(s,event);
}

function chooseEventRoom(s:GameState,p:Player,rooms:Room[],prompt:string):Room|undefined {
 if(!rooms.length)return;
 const selected=rooms.length===1?rooms[0].id:askChoice(s,p.id,`event-room|${s.round}|${p.id}|${prompt}`,prompt,rooms.map(room=>({id:room.id,label:room.name,roomId:room.id})))!;
 return rooms.find(room=>room.id===selected);
}

function placeMageForEvent(s:GameState,p:Player,rooms:Room[],prompt:string) {
 const room=chooseEventRoom(s,p,rooms,prompt);
 if(room)moveModel(s,snapshot(s,p.id)!,room.tiles[0]);
}

function resolveInstantEvent(s:GameState,event:EventCard) {
 switch(event.effect) {
  case 'AWAKENING': {
   const room=s.board.rooms.find(candidate=>candidate.effect==='BR_STANDARD');
   if(room)placeInstability(s,room,5);
   break;
  }
  case 'DISLOCATION': {
   const rooms=s.board.rooms.filter(room=>room.tiles.length>0);
   for(const p of playerOrder(s).filter(mage=>mage.wizard.alive))placeMageForEvent(s,p,rooms,`${p.name}: choose a room for Dislocation.`);
   break;
  }
  case 'A_HARD_LESSON':
   for(const p of playerOrder(s).filter(mage=>mage.wizard.alive)) {
    awardVictoryPoints(s,p.id,-1);
    const start=getRoom(s,p.wizard.startingRoomId).tiles[0];
    const rooms=s.board.rooms.filter(room=>!room.startingFor&&room.tiles.some(tile=>hexDistance(tile,start)<=1));
    placeMageForEvent(s,p,rooms,`${p.name}: choose a room within 1 of your starting cell.`);
   }
   break;
  case 'BLACK_THORNS':
    for(const p of playerOrder(s))damage(s,p,event.amount||2);
   break;
  default:
   if(event.kind==='BLACK_DAMAGE')for(const p of playerOrder(s))damage(s,p,event.amount);
   else if(event.kind==='INSTABILITY') {
    const candidates=shuffle(s.board.rooms.filter(room=>!room.startingFor&&!room.reconstructed&&room.instability<room.instabilityLimit),()=>resolutionRandom(s));
    for(const room of candidates.slice(0,event.rooms))placeInstability(s,room,event.amount);
   }
 }
}

function resolveOngoingEvents(s:GameState) {
 const events=eventBoardOf(s).filter((event):event is EventCard=>!!event);
 for(const event of events) {
  switch(event.effect) {
   case 'GIFT_TO_FOOLS':
    for(const p of playerOrder(s))drawSchoolCards(s,p,1);
    break;
   case 'REBIRTH_AT_NOON':
    for(const room of s.board.rooms.filter(candidate=>candidate.color==='azure'||candidate.color==='violet'))placeInstability(s,room,1);
    break;
   case 'REBIRTH_AT_DAWN':
    for(const room of s.board.rooms.filter(candidate=>candidate.color==='crimson'||candidate.color==='amber'))placeInstability(s,room,1);
    break;
   case 'REBIRTH_AT_SUNSET':
    for(const room of s.board.rooms.filter(candidate=>candidate.color==='emerald'||candidate.color==='grey'))placeInstability(s,room,1);
    break;
   case 'MIDNIGHT_REBIRTH': {
    const room=s.board.rooms.find(candidate=>candidate.effect==='BR_STANDARD');
    if(room)placeInstability(s,room,2);
    break;
   }
   case 'UNDEAD_ARMY':
    for(const p of playerOrder(s)) {
     const room=roomAt(s,p.wizard.position);
     if(!p.wizard.alive||!room||room.startingFor||getMageEvocationCount(s,p.id)>=3||getEvocationSupply(s).CADAVER<=0)continue;
     const choice=askChoice(s,p.id,`undead-army|${s.round}|${p.id}`,`${p.name}: summon a Cadaver in your room?`,[{id:'summon',label:'Summon a Cadaver'}],true);
     if(choice==='summon')summonEvocation(s,p,'CADAVER',p.wizard.position);
    }
    break;
   default:
    break;
  }
 }
}

function startBlackRose(s: GameState) {
 // Also settle legacy Cleanup snapshots, without returning a card twice.
 expireRoundSpells(s);
 s.round++; s.phase='BLACK_ROSE'; s.blackRoseResolved=false; s.roseQuestDiscards=[]; s.currentPlayerId=null; s.activation=null;s.evocationActivation=null;
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
 shiftEventBoard(s);
 const event=drawFromDiscard(s,s.eventDeck,s.eventDiscard);
 if(!event)throw new GameRuleError('No event cards are available');
 s.usedEvent=event;
 s.log.push(`Round ${s.round} · BR — ${event.name}.`);
 resolveDrawnEvent(s,event);
 resolveOngoingEvents(s);
}
// A drawn event enters the board (ongoing) or resolves at once and is discarded.
function resolveDrawnEvent(s:GameState,event:EventCard) {
 if(event.kind==='ONGOING')enterEventBoard(s,event);
 else {
  s.eventDiscard.push(event);
  const points=eventPoints(event,'entry');
  s.log.push(`BR — ${event.name} enters${points?`, BR gains ${points} VP`:''}.`);
  if(points)awardVictoryPoints(s,BLACK_ROSE_ID,points);
  crownLastPlayer(s,event);
  resolveInstantEvent(s,event);
 }
}
function drawExtraEvent(s:GameState) {
 const event=drawFromDiscard(s,s.eventDeck,s.eventDiscard);
 if(!event){s.log.push('No event cards are available.');return;}
 s.log.push(`BR — a new event is drawn: ${event.name}.`);
 resolveDrawnEvent(s,event);
}

const heldQuests = (p:Player) => p.quest?[p.quest,...p.additionalQuests]:[...p.additionalQuests];
const activeQuests = (p:Player) => heldQuests(p).filter(q=>!q.completed&&!q.claimed);

function beginStudyIfQuestsFit(s:GameState,tendonDone=false) {
 if(s.players.some(p=>activeQuests(p).length>p.questLimit))return;
 if(!tendonDone&&startTendonMoves(s))return;
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
  const held=heldQuests(p);
  // Legacy saves may still keep completed cards in a held slot. They neither
  // block a replacement nor count against the active quest limit.
  for(const quest of held.filter(q=>q.claimed))if(!s.questDiscard.some(q=>q.id===quest.id))s.questDiscard.push(quest);
  const quests=held.filter(q=>!q.claimed);p.quest=quests.shift()??null;p.additionalQuests=quests;
  if(!p.quest) {
   p.quest=drawQuest(s);
   if(p.quest)s.log.push(`${p.name} receives a personal quest.`);
  }
 }
 s.blackRoseResolved=true;
 if(s.players.some(p=>activeQuests(p).length>p.questLimit))s.log.push('BR — waiting for quest-limit discards.');
 beginStudyIfQuestsFit(s);
}

// Refill only on exhaustion, including between cards in a multi-card draw.
// Use resolution entropy so an interrupted action replays the same shuffle.
function drawFromDiscard<T>(s:GameState,deck:T[],discard:T[]):T|null {
 if(!deck.length) { deck.push(...shuffle(discard,()=>resolutionRandom(s))); discard.length=0; }
 return deck.shift()??null;
}

function drawOne(s:GameState,deck: Card[], discard: Card[]): Card {
 const card=drawFromDiscard(s,deck,discard); if(!card) throw new GameRuleError('This deck is empty');
 return card;
}

function discardCard(s:GameState,p:Player,card:Card) {
 assert(!card.powerful,'Forgotten spells cannot be discarded; keep them until used');
 const school=s.library.find(d=>card.schoolId===d.id || card.id.startsWith(`${d.id}-`));
 (school?school.discard:p.discard).push(card);
}

// Every precondition activateRoomBody asserts for the mage's own room. Root actions that
// activate a room after a damage step (PUNCH ... END) check this first: an interrupt there
// replays the action later, and a rule error at that point would strand the decision.
function roomActivationProblem(s:GameState,p:Player,targetRoomId?:string):string|null {
 try {
  const room=s.board.rooms.find(r=>inRoom(p,r));
  const effect=room?getRoomEffect(room):null;
  assert(effect && !room!.startingFor,'No room effect in a starting room');
  assert(!targetRoomId || roomEffectNeedsTarget(effect),'This room effect does not take a target room');
  if((effect==='DRAW_POWERFUL'||effect==='BR_STANDARD'||effect==='BR_REBUILT')&&s.powerfulDeck.length>0)
   assert(getCentralDiscardOptions(p).length>=CENTRAL_ROOM_DISCARD_COST,`Discard ${CENTRAL_ROOM_DISCARD_COST} cards from your hand to activate the central chamber`);
  assert(!room!.reconstructed||!room!.specialUsed,'Reconstructed room special already used this Action phase');
  if(roomEffectNeedsTarget(effect)) {
   const target=targetRoomId?getRoom(s,targetRoomId):room!;
   assert(!target.startingFor,'Starting rooms cannot be targeted');
   const distance=Math.min(...target.tiles.flatMap(h=>room!.tiles.map(origin=>hexLineDistance(origin,h))));
   assert(Number.isFinite(distance)&&distance<=1,'Room effect target out of range (maximum 1)');
  }
  return null;
 } catch(error) {
  if(error instanceof GameRuleError)return error.message;
  throw error;
 }
}
function activateRoom(s:GameState,p:Player,targetRoomId?:string) {
 activateRoomBody(s,p,targetRoomId);
}
function chooseRoomTarget(s:GameState,p:Player,origin:Room,range:number,prompt:string):Room|undefined {
 const options=s.board.rooms.filter(candidate=>!candidate.startingFor&&Math.min(...candidate.tiles.flatMap(h=>origin.tiles.map(g=>hexDistance(h,g))))<=range);
 if(!options.length)return;
 const id=options.length===1?options[0].id:askChoice(s,p.id,`room-target|${origin.id}|${prompt}`,prompt,options.map(candidate=>({id:candidate.id,label:candidate.name,roomId:candidate.id})))!;
 return options.find(candidate=>candidate.id===id);
}
function roomDamage(s:GameState,p:Player,room:Room,amount:number) {
 const actor=snapshot(s,p.id)!;
 for(const target of s.players.filter(candidate=>candidate.id!==p.id&&candidate.wizard.alive&&inRoom(candidate,room))) {
  resolveInstruction(s,p,{effect:'DAMAGE',amount,target:'EVENT_MODEL'},snapshot(s,target.id),undefined,actor,undefined,'ROOM');
 }
 for(const target of s.evocations.filter(candidate=>candidate.playerId!==p.id&&inRoomPosition(room,candidate.position))) {
  resolveInstruction(s,p,{effect:'DAMAGE',amount,target:'EVENT_MODEL'},snapshot(s,target.id),undefined,actor,undefined,'ROOM');
 }
}
function drawPersonalCards(s:GameState,p:Player,count:number) {
 let drawn=0;
 while(drawn<count&&p.personalDeck.length+p.discard.length>0){p.hand.push(drawOne(s,p.personalDeck,p.discard));drawn++;}
 return drawn;
}
function chooseAndDiscard(s:GameState,p:Player,count:number,label:string,required=false) {
 for(let index=0;index<count;index++) {
  const options=getCentralDiscardOptions(p);
  if(!options.length) {
   if(required)throw new GameRuleError(`${p.name} needs ${count} non-Forgotten hand cards to activate ${label}`);
   s.log.push(`${p.name} has no non-Forgotten card to discard for ${label}.`);return;
  }
  const id=options.length===1?options[0].id:askChoice(s,p.id,`room-discard|${label}|${p.id}|${index}`,`${label}: discard a card.`,options.map(card=>({id:card.id,label:card.name})))!;
  const card=options.find(candidate=>candidate.id===id)!;
  p.hand.splice(p.hand.indexOf(card),1);
  discardCard(s,p,card);
  s.log.push(`${p.name} discards ${card.name}.`);
 }
}
function allLiveModels(s:GameState) {
 return [
  ...s.players.filter(candidate=>candidate.wizard.alive).map(candidate=>({id:candidate.id,label:candidate.name,kind:'MAGE' as const})),
  ...s.evocations.filter(candidate=>!isNightmare(candidate)).map(candidate=>({id:candidate.id,label:`${candidate.name} #${candidate.number??1}`,kind:'EVOCATION' as const})),
 ];
}
function chooseRoomModel(s:GameState,p:Player,options:ReturnType<typeof allLiveModels>,prompt:string,allowSelf=true) {
 const eligible=options.filter(candidate=>allowSelf||
  (candidate.id!==p.id&&(candidate.kind==='MAGE'||s.evocations.find(evocation=>evocation.id===candidate.id)?.playerId!==p.id)));
 if(!eligible.length)return;
 const id=eligible.length===1?eligible[0].id:askChoice(s,p.id,`room-model|${prompt}|${p.id}`,prompt,eligible.map(candidate=>({id:candidate.id,label:candidate.label})))!;
 return eligible.find(candidate=>candidate.id===id);
}
function damageRoomModel(s:GameState,p:Player,modelId:string,amount:number) {
 const actor=snapshot(s,p.id)!;
 if(s.players.some(candidate=>candidate.id===modelId)) {
  const target=getPlayer(s,modelId);
  resolveInstruction(s,p,{effect:'DAMAGE',amount,target:'EVENT_MODEL'},snapshot(s,target.id),undefined,actor,undefined,'ROOM');
 } else {
  const target=s.evocations.find(candidate=>candidate.id===modelId);
  if(target)resolveInstruction(s,p,{effect:'DAMAGE',amount,target:'EVENT_MODEL'},snapshot(s,target.id),undefined,actor,undefined,'ROOM');
 }
}
function healRoomModel(s:GameState,p:Player,modelId:string,amount:number) {
 if(s.players.some(candidate=>candidate.id===modelId)) {
  const target=getPlayer(s,modelId);
  healModel(s,target.wizard,'onWizard',amount,p.id,{kind:'MAGE',id:target.id,name:target.name,roomId:roomAt(s,target.wizard.position)?.id});
  return;
 }
 const target=s.evocations.find(candidate=>candidate.id===modelId);
 if(target)healModel(s,target,'onEvocations',amount,p.id,{kind:'EVOCATION',id:target.id,name:target.name,roomId:roomAt(s,target.position)?.id});
}
function healRoomTarget(s:GameState,p:Player,amount:number) {
 const wounded=allLiveModels(s).filter(candidate=>{
  const target=candidate.kind==='MAGE'?s.players.find(mage=>mage.id===candidate.id)?.wizard:s.evocations.find(e=>e.id===candidate.id);
  return !!target&&target.damageCubes>0;
 });
 if(!wounded.length)return;
 const target=chooseRoomModel(s,p,wounded,`${p.name}: choose a model to heal.`);
 if(target)healRoomModel(s,p,target.id,amount);
}
function drawSchoolCards(s:GameState,p:Player,count:number) {
 const chosenDecks=new Set<string>();
 for(let index=0;index<count;index++) {
  const decks=s.library.filter(deck=>deck.cards.length+deck.discard.length>0&&!chosenDecks.has(deck.id));
  if(!decks.length){s.log.push('No school cards are available.');return;}
  const deckId=decks.length===1?decks[0].id:askChoice(s,p.id,`school-draw|${p.id}|${index}`,'Choose a school deck to draw from.',decks.map(deck=>({id:deck.id,label:`${deck.name} (${deck.cards.length+deck.discard.length} available)`})))!;
  const deck=decks.find(candidate=>candidate.id===deckId)!;
  p.hand.push(drawOne(s,deck.cards,deck.discard));
  chosenDecks.add(deck.id);
 }
}
function drawAndDiscardQuests(s:GameState,p:Player,drawCount:number,discardCount:number) {
 for(let index=0;index<drawCount;index++) {
  const quest=drawQuest(s);
  if(!quest){s.log.push('No quest cards are available.');break;}
  if(p.quest)p.additionalQuests.push(quest);else p.quest=quest;
 }
 const eligible=activeQuests(p);
 for(let index=0;index<Math.min(discardCount,eligible.length);index++) {
  const choices=activeQuests(p);
  const id=choices.length===1?choices[0].id:askChoice(s,p.id,`room-quest-discard|${p.id}|${index}`,'Choose a quest to discard.',choices.map(quest=>({id:quest.id,label:quest.name})))!;
  const selected=choices.find(quest=>quest.id===id)!;
  s.questDiscard.push(selected);
  if(p.quest?.id===id)p.quest=p.additionalQuests.shift()??null;
  else p.additionalQuests=p.additionalQuests.filter(quest=>quest.id!==id);
 }
}
function summonRoomEvocation(s:GameState,p:Player,kind:EvocationKind,room:Room,effect?:EffectResolution) {
 const evocation=summonEvocation(s,p,kind,room.tiles[0]);
 if(effect&&evocation)effect.summoned=snapshot(s,evocation.id);
 if(evocation)s.log.push(`${p.name} summons ${evocation.name} in ${room.name}.`);
 return evocation;
}
function roomSequenceMove(s:GameState,p:Player,label:string) {
 const destinations=s.board.tiles.filter(tile=>areAdjacent(p.wizard.position,tile)&&!s.board.rooms.some(candidate=>candidate.startingFor&&inRoomPosition(candidate,tile)));
 if(!destinations.length)return;
 const destination=destinations.length===1?destinations[0]:destinations.find(tile=>hexKey(tile)===askChoice(s,p.id,`forge-move|${p.id}|${label}`,`${label}: move one space.`,destinations.map(tile=>({id:hexKey(tile),label:roomAt(s,tile)?.name??hexKey(tile),...(roomAt(s,tile)?{roomId:roomAt(s,tile)!.id}:{})})))!);
 if(destination)moveModel(s,snapshot(s,p.id)!,destination);
}
function roomSequenceAttack(s:GameState,p:Player,label:string) {
 const targets=[
  ...s.players.filter(target=>target.id!==p.id&&target.wizard.alive&&hexKey(target.wizard.position)===hexKey(p.wizard.position)).map(target=>({id:target.id,label:target.name})),
  ...s.evocations.filter(target=>target.playerId!==p.id&&hexKey(target.position)===hexKey(p.wizard.position)).map(target=>({id:target.id,label:`${target.name} #${target.number??1}`})),
 ];
 if(!targets.length)return;
 const id=targets.length===1?targets[0].id:askChoice(s,p.id,`forge-attack|${p.id}|${label}`,`${label}: choose a model to attack.`,targets)!;
 damageRoomModel(s,p,id,p.wizard.attack);
 modelEvent(s,'MAGE_ATTACK',snapshot(s,id)!,snapshot(s,p.id)!,roomAt(s,p.wizard.position)?.id);
}
function moveAllMagesToStarts(s:GameState) {
 for(const mage of s.players) {
  mage.wizard.position={...getRoom(s,mage.wizard.startingRoomId).tiles[0]};
  syncNightmares(s,mage.id);
  if(mage.id===s.activation?.playerId)s.activation.mustExitCell=true;
 }
}
function castNextRoomSpell(s:GameState,p:Player) {
 const slot=(['slot1','slot2','slot3'] as const).find(candidate=>p.prepared[candidate]&&!p.prepared[candidate]!.used);
 if(!slot){s.log.push(`${p.name} has no ready numbered spell to cast.`);return;}
 if(!s.activation?.physicalAction){s.log.push('Arena: the numbered spell can only be cast during a physical action.');return;}
 const printed=p.prepared[slot]!.card;
 const spell=getEffectiveSpell(s,p,printed);
 if(['TRAP','PROTECTION'].includes(getSpellType(spell))){s.log.push('Arena cannot cast a Trap or Protection as a ready spell.');return;}
 const command:Extract<GameAction,{type:'CAST_SPELL'}>={type:'CAST_SPELL',playerId:p.id,slot};
 if(spell.target==='ROOM') {
  const rooms=s.board.rooms.filter(candidate=>!candidate.startingFor&&candidate.tiles.some(tile=>spellReaches(s,spell,p.wizard.position,tile)));
  if(!rooms.length){s.log.push(`${printed.name}: no room is in range.`);return;}
  const roomId=rooms.length===1?rooms[0].id:askChoice(s,p.id,`arena-room|${p.id}|${slot}`,'Arena: choose the room to target with your spell.',
   rooms.map(candidate=>({id:candidate.id,label:candidate.name,roomId:candidate.id})))!;
  command.roomId=roomId;
 } else if(spell.target!=='SELF') {
  const candidates=allLiveModels(s).filter(candidate=>{
   const model=modelTarget(s,candidate.id);
   return spellCanTargetModel(spell,p.id,model.playerId,candidate.kind)&&spellFilterAllows(spell,p.id,model)&&
    spellReaches(s,spell,p.wizard.position,model.position)&&!roomAt(s,model.position)?.startingFor;
  });
  if(!candidates.length){s.log.push(`${printed.name}: no model is a legal target.`);return;}
  const chosen=candidates.length===1?candidates[0]:candidates.find(candidate=>candidate.id===askChoice(s,p.id,`arena-model|${p.id}|${slot}`,
   'Arena: choose a model to target with your spell.',candidates.map(candidate=>({id:candidate.id,label:candidate.label})))!);
  if(chosen?.kind==='MAGE')command.targetPlayerId=chosen.id;
  else if(chosen)command.targetEvocationId=chosen.id;
 }
 castSpell(s,p,command,true);
}
function copyRoomEffect(s:GameState,p:Player,mirror:Room,position:Hex) {
 const options=s.board.rooms.filter(candidate=>candidate.id!==mirror.id&&!candidate.startingFor&&getRoomEffect(candidate)!=='MIRRORS_REBUILT'&&getRoomEffect(candidate));
 if(!options.length)return;
 const selectedId=options.length===1?options[0].id:askChoice(s,p.id,`mirror-room|${p.id}|${mirror.id}`,'Choose a room effect to copy.',options.map(candidate=>({id:candidate.id,label:`${candidate.name} · ${candidate.reconstructed?'rebuilt':'standard'}: ${ROOM_EFFECT_LABELS[getRoomEffect(candidate)!]}`,roomId:candidate.id})))!;
 const selected=options.find(candidate=>candidate.id===selectedId);
 if(!selected)return;
 const effect=getRoomEffect(selected)!;
 const copied:Room={...selected,reconstructed:false,rebuiltEffect:null,effect};
 s.log.push(`${p.name} copies ${selected.name}'s ${selected.reconstructed?'rebuilt':'standard'} effect.`);
 activateRoomBody(s,p,undefined,{room:copied,position,allowUsedSpecial:true});
}
function activateRoomBody(s:GameState,p:Player,targetRoomId?:string,via?:{room:Room;position:Hex;allowUsedSpecial?:boolean}) {
 const room=via?.room??s.board.rooms.find(r=>inRoom(p,r));
 const effect=room?getRoomEffect(room):null;
 assert(effect && !room!.startingFor,'No room effect in a starting room');
 assert(!targetRoomId || roomEffectNeedsTarget(effect),'This room effect does not take a target room');
 if((effect==='DRAW_POWERFUL'||effect==='BR_STANDARD'||effect==='BR_REBUILT')&&s.powerfulDeck.length>0&&getCentralDiscardOptions(p).length<CENTRAL_ROOM_DISCARD_COST) {
  if(via){s.log.push(`${p.name} cannot pay the central chamber’s discard cost; nothing happens.`);return;}
  assert(false,`Discard ${CENTRAL_ROOM_DISCARD_COST} cards from your hand to activate the central chamber`);
 }
 const legacyEffect=new Set<RoomEffect>(['ROOM_DAMAGE','DRAW_DISCARD','INSTABILITY','DRAW_QUEST','DRAW_GRIMOIRE','SUMMON_CADAVER','DRAW_POWERFUL','FIRST_PLAYER']).has(effect!);
 const reward=room!.reconstructed&&legacyEffect?2:1;
 if(room!.reconstructed) {
  // A spell-driven activation just fizzles on an already used reconstructed room.
  if(via&&room!.specialUsed&&!via.allowUsedSpecial){s.log.push(`${room!.name} special already used this Action phase; nothing happens.`);return;}
  if(room!.specialUsed)assert(via?.allowUsedSpecial,'Reconstructed room special already used this Action phase');
  else room!.specialUsed=true;
 }
 const actor=snapshot(s,p.id)!,position={...(via?.position??p.wizard.position)};
 const targets=[...s.players.filter(t=>inRoom(t,room!)).map(t=>snapshot(s,t.id)!),...s.evocations.filter(e=>room!.tiles.some(h=>hexKey(h)===hexKey(e.position))).map(e=>snapshot(s,e.id)!)];
 const instabilityBefore=s.board.rooms.reduce((total,candidate)=>total+candidate.instability,0);
 s.log.push(`${p.name} activates ${room!.name} for free${room!.reconstructed?' (rebuilt effect)':''}: ${ROOM_EFFECT_LABELS[effect!]}.`);
 if(!via)progressQuest(s,p,'ROOM_ACTIVATE');
 const effectResolution:EffectResolution={activationIsExplicit:false};
 // The room's Effect: each Moment is atomic (reactions, defeats included, interrupt only between Moments, then
 // the rest of the Effect resumes). Forge opens one Moment per step; other rooms resolve their Moments together.
 const applyRoomMoments=()=>{
 switch(effect) {
  case 'ROOM_DAMAGE': {
  for(const ref of targets)resolveInstruction(s,p,{effect:'DAMAGE',amount:reward,target:'EVENT_MODEL'},ref,undefined,actor,undefined,'ROOM');
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
    const evocation=summonEvocation(s,p,'CADAVER',position);
    if(!evocation)break;
    effectResolution.summoned=snapshot(s,evocation.id);
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
  case 'FIRST_PLAYER': {
   placeInstability(s,room!,1,p);
   if(s.firstPlayerId!==p.id) {
    s.firstPlayerId=p.id;
    s.log.push(`${p.name} takes the first-player token and starts the next phase.`);
   }
   break;
  }
  case 'DRAW_POWERFUL': {
  // Pay first: choose cards in order, then discard both only once both are chosen.
  const paid:Card[]=[];
  for(let i=0;i<(s.powerfulDeck.length?CENTRAL_ROOM_DISCARD_COST:0);i++) {
   const options=getCentralDiscardOptions(p).filter(c=>!paid.some(x=>x.id===c.id));
   const id=askChoice(s,p.id,`central-discard|${p.id}|${i}`,`Central chamber: discard card ${i+1} of ${CENTRAL_ROOM_DISCARD_COST} to gain a forgotten spell.`,options.map(c=>({id:c.id,label:c.name})))!;
   paid.push(options.find(c=>c.id===id)!);
  }
  for(const card of paid) {
   p.hand.splice(p.hand.findIndex(c=>c.id===card.id),1);
   discardCard(s,p,card);
  }
  if(paid.length)s.log.push(`${p.name} discards ${paid.map(c=>c.name).join(' and ')} to the central chamber.`);
  for(let i=0;i<reward;i++) {
   const card=s.powerfulDeck.shift();
  if(card)p.hand.push(card);else {s.log.push('The forgotten spell supply is exhausted.');break;}
  }
   break;
  }
  case 'BR_STANDARD':
  case 'BR_REBUILT': {
  if(s.powerfulDeck.length)chooseAndDiscard(s,p,CENTRAL_ROOM_DISCARD_COST,room!.name,true);
  const count=effect==='BR_REBUILT'?2:1;
  for(let index=0;index<count;index++) {
   const card=s.powerfulDeck.shift();
   if(card)p.hand.push(card);else {s.log.push('The Forgotten spell supply is exhausted.');break;}
  }
  if(effect==='BR_REBUILT')chooseAndDiscard(s,p,1,room!.name);
  else placeInstability(s,room!,1);
  break;
  }
  case 'CEMETERY_STANDARD':case 'CRYPT_STANDARD':case 'ALTAR_STANDARD':
  summonRoomEvocation(s,p,'CADAVER',room!,effectResolution);break;
  case 'CEMETERY_REBUILT': {
  const destination=chooseRoomTarget(s,p,room!,Infinity,'Cemetery: choose any room for the Colossus.');
  if(destination)summonRoomEvocation(s,p,'COLOSSUS',destination,effectResolution);
  break;
  }
  case 'CRYPT_REBUILT': {
  for(let index=0;index<2;index++) {
   const destination=chooseRoomTarget(s,p,room!,1,`Crypt: choose a room within range 1 for Cadaver ${index+1}.`);
  if(destination)summonRoomEvocation(s,p,'CADAVER',destination,effectResolution);
  }
  break;
  }
  case 'ALTAR_REBUILT': {
  const target=chooseRoomModel(s,p,allLiveModels(s),'Sacrificial Altar: choose a model anywhere to damage.',false);
  if(target)damageRoomModel(s,p,target.id,2);
  break;
  }
  case 'ALCHEMICAL_LAB_STANDARD':case 'ARENA_STANDARD':case 'SUMMONER_STANDARD': {
  const destination=targetRoomId?getRoom(s,targetRoomId):room!;
  roomDamage(s,p,destination,1);break;
  }
  case 'ALCHEMICAL_LAB_REBUILT':
  drawPersonalCards(s,p,3);chooseAndDiscard(s,p,1,room!.name);break;
  case 'ARENA_REBUILT':
  castNextRoomSpell(s,p);break;
  case 'SUMMONER_REBUILT': {
  summonForEffect(s,p,'NIGREDO',position,effectResolution);
  activateEffectSummon(s,p,'NIGREDO',effectResolution);
  break;
  }
  case 'BIBLIOTHECA_STANDARD':case 'OBSERVATORY_STANDARD':case 'SANCTUARY_STANDARD':
  for(let index=0;index<1;index++) {
   const quest=drawQuest(s);
   if(quest){if(p.quest)p.additionalQuests.push(quest);else p.quest=quest;}
   else s.log.push('No quest cards are available.');
  }
  break;
  case 'BIBLIOTHECA_REBUILT':drawSchoolCards(s,p,2);break;
  case 'OBSERVATORY_REBUILT':
  for(const mage of s.players)if(mage.id!==p.id)awardVictoryPoints(s,mage.id,-1);
  s.log.push(`${p.name} activates the Observatory; every other mage loses 1 VP.`);break;
  case 'SANCTUARY_REBUILT':case 'GARDEN_REBUILT': {
  healRoomModel(s,p,p.id,3);
  healRoomTarget(s,p,3);
  break;
  }
  case 'FORGE_STANDARD':case 'GARDEN_STANDARD':case 'TREASURE_STANDARD':case 'MIRRORS_STANDARD': {
  const destination=targetRoomId?getRoom(s,targetRoomId):room!;
  placeInstability(s,destination,1,p);break;
  }
  case 'FORGE_REBUILT':break;
  case 'TREASURE_REBUILT':
  awardVictoryPoints(s,p.id,2);s.log.push(`${p.name} gains 2 VP from the Treasure Room.`);drawExtraEvent(s);break;
  case 'ORACLE_STANDARD':case 'ABYSS_STANDARD': {
  if(p.discard.length) {
   const card=p.discard.splice(Math.floor(resolutionRandom(s)*p.discard.length),1)[0];
   p.hand.push(card);s.log.push(`${p.name} retrieves ${card.name} from their discard.`);
  } else s.log.push(`${p.name}'s personal discard is empty.`);
  break;
  }
  case 'ORACLE_REBUILT': {
  p.personalDeck=shuffle([...p.personalDeck,...p.discard],()=>resolutionRandom(s));p.discard=[];
  if(!p.personalDeck.length){s.log.push(`${p.name}'s grimoire is empty.`);break;}
  const cardId=askChoice(s,p.id,`oracle-draw|${p.id}|${room!.id}`,'Oracle Room: choose a card from your grimoire.',
   p.personalDeck.map(card=>({id:card.id,label:card.name})))!;
  const index=p.personalDeck.findIndex(card=>card.id===cardId);
  if(index>=0)p.hand.push(p.personalDeck.splice(index,1)[0]);
  break;
  }
  case 'ABYSS_REBUILT':moveAllMagesToStarts(s);break;
  case 'MIRRORS_REBUILT':break;
  case 'ARMORY_STANDARD':case 'PLEASURE_STANDARD':drawPersonalCards(s,p,1);break;
  case 'ARMORY_REBUILT': {
  const numbered=(['slot1','slot2','slot3'] as const).filter(slot=>p.prepared[slot]);
  const cards=getCentralDiscardOptions(p);
  if(!numbered.length||!cards.length){s.log.push('Armory Room needs a revealed numbered spell and a card in hand.');break;}
  const slotId=numbered.length===1?numbered[0]:askChoice(s,p.id,`armory-slot|${p.id}`,'Armory Room: choose a revealed numbered spell to replace.',
   numbered.map(slot=>({id:slot,label:`${slot}: ${p.prepared[slot]!.card.name}`})))!;
  const slot=numbered.find(candidate=>candidate===slotId)!;
  const cardId=cards.length===1?cards[0].id:askChoice(s,p.id,`armory-card|${p.id}`,'Armory Room: choose a card from your hand.',
   cards.map(card=>({id:card.id,label:card.name})))!;
  const replacement=cards.find(card=>card.id===cardId)!;
  const previous=p.prepared[slot]!.card;
  p.hand.splice(p.hand.indexOf(replacement),1);
  p.hand.push(previous);p.prepared[slot]={card:replacement,used:false};
  awardVictoryPoints(s,BLACK_ROSE_ID,1);break;
  }
  case 'PLEASURE_REBUILT':drawAndDiscardQuests(s,p,3,2);break;
  case 'THRONE_STANDARD': {
  const before=p.victoryPoints;
  awardVictoryPoints(s,p.id,-1);
  s.firstPlayerId=p.id;
  if(p.victoryPoints<before) s.log.push(`${p.name} loses 1 VP and takes the first-player token.`);
  else s.log.push(`${p.name} takes the first-player token without losing any VP.`);
  break;
  }
  case 'THRONE_REBUILT':
  s.firstPlayerId=p.id;awardVictoryPoints(s,p.id,1);
  s.log.push(`${p.name} takes the first-player token and gains 1 VP.`);break;
 }
 };
 const afterRoomEffect=()=>{
 if(effectResolution.summoned)progressTriggeredQuests(s,p,{event:'SPELL_EFFECT',summon:true});
 if(s.board.rooms.reduce((total,candidate)=>total+candidate.instability,0)>instabilityBefore)progressTriggeredQuests(s,p,{event:'INSTABILITY_EFFECT'});
 if(room!.color)progressTriggeredQuests(s,p,{event:'ROOM_EFFECT',roomColor:room!.color});
 if(room!.color==='amber'||room!.color==='emerald')progressJinx(s,p,'WEAKNESS');
 // Reactions to a room activation (Suffocation) resolve after the room's effect.
 modelEvent(s,'ROOM_ACTIVATED',actor,actor,room!.id);
 };
 const roomStep=(label:string,run:()=>void):EffectStep=>({label:`${room!.name} · ${label}: `,text:'',run});
 if(effect==='FORGE_REBUILT') {
  const forge:Array<['move'|'attack',string]>=[['move','Forge move 1'],['move','Forge move 2'],['attack','Forge attack 1'],['move','Forge move 3'],['move','Forge move 4'],['attack','Forge attack 2']];
  resolveEffect(s,undefined,forge.map(([kind,label])=>roomStep(label,()=>kind==='move'?roomSequenceMove(s,p,label):roomSequenceAttack(s,p,label))),()=>atMomentEnd(s,afterRoomEffect));
 } else if(effect==='MIRRORS_REBUILT') {
  resolveEffect(s,undefined,[{...roomStep('copy a room effect',()=>copyRoomEffect(s,p,room!,position)),unwrapped:true}],()=>atMomentEnd(s,afterRoomEffect));
 } else resolveEffect(s,undefined,[roomStep('room effect',()=>{applyRoomMoments();afterRoomEffect();})]);
}

function endExplore(s:GameState,p:Player,activate:boolean,targetRoomId?:string) {
 const a=s.activation!;
 assert(!a.mustExitCell || !isInStartingRoom(s,p),'Use your remaining action to leave the cell before finishing movement');
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

/** Slot readiness, independent of targeting/location so a cell exit is possible. */
export function getReadyPreparedSlots(p:Player,activation:Activation|null=null):(keyof Player['prepared'])[] {
 const next=slots.find(slot=>p.prepared[slot]&&!p.prepared[slot]!.used);
 return [...(next&&!activation?.sequencedSpellUsed?[next]:[]),...(p.prepared.rapid&&!p.prepared.rapid.used?['rapid' as const]:[])];
}

export function getDiscardMoveCards(p:Player,_activation:Activation|null=null):Card[] {
 // Discarding is not casting: any unspent preparation is eligible regardless
 // of numbered order or this turn's numbered-cast quota.
 return ([...slots,'rapid'] as const).flatMap(slot=>{
  const prepared=p.prepared[slot];
  return prepared&&!prepared.used&&!prepared.card.powerful?[prepared.card]:[];
 });
}

function hasExitDestination(s:GameState,p:Player):boolean {
 return s.board.tiles.some(h=>areAdjacent(p.wizard.position,h)&&!s.board.rooms.some(r=>r.startingFor&&r.tiles.some(t=>hexKey(t)===hexKey(h))));
}

export function mustLeaveCell(s:GameState,p:Player):boolean {
 const a=s.activation;
 if(s.phase!=='ACTION'||s.currentPlayerId!==p.id||a?.playerId!==p.id||!isInStartingRoom(s,p))return false;
 if(a.mustExitCell)return true;
 if(ACTIONS_PER_TURN-a.actionsUsed!==1)return false;
 const destination=hasExitDestination(s,p);
 const discard=!a.discardedExit&&getDiscardMoveCards(p,a).length>0;
 return destination&&((p.actionTokens>0&&getMageMovement(p)>0)||discard);
}

export function canPlayerAct(s: GameState, p: Player): boolean {
 const a=s.activation?.playerId===p.id?s.activation:null;
 if(a?.physicalAction || a?.exploring)return true;
 if(p.passed)return false;
 if((a?.actionsUsed??0)>=ACTIONS_PER_TURN)return false;
 if(p.actionTokens>0)return true;
 if(!a?.discardedExit&&getDiscardMoveCards(p,a).length>0&&hasExitDestination(s,p))return true;
 if(isInStartingRoom(s,p))return false;
 const spells=getReadyPreparedSlots(p,a).map(slot=>p.prepared[slot]);
 return spells.some(prepared=>{
  if(!prepared || prepared.used)return false;
  // The side chosen during Preparation is the only one this prepared spell can use.
  const canCastFace=(card:Card)=>{
  if(card.target==='ROOM' || canUseSpellDummy(card))return s.board.rooms.some(r=>!r.startingFor && r.tiles.some(h=>isWithinSpellRange(p.wizard.position,h,card.range)));
  const legal=(ownerId:string,kind:'MAGE'|'EVOCATION',position:Hex,evocation?:Evocation)=>spellCanTargetModel(card,p.id,ownerId,kind)
   && spellFilterAllows(card,p.id,{playerId:ownerId,evocation})
   && !s.board.rooms.some(r=>r.startingFor && r.tiles.some(h=>hexKey(h)===hexKey(position)))
   && isWithinSpellRange(p.wizard.position,position,card.range);
  return s.players.some(t=>legal(t.id,'MAGE',t.wizard.position)) || s.evocations.some(e=>legal(e.playerId,'EVOCATION',e.position,e));
  };
  if(prepared.side==='DARK') {
   const dark=getDarkSideSpell(prepared.card);
   return ['TRAP','PROTECTION'].includes(getSpellType(dark))?!!dark.trigger:canCastFace(dark);
  }
  const card=prepared.card;
  if(['TRAP','PROTECTION'].includes(getSpellType(card)))return !!card.trigger;
  return canCastFace(card);
 });
}

export function canPassActionPhase(s:GameState,p:Player):boolean {
 const a=s.activation?.playerId===p.id?s.activation:null;
 if(a?.physicalAction || a?.exploring || s.evocationActivation?.playerId===p.id)return false;
 return p.actionTokens===0 && !Object.values(p.prepared).some(c=>c&&!c.used);
}

function recordRecapCard(s:GameState,role:TurnRecapCard['role'],ownerId:string,card:Card,trigger?:TriggerEvent,side?:SpellSide) {
 const draft=s.turnRecapDraft;
 if(draft)draft.cards.push({at:s.log.length-draft.logStart,role,ownerId,card:{...card},...(side==='DARK'?{side}:{}),...(trigger?{trigger}:{})});
}

function startActivation(s: GameState, p: Player) {
 s.currentPlayerId=p.id; s.activation={playerId:p.id,actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false,physicalAction:null};
 s.turnRecapDraft={playerId:p.id,logStart:s.log.length,cards:[]};
 s.log.push(`${p.name} starts their turn: 2 actions total across physical actions, spell casts, and discard-to-move.`);
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
  const leaders=[...s.players,{id:BLACK_ROSE_ID,name:'BR',victoryPoints:s.blackRose.victoryPoints,questsCompleted:0,trophies:s.blackRose.trophies}].sort((a,b)=>compareFinalStanding(a,b,s.firstPlayerId));
  s.phase='GAME_OVER';s.winner=leaders[0].id;
  s.log.push(`${leaders[0].name} wins with ${leaders[0].victoryPoints} VP!`);
 }
}

function scoreEndgame(s:GameState) {
 if(s.endgameScored)return;
 s.endgameScored=true;
 const categories=[
  {label:'trophy tokens majority',counts:{...Object.fromEntries(s.players.map(p=>[p.id,p.trophies.length])),[BLACK_ROSE_ID]:s.blackRose.trophies.length}},
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
 s.log.push(`${getPlayer(s,id).name} ends their turn.`);
 const draft=s.turnRecapDraft;
 if(draft) {
  const owner=getPlayer(s,draft.playerId),recaps=s.turnRecaps??=[];
  recaps.push({id:`${s.round}:${draft.playerId}:${draft.logStart}`,round:s.round,playerId:owner.id,playerName:owner.name,isBot:owner.isBot===true,lines:s.log.slice(draft.logStart),cards:draft.cards});
  if(recaps.length>TURN_RECAP_LIMIT)recaps.splice(0,recaps.length-TURN_RECAP_LIMIT);
  s.turnRecapDraft=null;
 }
 s.activation=null;
 const start=s.players.findIndex(p=>p.id===id);
 for(let offset=1;offset<=s.players.length;offset++) {
  const next=s.players[(start+offset)%s.players.length];
    if(canPlayerAct(s,next)) { startActivation(s,next); return; }
 }
 startEvocationPhase(s);
}

// Seat order starting at the first-player token holder (seat order when none).
function seatOrder(s:GameState):Player[] {
 const first=Math.max(0,s.players.findIndex(p=>p.id===s.firstPlayerId));
 return [...s.players.slice(first),...s.players.slice(0,first)];
}

function startEvocationPhase(s:GameState) {
 s.phase='EVOCATION';s.activation=null;s.evocationActivation=null;
 for(const e of s.evocations)e.activated=false;
 const ready=s.players.map(player=>({player,models:s.evocations.filter(e=>e.playerId===player.id&&!e.activated)})).filter(({models})=>models.length>0);
 const roster=ready.map(({player,models})=>`${player.name}: ${models.map(e=>`${e.name} #${e.number??1}`).join(', ')}`).join('; ');
 s.log.push(`EVOCATION — alternate owners; each ready mage-controlled evocation activates once.${roster?` Ready models by owner: ${roster}.`:' No mage-controlled evocations are ready.'}`);
 activateNightmaresAtPhaseStart(s);
 const first=seatOrder(s).find(p=>s.evocations.some(e=>e.playerId===p.id&&!e.activated));
 if(first)s.currentPlayerId=first.id;else cleanup(s);
}

function finishEvocation(s:GameState) {
 const active=s.evocationActivation!;s.evocationActivation=null;
 // A spell's temporary attack bonus ends with the activation; Silver of the Sages then hurts it.
 const done=s.evocations.find(e=>e.id===active.evocationId);
 if(done) {
  delete done.bonusAttack;
  delete done.bonusMovement;
  if(active.endDamage)damageEvocation(s,done,active.endDamage);
 }
 if(active.tendon){s.currentPlayerId=null;if(!nextTendonMove(s))beginStudyIfQuestsFit(s,true);return;}
 if(active.resume) {
  s.currentPlayerId=active.resume.currentPlayerId;
  s.evocationActivation=active.resume.evocationActivation;
  if(s.evocationActivation) {
   const resumed=s.evocationActivation;
   if(!s.evocations.some(e=>e.id===resumed.evocationId)||(resumed.attackUsed&&resumed.movesRemaining===0))finishEvocation(s);
  } else afterAction(s);
  return;
 }
 if(active.returnToAction){afterAction(s);return;}
 const start=s.players.findIndex(p=>p.id===active.playerId);
 for(let offset=1;offset<=s.players.length;offset++) {
  const p=s.players[(start+offset)%s.players.length];
  if(s.evocations.some(e=>e.playerId===p.id&&!e.activated)){s.currentPlayerId=p.id;return;}
 }
 cleanup(s);
}

function requireEvocation(s:GameState,id:string) {
 assert(s.phase==='ACTION'||s.phase==='EVOCATION'||(s.phase==='BLACK_ROSE'&&!!s.evocationActivation?.tendon),'Evocation activation unavailable in this phase');
 const active=s.evocationActivation;assert(active&&active.playerId===id&&s.currentPlayerId===id,'No active evocation for this player');
 const e=s.evocations.find(e=>e.id===active!.evocationId);assert(e&&(e.playerId===id||e.playerId===active!.borrowedFrom)&&e.damageCubes<e.health,'Evocation unavailable');
 return {active:active!,e:e!};
}

// Tendon implants: at the end of the Black Rose phase each such model may move.
function nextTendonMove(s:GameState):boolean {
 const queue=s.tendonQueue??[];
 while(queue.length) {
  const e=s.evocations.find(model=>model.id===queue.shift());
  if(!e)continue;
  s.tendonQueue=queue;
  s.evocationActivation={evocationId:e.id,playerId:e.playerId,movesRemaining:evocationMovement(e),returnToAction:false,attackUsed:true,tendon:true};
  s.currentPlayerId=e.playerId;
  s.log.push(`${getPlayer(s,e.playerId).name}: ${e.name} #${e.number??1} may move up to ${evocationMovement(e)} (Tendon implant).`);
  return true;
 }
 delete s.tendonQueue;
 return false;
}
function startTendonMoves(s:GameState):boolean {
 s.tendonQueue=s.players.flatMap(p=>s.evocations.filter(e=>e.playerId===p.id&&e.upgrade==='TENDON_IMPLANT'&&evocationMovement(e)>0).map(e=>e.id));
 return nextTendonMove(s);
}

function afterAction(s: GameState) {
 const a=s.activation;if(!a)return;
 if(s.evocationActivation || a.physicalAction || a.exploring>0) return;
 const p=getPlayer(s,a.playerId);
 // A free reward earned by the last paid action is still usable this turn.
 // Do not schedule extra quest-only turns: End turn retains its usual handoff.
 const rewardReady=heldQuests(p).some(q=>q.completed&&!q.claimed&&(!q.rewardAction||getQuestRewardTargets(s,p,q.rewardAction).length>0));
 if(!canPlayerAct(s,p) && !rewardReady) finishActivation(s);
}

// The evocation a SUMMON step creates: a fixed kind, the model just lost, or one the owner picks among the
// summonable kinds within the health limit that still have a model in the shared supply.
function resolveSummonKind(s:GameState,owner:Player,step:{kind:EvocationKind|'EVENT_MODEL'|'CHOICE';maxHealth?:number},effect?:EffectResolution):EvocationKind|undefined {
 if(step.kind==='EVENT_MODEL')return effect?.eventKind;
 if(step.kind!=='CHOICE')return step.kind;
 const label=context(s).resolving?.sourceCard?.name??'Summon',supply=getEvocationSupply(s);
 const kinds=(Object.keys(EVOCATION_TYPES) as EvocationKind[]).filter(kind=>kind!=='UMBRA'&&supply[kind]>0&&(step.maxHealth===undefined||EVOCATION_TYPES[kind].health<=step.maxHealth));
 if(!kinds.length){s.log.push(`${label}: no evocation can be summoned.`);return;}
 if(kinds.length===1)return kinds[0];
 const id=askChoice(s,owner.id,`summon-kind|${owner.id}|${label}`,`${label}: choose an evocation to summon${step.maxHealth!==undefined?` (max ${step.maxHealth} health)`:''}.`,
  kinds.map(kind=>({id:kind,label:`${EVOCATION_TYPES[kind].name} · ${EVOCATION_TYPES[kind].health} health`})));
 return kinds.find(kind=>kind===id)??kinds[0];
}
function summonForEffect(s:GameState,owner:Player,kind:EvocationKind,position:Hex,effect?:EffectResolution) {
 const evocation=summonEvocation(s,owner,kind,position);
 if(effect)effect.summoned=evocation?snapshot(s,evocation.id):undefined;
 if(!evocation)return;
 // Models summoned during the Evocation phase still take their activation this phase.
 const duringEvocation=s.phase==='EVOCATION';
 evocation.activated=!effect?.activationIsExplicit&&!duringEvocation;
 s.log.push(effect?.activationIsExplicit||duringEvocation?`${owner.name} summons ${evocation.name}.`:`${owner.name} summons and activates ${evocation.name}.`);
}
function activateEffectSummon(s:GameState,owner:Player,kind:EvocationKind|'EVENT_MODEL',effect?:EffectResolution) {
 const evocation=liveModel(s,effect?.summoned)?.evocation;
 const expected=kind==='EVENT_MODEL'?effect?.eventKind:kind;
 // A failed summon or a destroyed model must never activate a different servant.
 if(!evocation||!expected||evocation.playerId!==owner.id||evocation.name!==EVOCATION_TYPES[expected].name)return;
 // A model lost outside the Action and Evocation phases cannot take an activation.
 if(s.phase!=='ACTION'&&s.phase!=='EVOCATION'){s.log.push(`${evocation.name} cannot activate outside the Action and Evocation phases.`);return;}
 beginSpellActivation(s,owner,evocation);
}
// A spell grants `controller` one activation of any evocation, outside the normal token
// economy. A model owned by another mage takes the controller's color for it.
function beginSpellActivation(s:GameState,controller:Player,evocation:Evocation,opts:{endDamage?:number}={}) {
 assert(s.phase==='ACTION'||s.phase==='EVOCATION','Resolve the spell activation during the Action or Evocation phase');
 assert(evocation.damageCubes<evocation.health,'Evocation is defeated');
 const resume=s.currentPlayerId!==controller.id||!!s.evocationActivation||s.phase==='EVOCATION'
  ? {currentPlayerId:s.currentPlayerId,evocationActivation:s.evocationActivation}:undefined;
 const borrowed=evocation.playerId!==controller.id;
 if(!borrowed)evocation.activated=true;
 s.evocationActivation={evocationId:evocation.id,playerId:controller.id,movesRemaining:evocationMovement(evocation),returnToAction:s.phase==='ACTION',...(borrowed?{borrowedFrom:evocation.playerId}:{}),...(resume?{resume}:{}),...(opts.endDamage?{endDamage:opts.endDamage}:{})};
 s.currentPlayerId=controller.id;
 s.log.push(`${controller.name} activates ${borrowed?`${getPlayer(s,evocation.playerId).name}'s `:''}${evocation.name} #${evocation.number??1} from the spell (no extra action or token): move ${evocationMovement(evocation)}, attack ${evocationAttack(evocation)}${borrowed?'; it fights for the controller':''}.`);
 modelEvent(s,'EVOCATION_ACTIVATED',snapshot(s,evocation.id)!);
}
const inRoomPosition=(room:Room,position:Hex)=>room.tiles.some(h=>hexKey(h)===hexKey(position));
// Owner picks any non-starting room (Fountain of the Three).
function chooseRoomPosition(s:GameState,caster:Player,spell:Card):Hex|undefined {
 const rooms=s.board.rooms.filter(r=>!r.startingFor);
 if(!rooms.length)return;
 const id=askChoice(s,caster.id,`room|${caster.id}|${spell.id}`,`${spell.name}: choose a room.`,rooms.map(r=>({id:r.id,label:r.name,roomId:r.id})))!;
 return rooms.find(r=>r.id===id)?.tiles[0];
}
// The caster chooses one model damaged by this effect and moves it up to `distance` spaces.
function moveDamaged(s:GameState,caster:Player,spell:Card,distance:number,effect:EffectResolution) {
 const live=(effect.damaged??[]).filter(ref=>!!liveModel(s,ref));
 if(!live.length){s.log.push(`${spell.name}: no damaged model to move.`);return;}
 const name=(ref:ModelSnapshot)=>modelFeedbackTarget(s,ref)!.name;
 const refId=live.length===1?live[0].id:askChoice(s,caster.id,`move-who|${caster.id}|${spell.id}`,`${spell.name}: choose a damaged model to move.`,live.map(r=>({id:r.id,label:name(r)})),true);
 const ref=live.find(r=>r.id===refId);
 if(ref)chooseMove(s,caster,spell,ref,distance);
}
// The caster picks where a live model goes, up to `distance` spaces away (never into a starting cell).
function chooseMove(s:GameState,caster:Player,spell:Card,ref:ModelSnapshot,distance:number) {
 const name=(r:ModelSnapshot)=>modelFeedbackTarget(s,r)!.name;
 const live=liveModel(s,ref);
 if(!live)return;
 const model=live.model;
 const options=s.board.tiles.filter(h=>hexDistance(h,model.position)<=distance&&hexKey(h)!==hexKey(model.position)&&!s.board.rooms.some(r=>r.startingFor&&inRoomPosition(r,h)));
 if(!options.length)return;
 const hexId=askChoice(s,caster.id,`move-where|${caster.id}|${spell.id}`,`${spell.name}: move ${name(ref)} up to ${distance}.`,options.map(h=>{const r=roomAt(s,h);return {id:hexKey(h),label:r?.name??hexKey(h),...(r?{roomId:r.id}:{})};}),true);
 const dest=options.find(h=>hexKey(h)===hexId);
 if(dest){s.log.push(`${caster.name} moves ${name(ref)} to ${roomAt(s,dest)?.name??hexKey(dest)}.`);moveModel(s,ref,dest);}
}
// Silver of the Sages, Fountain of the Three: activate one of your own evocations from an effect.
function activateChoice(s:GameState,owner:Player,step:{archetype?:'CONSTRUCT'|'UNDEAD';attackBonus?:number;movementBonus?:number;endDamage?:number;near?:{range:number}},label:string,origin?:Hex) {
 if(s.phase!=='ACTION'&&s.phase!=='EVOCATION'){s.log.push(`${label}: evocations can only be activated in the Action or Evocation phase.`);return;}
 const options=s.evocations.filter(e=>e.playerId===owner.id&&!isControlledByOther(s,e)&&(!step.archetype||e.archetype===step.archetype)
  &&(!step.near||(!!origin&&isWithinSpellRange(origin,e.position,step.near.range))));
 if(!options.length){s.log.push(`${owner.name} has no eligible evocation to activate.`);return;}
 const id=options.length===1?options[0].id:askChoice(s,owner.id,`activate|${owner.id}|${label}`,`${label}: choose an evocation to activate.`,options.map(e=>({id:e.id,label:`${e.name} #${e.number??1}`})),true);
 const e=options.find(model=>model.id===id);
 if(!e)return;
 if(step.attackBonus)e.bonusAttack=(e.bonusAttack??0)+step.attackBonus;
 if(step.movementBonus)e.bonusMovement=(e.bonusMovement??0)+step.movementBonus;
 beginSpellActivation(s,owner,e,{endDamage:step.endDamage});
}
function roomOccupants(s:GameState,room:Room) {
 return [...s.players.filter(p=>p.wizard.alive&&inRoomPosition(room,p.wizard.position)).map(p=>snapshot(s,p.id)!),...s.evocations.filter(e=>inRoomPosition(room,e.position)).map(e=>snapshot(s,e.id)!)];
}
// Mechanical Archive: choose a school, look at its top cards, keep one, discard the rest.
function lookLibrary(s:GameState,p:Player,count:number) {
 const decks=s.library.filter(d=>d.cards.length+d.discard.length>0);
 if(!decks.length){s.log.push('No library school has cards to look at.');return;}
 const deckId=decks.length===1?decks[0].id:askChoice(s,p.id,`archive-school|${p.id}`,'Mechanical Archive: choose a school to look at.',decks.map(d=>({id:d.id,label:`${d.name} (${d.cards.length+d.discard.length} cards)`})))!;
 const deck=decks.find(d=>d.id===deckId)!;
 const seen:Card[]=[];
 for(let i=0;i<count;i++){const card=drawFromDiscard(s,deck.cards,deck.discard);if(!card)break;seen.push(card);}
 const pickId=seen.length===1?seen[0].id:askChoice(s,p.id,`archive-card|${p.id}`,`Mechanical Archive: take one of these ${deck.name} spells; the rest are discarded.`,seen.map(c=>({id:c.id,label:c.name})))!;
 const pick=seen.find(c=>c.id===pickId)!;
 p.hand.push(pick);
 deck.discard.push(...seen.filter(c=>c!==pick));
 s.log.push(`${p.name} looks at ${seen.length} ${deck.name} spells, takes one and discards ${seen.length-1}.`);
}
// `Card.instability`: place 1 instability in the caster's room. It is its own effect, resolved before the
// card's main effect, with its own log entry, EffectResolution and moment boundary. It is never one of the
// main effect's numbered moments, so quests/triggers that count moments or effects see it separately.
const PRINTED_INSTABILITY:TriggeredInstruction={effect:'INSTABILITY',amount:1,scope:'CASTER_ROOM',target:'OWNER'};
// The caster's position while that life is on the board; afterwards, where it stood when defeated. A defeated
// caster respawns in its starting cell, but the spell keeps resolving where it was cast.
function casterPosition(s:GameState,caster:Player,actor:ModelSnapshot|undefined,effect?:EffectResolution):Hex {
 const seen=effect?.casterSeen,live=liveModel(s,actor);
 if(live){
  if(seen)seen.position={...live.model.position};
  return live.model.position;
 }
 return seen?.position??caster.wizard.position;
}
// One Moment of an Effect, ready to resolve. `skip` returns why the Moment cannot be applied at all.
type EffectStep={label:string;text:string;resolving?:string;skip?:()=>string|undefined;run:()=>void;unwrapped?:boolean};
/**
 * The single place where an Effect resolves: Moments run in order, each as a complete step with its own
 * moment boundary (interrupts finish before the next Moment). A Moment that cannot be applied is skipped
 * and the next one is attempted. The Effect is resolved once every Moment was attempted, so `onResolved`
 * (quest/trigger counting per Effect) runs even if nothing could be applied.
 */
function resolveEffect(s:GameState,source:Card|undefined,steps:EffectStep[],onResolved?:()=>void) {
 for(const step of steps) {
  const ctx=context(s),previous=ctx.resolving;
  if(step.resolving!==undefined||source)ctx.resolving={...(source?{sourceCard:source}:{}),...(step.resolving!==undefined?{moment:step.resolving}:{})};
  try{
  if(step.unwrapped){step.run();continue;}
  atMomentEnd(s,()=>{
   const reason=step.skip?.();
   if(reason){s.log.push(`${step.label}skipped; ${reason}.`);return;}
   if(step.text)s.log.push(`${step.label}${step.text}`);
   step.run();
  });}finally{ctx.resolving=previous;}
 }
 onResolved?.();
}
function resolveInstabilityEffect(s:GameState,owner:Player,spell:Card,actor:ModelSnapshot|undefined,total:number,seen:{position:Hex},damageOrigin:DamageOrigin='SPELL') {
 const effect:EffectResolution={activationIsExplicit:false,casterSeen:seen};
 const instruction:TriggeredInstruction={...PRINTED_INSTABILITY,target:'BOUND_ROOM'};
 resolveEffect(s,spell,[{label:`Effect 1/${total} · ${spell.name}: `,text:describeInstruction(PRINTED_INSTABILITY),resolving:describeInstruction(instruction),run:()=>{
  const room=roomAt(s,casterPosition(s,owner,actor,effect));
  if(room)resolveInstruction(s,owner,instruction,undefined,room.id,actor,effect,damageOrigin);
 }}],()=>{if((effect.instabilityPlaced??0)>0)progressTriggeredQuests(s,owner,{event:'INSTABILITY_EFFECT'});});
}
function resolveEffectMoments(s:GameState,caster:Player,spell:Card,room:Room|undefined,refs:ModelSnapshot[],actor:ModelSnapshot,damageOrigin:DamageOrigin='SPELL',protectedTargets=new Set<string>(),preventMainEffect=false,spellEvent?:SpellEvent) {
 const seen={position:{...caster.wizard.position}};
 const effect:EffectResolution={activationIsExplicit:getAllMoments(spell).some(step=>step.effect==='ACTIVATE_EVOCATION'),casterSeen:seen,protectedTargets,trapsAtStart:context(s).trapsTriggered??0,...(spellEvent?{spellEvent}:{})};
 // The chosen model and where it stands, remembered while it is still on the board.
 const chosen=spell.target==='ROOM'?undefined:refs[0];
 let origin=chosen?liveModel(s,chosen)?.model.position:room?.tiles[0];
 // The card's Effects in order: PLACE 1 (if unstable) then MAIN. Spell, quest-reward and reaction casts all share this path.
 const effects=getSpellEffects(spell);
 for(const [effectIndex,def] of effects.entries()) {
  if(def.kind==='PLACE'){resolveInstabilityEffect(s,caster,spell,actor,effects.length,seen,damageOrigin);continue;}
  if(effects.length>1)s.log.push(`Effect ${effectIndex+1}/${effects.length} · ${spell.name}: main effect.`);
  if(preventMainEffect){s.log.push(`${spell.name}: its main effect is ignored.`);return;}
  const targetKind=spell.target==='SELF'?'OWNER':spell.target==='ROOM'?'BOUND_ROOM':'BOUND_MODEL';
  const steps:EffectStep[]=def.moments.map((step,index)=>{
   const label=`Moment ${index+1}/${def.moments.length} · ${spell.name}: `;
   let live:ReturnType<typeof liveModel>;
   return {label,text:describeInstruction({...step,target:targetKind}),resolving:describeInstruction({...step,target:targetKind}),
    skip:()=>{
     live=liveModel(s,chosen);
     if(live)origin={...live.model.position};
     if(step.when==='TARGET_DEFEATED'&&(!chosen||live))return chosen?'the target was not defeated':'there is no target';
     if(step.when==='TARGET_JINXED'&&!(live?.mage&&getMageJinxes(live.mage).length))return 'the target carries no jinx';
     if(step.when==='UPGRADE_ASSIGNED'&&!effect.upgraded)return 'no upgrade was assigned';
     if(step.when==='EVOCATION_REMOVED'&&!effect.removed)return 'no evocation was removed';
     if(step.when==='VP_LOST'&&!effect.vpLost)return 'no victory point was lost';
     if(step.when==='UPGRADE_DISCARDED'&&!effect.upgradeDiscarded)return 'no upgrade was discarded';
     if(step.when==='TARGET_UPGRADED'&&!live?.evocation?.upgrade)return 'the target has no upgrade';
     if(step.when==='TARGET_HAS_3_NIGHTMARES'&&!(live?.mage&&nightmaresOf(s,live.mage.id).length>=3))return 'the target does not carry 3 Nightmares';
     if(step.when==='PAIN_RESOLVED'&&!effect.painResolved)return 'no Pain was suffered';
     return undefined;
    },
    run:()=>{
     let stepRefs=refs;
     const area=step.area;
     if(area?.choose) {
      // One different model of the caster's choice (enemy models only, never in a starting cell).
      const near=origin?[...s.players.filter(p=>p.wizard.alive&&p.id!==caster.id&&p.wizard.id!==chosen?.id&&!isInStartingRoom(s,p)&&hexDistance(origin!,p.wizard.position)<=area.range).map(p=>snapshot(s,p.id)!),
       ...s.evocations.filter(e=>e.playerId!==caster.id&&e.id!==chosen?.id&&!roomAt(s,e.position)?.startingFor&&hexDistance(origin!,e.position)<=area.range).map(e=>snapshot(s,e.id)!)]:[];
      let picked=near[0];
      if(near.length>1) {
       const id=askChoice(s,caster.id,`near-target|${caster.id}|${spell.id}|${index}`,`${spell.name}: choose a different model within range ${area.range} of the target.`,
        near.map(ref=>({id:ref.id,label:modelFeedbackTarget(s,ref)?.name??ref.id})))!;
       picked=near.find(ref=>ref.id===id)??near[0];
      }
      stepRefs=picked?[picked]:[];
     } else if(area) {
      // Every other mage near the chosen model's last position; evocations are not mages.
      stepRefs=origin?s.players.filter(p=>p.wizard.alive&&p.wizard.id!==chosen?.id&&hexDistance(origin!,p.wizard.position)<=area.range).map(p=>snapshot(s,p.id)!):[];
     }
     resolveMomentBody(s,caster,spell,step,room,stepRefs,actor,effect,damageOrigin);
    }};
  });
  resolveEffect(s,spell,steps,()=>{
   if((effect.instabilityPlaced??0)>0)progressTriggeredQuests(s,caster,{event:'INSTABILITY_EFFECT'});
   if(def.moments.length&&(damageOrigin==='SPELL'||effect.summoned)) {
    const isSpellEffect=damageOrigin==='SPELL';
    const elements=isSpellEffect?getRevealedElements(s,caster,spell):undefined;
    if(elements&&spell.element)elements.push(spell.element);
    progressTriggeredQuests(s,caster,{event:'SPELL_EFFECT',...(isSpellEffect?{spellType:getSpellType(spell),elements}:{}),summon:!!effect.summoned});
   }
  });
 }
}
function resolveMomentBody(s:GameState,caster:Player,spell:Card,step:Moment,room:Room|undefined,refs:ModelSnapshot[],actor:ModelSnapshot,effect:EffectResolution,damageOrigin:DamageOrigin) {
 // Wound-dependent amounts are read when the Moment resolves, from the chosen model (before any scope change).
 if(step.scale&&'amount' in step)step={...step,amount:scaledAmount(s,caster,step,refs[0],effect,spell)} as Moment;
 if(step.scope==='ALL_MAGES')refs=s.players.filter(p=>p.wizard.alive).map(p=>snapshot(s,p.id)!);
 if(step.scope==='DAMAGED')refs=(effect.damaged??[]).filter(ref=>!!liveModel(s,ref));
 if(step.scope==='MOVED')refs=effect.moved&&liveModel(s,effect.moved)?[effect.moved]:[];
 if(step.scope==='TARGET_ROOM')refs=room?roomOccupants(s,room):[];
 if(step.magesOnly)refs=refs.filter(ref=>ref.kind==='MAGE');
 if(step.scope==='CASTER'){const self=snapshot(s,caster.id);refs=self&&liveModel(s,self)?[self]:[];}
 if(step.scope==='CASTER_ROOM') {
  const origin=room??roomAt(s,casterPosition(s,caster,actor,effect));
  refs=origin?[...s.players.filter(p=>inRoom(p,origin)).map(p=>snapshot(s,p.id)!),...s.evocations.filter(e=>origin.tiles.some(h=>hexKey(h)===hexKey(e.position))).map(e=>snapshot(s,e.id)!)]:[];
 }
 if(effect.protectedTargets)refs=refs.filter(ref=>!effect.protectedTargets!.has(ref.id));
 if(step.effect==='PAIN') {
  if(step.optional) {
   const accepted=askChoice(s,caster.id,`optional-pain|${caster.id}|${spell.id}`,`${spell.name}: suffer ${step.amount} Pain?`,[{id:'PAIN',label:`Suffer ${step.amount} Pain`}],true);
   if(accepted!=='PAIN'){s.log.push(`${caster.name} declines the Pain.`);return;}
  }
  damage(s,caster,step.amount);
  effect.painResolved=true;
  return;
 }
 if(step.effect==='MOVE_ROOM_MAGE') {
  const mages=room?s.players.filter(p=>p.wizard.alive&&inRoom(p,room)):[];
  if(!mages.length){s.log.push(`${spell.name}: no mage in the target room.`);return;}
  const id=mages.length===1?mages[0].id:askChoice(s,caster.id,`room-mage|${caster.id}|${spell.id}`,`${spell.name}: choose a mage in ${room!.name} to move.`,mages.map(p=>({id:p.id,label:p.name})))!;
  const mage=mages.find(p=>p.id===id)??mages[0];
  chooseMove(s,caster,spell,snapshot(s,mage.id)!,step.distance);
  return;
 }
 if(step.effect==='GAIN_VP_PER_TRAP') {
  const traps=(context(s).trapsTriggered??0)-(effect.trapsAtStart??0);
  if(traps>0){awardVictoryPoints(s,caster.id,traps);s.log.push(`${caster.name} gains ${traps} VP from triggered Traps.`);}
  else s.log.push(`${spell.name}: no Trap was triggered.`);
  return;
 }
 if(step.effect==='DEFEAT_TARGET') {
  for(const ref of refs) {
   const mage=liveModel(s,ref)?.mage;
   if(!mage||mage.id===caster.id)continue;
   const remaining=Math.max(0,mage.wizard.health-mage.wizard.damageCubes);
   if(remaining>0)damage(s,mage,remaining,caster,actor,damageOrigin);
  }
  return;
 }
 if(step.effect==='DRAW_QUESTS_PER_NIGHTMARE') {
  const count=s.evocations.filter(isNightmare).length;
  const drawn:Quest[]=[];
  for(let i=0;i<count;i++) {
   const quest=drawQuest(s);
   if(!quest){s.log.push(`${spell.name}: no more quest cards are available.`);break;}
   drawn.push(quest);
   if(caster.quest)caster.additionalQuests.push(quest);else caster.quest=quest;
  }
  if(!drawn.length){s.log.push(`${spell.name}: no quest drawn.`);return;}
  s.log.push(`${caster.name} draws ${drawn.length} quest${drawn.length===1?'':'s'}.`);
  const id=drawn.length===1?drawn[0].id:askChoice(s,caster.id,`ephialtes-quest|${caster.id}|${spell.id}`,`${spell.name}: choose one of the drawn quests to discard.`,drawn.map(q=>({id:q.id,label:q.name})))!;
  const discarded=drawn.find(q=>q.id===id)??drawn[0];
  s.questDiscard.push(discarded);
  if(caster.quest?.id===discarded.id)caster.quest=caster.additionalQuests.shift()??null;
  else caster.additionalQuests=caster.additionalQuests.filter(q=>q.id!==discarded.id);
  s.log.push(`${caster.name} discards the quest “${discarded.name}”.`);
  return;
 }
 if(step.effect==='SUMMON') {
  const target = refs[0] ? liveModel(s, refs[0]) : undefined;
  const kind=resolveSummonKind(s,caster,step,effect);
  const position = step.position === 'TARGET' ? target?.model.position??room?.tiles[0] : step.position==='REMOVED' ? effect.removed?.position : step.position==='EVENT' ? effect.eventPosition : step.position==='CHOICE' ? chooseRoomPosition(s,caster,spell) : casterPosition(s,caster,actor,effect);
  if(!position||!kind)return;
  summonForEffect(s,caster,kind,position,effect);
  return;
 }
 if(step.effect==='ACTIVATE_CHOICE') {
  activateChoice(s,caster,step,spell.name);
  return;
 }
 if(step.effect==='LOSE_VP') {
  for(const ref of refs) {
   const mage=liveModel(s,ref)?.mage;
   if(!mage||(mage.id===caster.id&&step.scope!=='CASTER'))continue;
   const before=mage.victoryPoints;
   awardVictoryPoints(s,mage.id,-step.amount);
   if(mage.victoryPoints===before)s.log.push(`${mage.name} has no victory points to lose.`);
   else effect.vpLost=(effect.vpLost??0)+(before-mage.victoryPoints);
  }
  return;
 }
 if(step.effect==='ATTACK_BONUS') {
  const e=liveModel(s,refs[0])?.evocation;
  if(e){e.bonusAttack=(e.bonusAttack??0)+step.amount;s.log.push(`${e.name} #${e.number??1} gets +${step.amount} attack on its next activation.`);}
  return;
 }
 if(step.effect==='MOVE_DAMAGED') {
  moveDamaged(s,caster,spell,step.distance,effect);
  return;
 }
 if(step.effect==='ACTIVATE_ROOM') {
  const live=liveModel(s,refs[0]),at=live?roomAt(s,live.model.position):undefined;
  if(!live||!at||!getRoomEffect(at)||at.startingFor||getRoomEffect(at)==='DRAW_POWERFUL'){s.log.push(`${spell.name}: no room effect to activate.`);return;}
  activateRoomBody(s,caster,undefined,{room:at,position:{...live.model.position}});
  return;
 }
 if(step.effect==='ACTIVATE_EVOCATION') {
  activateEffectSummon(s,caster,step.kind,effect);
  return;
 }
 if(step.effect==='ASSIGN_UPGRADE') {
  const e=step.to==='SUMMONED'?liveModel(s,effect.summoned)?.evocation:liveModel(s,refs[0])?.evocation;
  effect.upgraded=assignUpgrade(s,e,step.upgrade,caster);
  return;
 }
 if(step.effect==='DISCARD_UPGRADE') {
  if(discardUpgrade(s,liveModel(s,refs[0])?.evocation))effect.upgradeDiscarded=true;
  return;
 }
 if(step.effect==='ACTIVATE_TARGET') {
  const e=liveModel(s,refs[0])?.evocation;
  if(e)beginSpellActivation(s,caster,e);
  return;
 }
 if(step.effect==='REMOVE_EVOCATION'&&step.chosen) {
  const e=liveModel(s,refs[0])?.evocation;
  if(!e)return;
  effect.removed={position:{...e.position},attack:evocationAttack(e),roomId:roomAt(s,e.position)?.id};
  removeEvocation(s,e,'removed');
  return;
 }
 if(step.effect==='REMOVE_EVOCATION') {
  // The chosen evocation anchors the room (a room spell anchors on its target room); dummies and defeated anchors remove nothing.
  const anchor=liveModel(s,refs[0])?.evocation,origin=spell.target==='ROOM'&&refs.length?room:anchor?roomAt(s,anchor.position):undefined;
  if(!origin)return;
  const options=s.evocations.filter(e=>e.playerId===caster.id&&(!step.archetype||e.archetype===step.archetype)&&inRoomPosition(origin,e.position));
  if(!options.length){s.log.push(`${caster.name} has no eligible evocation to remove in ${origin.name}.`);return;}
  const chosenId=askChoice(s,caster.id,`remove|${caster.id}|${spell.id}`,`${spell.name}: remove one of your evocations in ${origin.name}?`,options.map(e=>({id:e.id,label:`${e.name} #${e.number??1}${e.upgrade?` (${UPGRADE_LABELS[e.upgrade]})`:''}`})),true);
  const e=options.find(model=>model.id===chosenId);
  if(!e)return;
  effect.removed={position:{...e.position},attack:evocationAttack(e),roomId:origin.id};
  removeEvocation(s,e,'removed');
  return;
 }
 if(step.effect==='REMOVED_BLAST') {
  const removed=effect.removed,origin=removed?.roomId?s.board.rooms.find(r=>r.id===removed.roomId):undefined;
  if(!removed||!origin||(step.amount===undefined&&removed.attack<=0))return;
  const near=s.board.rooms.filter(r=>r.id===origin.id||r.tiles.some(h=>origin.tiles.some(g=>hexDistance(h,g)<=1)));
  const blast=step.amount??removed.attack;
  const victims=[...s.players.filter(p=>p.wizard.alive&&near.some(r=>inRoomPosition(r,p.wizard.position))).map(p=>snapshot(s,p.id)!),
   ...(step.models?s.evocations.filter(e=>near.some(r=>inRoomPosition(r,e.position))).map(e=>snapshot(s,e.id)!):[])];
  for(const victim of victims)
   resolveInstruction(s,caster,{effect:'DAMAGE',amount:blast,target:'BOUND_MODEL'},victim,undefined,actor,effect,damageOrigin);
  return;
 }
 if(step.effect==='SEARCH_GRIMOIRE') {
  const pool=step.keyword==='SUMMON'?caster.personalDeck.filter(hasSummonKeyword):caster.personalDeck;
  if(!pool.length){s.log.push(step.keyword==='SUMMON'?`${caster.name}'s grimoire has no card with the Summon keyword.`:`${caster.name}'s grimoire is empty.`);return;}
  const cardId=pool.length===1?pool[0].id:askChoice(s,caster.id,`quest-grimoire|${caster.id}|${spell.id}`,`${spell.name}: choose a ${step.keyword==='SUMMON'?'Summon ':''}card from your grimoire.`,pool.map(card=>({id:card.id,label:card.name})))!;
  const index=caster.personalDeck.findIndex(card=>card.id===cardId);
  if(index>=0){caster.hand.push(caster.personalDeck.splice(index,1)[0]);caster.personalDeck=shuffle(caster.personalDeck,()=>resolutionRandom(s));}
  return;
 }
 if(step.effect==='DRAW_SCHOOL') {
  drawSchoolCards(s,caster,step.amount);
  return;
 }
 if(step.effect==='RETURN_REVEALED') {
  const hidden=new Set((s.readiedSpells??[]).filter(active=>active.playerId===caster.id).map(active=>active.card.id));
  const options=Object.entries(caster.prepared).filter(([,slot])=>!!slot?.used&&!!slot.card.element&&step.elements.includes(slot.card.element)&&!hidden.has(slot.card.id));
  if(!options.length){s.log.push(`${spell.name}: no matching revealed spell can be returned.`);return;}
  const slotId=options.length===1?options[0][0]:askChoice(s,caster.id,`quest-return|${caster.id}|${spell.id}`,`${spell.name}: choose a revealed spell to return to your hand.`,options.map(([id,slot])=>({id,label:`${slot!.card.name} · ${slot!.card.element}`})))!;
  const selected=caster.prepared[slotId as keyof Player['prepared']];
  if(selected?.used&&selected.card.element&&step.elements.includes(selected.card.element)&&!hidden.has(selected.card.id)) {
   caster.prepared[slotId as keyof Player['prepared']]=null;
   caster.hand.push(selected.card);
  }
  return;
 }
 if(step.effect==='IF_UNWOUNDED') {
  if(caster.wizard.damageCubes===0&&caster.wizard.blackDamage===0)drawPersonalCards(s,caster,step.draw);
  else healDamageWithChoice(s,caster,caster.wizard,'onWizard',step.otherwiseHeal,modelFeedbackTarget(s,actor)!);
  return;
 }
 if(step.effect==='LOOK_LIBRARY') {
  lookLibrary(s,caster,step.cards);
  return;
 }
 if(step.effect==='MOVE_TARGET') {
  if(refs[0]?.kind==='MAGE'||(step.models&&refs[0]))chooseMove(s,caster,spell,refs[0],step.distance);
  return;
 }
 if(step.effect==='ASSIGN_NIGHTMARE') {
  for(const ref of refs) {
   const mage=liveModel(s,ref)?.mage;
   if(!mage||(step.others&&mage.id===caster.id))continue;
   for(let i=0;i<(step.count??1);i++)assignNightmare(s,caster,mage,effect);
  }
  return;
 }
 if(step.effect==='ASSIGN_PER_EVENT') {
  const count=eventBoardOf(s).filter(Boolean).length;
  for(let i=0;i<count;i++) {
   const mages=s.players.filter(p=>p.wizard.alive);
   if(!mages.length)break;
   const id=askChoice(s,caster.id,`ephialtes|${caster.id}|${i}`,`${spell.name}: choose a mage to receive an Umbra.`,mages.map(p=>({id:p.id,label:p.name})))!;
   assignNightmare(s,caster,mages.find(p=>p.id===id)??mages[0],effect);
  }
  return;
 }
 if(step.effect==='ACTIVATE_NIGHTMARES') {
  const list=step.of==='ALL'?s.evocations.filter(isNightmare)
   :step.of==='ASSIGNED'?s.evocations.filter(e=>effect.assigned?.includes(e.id))
   :refs.flatMap(ref=>{const mage=liveModel(s,ref)?.mage;return mage?nightmaresOf(s,mage.id):[];});
  if(!list.length)s.log.push(`${spell.name}: no Nightmare to activate.`);
  for(const umbra of list)activateNightmare(s,umbra,caster,step.attackBonus??0);
  return;
 }
 if(step.effect==='REASSIGN_NIGHTMARES') {
  const mage=liveModel(s,refs[0])?.mage;
  if(!mage)return;
  for(const umbra of s.evocations.filter(e=>isNightmare(e)&&e.assignedTo!==mage.id)) {
   umbra.assignedTo=mage.id;umbra.position={...mage.wizard.position};
   s.log.push(`${umbra.name} #${umbra.number??1} is reassigned to ${mage.name}.`);
  }
  return;
 }
 if(step.effect==='STEAL_VP') {
  const mage=liveModel(s,refs[0])?.mage;
  if(mage)stealVictoryPoints(s,caster,mage,step.amount);
  return;
 }
 if(step.effect==='FIRST_PLAYER') {
  const mage=liveModel(s,refs[0])?.mage;
  if(mage){s.firstPlayerId=mage.id;s.log.push(`${mage.name} becomes the first player.`);}
  return;
 }
 if(step.effect==='DISCARD_CARDS') {
  const mage=liveModel(s,refs[0])?.mage;
  if(mage)discardFromHand(s,caster,mage,spell,step.amount,!!step.stealVp);
  return;
 }
 if(step.effect==='ACTIVATE_ROOM_IF_NIGHTMARE') {
  const umbra=room?s.evocations.find(e=>isNightmare(e)&&inRoomPosition(room,e.position)):undefined;
  const effect=room?getRoomEffect(room):null;
  if(!room||!umbra||!effect||room.startingFor||effect==='DRAW_POWERFUL'){s.log.push(`${spell.name}: no room effect to activate.`);return;}
  activateRoomBody(s,caster,undefined,{room,position:{...umbra.position},allowUsedSpecial:true});
  return;
 }
 if(step.effect==='INSTABILITY_PER_NIGHTMARE') {
  const count=room?s.evocations.filter(e=>isNightmare(e)&&inRoomPosition(room,e.position)).length:0;
  if(room&&count>0)placeInstability(s,room,count,caster);
  return;
 }
 if(step.effect==='DRAW_EVENT') {
  drawExtraEvent(s);
  return;
 }
 if(step.effect==='GAIN_VP_PER_NIGHTMARE') {
  const gained=Math.min(step.max,s.evocations.filter(isNightmare).length);
  if(gained>0){awardVictoryPoints(s,caster.id,gained);s.log.push(`${caster.name} gains ${gained} VP from Nightmares.`);}
  return;
 }
 if(step.effect==='GAIN_VP') {
  awardVictoryPoints(s,caster.id,step.amount);
  s.log.push(`${caster.name} gains ${step.amount} VP.`);
  return;
 }
 if(step.effect==='GAIN_VP_PER_ALTAR') {
  const gained=Math.min(step.max,s.evocations.filter(e=>e.archetype==='ALTAR').length);
  if(gained){awardVictoryPoints(s,caster.id,gained);s.log.push(`${caster.name} gains ${gained} VP from Altars.`);}
  return;
 }
 if(step.effect==='COMPLETE_QUEST') {
  const quests=heldQuests(caster).filter(q=>!q.completed&&!q.claimed);
  const moon=s.moon??1;
  if(caster.victoryPoints<moon||!quests.length){s.log.push(`${spell.name}: no active quest can be completed.`);return;}
  const id=quests.length===1?quests[0].id:askChoice(s,caster.id,`complete-quest|${caster.id}|${spell.id}`,
   `${spell.name}: choose an active quest to complete for ${moon} VP.`,quests.map(q=>({id:q.id,label:q.name})),true);
  const quest=quests.find(q=>q.id===id);
  if(quest) {
   awardVictoryPoints(s,caster.id,-moon);
   quest.progress=quest.amount;
   quest.completed=true;
   s.log.push(`${caster.name} spends ${moon} VP to complete “${quest.name}”.`);
  }
  return;
 }
 if(step.effect==='RESHUFFLE_DRAW') {
  if(caster.personalDeck.length+caster.discard.length===0){s.log.push(`${spell.name}: your grimoire and discard are empty.`);return;}
  caster.personalDeck=shuffle([...caster.personalDeck,...caster.discard],()=>resolutionRandom(s));
  caster.discard=[];
  const chosen:Card[]=[];
  for(let i=0;i<step.amount&&i<caster.personalDeck.length;i++) {
   const options=caster.personalDeck.filter(card=>!chosen.includes(card));
   const id=options.length===1?options[0].id:askChoice(s,caster.id,`wind-spirit|${caster.id}|${spell.id}|${i}`,
    `${spell.name}: choose a card from your grimoire.`,options.map(card=>({id:card.id,label:card.name})))!;
   const card=options.find(option=>option.id===id);
   if(card)chosen.push(card);
  }
  caster.personalDeck=caster.personalDeck.filter(card=>!chosen.includes(card));
  caster.hand.push(...chosen);
  caster.personalDeck=shuffle(caster.personalDeck,()=>resolutionRandom(s));
  s.log.push(`${caster.name} chooses ${chosen.length} grimoire card${chosen.length===1?'':'s'}: ${chosen.map(c=>c.name).join(', ')||'none'}.`);
  return;
 }
 if(step.effect==='DRAW_QUEST') {
  const quest=drawQuest(s);
  if(quest){if(caster.quest)caster.additionalQuests.push(quest);else caster.quest=quest;s.log.push(`${caster.name} draws the quest “${quest.name}”.`);}
  else s.log.push(`${spell.name}: no quest cards are available.`);
  return;
 }
 if(step.effect==='ACTIVATE_TARGET_ROOM') {
  const target=step.used&&effect.spellEvent?.roomId?s.board.rooms.find(r=>r.id===effect.spellEvent!.roomId)??room:room;
  if(!target||!getRoomEffect(target)||target.startingFor){s.log.push(`${spell.name}: the target room has no activatable effect.`);return;}
  const targetRoomId=roomEffectNeedsTarget(getRoomEffect(target))
   ?askChoice(s,caster.id,`activate-room|${caster.id}|${spell.id}`,`${spell.name}: choose a room within range 1 of ${target.name} to receive instability.`,
    s.board.rooms.filter(candidate=>!candidate.startingFor&&Math.min(...candidate.tiles.flatMap(h=>target.tiles.map(origin=>hexLineDistance(origin,h))))<=1)
     .map(candidate=>({id:candidate.id,label:candidate.name,roomId:candidate.id})))!
   :undefined;
  activateRoomBody(s,caster,targetRoomId,{room:target,position:{...target.tiles[0]},...(step.used?{allowUsedSpecial:true}:{})});
  return;
 }
 if(step.effect==='ASSIGN_JINX') {
  for(const ref of refs) {
   const mage=liveModel(s,ref)?.mage;
   if(!mage)continue;
   let name:JinxName|undefined=step.jinx==='CHOICE'?undefined:step.jinx;
   if(!name) {
    const supply=getJinxSupply(s);
    const options=JINX_NAMES.filter(n=>supply[n]>0&&!hasJinx(mage,n));
    if(!options.length){s.log.push(`${spell.name}: no jinx can be assigned to ${mage.name}.`);continue;}
    name=options.length===1?options[0]:askChoice(s,caster.id,`jinx|${spell.id}|${mage.id}`,`${spell.name}: choose a jinx to assign to ${mage.name}.`,
     options.map(n=>({id:n,label:`${JINX_LABELS[n]} · ${JINX_RULES[n].effect}`})))! as JinxName;
   }
   assignJinx(s,caster,mage,name);
  }
  return;
 }
 if(step.effect==='DISCARD_QUEST_OR_JINX') {
  const quests=heldQuests(caster).filter(q=>!q.completed&&!q.claimed);
  const jinxes=getMageJinxes(caster);
  if(!quests.length&&!jinxes.length){s.log.push(`${spell.name}: ${caster.name} has no quest or jinx to discard.`);return;}
  const options=[...quests.map(q=>({id:`quest:${q.id}`,label:`Quest · ${q.name}`})),...jinxes.map(j=>({id:`jinx:${j.id}`,label:`Jinx · ${JINX_LABELS[j.name]}`}))];
  const picked=options.length===1?options[0].id:askChoice(s,caster.id,`discard-quest-jinx|${caster.id}|${spell.id}`,`${spell.name}: discard one active quest or one jinx.`,options)!;
  if(picked.startsWith('jinx:')) {
   const jinx=jinxes.find(j=>`jinx:${j.id}`===picked);
   if(jinx)discardJinx(s,caster,jinx,`${spell.name}`);
  } else {
   const quest=quests.find(q=>`quest:${q.id}`===picked);
   if(quest) {
    const remaining=heldQuests(caster).filter(q=>q.id!==quest.id);
    caster.quest=remaining.shift()??null;
    caster.additionalQuests=remaining;
    s.questDiscard.push(quest);
    s.log.push(`${caster.name} discards the quest “${quest.name}”.`);
   }
  }
  return;
 }
 if(step.effect==='DRAW_SPELLS') {
  let drawn=0;
  for(let i=0;i<step.amount&&caster.personalDeck.length+caster.discard.length>0;i++){caster.hand.push(drawOne(s,caster.personalDeck,caster.discard));drawn++;}
  s.log.push(`${caster.name} draws ${drawn} spell${drawn===1?'':'s'}.`);
  return;
 }
 if(step.effect==='INSTABILITY_PER_UNCONVERTED'||step.effect==='INSTABILITY_PER_JINX') {
  const live=liveModel(s,refs[0]);
  const count=step.effect==='INSTABILITY_PER_JINX'?(live?.mage?getMageJinxes(live.mage).length:0):effect.unconverted??0;
  const placeIn=(live?roomAt(s,live.model.position):undefined)??room;
  if(count>0&&placeIn)placeInstability(s,placeIn,count,caster);
  else s.log.push(`${spell.name}: no instability to place.`);
  return;
 }
 if(step.effect==='LOSE_VP_OR_PREVENT') {
  const mage=liveModel(s,refs[0])?.mage;
  if(!mage||mage.id===caster.id)return;
  const prevent=()=>{if(effect.spellEvent?.prevented)effect.spellEvent.prevented.value=true;s.log.push(`${caster.name} ignores the spell effect.`);};
  if(mage.victoryPoints<step.amount){prevent();return;}
  const choice=askChoice(s,mage.id,`lose-vp-or-prevent|${mage.id}|${spell.id}`,`${spell.name}: lose ${step.amount} VP, or let ${caster.name} ignore that spell effect?`,
   [{id:'LOSE',label:`Lose ${step.amount} VP`},{id:'IGNORE',label:`${caster.name} ignores the effect`}]);
  if(choice==='LOSE')awardVictoryPoints(s,mage.id,-step.amount);
  else prevent();
  return;
 }
 if(step.effect==='MOVE_MODEL') {
  if(!room){s.log.push(`${spell.name}: there is no target room for the model placement.`);return;}
  const models=[...s.players.filter(p=>p.wizard.alive).map(p=>snapshot(s,p.id)!),...s.evocations.filter(e=>!isNightmare(e)).map(e=>snapshot(s,e.id)!)];
  if(!models.length)return;
  const modelId=models.length===1?models[0].id:askChoice(s,caster.id,`move-model|${caster.id}|${spell.id}`,
   `${spell.name}: choose any model to move.`,models.map(ref=>({id:ref.id,label:modelFeedbackTarget(s,ref)!.name})),true);
  const ref=models.find(model=>model.id===modelId),live=ref&&liveModel(s,ref);
  if(!ref||!live)return;
  const destinations=s.board.rooms.filter(candidate=>!candidate.startingFor&&Math.min(...candidate.tiles.flatMap(h=>room.tiles.map(g=>hexDistance(h,g))))<=step.distance);
  if(!destinations.length)return;
  const destinationId=destinations.length===1?destinations[0].id:askChoice(s,caster.id,`move-model-room|${caster.id}|${spell.id}`,
   `${spell.name}: choose a room within range ${step.distance} of ${room.name}.`,destinations.map(candidate=>({id:candidate.id,label:candidate.name,roomId:candidate.id})),true);
  const destination=destinations.find(candidate=>candidate.id===destinationId);
  if(destination){moveModel(s,ref,destination.tiles[0]);effect.moved=ref;s.log.push(`${caster.name} moves ${modelFeedbackTarget(s,ref)!.name} to ${destination.name}.`);}
  return;
 }
 if(step.effect==='PLACE_ALTAR_CUBES') {
  const count=s.evocations.filter(e=>e.archetype==='ALTAR').length;
  if(room&&count)placeInstability(s,room,count,caster);
  return;
 }
 if('amount' in step&&step.amount<=0)return;
 // Instability always lands in the chosen room; conversion of a room spell converts that room's cubes.
 if(step.effect==='INSTABILITY' || (step.effect==='CONVERT' && spell.target==='ROOM' && step.scope!=='TARGET_ROOM')) {
  const placeIn=step.effect==='INSTABILITY'&&step.scope==='CASTER_ROOM'?roomAt(s,casterPosition(s,caster,actor,effect)):room;
  if(placeIn)resolveInstruction(s,caster,{...step,target:'BOUND_ROOM'},undefined,placeIn.id,actor,effect,damageOrigin);
  return;
 }
 for(const ref of refs)resolveInstruction(s,caster,{...step,target:'BOUND_MODEL'},ref,undefined,actor,effect,damageOrigin);
}

function castSpell(s: GameState, p: Player, command: Extract<GameAction,{type:'CAST_SPELL'|'CAST_POWERFUL_SPELL'|'ACTIVATE_SPELL'}>,freeWithinRoom=false) {
 const a=requireActivation(s,p.id);
 if(freeWithinRoom)assert(a.physicalAction,'A room-granted spell requires a pending physical action');
 else {
  assert(a.exploring===0,'Finish exploring first');
  requireNoPendingPhysical(a);
  requireTurnAction(a);
 }
 assert(!isInStartingRoom(s,p),'Leave the starting room before casting spells');
 if(command.type==='CAST_POWERFUL_SPELL')throw new GameRuleError('Forgotten spells cannot be cast from hand; prepare them in a later Preparation phase and use CAST_SPELL');
 const action=command as Extract<GameAction,{type:'CAST_SPELL'}>;
 const prepared=p.prepared[action.slot];
 const card=prepared&&!prepared.used?prepared.card:undefined;
 assert(card,'Spell unavailable');
 if(action.slot!=='rapid'&&!freeWithinRoom) {
  assert(!a.sequencedSpellUsed,'Only one sequenced spell per turn');
  assert(slots.find(slot=>p.prepared[slot] && !p.prepared[slot]!.used)===action.slot,'Cast numbered spells in order 1 → 2 → 3');
 }
 const printed=card!;
 const side=prepared?.side??'LIGHT';
 // Enhancement: merged only if the other revealed spells on the Mage Sheet show the symbols (either side).
 const spell=getSpellForSide(s,p,printed,side);
 const face=side==='DARK'?getDarkSideSpell(printed):printed;
 const enhanced=!!face.enhancement&&!spell.enhancement;
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
   assert(room.tiles.some(h=>spellReaches(s,spell,p.wizard.position,h)),'Room out of range');
   if(!action.dummy)targets=[...s.players.filter(t=>inRoom(t,room!)).map(t=>modelTarget(s,t.id)),...s.evocations.filter(e=>room!.tiles.some(h=>hexKey(h)===hexKey(e.position))).map(e=>modelTarget(s,e.id))];
  } else {
   assert(!action.roomId,'Individual model spells cannot target a room');
   const inferSelf=spell.target==='SELF' && !action.targetPlayerId && !action.targetEvocationId;
   assert(inferSelf || !!action.targetPlayerId!==!!action.targetEvocationId,'Select one mage or evocation');
   const id=inferSelf?p.id:action.targetEvocationId??action.targetPlayerId!;
   const target=modelTarget(s,id);
   assert(inferSelf || (action.targetPlayerId?!!target.mage:!!target.evocation),'Target payload does not match the model kind');
   assert(spellCanTargetModel(spell,p.id,target.playerId,target.mage?'MAGE':'EVOCATION'),'Spell cannot target this model category or ownership');
   assert(spellFilterAllows(spell,p.id,target),'Spell cannot target this model');
   room=s.board.rooms.find(r=>r.tiles.some(h=>hexKey(h)===hexKey(target.position)));
   assert(!room?.startingFor,'Cannot target a model in its starting room');
   assert(spellReaches(s,spell,p.wizard.position,target.position),'Model out of range');targets=[target];
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
  const active:ActiveSpell={id:resolutionId(s),playerId:p.id,card:side==='DARK'?spell:printed,...(side==='DARK'?{side,printed}:{}),
   ...(spell.target!=='ROOM' && target?.mage?{targetPlayerId:target.mage.id}:{}),
   ...(spell.target!=='ROOM' && target?.evocation?{targetEvocationId:target.evocation.id}:{}),
   ...(room?{roomId:room.id}:{})};
  (reactive?s.readiedSpells!:s.ongoingSpells!).push(active);
  s.activeSpellOrder!.push(active.id);bindActiveSpell(s,active);
 } else if(spell.powerful){s.removedCards.push(printed);s.log.push(`${spell.name} is removed from the game after use.`);}
 else discardCard(s,p,printed);
 a.spellsCast++;if(!freeWithinRoom)a.actionsUsed++;
 if(action.slot!=='rapid')a.sequencedSpellUsed=true;
 s.log.push(freeWithinRoom?`${p.name} casts ${spell.name} through the Arena's rebuilt effect.`:reactive&&!action.dummy?`${p.name} activates a hidden spell for 1 action (no physical token).`:`${p.name} casts ${side==='DARK'?'the dark side of ':''}${spell.name}${action.dummy?' on a dummy (no model effects)':''} for 1 action (no physical token).`);
 if(!reactive||action.dummy)recordRecapCard(s,'CAST',p.id,printed,undefined,side);
 if(spell.ongoing&&!action.dummy)s.log.push(`${spell.name} remains ongoing: ${spell.ongoing.effects.map(describeInstruction).join(' ')}`);
 // Activation is not a cast and cannot trigger "when a spell is cast".
 if(!reactive)emitEvent(s,{event:'SPELL_CAST',actor,model:actor,roomId:room?.id,spellType:getSpellType(spell),sourceCard:spell});
 const protectedTargets=new Set<string>();
 if(!reactive&&getSpellType(spell)==='COMBAT')for(const ref of refs) {
  const prevented={value:false};
  emitEvent(s,{event:'SPELL_TARGETED',actor,model:ref,roomId:modelFeedbackTarget(s,ref)?.roomId,spellType:'COMBAT',sourceCard:spell,prevented});
  if(prevented.value)protectedTargets.add(ref.id);
 }
 if(!reactive || action.dummy) {
  // Printed moments resolve strictly in card order, and a card may repeat a moment.
  // Each moment is a complete step: every interrupt it causes (reactive spells, a
  // mage defeat with its scoring and respawn) finishes before the next moment
  // resumes. Models defeated or destroyed meanwhile are skipped by later moments.
  if(enhanced)s.log.push(`${spell.name} is enhanced: ${face.enhancement!.text}`);
  const ctx=context(s),wasSuppressed=ctx.suppress;
  if(spell.suppressReactions){ctx.suppress=true;s.log.push(`${spell.name}: Traps and Protections will not trigger while it resolves.`);}
  const preventMainEffect=spell.target!=='ROOM'&&refs.length===1&&protectedTargets.has(refs[0].id);
  try{resolveEffectMoments(s,p,spell,room,refs.filter(ref=>!protectedTargets.has(ref.id)),actor,'SPELL',protectedTargets,preventMainEffect);}finally{ctx.suppress=wasSuppressed;}
 }
 afterAction(s);
}

/**
 * Applies one root action. When `frames` is supplied and the action completes,
 * a snapshot of the state at the end of each moment is appended to it (in
 * order, excluding the final state). A paused decision appends nothing: the
 * answer replays the whole action and reports all of its moments.
 */
export function applyAction(state: GameState, action: GameAction, frames?: GameState[]): GameState {
 const pending=state.pendingDecision;
 if(action.type==='RESPOND_SOUL_TITHE') {
  if(pending?.kind!=='SOUL_TITHE'||!pending.resume)throw new GameRuleError('No decision is waiting');
  assert(pending.playerId===action.playerId,'This decision belongs to another mage');
  assert(typeof action.accept==='boolean','Choose accept or decline');
  const base=structuredClone(state);delete base.pendingDecision;
  return runWithDecisions(base,pending.resume.action,[...pending.resume.answers,{key:pending.key,accept:action.accept}],pending.resume.entropy,frames);
 }
 if(action.type==='RESPOND_REACTIVE_SPELL') {
  if(pending?.kind!=='REACTIVE_SPELL'||!pending.resume)throw new GameRuleError('No reactive decision is waiting');
  assert(pending.playerId===action.playerId,'This decision belongs to another mage');
  assert(pending.key===action.key,'Stale reactive decision');
  let targetId=action.targetId;
  if(action.activeSpellId) {
   const option=pending.options.find(o=>o.activeSpellId===action.activeSpellId);
   if(option && option.targets.length===1)targetId??=option.targets[0].id;
   assert(option && option.targets.some(t=>t.id===targetId),'Choose an eligible spell and target');
  } else assert(!action.targetId,'Declining does not select a target');
  const base=structuredClone(state);delete base.pendingDecision;
  return runWithDecisions(base,pending.resume.action,[...pending.resume.answers,{key:pending.key,accept:!!action.activeSpellId,activeSpellId:action.activeSpellId,targetId}],pending.resume.entropy,frames);
 }
 if(action.type==='RESPOND_CHOICE') {
  if(pending?.kind!=='CHOICE'||!pending.resume)throw new GameRuleError('No choice is waiting');
  assert(pending.playerId===action.playerId,'This decision belongs to another mage');
  assert(pending.key===action.key,'Stale choice');
  if(action.choiceId===undefined)assert(pending.optional,'Choose one of the options');
  else assert(pending.options.some(o=>o.id===action.choiceId),'Choose one of the listed options');
  const base=structuredClone(state);delete base.pendingDecision;
  return runWithDecisions(base,pending.resume.action,[...pending.resume.answers,{key:pending.key,accept:action.choiceId!==undefined,targetId:action.choiceId}],pending.resume.entropy,frames);
 }
 // The paused action's mage decides first; the owner may still adjust their own switches.
 if(pending)assert(action.type==='SET_EVOCATION_AUTO',`Waiting for ${state.players.find(p=>p.id===pending.playerId)?.name??'a mage'} to decide`);
 return runWithDecisions(state,action,[],undefined,frames);
}

function runWithDecisions(state:GameState,action:GameAction,answers:DecisionAnswer[],entropy:ReplayEntropy={ids:[],random:[]},frames?:GameState[]):GameState {
 const replay=structuredClone(entropy);
 const collected:GameState[]|undefined=frames?[]:undefined;
 try {const result=runAction(state,action,answers,replay,collected);frames?.push(...collected!);return result;}
 catch(error) {
  if(!(error instanceof DecisionNeeded))throw error;
  const paused=structuredClone(state);
  paused.pendingDecision=structuredClone({...error.decision,resume:{action,answers:error.answers,entropy:replay}});
  return paused;
 }
}

function runAction(state: GameState, action: GameAction, answers: DecisionAnswer[],entropy:ReplayEntropy,frames?:GameState[]): GameState {
 const s=structuredClone(state);
 s.feedbackEvents??=[];
 s.readiedSpells??=[];s.ongoingSpells??=[];
 s.activeSpellOrder??=[...s.readiedSpells,...s.ongoingSpells].map(a=>a.id);
 instructionContexts.set(s,{generations:new Map(),bindings:new Map(),defeats:new Map(),resolutions:0,answers,cursor:0,momentDepth:0,events:[],entropy,idCursor:0,randomCursor:0,frames,frameKey:frames?JSON.stringify(s):undefined});
 for(const active of [...s.readiedSpells,...s.ongoingSpells])bindActiveSpell(s,active);
 assert(s.phase!=='GAME_OVER','The game is over');
 // Wire payloads can include fields excluded by the TypeScript action union.
 assert(!('dummy' in action) || action.type==='CAST_SPELL' || action.type==='CAST_POWERFUL_SPELL','Dummy targeting is only available for spell cards');
 assert(!('side' in action),'A spell’s side is chosen during Preparation, not when casting');
 const p=getPlayer(s,action.playerId);
 switch(action.type) {
  case 'UNDO_ACTION': case 'REDO_ACTION': throw new GameRuleError('History commands must be intercepted by the server; the engine does not process undo/redo');
  case 'DRAFT_SCHOOL': {
   requirePhase(s,'SETUP');assert(s.setupStage==='SCHOOL','The school draft is complete');
   assert(p.connected,'Join the room first');
   assert(setupDrafter(s)?.id===p.id,'Wait for your turn to draft a school');
   assert(typeof action.schoolId==='string'&&s.library.some(d=>d.id===action.schoolId),'School not found');
   assert(!s.players.some(mage=>mage.startingSchoolId===action.schoolId),'That school has already been drafted');
   const deck=s.library.find(d=>d.id===action.schoolId)!;
   assert(deck.cards.length+deck.discard.length>=STARTING_SCHOOL_CARDS,'Not enough cards remain in that school');
   deck.cards=shuffle(deck.cards,()=>resolutionRandom(s));
   p.startingSchoolId=action.schoolId;
   for(let i=0;i<STARTING_SCHOOL_CARDS;i++)p.personalDeck.push(drawOne(s,deck.cards,deck.discard));
   if(s.players.every(mage=>mage.startingSchoolId))s.setupStage='MAGE';
   break;
  }
  case 'DRAFT_MAGE': {
   requirePhase(s,'SETUP');assert(s.setupStage==='MAGE','The mage draft is not active');
   assert(p.connected,'Join the room first');
   assert(setupDrafter(s)?.id===p.id,'Wait for your turn to draft a mage');
   assert(MAGE_DRAFT_POOL.some(mage=>mage.id===action.mageId),'Mage not found');
   assert(!s.players.some(mage=>mage.mageId===action.mageId),'That mage has already been drafted');
   p.mageId=action.mageId;
   const spells=mageSpellCopies(action.mageId);
   p.personalDeck.push(spells[0]);
   p.mageSpellSupply=spells.slice(1);
   p.wizard.health=10;p.wizard.attack=2;p.wizard.movement=2;
   if(s.players.every(mage=>mage.mageId))finishSetup(s);
   break;
  }
  case 'SET_READY':
   requirePhase(s,'LOBBY');assert(p.connected,'Join the room first');
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
   assert(canStartGame(s),'At least 2 mages must join and everyone must be ready');
    s.board=createDemoBoard(s.roomsPerColor??getDefaultRoomsPerColor(s.players.length),()=>resolutionRandom(s));
    for(const mage of s.players) {
     const start=s.board.rooms.find(r=>r.startingFor===mage.id)!;
     mage.wizard.startingRoomId=start.id;mage.wizard.position={...start.tiles[0]};
    }
   s.phase='SETUP';
   s.setupOrder=shuffle(s.players.map(mage=>mage.id),()=>resolutionRandom(s));
   s.setupStage='SCHOOL';
   s.firstPlayerId=s.setupOrder[0];
   s.log.push(`${s.players.find(mage=>mage.id===s.firstPlayerId)!.name} is first. School draft begins.`);
   break;
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
  requirePhase(s,'BLACK_ROSE');assert(s.blackRoseResolved,'Resolve BR before discarding quests');
   const quests=heldQuests(p),eligible=activeQuests(p),overflow=eligible.length-p.questLimit;
   assert(overflow>0,'No quests over the quest limit');
   assert(Array.isArray(action.questIds) && action.questIds.length===overflow && new Set(action.questIds).size===overflow,`Discard exactly ${overflow} different quests`);
   assert(action.questIds.every(id=>eligible.some(q=>q.id===id)),'Only active quests can be discarded to meet the quest limit');
   const selected=new Set(action.questIds),remaining=quests.filter(q=>!selected.has(q.id));
   s.questDiscard.push(...quests.filter(q=>selected.has(q.id)));
   p.quest=remaining.shift()??null;p.additionalQuests=remaining;
   s.log.push(`${p.name} discards ${overflow} quests to meet the quest limit.`);
   beginStudyIfQuestsFit(s);break;
  }
  case 'DISCARD_QUEST_FOR_ROSE': {
   requirePhase(s,'BLACK_ROSE');assert(!s.blackRoseResolved,'Quests are already being drawn');
   assert(!(s.roseQuestDiscards??[]).includes(p.id),'You already discarded a quest for the Black Rose this round');
   const quest=activeQuests(p).find(q=>q.id===action.questId);
   assert(quest,'Only an active quest can be discarded');
   const remaining=heldQuests(p).filter(q=>q.id!==quest!.id);
   s.questDiscard.push(quest!);
   p.quest=remaining.shift()??null;p.additionalQuests=remaining;
   s.roseQuestDiscards=[...(s.roseQuestDiscards??[]),p.id];
   s.log.push(`${p.name} discards the quest ${quest!.name}; the Black Rose gains 1 VP.`);
   awardVictoryPoints(s,BLACK_ROSE_ID,1);break;
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
    const sides=action.sides??{};
    assert(typeof sides==='object'&&sides!==null&&!Array.isArray(sides)&&Object.entries(sides).every(([,side])=>side==='LIGHT'||side==='DARK'),'Choose the light or the dark side for each spell');
    // Null placeholders preserve the player's exact numbered destinations.
    // Legacy contiguous string arrays remain valid and unchanged.
    const numbered=action.preparedCardIds.filter((id):id is string=>id!==null);
    const ids=[...numbered,...(action.rapidCardId===undefined?[]:[action.rapidCardId])];
    assert(action.preparedCardIds.length<=3 && ids.length>=2 && ids.length<=4 && new Set(ids).size===ids.length,'Choose 2 to 4 different spells, at most 3 numbered and 1 Quick');
   assert(ids.every(id=>p.hand.some(c=>c.id===id)),'Spell not in hand');
   assert(Object.keys(sides).every(id=>ids.includes(id)),'Choose a side only for the spells you prepare');
   assert(Object.entries(sides).every(([id,side])=>side!=='DARK'||!p.hand.find(c=>c.id===id)?.lightOnly),'This spell has only a light side');
   const sideOf=(id:string):Partial<Pick<PreparedCard,'side'>>=>sides[id]==='DARK'?{side:'DARK'}:{};
   for(const [i,id] of action.preparedCardIds.entries()) {
    if(id===null)continue;
    const card=p.hand.splice(p.hand.findIndex(c=>c.id===id),1)[0];
    p.prepared[slots[i]]={card,used:false,...sideOf(id)};
   }
   if(action.rapidCardId!==undefined) {
    const card=p.hand.splice(p.hand.findIndex(c=>c.id===action.rapidCardId),1)[0];
    p.prepared.rapid={card,used:false,...sideOf(card.id)};
   }
   p.preparationDone=true;
  if(s.players.every(p=>p.preparationDone)) { s.phase='ACTION'; s.log.push('ACTION — up to 2 total actions per turn, including spell casts and discard-to-move; at most one numbered spell per turn.'); startActivation(s,seatOrder(s)[0]); }
   break;
  }
  case 'END_ACTIVATION': {
   const a=requireActivation(s,p.id); assert(a.exploring===0,'Finish exploring first');
    requireNoPendingPhysical(a);
    assert(!mustLeaveCell(s,p),'Use your remaining action to leave the cell before ending your turn');
    assert(a.actionsUsed>=1 || a.spellsCast>0 || a.discardedExit,'Take an action, cast a spell, or pass for the round'); finishActivation(s); break;
  }
  case 'PASS_ROUND': {
   const a=requireActivation(s,p.id);assert(a.exploring===0,'Finish exploring first');
    requireNoPendingPhysical(a);
    assert(!mustLeaveCell(s,p),'Use your remaining action to leave the cell before passing');
   assert(canPassActionPhase(s,p),'You may pass permanently only with no physical tokens and no unused spells');
   p.passed=true;s.log.push(`${p.name} passes for the rest of the Action phase.`);finishActivation(s);break;
  }
  case 'ACTIVATE_EVOCATION': {
   assert(!s.evocationActivation,'Finish the active evocation first');
   const e=s.evocations.find(e=>e.id===action.evocationId);assert(e&&e.playerId===p.id,'You may activate only your own evocations');
   assert(e!.damageCubes<e!.health,'This evocation is defeated');
   if(s.phase==='ACTION') {
    const a=requirePhysicalAction(s,p);assert(p.actionTokens>0,'No action tokens');
    assert(!isInStartingRoom(s,p),'Leave the starting room before activating evocations');p.actionTokens--;a.actionsUsed++;
   } else {
    requirePhase(s,'EVOCATION');assert(s.currentPlayerId===p.id,'Not your turn');assert(!e!.activated,'This evocation already activated this phase');e!.activated=true;
   }
   s.evocationActivation={evocationId:e!.id,playerId:p.id,movesRemaining:evocationMovement(e!),returnToAction:s.phase==='ACTION'};
  s.log.push(`${p.name} activates ${e!.name} #${e!.number??1} during the ${s.phase==='EVOCATION'?'free Evocation':'Action'} phase${s.phase==='ACTION'?' (1 action token)':''}: move ${evocationMovement(e!)}, attack ${evocationAttack(e!)}.`);
  modelEvent(s,'EVOCATION_ACTIVATED',snapshot(s,e!.id)!);break;
  }
  case 'BEGIN_EVOCATION_MOVEMENT': {
   const {active}=requireEvocation(s,p.id);assert(active.movesRemaining>0,'No evocation movement remaining');
   assert(!active.moving,'Evocation movement already started');active.moving=true;break;
  }
  case 'EVOCATION_STEP': {
   const {active,e}=requireEvocation(s,p.id);assert(active.movesRemaining>0,'No evocation movement remaining');
   active.moving=true;
   assert(areAdjacent(e.position,action.destination),'Move one adjacent space at a time');
   assert(s.board.tiles.some(h=>hexKey(h)===hexKey(action.destination)),'Destination outside board');
   assert(!s.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(action.destination))),'Evocations cannot enter starting rooms');
  active.movesRemaining--;if(active.movesRemaining===0)active.moving=false;moveModel(s,snapshot(s,e.id)!,action.destination);
  if(s.evocationActivation===active&&active.movesRemaining===0&&active.attackUsed)finishEvocation(s);
  break;
  }
  case 'END_EVOCATION_MOVEMENT': {
   const {active}=requireEvocation(s,p.id);assert(active.movesRemaining>0,'No evocation movement remaining');
   active.movesRemaining=0;active.moving=false;
   if(active.attackUsed)finishEvocation(s);
   break;
  }
  case 'EVOCATION_ATTACK': {
   const {active,e}=requireEvocation(s,p.id);assert(!active.attackUsed,'Evocation attack already used');
   const target=modelTarget(s,action.targetId);
   if(e.ability==='TOTEM') {
    assert(action.targetId!==e.id,'A Totem cannot target itself');
    assert(hexDistance(e.position,target.position)<=1,'Totem targets must be within range 1');
    assert(!target.evocation||!isNightmare(target.evocation),'A Totem cannot target a Nightmare');
    assert(!s.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(target.position))),'Cannot target a model in its starting room');
    assert(!active.moving,'Finish the evocation movement before using its ability');
    const model=target.mage?.wizard??target.evocation!;
    assert(model.damageCubes>0,'Totem targets must have damage to heal or convert');
    const options:Array<{id:string;label:string}>=[{id:'HEAL',label:`Heal 1 damage on ${modelFeedbackTarget(s,snapshot(s,action.targetId)!)!.name}`}];
    if(p.cubes.available>0&&(Object.entries(model.damageByPlayer).some(([id,count])=>count>0&&id!==p.id)||('blackDamage' in model&&(model.blackDamage??0)>0))) {
     const convert={id:'CONVERT',label:`Convert 1 damage on ${modelFeedbackTarget(s,snapshot(s,action.targetId)!)!.name}`};
     if(target.playerId!==p.id)options.unshift(convert);else options.push(convert);
    }
    const mode=options.length===1?options[0].id:askChoice(s,p.id,`totem|${e.id}`,`${e.name} activation: choose its effect.`,options)!;
    const ref=snapshot(s,action.targetId)!;
    if(mode==='HEAL')healDamageWithChoice(s,p,model,target.mage?'onWizard':'onEvocations',1,modelFeedbackTarget(s,ref)!);
    else convertDamageWithChoice(s,p,model,target.mage?'onWizard':'onEvocations',1,modelFeedbackTarget(s,ref)!);
    active.attackUsed=true;
    s.log.push(`${e.name} #${e.number??1} uses its altar ability on ${modelFeedbackTarget(s,ref)!.name}.`);
    if(s.evocationActivation===active&&active.movesRemaining===0)finishEvocation(s);
    break;
   }
   assert(target.playerId!==p.id,'Evocations cannot damage their mage or friendly evocations');
   assert(target.evocation?.id!==e.id,'An evocation cannot attack itself');
   assert(!s.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(target.position))),'Cannot target a model in its starting room');
  assert(areInSameRoom(s,e.position,target.position),'Target must be in the same room');
  assert(!active.moving,'Finish the evocation movement before attacking');
  const actor=snapshot(s,e.id)!,ref=snapshot(s,action.targetId)!,roomId=roomAt(s,target.position)?.id;
  active.attackUsed=true;
  // Nigredo: instead of damaging, its controller may place or convert 1 cube in its room.
  let alchemy:'PLACE'|'CONVERT'|undefined;
  if(e.ability==='ALCHEMY') {
   const room=roomAt(s,e.position);
   const modes:Array<{id:string;label:string}>=[{id:'DAMAGE',label:`Deal ${evocationAttack(e)} damage to the target`}];
   if(room&&!room.reconstructed&&!room.startingFor&&room.instability<room.instabilityLimit&&p.cubes.available>0)modes.push({id:'PLACE',label:`Deal no damage: place 1 instability cube in ${room.name}`});
   if(room&&!room.reconstructed&&!room.scored&&room.instability>0&&p.cubes.available>0&&Object.entries(room.cubesByPlayer).some(([id,n])=>id!==p.id&&n>0))modes.push({id:'CONVERT',label:`Deal no damage: convert 1 cube in ${room.name} to your color`});
   if(modes.length>1) {
    const mode=askChoice(s,p.id,`nigredo|${e.id}`,`Nigredo attacks: choose its effect.`,modes);
    if(mode==='PLACE')alchemy='PLACE';else if(mode==='CONVERT')alchemy='CONVERT';
   }
   if(alchemy&&room) {
    s.log.push(`${e.name} #${e.number??1} deals no damage and ${alchemy==='PLACE'?'places':'converts'} 1 cube.`);
    if(alchemy==='PLACE')placeInstability(s,room,1,p);
    else convertRoomCubes(s,p,room,1);
   }
  }
  // Corrosive plasma attacks the room: every model there not of the controller's color suffers it.
  const victims=alchemy?[]:e.upgrade==='CORROSIVE_PLASMA'?roomOccupants(s,roomAt(s,target.position)!).filter(v=>v.playerId!==p.id&&v.id!==e.id):[ref];
  for(const victim of victims)resolveInstruction(s,p,{effect:'DAMAGE',amount:evocationAttack(e),target:'EVENT_MODEL'},victim,undefined,actor,undefined,'EVOCATION');
  modelEvent(s,'EVOCATION_ATTACK',ref,actor,roomId);
  if(s.evocationActivation===active&&active.movesRemaining===0)finishEvocation(s);
  break;
  }
  case 'END_EVOCATION':requireEvocation(s,p.id);finishEvocation(s);break;
  case 'BEGIN_PHYSICAL_ACTION': {
   const a=requirePhysicalAction(s,p);assert(p.actionTokens>0,'No action tokens');
   assert(action.kind==='EXPLORE'||action.kind==='ATTACK','Unknown physical action kind');
   if(action.kind==='ATTACK')assert(!isInStartingRoom(s,p),'Leave the starting room before attacking');
    if(mustLeaveCell(s,p)){assert(getMageMovement(p)>0,'Discard a card to leave the cell');a.mustExitCell=true;}
   p.actionTokens--;a.actionsUsed++;a.roomEffectUsed=false;
   a.physicalAction={kind:action.kind,mainEffectUsed:false,movementStarted:false};
   s.log.push(`${p.name} begins ${action.kind}: resolve the primary and room effects in either order, or skip remaining effects.`);
   if(action.kind==='EXPLORE')progressJinx(s,p,'SLOWNESS');
   break;
  }
  case 'PERFORM_MOVEMENT': {
   const {a,physical}=requirePendingPhysical(s,p);
   assert(physical.kind==='EXPLORE','Movement requires a pending Explore');
   assert(!physical.mainEffectUsed && !physical.movementStarted,'Movement already started or resolved');
   physical.movementStarted=true;a.exploring=getMageMovement(p);
   if(a.exploring===0){physical.mainEffectUsed=true;finishPhysicalEffects(s);}
   break;
  }
  case 'ACTIVATE_ROOM': {
   const {a}=requirePendingPhysical(s,p);assert(a.exploring===0,'Finish exploring first');
   assert(!a.roomEffectUsed,'Room effect already used for this physical action');
   activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;finishPhysicalEffects(s);break;
  }
  case 'SKIP_PHYSICAL_EFFECTS': {
    const {a}=requirePendingPhysical(s,p);
    assert(!a.mustExitCell || !isInStartingRoom(s,p),'Leave the cell before skipping the remaining effects');
    a.physicalAction=null;a.exploring=0;afterAction(s);break;
  }
  case 'INFLICT_ATTACK': {
   const {physical}=requirePendingPhysical(s,p);
   assert(physical.kind==='ATTACK','Attack requires a pending Attack');
   assert(!physical.mainEffectUsed,'Attack primary effect already used');
  const target=mageAttackTarget(s,p,action.targetId),ref=snapshot(s,action.targetId)!,actor=snapshot(s,p.id)!,roomId=roomAt(s,target.position)?.id;
  resolveInstruction(s,p,{effect:'DAMAGE',amount:p.wizard.attack,target:'EVENT_MODEL'},ref,undefined,actor,undefined,'MAGE_PHYSICAL');
  modelEvent(s,'MAGE_ATTACK',ref,actor,roomId);
   physical.mainEffectUsed=true;finishPhysicalEffects(s);break;
  }
  case 'EXPLORE': {
    const a=requirePhysicalAction(s,p);assert(p.actionTokens>0,'No action tokens');
    const speed=getMageMovement(p);
    if(mustLeaveCell(s,p)){assert(speed>0,'Discard a card to leave the cell');a.mustExitCell=true;}
    p.actionTokens--; a.actionsUsed++; a.exploring=speed;a.roomEffectUsed=false;
    const actor=snapshot(s,p.id)!;
    progressJinx(s,p,'SLOWNESS');
    if(action.activateRoomAtStart){activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;}
    if(!liveModel(s,actor))a.exploring=0;
    s.log.push(`${p.name} explores: up to ${speed} one-step moves.`);
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
  const key=([...slots,'rapid'] as const).find(key=>p.prepared[key]&&!p.prepared[key]!.used&&p.prepared[key]!.card.id===action.cardId);
  assert(key,'Choose a prepared spell that has not been cast or activated');
  const prepared=p.prepared[key!]!,card=prepared.card;
  assert(!card.powerful,'Forgotten spells cannot be discarded to move');
  prepared.used=true;
  discardCard(s,p,card);a.discardedExit=true;a.actionsUsed++;
  s.log.push(`${p.name} discards ${card.name} to ${leavingStart?'leave the starting room':'move'} by 1 space (1 action, no physical token).`);
  recordRecapCard(s,'DISCARDED',p.id,card);
  moveModel(s,snapshot(s,p.id)!,action.destination);
  progressJinx(s,p,'SLOWNESS');
  afterAction(s);break;
  }
  case 'PUNCH': {
  const a=requirePhysicalAction(s,p);assert(p.actionTokens>0,'No action tokens');
  const target=mageAttackTarget(s,p,action.targetId);
  // Validate only on the first run: a replay after an interrupt answer was already accepted.
  if(action.roomEffect&&context(s).answers.length===0){const problem=roomActivationProblem(s,p,action.roomTargetId);assert(!problem,problem!);}
  p.actionTokens--; a.actionsUsed++;a.roomEffectUsed=false;
  const ref=snapshot(s,action.targetId)!,actor=snapshot(s,p.id)!,roomId=roomAt(s,target.position)?.id;
  if(action.roomEffect==='START'){activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;}
  // A room effect may defeat the intended victim; never punch their respawn.
  if(liveModel(s,ref) && liveModel(s,actor)) {
  resolveInstruction(s,p,{effect:'DAMAGE',amount:p.wizard.attack,target:'EVENT_MODEL'},ref,undefined,actor,undefined,'MAGE_PHYSICAL');
   modelEvent(s,'MAGE_ATTACK',ref,actor,roomId);
  }
  if(action.roomEffect==='END' && liveModel(s,actor)) {
   // Interrupts during the punch (traps, moves) may have changed the room since validation.
   const problem=roomActivationProblem(s,p,action.roomTargetId);
   if(problem)s.log.push(`${p.name}'s room effect can no longer be activated (${problem}); it is skipped.`);
   else {activateRoom(s,p,action.roomTargetId);a.roomEffectUsed=true;}
  }
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
  case 'RESPOND_REACTIVE_SPELL': case 'RESPOND_SOUL_TITHE': case 'RESPOND_CHOICE': throw new GameRuleError('No decision is waiting');
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
   progressJinx(s,p,'VULNERABILITY');
  const remaining=heldQuests(p).filter(q=>q.id!==quest.id);
   p.quest=remaining.shift()??null; p.additionalQuests=remaining;
    s.questDiscard.push(quest);
  afterAction(s);
   break;
  }
  default: throw new GameRuleError('Unknown game action');
 }
 // Trigger destruction during activation or movement must release the lock and
 // follow the normal paid-action/free-phase handoff exactly once.
 while(s.evocationActivation && !s.evocations.some(e=>e.id===s.evocationActivation!.evocationId))finishEvocation(s);
 instructionContexts.delete(s);
 return s;
}