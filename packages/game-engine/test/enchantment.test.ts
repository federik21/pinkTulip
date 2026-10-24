import { describe, expect, it } from 'vitest';
import {
 applyAction, canPlayerAct, canUseSpellDummy, createEnchantmentDeck, createGame,
 createLibrary, getSpellType, spellCanTargetModel,
} from '../src';
import type { ActiveSpell, Card, Evocation, GameAction, GameState, Hex, Player, SpellType, TriggerCondition, TriggeredInstruction } from '../src';

type Cast=Extract<GameAction,{type:'CAST_SPELL'}>;
type Selection=Omit<Cast,'type'|'playerId'|'slot'>;
const center='room-0,0',east='room-1,0';
function fixture():GameState {
 const s=createGame(4);s.phase='ACTION';s.round=1;s.firstPlayerId='p1';
 for(const p of s.players)p.wizard.position={q:0,r:0};
 turn(s,'p1');return s;
}
function turn(s:GameState,id:string) {
 s.currentPlayerId=id;s.phase='ACTION';s.evocationActivation=null;
 s.activation={playerId:id,actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
}
const player=(s:GameState,id='p1')=>s.players.find(p=>p.id===id)!;
const room=(s:GameState,id=center)=>s.board.rooms.find(r=>r.id===id)!;
function take(s:GameState,name:string):Card {
 for(const deck of s.library) {
  const i=deck.cards.findIndex(c=>c.name===name);
  if(i>=0)return deck.cards.splice(i,1)[0];
 }
 throw new Error(`No card named ${name}`);
}
function prepare(s:GameState,spell:Card|string,id='p1',slot:keyof Player['prepared']='rapid') {
 const card=typeof spell==='string'?take(s,spell):spell;
 player(s,id).prepared[slot]={card,used:false};return card;
}
function cast(s:GameState,id='p1',selection:Selection={},slot:Cast['slot']='rapid') {
 return applyAction(s,{type:'CAST_SPELL',playerId:id,slot,...selection});
}
function arm(s:GameState,name:Card|string,id='p1',selection:Selection={roomId:center}) {
 turn(s,id);prepare(s,name,id);return cast(s,id,selection);
}
const instruction=(effect:TriggeredInstruction['effect'],amount:number,target:TriggeredInstruction['target']):TriggeredInstruction=>({effect,amount,target});
let syntheticId=0;
function custom(name:string,trigger:TriggerCondition,effects:TriggeredInstruction[],changes:Partial<Card>={}):Card {
 return {id:`synthetic-${++syntheticId}`,name,kind:'SPELL',target:'ROOM',range:3,damage:0,instability:0,spellType:'TRAP',trigger,triggerEffects:effects,...changes};
}
const on=(event:TriggerCondition['event'],scope:TriggerCondition['scope']='BOUND_ROOM',relation:TriggerCondition['relation']='ENEMY'):TriggerCondition=>({event,scope,relation});
function evoc(s:GameState,id='e1',owner='p2',health=4,position:Hex={q:0,r:0}):Evocation {
 const e:Evocation={id,playerId:owner,name:id,archetype:'UNDEAD',movement:2,attack:2,health,passive:'WOUNDED_FURY',position:{...position},damageCubes:0,damageByPlayer:{},activated:false};
 s.evocations.push(e);return e;
}
function syncCubes(s:GameState) {
 for(const p of s.players) {
  p.cubes.onWizard=s.players.reduce((n,t)=>n+(t.wizard.damageByPlayer[p.id]??0),0);
  p.cubes.onEvocations=s.evocations.reduce((n,t)=>n+(t.damageByPlayer[p.id]??0),0);
  p.cubes.onBoard=s.board.rooms.filter(r=>!r.scored).reduce((n,r)=>n+(r.cubesByPlayer[p.id]??0),0);
  p.cubes.available=25-p.cubes.onWizard-p.cubes.onEvocations-p.cubes.onBoard;
 }
}
function wound(s:GameState,id:string,ledger:Record<string,number>) {
 const m=s.evocations.find(e=>e.id===id)??player(s,id).wizard;
 m.damageByPlayer={...ledger};m.damageCubes=Object.values(ledger).reduce((a,b)=>a+b,0);syncCubes(s);
}
function conserved(s:GameState) {
 for(const p of s.players) {
  expect(Object.values(p.cubes).every(n=>Number.isInteger(n)&&n>=0)).toBe(true);
  expect(Object.values(p.cubes).reduce((a,b)=>a+b,0)).toBe(25);
  expect(p.cubes.onWizard).toBe(s.players.reduce((n,t)=>n+(t.wizard.damageByPlayer[p.id]??0),0));
  expect(p.cubes.onEvocations).toBe(s.evocations.reduce((n,t)=>n+(t.damageByPlayer[p.id]??0),0));
  expect(p.cubes.onBoard).toBe(s.board.rooms.filter(r=>!r.scored).reduce((n,r)=>n+(r.cubesByPlayer[p.id]??0),0));
 }
}
function physicalCards(s:GameState) {
 return [
  ...s.library.flatMap(d=>[...d.cards,...d.discard]),...s.powerfulDeck,...s.removedCards,
  ...s.players.flatMap(p=>[...p.personalDeck,...p.hand,...p.discard,...Object.values(p.prepared).flatMap(c=>c&&!c.used?[c.card]:[])]),
  ...[...s.readiedSpells??[],...s.ongoingSpells??[]].map(a=>a.card),
 ].map(c=>c.id).sort();
}
const interrupts=(s:GameState)=>s.log.filter(l=>l.startsWith('Interrupt '));
function exploreInto(s:GameState,id:string,destination:Hex) {
 turn(s,id);s=applyAction(s,{type:'EXPLORE',playerId:id});
 return applyAction(s,{type:'EXPLORE_STEP',playerId:id,destination});
}
function reject(s:GameState,action:GameAction,error:RegExp) {
 const before=structuredClone(s);expect(()=>applyAction(s,action)).toThrow(error);expect(s).toEqual(before);
}
function expectSameFreshResolution(first:GameState,second:GameState) {
 // Independent resolutions have identical facts, but deliberately disjoint event UUIDs.
 const facts=(s:GameState)=>({...s,feedbackEvents:s.feedbackEvents?.map(({id,interruptId,...event})=>({...event,...(interruptId?{interruptIndex:s.feedbackEvents!.findIndex(e=>e.id===interruptId)}:{})}))});
 expect(facts(first)).toEqual(facts(second));
 const secondIds=new Set(second.feedbackEvents?.map(event=>event.id));
 for(const event of first.feedbackEvents??[])expect(secondIds.has(event.id)).toBe(false);
}

describe('Enchantment public catalog and active-zone contract',()=>{
 const patterns:[string,SpellType,Card['target']][]=[
  ['Threshold Snare','TRAP','ROOM'],['Spell Leech','TRAP','ROOM'],['Thorn Retort','PROTECTION','SELF'],
  ['Mending Ward','PROTECTION','MAGE'],["Servant's Safeguard",'PROTECTION','EVOCATION'],['Hearth Ward','PROTECTION','ROOM'],
  ['Tripwire','TRAP','ROOM'],['Cinder Seal','TRAP','ROOM'],["Pilgrim's Mark",'CONTINGENCY','SELF'],
    ['Thorned Path','COMBAT','MAGE'],['Runic Remedy','CONTINGENCY','MAGE'],['Arcane Feedback','COMBAT','MAGE'],
 ];
 it('adds a separate 36-card school without replacing either previous school',()=>{
  expect(createLibrary().map(d=>[d.id,d.name])).toEqual([['cantrip','Cantrip'],['transmutation','Transmutation'],['enchantment','Enchantment']]);
  const deck=createEnchantmentDeck();expect(deck).toHaveLength(36);expect(new Set(deck.map(c=>c.id)).size).toBe(36);
    expect(new Set(deck.map(c=>c.name)).size).toBe(12);expect(new Set(deck.map(getSpellType))).toEqual(new Set(['COMBAT','CONTINGENCY','TRAP','PROTECTION']));
  const s=createGame();expect(s.readiedSpells).toEqual([]);expect(s.ongoingSpells).toEqual([]);
  expect(physicalCards(s)).toHaveLength(120);expect(new Set(physicalCards(s)).size).toBe(120);
 });
 it.each(patterns)('%s has three distinct physical copies and complete printed rules', (name,spellType,target)=>{
  const copies=createEnchantmentDeck().filter(c=>c.name===name);expect(copies).toHaveLength(3);
  for(const card of copies) {
   expect(card).toMatchObject({schoolId:'enchantment',kind:'SPELL',spellType,target,instability:0,damage:name==='Arcane Feedback'?1:0});
   expect(card.range).toBeGreaterThanOrEqual(0);expect(card.rulesText!.length).toBeGreaterThan(30);
    if(['TRAP','PROTECTION'].includes(spellType)){expect(card.rulesText).toMatch(/^Activate secretly/);expect(card.trigger).toBeDefined();expect(card.triggerEffects!.length).toBeGreaterThan(0);}
   else {expect(card.ongoing?.trigger.relation).toBe('ANY');expect(card.ongoing?.trigger.scope).toBe('BOUND_MODEL');}
  }
 });
 it.each([{damage:1},{instability:1},{convert:1},{heal:2},{}])('infers legacy type without changing the card: %j',stats=>{
  const card:Card={id:'legacy',name:'Legacy',kind:'SPELL',target:'MODEL',damage:0,instability:0,range:2,...stats};
    const before=structuredClone(card);expect(getSpellType(card)).toBe(card.damage||card.instability||card.convert?'COMBAT':'CONTINGENCY');expect(card).toEqual(before);
  expect(getSpellType({...card,spellType:'PROTECTION'})).toBe('PROTECTION');
 });
 it('arms hidden, costs exactly one shared action and no token, and conserves the physical card',()=>{
  const s=fixture(),before=physicalCards(s);const card=prepare(s,'Threshold Snare');const original=structuredClone(s);
  const result=cast(s,'p1',{roomId:center});expect(s).toEqual(original);
  const active=result.readiedSpells![0];expect(active).toMatchObject({playerId:'p1',card,roomId:center});
  expect(active.id).not.toBe(card.id);expect(active.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.log.join('\n')).not.toContain(card.name);expect(result.log.join('\n')).toContain('activates a hidden spell');
  expect(result.activation).toMatchObject({actionsUsed:1,spellsCast:1});expect(player(result).actionTokens).toBe(2);
  expect(player(result).prepared.rapid).toMatchObject({used:true});expect(physicalCards(result)).toEqual(before);
  expect(result.library.find(d=>d.id==='enchantment')!.discard).toEqual([]);
 });
 it('initializes absent legacy active zones on the first command',()=>{
  const s=fixture();delete s.readiedSpells;delete s.ongoingSpells;delete s.activeSpellOrder;
  const result=applyAction(s,{type:'EXPLORE',playerId:'p1'});
  expect(result.readiedSpells).toEqual([]);expect(result.ongoingSpells).toEqual([]);
 });
 it('round-trips active zones and history through plain JSON with identical subsequent resolution',()=>{
  let s=arm(fixture(),'Threshold Snare','p1',{roomId:east});
  s=arm(s,'Thorned Path','p3',{targetPlayerId:'p2'});s.history={canUndo:true,canRedo:false,undoLabel:'ready'};
  const restored:GameState=JSON.parse(JSON.stringify(s));expect(restored).toEqual(s);
  expectSameFreshResolution(exploreInto(restored,'p2',{q:1,r:0}),exploreInto(s,'p2',{q:1,r:0}));
  expect(Object.keys(s.readiedSpells![0]).sort()).toEqual(['card','id','playerId','roomId']);
 });
});

describe('reactive targeting, quotas and dummy compatibility',()=>{
 it.each([['Mending Ward','p1','MAGE'],["Servant's Safeguard",'e1','EVOCATION']] as const)('%s accepts its own model with no printed heal', (name,id,kind)=>{
  const s=fixture();evoc(s,'e1','p1');const c=prepare(s,name);player(s).actionTokens=0;
  expect(spellCanTargetModel(c,'p1','p1',kind)).toBe(true);expect(canPlayerAct(s,player(s))).toBe(true);
  const result=cast(s,'p1',kind==='MAGE'?{targetPlayerId:id}:{targetEvocationId:id});expect(result.readiedSpells).toHaveLength(1);
 });
 it.each(['TRAP','PROTECTION'] as const)('%s cannot fake a MODEL dummy despite zero support stats',spellType=>{
  const s=fixture(),c=custom('Hidden model',on('MAGE_ATTACK'),[],{target:'MODEL',spellType});prepare(s,c);
  expect(canUseSpellDummy(c)).toBe(false);reject(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',dummy:true,roomId:center},/Dummy/);
  player(s).actionTokens=0;for(const p of s.players.slice(1))p.wizard.position={q:1,r:1};
  expect(canPlayerAct(s,player(s))).toBe(spellType==='PROTECTION');
 });
 it('ongoing MODEL spells cannot use dummy targeting, but legacy MODEL offense can',()=>{
  const c:Card={id:'model',name:'Model',kind:'SPELL',target:'MODEL',range:2,damage:1,instability:0};
  expect(canUseSpellDummy(c)).toBe(true);
  const bound={...c,ongoing:{trigger:on('ENTER_ROOM','BOUND_MODEL','ANY'),effects:[]}};
  expect(canUseSpellDummy(bound)).toBe(false);
  const s=fixture();prepare(s,bound);reject(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:center,dummy:true},/Dummy/);
 });
 it.each([
  {roomId:'room-1,1'}, {roomId:'room-3,-2'}, {roomId:center,targetPlayerId:'p2'}, {targetPlayerId:'p2'},
 ])('hidden room selection enforces LOS/protection/typed payload: %j',selection=>{
  const s=fixture();prepare(s,'Threshold Snare');reject(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',...selection},/range|Starting rooms|room\/dummy|Select a room/);
 });
 it('model wards enforce range, category, protected rooms, and one real target',()=>{
  const s=fixture();evoc(s);prepare(s,'Mending Ward');
  for(const selection of [{targetEvocationId:'e1'},{targetPlayerId:'p2',targetEvocationId:'e1'},{targetEvocationId:'p2'}])
   reject(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',...selection},/category|Select one|payload/);
  player(s,'p2').wizard.position={q:1,r:1};reject(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'},/range/);
  player(s,'p2').wizard.position={q:3,r:-2};reject(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'},/starting room/);
 });
 it('readiness and continuous spells obey numbered ordering/quota and the shared two-action cap',()=>{
  let s=fixture();prepare(s,'Threshold Snare','p1','slot1');prepare(s,'Spell Leech','p1','slot2');prepare(s,"Pilgrim's Mark");
  reject(s,{type:'CAST_SPELL',playerId:'p1',slot:'slot2',roomId:center},/in order/);
  s=cast(s,'p1',{roomId:center},'slot1');reject(s,{type:'CAST_SPELL',playerId:'p1',slot:'slot2',roomId:center},/sequenced/);
  s=cast(s);expect(s.currentPlayerId).toBe('p2');expect(player(s).actionTokens).toBe(2);
  expect(s.readiedSpells).toHaveLength(1);expect(s.ongoingSpells).toHaveLength(1);
  reject(s,{type:'CAST_SPELL',playerId:'p1',slot:'slot2',roomId:center},/Not your turn/);
 });
 it('readiness cannot interrupt pending physical movement or evocation commands',()=>{
  const s=fixture();prepare(s,'Threshold Snare');evoc(s,'e1','p1');
  for(const action of [
   {type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'},
   {type:'EXPLORE',playerId:'p1'},
   {type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'e1'},
  ] as GameAction[]) {
   const pending=applyAction(s,action);reject(pending,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:center},/pending|exploring|active evocation/);
  }
 });
});

describe('instruction interruption, single fire and depth-first ordering',()=>{
 it('fires once after an actual enemy room entry and discards/reveals before resuming movement',()=>{
  let s=arm(fixture(),'Threshold Snare','p1',{roomId:east});const cards=physicalCards(s);
  s=exploreInto(s,'p2',{q:1,r:0});expect(player(s,'p2').wizard.damageCubes).toBe(2);
  expect(s.activation?.exploring).toBe(1);expect(s.readiedSpells).toEqual([]);
  expect(s.library.find(d=>d.id==='enchantment')!.discard.map(c=>c.name)).toContain('Threshold Snare');
  expect(s.log.slice(-4).join('\n')).toMatch(/reveals Threshold Snare[\s\S]*suffers 2[\s\S]*Resume ENTER_ROOM/);
  s=applyAction(s,{type:'EXPLORE_STEP',playerId:'p2',destination:{q:0,r:0}});
  s=exploreInto(s,'p2',{q:1,r:0});expect(player(s,'p2').wizard.damageCubes).toBe(2);
  expect(interrupts(s)).toHaveLength(1);expect(physicalCards(s)).toEqual(cards);conserved(s);
 });
 it('SPELL_CAST interrupts after payment but before printed healing',()=>{
  let s=arm(fixture(),'Spell Leech');wound(s,'p2',{p3:1});turn(s,'p2');prepare(s,'Mending Light','p2');
  s=cast(s,'p2');expect(player(s,'p2').wizard.damageCubes).toBe(0);
  expect(s.activation).toMatchObject({actionsUsed:1,spellsCast:1});
  const text=s.log.join('\n');expect(text.indexOf('casts Mending Light')).toBeLessThan(text.indexOf('reveals Spell Leech'));
  expect(text.indexOf('Resume SPELL_CAST')).toBeLessThan(text.indexOf('Healing removes 3'));conserved(s);
 });
 it('finishes a single model damage instruction, resolves its ward, then resumes the remaining area targets',()=>{
  let s=arm(fixture(),'Mending Ward','p2',{targetPlayerId:'p2'});turn(s,'p1');
  prepare(s,{id:'area',name:'Area',kind:'SPELL',target:'ROOM',damage:2,instability:1,range:0});
  s=cast(s,'p1',{roomId:center});expect(s.players.map(p=>p.wizard.damageCubes)).toEqual([0,0,2,2]);
  const text=s.log.join('\n');expect(text.indexOf('places 1 instability')).toBeLessThan(text.indexOf('Azure Mage suffers 2'));
  expect(text.indexOf('Azure Mage suffers 2')).toBeLessThan(text.indexOf('reveals Mending Ward'));
  expect(text.indexOf('Resume DAMAGE_TAKEN')).toBeLessThan(text.indexOf('Amber Mage suffers 2'));conserved(s);
 });
 it('resolves nested retorts depth-first, before the outer card resumes or the next root effect',()=>{
  let s=arm(fixture(),'Thorn Retort','p1',{});s=arm(s,'Thorn Retort','p2',{});turn(s,'p1');
  s=applyAction(s,{type:'PUNCH',playerId:'p1',targetId:'p2',roomEffect:'END'});
  expect(player(s).wizard.damageCubes).toBe(0);expect(player(s,'p2').wizard.damageCubes).toBe(2);
  const events=s.log.filter(l=>/^(Interrupt|Resume)/.test(l));
  expect(events).toEqual([
   'Interrupt DAMAGE_TAKEN: Azure Mage reveals Thorn Retort.',
   'Interrupt DAMAGE_TAKEN: Crimson Mage reveals Thorn Retort.',
   'Resume DAMAGE_TAKEN after Thorn Retort.','Resume DAMAGE_TAKEN after Thorn Retort.',
  ]);
  expect(s.log.findIndex(l=>l.includes('activates')&&l.includes('for free'))).toBeGreaterThan(s.log.lastIndexOf(events[3]));
  expect(s.readiedSpells).toEqual([]);conserved(s);
 });
 it('rotates simultaneous owners from firstPlayerId, keeping every owner’s cards in arm order',()=>{
  let s=fixture();s.firstPlayerId='p3';
  for(const [id,name] of [['p1','one'],['p3','three-A'],['p4','four'],['p3','three-B'],['p2','two']])
   s=arm(s,custom(name,on('ENTER_ROOM'),[instruction('DAMAGE',1,'EVENT_MODEL')]),id,{roomId:east});
  s=exploreInto(s,'p2',{q:1,r:0});
  expect(interrupts(s).map(l=>l.split('reveals ')[1])).toEqual(['three-A.','three-B.','four.','one.']);
  // The event actor's own ENEMY trigger is ineligible.
  expect(s.readiedSpells!.map(a=>a.card.name)).toEqual(['two']);conserved(s);
 });
 it('preserves cross-zone arm order for one owner rather than sorting by zone',()=>{
  let s=fixture();
  const passive=(name:string)=>custom(name,on('ENTER_ROOM','BOUND_MODEL','ANY'),[],{spellType:'CONTINGENCY',target:'MAGE',ongoing:{trigger:on('ENTER_ROOM','BOUND_MODEL','ANY'),effects:[instruction('HEAL',1,'BOUND_MODEL')]}});
  s=arm(s,passive('first'),'p1',{targetPlayerId:'p2'});
  s=arm(s,custom('second',on('ENTER_ROOM'),[]),'p1',{roomId:east});
  s=arm(s,passive('third'),'p1',{targetPlayerId:'p2'});
  s=exploreInto(s,'p2',{q:1,r:0});expect(interrupts(s).map(l=>l.split(/(?:with|reveals) /)[1])).toEqual(['first.','second.','third.']);
 });
 it('nested triggers finish before the next simultaneous owner resolves',()=>{
  let s=arm(fixture(),'Thorn Retort','p2',{});
  s=arm(s,custom('first entrance',on('ENTER_ROOM'),[instruction('DAMAGE',1,'EVENT_MODEL')]),'p1',{roomId:east});
  s=arm(s,custom('second entrance',on('ENTER_ROOM'),[]),'p3',{roomId:east});
  s=exploreInto(s,'p2',{q:1,r:0});expect(interrupts(s).map(l=>l.split('reveals ')[1])).toEqual(['first entrance.','Thorn Retort.','second entrance.']);
 });
 it('does not damage/heal/convert a respawn when nested damage kills a later original area target',()=>{
  let s=fixture();player(s,'p3').wizard.health=1;
  s=arm(s,custom('protect another',on('DAMAGE_TAKEN','BOUND_MODEL','ANY'),[instruction('DAMAGE',1,'EVENT_ACTOR')],{target:'MAGE',spellType:'PROTECTION'}),'p3',{targetPlayerId:'p1'});
  s=arm(s,custom('fatal retort',on('DAMAGE_TAKEN','BOUND_MODEL','ENEMY'),[instruction('DAMAGE',10,'EVENT_ACTOR')],{target:'SELF',spellType:'PROTECTION'}),'p2',{});
  turn(s,'p2');prepare(s,{id:'root-area',name:'Root area',kind:'SPELL',target:'ROOM',range:0,damage:1,instability:1},'p2');
  s=cast(s,'p2',{roomId:center});expect(player(s,'p3').wizard.damageCubes).toBe(0);
  expect(player(s,'p3').wizard.position).toEqual({q:-1,r:-2});expect(player(s,'p2').kills).toBe(1);
  expect(s.log.filter(l=>l.startsWith('Amber Mage suffers'))).toHaveLength(1);
  expect(room(s).instability).toBe(1);expect(room(s,'room--1,-2').instability).toBe(0);conserved(s);
 });
 it('guards unbounded passive recursion at 128 resolutions and leaves the whole root action unchanged',()=>{
  let s=fixture();for(const p of s.players)p.wizard.health=1000;
  const feedback=(name:string)=>custom(name,on('DAMAGE_TAKEN','BOUND_MODEL','ANY'),[],{target:'SELF',spellType:'CONTINGENCY',ongoing:{trigger:on('DAMAGE_TAKEN','BOUND_MODEL','ANY'),effects:[instruction('DAMAGE',1,'EVENT_ACTOR')]}});
  s=arm(s,feedback('A'),'p1',{});s=arm(s,feedback('B'),'p2',{});turn(s,'p1');
  reject(s,{type:'PUNCH',playerId:'p1',targetId:'p2'},/resolution limit exceeded \(128\)/);
 });
 it('allows exactly 128 finite resolutions and rejects the 129th without partially committing',()=>{
  let s=fixture();
  for(let i=0;i<128;i++)s=arm(s,custom(`finite-${i}`,on('ENTER_ROOM'),[]),'p1',{roomId:east});
  const before=structuredClone(s),result=exploreInto(structuredClone(s),'p2',{q:1,r:0});
  expect(interrupts(result)).toHaveLength(128);expect(result.readiedSpells).toEqual([]);
  s=arm(s,custom('finite-129',on('ENTER_ROOM'),[]),'p1',{roomId:east});turn(s,'p2');
  s=applyAction(s,{type:'EXPLORE',playerId:'p2'});
  reject(s,{type:'EXPLORE_STEP',playerId:'p2',destination:{q:1,r:0}},/resolution limit/);
  expect(before.readiedSpells).toHaveLength(128);
 });
 it('keeps an interrupted cast’s original selected room even if Spell Leech defeats its caster',()=>{
  let s=fixture();player(s,'p2').wizard.health=2;s=arm(s,'Spell Leech');turn(s,'p2');
  prepare(s,{id:'committed',name:'Committed',kind:'SPELL',target:'MAGE',damage:1,instability:1,range:0},'p2');
  s=cast(s,'p2',{targetPlayerId:'p3'});
  expect(player(s,'p2').wizard.position).toEqual({q:-3,r:2});expect(player(s,'p3').wizard.damageCubes).toBe(1);
  expect(room(s).instability).toBe(1);expect(room(s,'room--3,2').instability).toBe(0);conserved(s);
 });
 it('uses the event origin room after lethal damage instead of the victim’s respawn room',()=>{
  let s=fixture();player(s,'p2').wizard.health=1;
  s=arm(s,custom('origin marker',on('DAMAGE_TAKEN','BOUND_ROOM','ANY'),[instruction('INSTABILITY',1,'EVENT_ROOM')]),'p3');
  turn(s,'p1');s=applyAction(s,{type:'PUNCH',playerId:'p1',targetId:'p2'});
  expect(room(s).cubesByPlayer).toEqual({p3:1});expect(room(s,'room--3,2').instability).toBe(0);
  expect(player(s,'p2').wizard.damageCubes).toBe(0);conserved(s);
 });
 it('fizzles remaining model instructions after nested defeat rather than healing or hitting a respawn',()=>{
  let s=fixture();player(s,'p2').wizard.health=1;
  s=arm(s,custom('two hits',on('ENTER_ROOM'),[
   instruction('DAMAGE',1,'EVENT_MODEL'),instruction('HEAL',2,'EVENT_MODEL'),
   instruction('CONVERT',2,'EVENT_MODEL'),instruction('DAMAGE',1,'EVENT_MODEL'),
  ]),'p1',{roomId:east});
  s=exploreInto(s,'p2',{q:1,r:0});expect(player(s,'p2').wizard.damageCubes).toBe(0);
  expect(player(s).kills).toBe(1);expect(s.log.filter(l=>l.startsWith('Azure Mage suffers'))).toHaveLength(1);conserved(s);
 });
});

describe('room, movement, evocation and attack event moments',()=>{
 it('signals activation before reward; Cinder Seal spends its cubes before Emerald reward',()=>{
  let s=arm(fixture(),'Cinder Seal');room(s).effect='INSTABILITY';turn(s,'p2');
  s=applyAction(s,{type:'EXPLORE',playerId:'p2',activateRoomAtStart:true});
  expect(room(s)).toMatchObject({instability:3,cubesByPlayer:{p1:2,p2:1}});
  expect(s.log.findIndex(l=>l.includes('Resume ROOM_ACTIVATED'))).toBeLessThan(s.log.findIndex(l=>l.includes('Azure Mage places 1 instability')));conserved(s);
 });
 it('Hearth Ward heals the owner before the enemy room reward damages it',()=>{
  let s=arm(fixture(),'Hearth Ward');room(s).effect='ROOM_DAMAGE';wound(s,'p1',{p3:2});turn(s,'p2');
  s=applyAction(s,{type:'EXPLORE',playerId:'p2',activateRoomAtStart:true});
  expect(player(s).wizard.damageCubes).toBe(1);expect(player(s).wizard.damageByPlayer).toEqual({p2:1});conserved(s);
 });
 it('room rewards keep their pre-interrupt model snapshots and never hit a victim’s respawn',()=>{
  let s=fixture();player(s,'p3').wizard.health=1;
  s=arm(s,custom('room blast',on('ROOM_ACTIVATED'),[instruction('DAMAGE',1,'EVENT_ROOM')]),'p1');
  room(s).effect='ROOM_DAMAGE';turn(s,'p2');s=applyAction(s,{type:'EXPLORE',playerId:'p2',activateRoomAtStart:true});
  expect(player(s,'p3').wizard.damageCubes).toBe(0);expect(player(s,'p3').wizard.position).toEqual({q:-1,r:-2});
  expect(s.log.filter(l=>l.startsWith('Amber Mage suffers'))).toHaveLength(1);
  expect(player(s).wizard.damageCubes).toBe(1);expect(player(s,'p4').wizard.damageCubes).toBe(2);conserved(s);
 });
 it('room activation and a same-room multihex step are not ENTER_ROOM',()=>{
  let s=arm(fixture(),'Threshold Snare');room(s).tiles.push({q:1,r:0});s.board.rooms=s.board.rooms.filter(r=>r.id!==east);
  turn(s,'p2');s=applyAction(s,{type:'EXPLORE',playerId:'p2',activateRoomAtStart:true});
  s=applyAction(s,{type:'EXPLORE_STEP',playerId:'p2',destination:{q:1,r:0}});
  expect(s.readiedSpells).toHaveLength(1);expect(player(s,'p2').wizard.damageCubes).toBe(0);
 });
 it('friendly entry does not spend an enemy trap',()=>{
  const s=exploreInto(arm(fixture(),'Threshold Snare','p1',{roomId:east}),'p1',{q:1,r:0});
  expect(s.readiedSpells).toHaveLength(1);expect(player(s).wizard.damageCubes).toBe(0);
 });
 it('discard-to-exit emits entry after card payment and preserves its one-action/no-token cost',()=>{
  let s=fixture();player(s).wizard.position={q:2,r:-2};s=arm(s,'Threshold Snare','p1',{roomId:'room-2,-2'});
  const cards=physicalCards(s);
  player(s,'p2').wizard.position={q:3,r:-2};const c=take(s,'Arcane Bolt');player(s,'p2').hand.push(c);turn(s,'p2');
  s=applyAction(s,{type:'DISCARD_EXIT',playerId:'p2',cardId:c.id,destination:{q:2,r:-2}});
  expect(player(s,'p2').wizard.damageCubes).toBe(2);expect(s.activation).toMatchObject({actionsUsed:1,discardedExit:true});expect(player(s,'p2').actionTokens).toBe(2);
  expect(s.library.find(d=>d.id===c.schoolId)!.discard).toContainEqual(c);expect(player(s,'p2').discard).toEqual([]);
  expect(physicalCards(s)).toEqual(cards);conserved(s);
 });
 it.each(['PUNCH','INFLICT_ATTACK'] as const)('%s signals MAGE_ATTACK after damage and before the remaining room effect',type=>{
  let s=arm(fixture(),custom('punch alarm',on('MAGE_ATTACK'),[instruction('DAMAGE',1,'EVENT_ACTOR')]),'p3');turn(s,'p1');
  if(type==='INFLICT_ATTACK')s=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'ATTACK'});
  s=applyAction(s,type==='PUNCH'?{type,playerId:'p1',targetId:'p2',roomEffect:'END'}:{type,playerId:'p1',targetId:'p2'});
  expect(player(s,'p2').wizard.damageCubes).toBe(2);expect(player(s).wizard.damageCubes).toBe(1);
  expect(s.log.findIndex(l=>l.includes('Azure Mage suffers 2'))).toBeLessThan(s.log.findIndex(l=>l.includes('reveals punch alarm')));conserved(s);
 });
 it('Tripwire fires on evocation activation, not mere presence or mage activation',()=>{
  let s=fixture();evoc(s);s=arm(s,'Tripwire');turn(s,'p2');
  s=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:'e1'});
  expect(s.evocations[0].damageCubes).toBe(1);expect(s.evocationActivation?.evocationId).toBe('e1');expect(s.readiedSpells).toEqual([]);conserved(s);
 });
 it.each([false,true])('destroying an activating evocation releases its lock and normal handoff (free=%s)',free=>{
  let s=fixture();evoc(s,'e1','p2',1);evoc(s,'e2','p3');s=arm(s,'Tripwire');turn(s,'p2');
  if(free){s.phase='EVOCATION';s.activation=null;}else s.activation!.actionsUsed=1;
  s=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:'e1'});
  expect(s.evocationActivation).toBeNull();expect(s.evocations.some(e=>e.id==='e1')).toBe(false);
  expect(s.currentPlayerId).toBe('p3');expect(s.phase).toBe(free?'EVOCATION':'ACTION');conserved(s);
 });
 it('an evocation entry can destroy the active model without leaving an unresolvable activation',()=>{
  let s=fixture();evoc(s,'e1','p2',2);s=arm(s,'Threshold Snare','p1',{roomId:east});turn(s,'p2');
  s=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:'e1'});
  s=applyAction(s,{type:'EVOCATION_STEP',playerId:'p2',destination:{q:1,r:0}});
  expect(s.evocations).toEqual([]);expect(s.evocationActivation).toBeNull();expect(s.activation?.actionsUsed).toBe(1);
  expect(s.currentPlayerId).toBe('p2');conserved(s);
 });
 it('nonlethal evocation movement retains the movement budget after nested healing',()=>{
  let s=fixture();evoc(s,'e1','p2',4);s=arm(s,"Servant's Safeguard",'p2',{targetEvocationId:'e1'});
  s=arm(s,'Threshold Snare','p1',{roomId:east});turn(s,'p2');s=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:'e1'});
  s=applyAction(s,{type:'EVOCATION_STEP',playerId:'p2',destination:{q:1,r:0}});
  expect(s.evocations[0].damageCubes).toBe(0);expect(s.evocationActivation?.movesRemaining).toBe(1);expect(s.readiedSpells).toEqual([]);conserved(s);
 });
 it('EVOCATION_ATTACK signals after punch damage, with the evocation as event actor',()=>{
  let s=fixture();evoc(s);s=arm(s,custom('attack alarm',on('EVOCATION_ATTACK'),[instruction('DAMAGE',1,'EVENT_ACTOR')]),'p3');turn(s,'p2');
  s=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:'e1'});
  s=applyAction(s,{type:'EVOCATION_ATTACK',playerId:'p2',targetId:'p1'});
  expect(player(s).wizard.damageCubes).toBe(2);expect(s.evocations[0].damageCubes).toBe(1);expect(s.evocationActivation).toBeNull();conserved(s);
 });
 it('a retort damages the attacking evocation, and destruction ends its activation exactly once',()=>{
  let s=fixture();evoc(s,'e1','p2',1);s=arm(s,'Thorn Retort','p1',{});turn(s,'p2');
  s=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:'e1'});
  s=applyAction(s,{type:'EVOCATION_ATTACK',playerId:'p2',targetId:'p1'});
  expect(player(s).wizard.damageCubes).toBe(1);expect(s.evocations).toEqual([]);expect(s.evocationActivation).toBeNull();conserved(s);
 });
 it('lethal mage entry stops the movement budget and does not activate the respawn room',()=>{
  let s=fixture();player(s,'p2').wizard.health=2;s=arm(s,'Threshold Snare','p1',{roomId:east});turn(s,'p2');
  s=applyAction(s,{type:'EXPLORE',playerId:'p2'});
  s=applyAction(s,{type:'EXPLORE_STEP',playerId:'p2',destination:{q:1,r:0},activateRoomAtEnd:true});
  expect(player(s,'p2').wizard.position).toEqual({q:-3,r:2});expect(player(s,'p2').wizard.damageCubes).toBe(0);
  expect(s.activation?.exploring).toBe(0);expect(s.log.filter(l=>l.includes('for free'))).toEqual([]);conserved(s);
 });
});

describe('continuous bindings, expiry, immunities and physical ledgers',()=>{
 it('Pilgrim’s Mark persists, converts actual entry-room cubes, and uses owner stock',()=>{
  let s=fixture();room(s,east).instability=2;room(s,east).cubesByPlayer={p2:1,'black-rose':1};syncCubes(s);
  s=arm(s,"Pilgrim's Mark",'p1',{});expect(s.ongoingSpells).toHaveLength(1);
  s=exploreInto(s,'p1',{q:1,r:0});expect(room(s,east).cubesByPlayer).toEqual({p1:1,'black-rose':1});
  expect(room(s,east).instability).toBe(2);expect(s.ongoingSpells).toHaveLength(1);conserved(s);
 });
 it.each([0,1])('entry conversion is capped at %i remaining owner cubes without changing room totals',stock=>{
  let s=fixture();room(s,east).instability=2;room(s,east).cubesByPlayer={p2:2};
  let remaining=25-stock;
  for(const r of s.board.rooms.filter(r=>!r.startingFor&&r.id!==east)) {
   const n=Math.min(remaining,r.instabilityLimit);r.instability=n;r.cubesByPlayer=n?{p1:n}:{};remaining-=n;
  }
  expect(remaining).toBe(0);syncCubes(s);s=arm(s,"Pilgrim's Mark",'p1',{});s=exploreInto(s,'p1',{q:1,r:0});
  expect(room(s,east).instability).toBe(2);expect(room(s,east).cubesByPlayer.p1??0).toBe(stock);expect(player(s).cubes.available).toBe(0);conserved(s);
 });
 it('entry conversion never rewrites historical reconstructed/scored-room contributions',()=>{
  let s=fixture();Object.assign(room(s,east),{instability:5,cubesByPlayer:{p2:5},scored:true,reconstructed:true});syncCubes(s);
  s=arm(s,"Pilgrim's Mark",'p1',{});s=exploreInto(s,'p1',{q:1,r:0});
  expect(room(s,east).cubesByPlayer).toEqual({p2:5});expect(player(s).cubes.available).toBe(25);conserved(s);
 });
 it('Thorned Path applies conversion immediately to the selected mage and follows that mage, not its owner',()=>{
  let s=fixture();wound(s,'p2',{p3:2});s=arm(s,'Thorned Path','p1',{targetPlayerId:'p2'});
  expect(player(s,'p2').wizard.damageByPlayer).toEqual({p1:1,p3:1});
  s=exploreInto(s,'p1',{q:1,r:0});expect(room(s,east).instability).toBe(0);
  s=exploreInto(s,'p2',{q:1,r:0});expect(room(s,east)).toMatchObject({instability:1,cubesByPlayer:{p1:1}});conserved(s);
 });
 it('Thorned Path ignores immediate own-mage conversion but still binds and places instability on entry',()=>{
  const s=fixture();wound(s,'p1',{p2:1,p3:1,'black-rose':1});
  const card=prepare(s,'Thorned Path'),before=structuredClone(s),cards=physicalCards(s);
  let result=cast(s,'p1',{targetPlayerId:'p1-wizard'});
  expect(player(result).wizard).toEqual(player(before).wizard);expect(result.players.map(p=>p.cubes)).toEqual(before.players.map(p=>p.cubes));
  expect(result.feedbackEvents).toEqual([]);expect(result.activation).toMatchObject({actionsUsed:1,spellsCast:1});
  expect(player(result).actionTokens).toBe(2);expect(player(result).prepared.rapid?.used).toBe(true);
  expect(result.ongoingSpells).toMatchObject([{playerId:'p1',targetPlayerId:'p1',card}]);
  const active=structuredClone(result.ongoingSpells);expect(result.activeSpellOrder).toEqual([active![0].id]);
  expect(result.library.find(d=>d.id==='enchantment')!.discard).not.toContainEqual(card);
  expect(s).toEqual(before);expect(physicalCards(result)).toEqual(cards);conserved(result);
  result=exploreInto(result,'p1',{q:1,r:0});
  expect(player(result).wizard).toMatchObject({damageCubes:3,damageByPlayer:{p2:1,p3:1,'black-rose':1},position:{q:1,r:0}});
  expect(room(result,east)).toMatchObject({instability:1,cubesByPlayer:{p1:1}});
  expect(player(result).cubes).toEqual({...player(before).cubes,available:player(before).cubes.available-1,onBoard:1});
  expect(result.players.slice(1).map(p=>p.cubes)).toEqual(before.players.slice(1).map(p=>p.cubes));
  expect(result.feedbackEvents).toMatchObject([{kind:'SPELL_TRIGGERED',activeSpellId:active![0].id,ongoing:true,ownerId:'p1',trigger:'ENTER_ROOM'}]);
  expect(result.ongoingSpells).toEqual(active);expect(physicalCards(result)).toEqual(cards);conserved(result);
 });
 for(const kind of ['MAGE','EVOCATION'] as const)for(const own of [false,true]) {
  it(`ongoing ${kind} binding ${own?'ignores own':'resolves enemy'} conversion both immediately and on entry, then resumes instability`,()=>{
   const s=fixture(),id=kind==='MAGE'?(own?'p1':'p2'):'bound-servant';
   if(kind==='EVOCATION')evoc(s,id,own?'p1':'p2',8);
   wound(s,id,{p1:1,p3:2,'black-rose':1});
   const trigger=on('ENTER_ROOM','BOUND_MODEL','ANY');
   const card={...take(s,'Stolen Sigil'),convert:1,spellType:'CONTINGENCY' as const,ongoing:{trigger,effects:[
    instruction('CONVERT',2,'BOUND_MODEL'),instruction('INSTABILITY',1,'EVENT_ROOM'),
   ]}};
   prepare(s,card);const before=structuredClone(s),cards=physicalCards(s);
   let result=cast(s,'p1',kind==='MAGE'?{targetPlayerId:id}:{targetEvocationId:id});
   const bound=(state:GameState)=>kind==='MAGE'?player(state,id).wizard:state.evocations.find(e=>e.id===id)!;
   expect(bound(result)).toMatchObject({damageCubes:4,damageByPlayer:own?{p1:1,p3:2,'black-rose':1}:{p1:2,p3:1,'black-rose':1}});
   if(own) {
    expect(bound(result)).toEqual(bound(before));expect(result.players.map(p=>p.cubes)).toEqual(before.players.map(p=>p.cubes));
    expect(result.feedbackEvents).toEqual([]);
   } else expect(result.feedbackEvents).toMatchObject([{kind:'CONVERT',sourceId:'p1',target:{kind,id},amount:1,total:4}]);
   expect(result.activation).toMatchObject({actionsUsed:1,spellsCast:1});expect(player(result).actionTokens).toBe(2);
   const active=structuredClone(result.ongoingSpells!);expect(active).toHaveLength(1);expect(active[0].card).toEqual(card);
   expect(s).toEqual(before);expect(physicalCards(result)).toEqual(cards);conserved(result);
   const controller=own?'p1':'p2';turn(result,controller);
   result=applyAction(result,kind==='MAGE'?{type:'EXPLORE',playerId:controller}:{type:'ACTIVATE_EVOCATION',playerId:controller,evocationId:id});
   const beforeStep=structuredClone(result);
   const moved=applyAction(result,kind==='MAGE'?{type:'EXPLORE_STEP',playerId:controller,destination:{q:1,r:0}}:{type:'EVOCATION_STEP',playerId:controller,destination:{q:1,r:0}});
   expect(result).toEqual(beforeStep);
   expect(bound(moved)).toMatchObject({position:{q:1,r:0},damageCubes:4,damageByPlayer:own?{p1:1,p3:2,'black-rose':1}:{p1:4}});
   expect(room(moved,east)).toMatchObject({instability:1,cubesByPlayer:{p1:1}});
   const location=kind==='MAGE'?'onWizard':'onEvocations',converted=own?0:2;
   expect(player(moved).cubes).toEqual({...player(beforeStep).cubes,available:player(beforeStep).cubes.available-converted-1,
    onBoard:player(beforeStep).cubes.onBoard+1,[location]:player(beforeStep).cubes[location]+converted});
   expect(player(moved,'p3').cubes.available).toBe(player(beforeStep,'p3').cubes.available+(own?0:1));
   const triggered=moved.feedbackEvents!.slice(beforeStep.feedbackEvents!.length);
   expect(triggered.map(e=>e.kind)).toEqual(own?['SPELL_TRIGGERED']:['SPELL_TRIGGERED','CONVERT']);
   expect(triggered[0]).toMatchObject({kind:'SPELL_TRIGGERED',activeSpellId:active[0].id,ongoing:true,trigger:'ENTER_ROOM'});
   if(!own)expect(triggered[1]).toMatchObject({kind:'CONVERT',sourceId:'p1',target:{kind,id},amount:2,total:4,interruptId:triggered[0].id});
   expect(moved.ongoingSpells).toEqual(active);expect(moved.activeSpellOrder).toEqual([active[0].id]);
   expect(physicalCards(moved)).toEqual(cards);conserved(moved);
  });
 }
 it('Runic Remedy heals immediately and on bound-mage room activation, including the own mage',()=>{
  let s=fixture();wound(s,'p1',{p2:3});s=arm(s,'Runic Remedy','p1',{targetPlayerId:'p1'});
  expect(player(s).wizard.damageCubes).toBe(2);turn(s,'p1');s=applyAction(s,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  expect(player(s).wizard.damageCubes).toBe(1);expect(s.ongoingSpells).toHaveLength(1);conserved(s);
 });
 it('Arcane Feedback applies its base damage and reacts before the bound mage’s printed heal',()=>{
  let s=arm(fixture(),'Arcane Feedback','p1',{targetPlayerId:'p2'});expect(player(s,'p2').wizard.damageCubes).toBe(1);
  turn(s,'p2');prepare(s,'Mending Light','p2');s=cast(s,'p2');expect(player(s,'p2').wizard.damageCubes).toBe(0);
  expect(s.ongoingSpells).toHaveLength(1);expect(s.log.join('\n')).toMatch(/reacts with Arcane Feedback[\s\S]*Resume SPELL_CAST[\s\S]*Healing removes 2/);conserved(s);
 });
 it('ongoing CONTINGENCY MAGE with no printed heal may bind the caster; pure offensive MAGE cannot',()=>{
  const s=fixture(),trigger=on('ROOM_ACTIVATED','BOUND_MODEL','ANY');
  const c=custom('beneficial',trigger,[],{spellType:'CONTINGENCY',target:'MAGE',ongoing:{trigger,effects:[]}});
  expect(spellCanTargetModel(c,'p1','p1','MAGE')).toBe(true);prepare(s,c);expect(cast(s,'p1',{targetPlayerId:'p1'}).ongoingSpells).toHaveLength(1);
    expect(spellCanTargetModel({...c,spellType:'COMBAT'},'p1','p1','MAGE')).toBe(false);
 });
 it('expiry on defeat returns the ongoing physical card once, and it never binds the respawn',()=>{
  let s=fixture();player(s,'p2').wizard.health=2;s=arm(s,'Arcane Feedback','p1',{targetPlayerId:'p2'});const cards=physicalCards(s);
  turn(s,'p3');s=applyAction(s,{type:'PUNCH',playerId:'p3',targetId:'p2'});
  expect(s.ongoingSpells).toEqual([]);expect(s.library.find(d=>d.id==='enchantment')!.discard.filter(c=>c.name==='Arcane Feedback')).toHaveLength(1);
  expect(s.activeSpellOrder).toEqual([]);expect(physicalCards(s)).toEqual(cards);conserved(s);
 });
 it('an immediately lethal base effect expires the newly committed binding',()=>{
  const s=fixture();player(s,'p2').wizard.health=1;prepare(s,'Arcane Feedback');
  const result=cast(s,'p1',{targetPlayerId:'p2'});expect(result.ongoingSpells).toEqual([]);expect(player(result,'p2').wizard.damageCubes).toBe(0);conserved(result);
 });
 it('bound evocation destruction expires passives and returns all colored cubes, including safe own-color ledgers',()=>{
  let s=fixture();evoc(s,'e1','p2',3);wound(s,'e1',{p2:1,p3:1});
  const trigger=on('ENTER_ROOM','BOUND_MODEL','ANY');s=arm(s,custom('bound servant',trigger,[],{spellType:'CONTINGENCY',target:'EVOCATION',ongoing:{trigger,effects:[]}}),'p1',{targetEvocationId:'e1'});
  turn(s,'p4');s=applyAction(s,{type:'PUNCH',playerId:'p4',targetId:'e1'});
  expect(s.evocations).toEqual([]);expect(s.ongoingSpells).toEqual([]);expect(player(s,'p2').cubes.available).toBe(25);expect(player(s,'p3').cubes.available).toBe(25);conserved(s);
 });
 it('triggered damage is immune on owner and own evocations and emits no DAMAGE_TAKEN for zero/immune damage',()=>{
  let s=fixture();evoc(s,'e1','p1');
  s=arm(s,custom('own damage',on('EVOCATION_ACTIVATED','BOUND_ROOM','ANY'),[instruction('DAMAGE',3,'EVENT_MODEL'),instruction('DAMAGE',3,'OWNER')]),'p1');
  s=arm(s,'Thorn Retort','p1',{});turn(s,'p1');s=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'e1'});
  expect(player(s).wizard.damageCubes).toBe(0);expect(s.evocations[0].damageCubes).toBe(0);expect(s.readiedSpells!.map(a=>a.card.name)).toEqual(['Thorn Retort']);
  let zero=fixture();zero=arm(zero,'Thorn Retort','p2',{});player(zero).wizard.attack=0;turn(zero,'p1');
  zero=applyAction(zero,{type:'PUNCH',playerId:'p1',targetId:'p2'});expect(zero.readiedSpells).toHaveLength(1);conserved(s);conserved(zero);
 });
 it('triggered healing includes every owner and safely returns the bound model’s own friendly cubes first',()=>{
  let s=fixture();wound(s,'p1',{p1:1,p3:1});s=arm(s,'Mending Ward','p2',{targetPlayerId:'p1'});turn(s,'p4');
  s=applyAction(s,{type:'PUNCH',playerId:'p4',targetId:'p1'});
  expect(player(s).wizard).toMatchObject({damageCubes:2,damageByPlayer:{p4:2}});expect(player(s).cubes.available).toBe(25);expect(player(s,'p3').cubes.available).toBe(25);conserved(s);
 });
 it('settles legacy Cleanup active zones once while clearing used preparation references without duplicating cards',()=>{
  let s=arm(fixture(),'Threshold Snare','p1',{roomId:east});s=arm(s,"Pilgrim's Mark",'p2',{});
  const cards=physicalCards(s),readied=structuredClone(s.readiedSpells),ongoing=structuredClone(s.ongoingSpells);
  s.phase='CLEANUP';s.activation=null;s.currentPlayerId=null;s.eventDeck=[{id:'quiet',name:'Quiet',description:'Quiet',kind:'BLACK_DAMAGE',amount:0,rooms:0}];
  s=applyAction(s,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:'CLEANUP',expectedRound:1});
  expect(s.readiedSpells).toEqual([]);expect(s.ongoingSpells).toEqual([]);expect(s.activeSpellOrder).toEqual([]);
  expect(player(s).hand).toContainEqual(readied![0].card);
  expect(s.library.find(d=>d.id==='enchantment')!.discard).toContainEqual(ongoing![0].card);
  expect(player(s).prepared.rapid).toBeNull();expect(player(s,'p2').prepared.rapid).toBeNull();
  expect(physicalCards(s)).toEqual(cards);conserved(s);
 });
 it.each([1,3])('returns untriggered traps/protections to their owners and discards ongoing effects at actual round-%i Cleanup, including endgame',round=>{
  let s=arm(fixture(),'Threshold Snare','p1',{roomId:east});
  s=arm(s,'Mending Ward','p2',{targetPlayerId:'p3'});s=arm(s,"Pilgrim's Mark",'p3',{});
  const cards=physicalCards(s),readied=structuredClone(s.readiedSpells!),ongoing=structuredClone(s.ongoingSpells!),events=structuredClone(s.feedbackEvents);
  evoc(s,'last-model','p4');s.phase='EVOCATION';s.round=round;s.currentPlayerId='p4';s.activation=null;
  s=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p4',evocationId:'last-model'});
  s=applyAction(s,{type:'END_EVOCATION',playerId:'p4'});
  expect(s.phase).toBe(round===3?'GAME_OVER':'CLEANUP');
  expect(s.readiedSpells).toEqual([]);expect(s.ongoingSpells).toEqual([]);expect(s.activeSpellOrder).toEqual([]);
  for(const active of readied) {
   expect(player(s,active.playerId).hand.filter(c=>c.id===active.card.id)).toEqual([active.card]);
   expect(s.library.flatMap(d=>d.discard).some(c=>c.id===active.card.id)).toBe(false);
  }
  expect(s.library.find(d=>d.id==='enchantment')!.discard).toContainEqual(ongoing[0].card);
  expect(player(s,'p3').hand).not.toContainEqual(ongoing[0].card);
  expect(s.feedbackEvents).toEqual(events);expect(physicalCards(s)).toEqual(cards);expect(new Set(physicalCards(s)).size).toBe(120);conserved(s);
  if(round===1) {
   const settled=structuredClone(s.library),hands=s.players.map(p=>structuredClone(p.hand));
   s.eventDeck=[{id:'quiet',name:'Quiet',description:'No damage',kind:'INSTABILITY',amount:0,rooms:0}];
   s=applyAction(s,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:'CLEANUP',expectedRound:1});
   expect(s.players.map(p=>p.hand)).toEqual(hands);expect(s.library).toEqual(settled);expect(physicalCards(s)).toEqual(cards);
   expect(s.players.every(p=>Object.values(p.prepared).every(c=>c===null))).toBe(true);
  }
 });
 it('returns the actual physical hidden card even above the hand limit, deferring overflow to Preparation',()=>{
  let s=arm(fixture(),'Threshold Snare','p1',{roomId:east});
  const active=s.readiedSpells![0];player(s).hand.push(...s.library[0].cards.splice(0,7));const cards=physicalCards(s);
  evoc(s,'last-model','p4');s.phase='EVOCATION';s.activation=null;s.currentPlayerId='p4';
  s=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p4',evocationId:'last-model'});
  s=applyAction(s,{type:'END_EVOCATION',playerId:'p4'});
  expect(player(s).hand).toHaveLength(8);expect(player(s).hand.at(-1)).toEqual(active.card);expect(s.activeSpellOrder).toEqual([]);
  s.phase='PREPARATION';player(s).preparationDone=false;
  reject(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:player(s).hand.slice(0,2).map(c=>c.id)},/hand limit/);
  expect(physicalCards(s)).toEqual(cards);expect(new Set(cards).size).toBe(120);conserved(s);
 });
 it('can replay a serialized one-shot state twice without reusing physical instance IDs or mutating history snapshots',()=>{
  const s=arm(fixture(),'Threshold Snare','p1',{roomId:east}),before=structuredClone(s);
  const first=exploreInto(structuredClone(s),'p2',{q:1,r:0}),second=exploreInto(JSON.parse(JSON.stringify(s)) as GameState,'p2',{q:1,r:0});
  expectSameFreshResolution(first,second);expect(s).toEqual(before);expect(first.readiedSpells).toEqual([]);
  const active:ActiveSpell=s.readiedSpells![0];expect(active.id).not.toContain('enchantment');
 });
});