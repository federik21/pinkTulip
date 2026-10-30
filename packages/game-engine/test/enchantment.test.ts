import { describe, expect, it } from 'vitest';
import {
 applyAction, canPlayerAct, canUseSpellDummy, createEnchantmentDeck, createGame,
 createLibrary, getSpellType, hexDistance, spellCanTargetModel,
} from '../src';
import { moment, momentTotal } from '../src/cards';
import { withMoments } from './flat-effects';
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
 const held=player(s,id).prepared[slot]?.card;
 return applyAction(s,{type:'CAST_SPELL',playerId:id,slot,...(held&&['TRAP','PROTECTION'].includes(getSpellType(held))?{}:selection)});
}
function arm(s:GameState,name:Card|string,id='p1',selection:Selection={roomId:center}) {
 turn(s,id);prepare(s,name,id);return cast(s,id,selection);
}
const instruction=(effect:TriggeredInstruction['effect'],amount:number,target:TriggeredInstruction['target']):TriggeredInstruction=>({effect,amount,target});
let syntheticId=0;
function custom(name:string,trigger:TriggerCondition,effects:TriggeredInstruction[],changes:Partial<Card>={}):Card {
 return {id:`synthetic-${++syntheticId}`,name,kind:'SPELL',target:'ROOM',range:3,moments:[],spellType:'TRAP',trigger,triggerEffects:effects,...changes};
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
 it.each([{damage:1},{instability:1},{convert:1},{heal:2},{}])('infers legacy type without changing the card: %j',stats=>{
  const card:Card={id:'legacy',name:'Legacy',kind:'SPELL',target:'MODEL',moments:[],range:2,...withMoments(stats)};
    const before=structuredClone(card);expect(getSpellType(card)).toBe(card.moments.some(m=>m.effect!=='HEAL')?'COMBAT':'CONTINGENCY');expect(card).toEqual(before);
  expect(getSpellType({...card,spellType:'PROTECTION'})).toBe('PROTECTION');
 });
 it('initializes absent legacy active zones on the first command',()=>{
  const s=fixture();delete s.readiedSpells;delete s.ongoingSpells;delete s.activeSpellOrder;
  const result=applyAction(s,{type:'EXPLORE',playerId:'p1'});
  expect(result.readiedSpells).toEqual([]);expect(result.ongoingSpells).toEqual([]);
 });
});

describe('reactive targeting, quotas and dummy compatibility',()=>{
 it('ongoing MODEL spells and legacy MODEL offense both allow dummy targeting without binding',()=>{
  const c:Card={id:'model',name:'Model',kind:'SPELL',target:'MODEL',range:2,moments:[moment.damage(1)]};
  expect(canUseSpellDummy(c)).toBe(true);
  const bound={...c,ongoing:{trigger:on('ENTER_ROOM','BOUND_MODEL','ANY'),effects:[]}};
  expect(canUseSpellDummy(bound)).toBe(true);
  const s=fixture();prepare(s,bound);const result=cast(s,'p1',{roomId:center,dummy:true});
  expect(result.ongoingSpells).toEqual([]);expect(result.activeSpellOrder).toEqual([]);
  expect(player(result).discard).toEqual([bound]);expect(result.players.map(p=>p.wizard)).toEqual(s.players.map(p=>p.wizard));
 });
});

describe('instruction interruption, single fire and depth-first ordering',()=>{
 it('guards unbounded passive recursion at 128 resolutions and leaves the whole root action unchanged',()=>{
  let s=fixture();for(const p of s.players)p.wizard.health=1000;
  const feedback=(name:string)=>custom(name,on('DAMAGE_TAKEN','BOUND_MODEL','ANY'),[],{target:'SELF',spellType:'CONTINGENCY',ongoing:{trigger:on('DAMAGE_TAKEN','BOUND_MODEL','ANY'),effects:[instruction('DAMAGE',1,'EVENT_ACTOR')]}});
  s=arm(s,feedback('A'),'p1',{});s=arm(s,feedback('B'),'p2',{});turn(s,'p1');
  reject(s,{type:'PUNCH',playerId:'p1',targetId:'p2'},/resolution limit exceeded \(128\)/);
 });
});
