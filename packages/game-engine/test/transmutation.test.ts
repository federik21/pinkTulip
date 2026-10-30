import { describe, expect, it } from 'vitest';
import {
 applyAction, BLACK_ROSE_ID, canPlayerAct, canUseSpellDummy, createGame,
 createLibrary, evocationAttack, spellCanTargetModel,
} from '../src';
import { momentTotal } from '../src/cards';
import { flatMoments, withMoments, type FlatEffects } from './flat-effects';
import type { Card, Evocation, GameAction, GameState, Hex, SpellTarget } from '../src';

const origin:Hex={q:0,r:0};
const targets:SpellTarget[]=['SELF','ROOM','MAGE','EVOCATION','MODEL'];
type Cast=Extract<GameAction,{type:'CAST_SPELL'}>;
type Selection=Omit<Cast,'type'|'playerId'|'slot'>;
const card=(target:SpellTarget,changes:Partial<Card>&FlatEffects={}):Card=>({id:'test-spell',name:'Test spell',kind:'SPELL',moments:[],range:2,target,...withMoments(changes)});
function fixture():GameState {
 const s=createGame(4);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players)p.wizard.position={...origin};
 s.evocations=['p1','p2','p3','p4'].map((playerId,i):Evocation=>({
  id:`evoc-${i+1}`,playerId,name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:10,
  passive:'WOUNDED_FURY',position:{...origin},damageCubes:0,damageByPlayer:{},activated:false,
 }));
 return s;
}
function prepare(s:GameState,spell:Card|string,slot:Cast['slot']='rapid') {
 if(typeof spell==='string') {
  const deck=s.library.find(d=>d.id==='transmutation')!;
  const i=deck.cards.findIndex(c=>c.name===spell);expect(i).toBeGreaterThanOrEqual(0);
  spell=deck.cards.splice(i,1)[0];
 }
 s.players[0].prepared[slot]={card:spell,used:false};
 return spell;
}
const cast=(s:GameState,selection:Selection={},slot:Cast['slot']='rapid')=>applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot,...selection});
function reject(s:GameState,selection:Selection,error:RegExp,slot:Cast['slot']='rapid') {
 const before=structuredClone(s);expect(()=>cast(s,selection,slot)).toThrow(error);expect(s).toEqual(before);
}
const room=(s:GameState,id='room-0,0')=>s.board.rooms.find(r=>r.id===id)!;
const model=(s:GameState,kind:'MAGE'|'EVOCATION',index=1)=>kind==='MAGE'?s.players[index].wizard:s.evocations[index];
function syncCubes(s:GameState) {
 for(const p of s.players) {
  p.cubes.onWizard=s.players.reduce((n,t)=>n+(t.wizard.damageByPlayer[p.id]??0),0);
  p.cubes.onEvocations=s.evocations.reduce((n,t)=>n+(t.damageByPlayer[p.id]??0),0);
  p.cubes.onBoard=s.board.rooms.filter(r=>!r.scored).reduce((n,r)=>n+(r.cubesByPlayer[p.id]??0),0);
  p.cubes.available=25-p.cubes.onWizard-p.cubes.onEvocations-p.cubes.onBoard;
 }
}
function conserved(s:GameState) {
 for(const p of s.players) {
  expect(Object.values(p.cubes).every(n=>Number.isInteger(n)&&n>=0)).toBe(true);
  expect(Object.values(p.cubes).reduce((n,v)=>n+v,0)).toBe(25);
  expect(p.cubes.onWizard).toBe(s.players.reduce((n,t)=>n+(t.wizard.damageByPlayer[p.id]??0),0));
  expect(p.cubes.onEvocations).toBe(s.evocations.reduce((n,t)=>n+(t.damageByPlayer[p.id]??0),0));
  expect(p.cubes.onBoard).toBe(s.board.rooms.filter(r=>!r.scored).reduce((n,r)=>n+(r.cubesByPlayer[p.id]??0),0));
 }
}
function wound(s:GameState,kind:'MAGE'|'EVOCATION',index:number,ledger:Record<string,number>,unattributed=0,blackDamage=0) {
 const m=model(s,kind,index);m.damageByPlayer={...ledger};
 m.damageCubes=Object.values(ledger).reduce((n,v)=>n+v,0)+unattributed+blackDamage;
 if(kind==='MAGE')s.players[index].wizard.blackDamage=blackDamage;
 syncCubes(s);
}
function limitStock(s:GameState,id:string,available:number) {
 const owner=s.players.find(p=>p.id===id)!;let remaining=owner.cubes.available-available;
 for(const r of s.board.rooms.filter(r=>!r.startingFor&&r.id!=='room-0,0')) {
  const n=Math.min(remaining,r.instabilityLimit-r.instability);
  if(n>0){r.instability+=n;r.cubesByPlayer[id]=(r.cubesByPlayer[id]??0)+n;remaining-=n;}
 }
 expect(remaining).toBe(0);syncCubes(s);
}
function mergeRoom(s:GameState,position:Hex) {
 const other=s.board.rooms.find(r=>r.tiles.some(h=>h.q===position.q&&h.r===position.r))!;
 s.board.rooms=s.board.rooms.filter(r=>r!==other);room(s).tiles.push({...position});
}
function physicalCards(s:GameState) {
 return [
  ...s.library.flatMap(d=>[...d.cards,...d.discard]),...s.powerfulDeck,...s.removedCards,
  ...s.players.flatMap(p=>[...p.personalDeck,...p.hand,...p.discard,...Object.values(p.prepared).flatMap(c=>c&&!c.used?[c.card]:[])]),
  ...[...s.readiedSpells??[],...s.ongoingSpells??[]].map(a=>a.card),
 ].map(c=>c.id).sort();
}

describe.each(targets)('%s public target helpers',target=>{
 for(const kind of ['MAGE','EVOCATION'] as const)for(const own of [false,true]) {
  it.each([{damage:2},{},{heal:1},{convert:1},{damage:2,heal:1},{damage:2,convert:1}])(`validates ${own?'own':'enemy'} ${kind} with %j`,effects=>{
   const spell=card(target,effects),before=structuredClone(spell);
   const category=target==='MODEL'||target===kind;
  const expected=target==='SELF'?own&&kind==='MAGE':category&&!(own&&kind==='MAGE')&&(!own||!!(momentTotal(spell,'HEAL')||momentTotal(spell,'CONVERT')));
   expect(spellCanTargetModel(spell,'p1',own?'p1':'p2',kind)).toBe(expected);expect(spell).toEqual(before);
  expect(canUseSpellDummy(spell)).toBe(['MAGE','EVOCATION','MODEL'].includes(target));
  });
 }
});

describe('authoritative target selection and legality',()=>{
 it.each(['MAGE','EVOCATION','MODEL'] as const)('%s requires a real typed target or an explicit dummy; rejects forgeries and mixed payloads',target=>{
  const s=fixture();prepare(s,card(target,{heal:1,convert:1}));
  for(const selection of [{},{targetPlayerId:'missing'},{targetEvocationId:'missing'},
   {targetPlayerId:'evoc-2'},{targetEvocationId:'p2'},{targetEvocationId:'p2-wizard'},
   {targetPlayerId:'p2',targetEvocationId:'evoc-2'},{roomId:'room-0,0'},
   {targetPlayerId:'p2',roomId:'room-0,0'},{dummy:true},
   {dummy:true,roomId:'room-0,0',targetPlayerId:'p2'},
   {dummy:true,roomId:'room-0,0',targetEvocationId:'evoc-2'}])reject(s,selection,/Select one|Select a room|not found|payload|room|Dummy/);
  const before=structuredClone(s),result=cast(s,{dummy:true,roomId:'room-0,0'});
  expect(result.players.map(p=>p.wizard)).toEqual(before.players.map(p=>p.wizard));
  expect(result.evocations).toEqual(before.evocations);conserved(result);
 });
 it('legacy MODEL dummy preserves instability but never damages models or supplies support',()=>{
  const s=fixture();prepare(s,card('MODEL',{damage:8,instability:2}));const before=structuredClone(s);
  const result=cast(s,{dummy:true,roomId:'room-0,0'});
  expect(room(result)).toMatchObject({instability:2,cubesByPlayer:{p1:2}});
  expect(result.players.map(p=>p.wizard)).toEqual(before.players.map(p=>p.wizard));expect(result.evocations).toEqual(before.evocations);
  expect(result.activation).toMatchObject({actionsUsed:1,spellsCast:1});conserved(result);
 });
 it.each(['MAGE','EVOCATION','MODEL'] as const)('%s pure offense rejects own mage/evocations, even at zero damage',target=>{
  for(const damage of [0,2]) {
   const s=fixture();prepare(s,card(target,{damage}));
   reject(s,{targetPlayerId:'p1'},/Spell cannot target/);reject(s,{targetEvocationId:'evoc-1'},/Spell cannot target/);
  }
 });

 for(const target of targets) {
  it(`${target} cannot be cast from any protected starting room`,()=>{
   const s=fixture();prepare(s,card(target,{heal:2}));
   for(const start of s.board.rooms.filter(r=>r.startingFor)) {
    s.players[0].wizard.position={...start.tiles[0]};reject(s,{},/Leave the starting room/);
   }
  });
 }
 for(const kind of ['MAGE','EVOCATION'] as const) {
  it(`${kind} healing/conversion cannot target models in any protected start`,()=>{
   const s=fixture();prepare(s,card(kind,{heal:2,convert:2,range:99}));
   for(const start of s.board.rooms.filter(r=>r.startingFor)) {
    // Put caster on a straight axis so protection is tested independently of LOS.
    s.players[0].wizard.position={q:start.tiles[0].q,r:0};
    model(s,kind,1).position={...start.tiles[0]};
    reject(s,kind==='MAGE'?{targetPlayerId:'p2'}:{targetEvocationId:'evoc-2'},/starting room/);
   }
  });
  it.each([{q:1,r:1},{q:2,r:0}])(`${kind} support rejects off-axis or out-of-range coordinates %j`,position=>{
   const s=fixture();prepare(s,card(kind,{heal:2,convert:2,range:1}));model(s,kind,1).position=position;
   reject(s,kind==='MAGE'?{targetPlayerId:'p2'}:{targetEvocationId:'evoc-2'},/out of range/);
  });
 }
 it.each([false,true])('ROOM/legacy dummy enforce room LOS, range and protected starts (dummy=%s)',dummy=>{
  const s=fixture();prepare(s,card(dummy?'MODEL':'ROOM',{damage:1,instability:1,range:1}));
  for(const id of ['room-1,1','room-2,0'])reject(s,{dummy,roomId:id},/out of range/);
  for(const start of s.board.rooms.filter(r=>r.startingFor))reject(s,{dummy,roomId:start.id},/Starting rooms/);
 });
 it.each(['ROOM','MODEL'] as const)('%s selects any in-range tile of a multihex room',target=>{
  const s=fixture();s.players[0].wizard.position={q:2,r:0};mergeRoom(s,{q:1,r:0});
  prepare(s,card(target,{heal:target==='ROOM'?1:undefined,instability:1,range:1}));
  const result=cast(s,{roomId:'room-0,0',dummy:target==='MODEL'});expect(room(result).instability).toBe(1);conserved(result);
 });

 it.each(targets)('canPlayerAct uses legal %s targets without requiring a nonzero effect',target=>{
  const s=fixture();s.players[0].actionTokens=0;prepare(s,card(target,{heal:1}));
  if(target==='EVOCATION')s.evocations=[];
  expect(canPlayerAct(s,s.players[0])).toBe(true);
  if(target==='EVOCATION'){s.evocations=fixture().evocations;expect(canPlayerAct(s,s.players[0])).toBe(true);}
 });
 it.each(['MAGE','EVOCATION','MODEL'] as const)('canPlayerAct includes a legal %s offensive dummy when real targets are unavailable',target=>{
  const s=fixture();s.players[0].actionTokens=0;prepare(s,card(target,{damage:1}));
  for(const p of s.players.slice(1))p.wizard.position={q:1,r:1};
  for(const e of s.evocations)e.position={q:1,r:1};
  expect(canPlayerAct(s,s.players[0])).toBe(true);
 });
 it.each(['MAGE','EVOCATION','MODEL'] as const)('canPlayerAct retains a dummy without weakening protected/off-axis real %s targets',target=>{
  const s=fixture();s.players[0].actionTokens=0;prepare(s,card(target,{heal:1}));
  const kind=target==='EVOCATION'?'EVOCATION':'MAGE';
  const selection=kind==='EVOCATION'?{targetEvocationId:'evoc-2'}:{targetPlayerId:'p2'};
  model(s,kind,1).position={q:1,r:1};reject(s,selection,/out of range/);
  expect(canPlayerAct(s,s.players[0])).toBe(true);
  model(s,kind,1).position={q:3,r:-2};reject(s,selection,/starting room/);
  expect(canPlayerAct(s,s.players[0])).toBe(true);
 });
});

describe('healing wounds and returning only actual physical cubes',()=>{
 it.each([1,2,3,4,5,20])('caps %i healing at actual wounds, removing black damage before unattributed wounds',heal=>{
  const s=fixture();prepare(s,card('MAGE',{heal}));wound(s,'MAGE',1,{p3:1,[BLACK_ROSE_ID]:1},2,1);
  const before=structuredClone(s.players.map(p=>p.cubes));const result=cast(s,{targetPlayerId:'p2'});
  expect(result.players[1].wizard.damageCubes).toBe(Math.max(0,5-heal));
  expect(result.players[1].wizard.blackDamage).toBe(heal>=3?0:1);
  expect(result.players[1].wizard.damageByPlayer[BLACK_ROSE_ID]??0).toBe(heal>=2?0:1);
  expect(result.players[2].cubes.available).toBe(before[2].available+1);
  for(const i of [0,1,3])expect(result.players[i].cubes).toEqual(before[i]);conserved(result);
 });
 it.each(['MAGE','EVOCATION'] as const)('neutral-only and unattributed-only %s healing creates no supply',kind=>{
  for(const ledger of [{[BLACK_ROSE_ID]:3},{}] as Record<string,number>[]) {
   const s=fixture();prepare(s,card(kind,{heal:20}));wound(s,kind,1,ledger,Object.keys(ledger).length?0:3);
   const before=s.players.map(p=>({...p.cubes}));const result=cast(s,kind==='MAGE'?{targetPlayerId:'p2'}:{targetEvocationId:'evoc-2'});
   expect(model(result,kind).damageCubes).toBe(0);expect(model(result,kind).damageByPlayer).toEqual({});
   expect(result.players.map(p=>p.cubes)).toEqual(before);conserved(result);
  }
 });
 it('healing Succubus Wounded Fury reduces the actual subsequent evocation attack',()=>{
  const s=fixture();prepare(s,card('EVOCATION',{heal:2}));
  Object.assign(s.evocations[0],{kind:'SUCCUBUS',name:'Succubus',archetype:'DEMON',attack:1,health:3});wound(s,'EVOCATION',0,{p2:1});
  expect(evocationAttack(s.evocations[0])).toBe(2);
  let result=cast(s,{targetEvocationId:'evoc-1'});expect(evocationAttack(result.evocations[0])).toBe(1);
  result=applyAction(result,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'evoc-1'});
  result=applyAction(result,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'});
  expect(result.players[1].wizard.damageCubes).toBe(1);expect(result.players[1].wizard.damageByPlayer).toEqual({p1:1});conserved(result);
 });
});

describe('conversion replaces ownership without creating wounds, instability or rewards',()=>{
 it('converts actual mage Pink Tulip ledger/blackDamage, but not unattributed wounds',()=>{
  const s=fixture();prepare(s,card('MAGE',{convert:20}));wound(s,'MAGE',1,{p3:1,[BLACK_ROSE_ID]:1},3,2);
  const result=cast(s,{targetPlayerId:'p2'});
  expect(result.players[1].wizard).toMatchObject({damageCubes:7,blackDamage:0,damageByPlayer:{p1:4}});
  expect(result.players[2].cubes.available).toBe(25);expect(result.players[0].cubes.available).toBe(21);
  expect(result.blackRose).toEqual(s.blackRose);conserved(result);
 });
 it.each(['MAGE','EVOCATION'] as const)('enemy %s conversion cannot spend supply on caster-colored cubes or unattributed wounds',kind=>{
  for(const ledger of [{p1:2},{}] as Record<string,number>[]) {
   const s=fixture();prepare(s,card(kind,{convert:5}));wound(s,kind,1,ledger,2);
   const before=structuredClone(s),result=cast(s,kind==='MAGE'?{targetPlayerId:'p2'}:{targetEvocationId:'evoc-2'});
   expect(model(result,kind)).toEqual(model(before,kind));expect(result.players.map(p=>p.cubes)).toEqual(before.players.map(p=>p.cubes));
   expect(result.feedbackEvents).toEqual(before.feedbackEvents);expect(s).toEqual(before);conserved(result);
  }
 });
 it('conversion of a completed all-enemy room earns no immediate solo/completion/instability/kill quests or VP',()=>{
  const s=fixture();prepare(s,card('ROOM',{convert:10}));room(s).instability=10;room(s).cubesByPlayer={p2:10};syncCubes(s);
  s.players[0].quest={id:'inst',name:'Instability',description:'Place instability',kind:'INSTABILITY',amount:2,reward:2};
  s.players[0].additionalQuests=[{id:'rebuild',name:'Rebuild',description:'Complete room',kind:'REBUILD',amount:1,reward:3},{id:'kill',name:'Kill',description:'Defeat mage',kind:'KILL',amount:1,reward:3}];
  const result=cast(s,{roomId:'room-0,0'});expect(room(result).cubesByPlayer).toEqual({p1:10});
  expect(result.players[0]).toMatchObject({victoryPoints:0,kills:0,questsCompleted:0,quest:s.players[0].quest,additionalQuests:s.players[0].additionalQuests});
  expect(room(result)).toMatchObject({reconstructed:false,scored:false,instability:10});expect(result.questDiscard).toEqual(s.questDiscard);conserved(result);
 });
});

describe('mixed support, damage immunity, resolution order and settlement',()=>{
 it('ROOM support heals all owners but ROOM damage skips caster and every owned evocation',()=>{
  const s=fixture();prepare(s,card('ROOM',{heal:2,damage:3}));
  for(const i of [0,1,2,3]){wound(s,'MAGE',i,{p4:3});wound(s,'EVOCATION',i,{p3:3});}
  const result=cast(s,{roomId:'room-0,0'});
  expect(result.players.map(p=>p.wizard.damageCubes)).toEqual([1,4,4,4]);expect(result.evocations.map(e=>e.damageCubes)).toEqual([1,4,4,4]);
  expect(result.players[0].wizard.damageByPlayer).toEqual({p4:1});expect(result.evocations[0].damageByPlayer).toEqual({p3:1});conserved(result);
 });
 it('legacy offensive ROOM spells also leave all owned models completely untouched',()=>{
  const s=fixture();prepare(s,card('ROOM',{damage:2}));const result=cast(s,{roomId:'room-0,0'});
  expect(result.players[0].wizard).toEqual(s.players[0].wizard);expect(result.evocations[0]).toEqual(s.evocations[0]);
  expect(result.players.slice(1).every(p=>p.wizard.damageCubes===2)).toBe(true);expect(result.evocations.slice(1).every(e=>e.damageCubes===2)).toBe(true);conserved(result);
 });
 it('controlled evocations still cannot damage their mage or any friendly evocation',()=>{
  const s=fixture();const active=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'evoc-1'});
  for(const targetId of ['p1','p1-wizard','evoc-1']) {
   const before=structuredClone(active);expect(()=>applyAction(active,{type:'EVOCATION_ATTACK',playerId:'p1',targetId})).toThrow(/cannot damage/);expect(active).toEqual(before);
  }
 });
 it('resolves instability, conversion, healing, then damage with stock shared between effects',()=>{
  const s=fixture();prepare(s,card('MAGE',{instability:1,convert:2,heal:2,damage:1}));
  wound(s,'MAGE',1,{p3:3});limitStock(s,'p1',2);const result=cast(s,{targetPlayerId:'p2'});
  expect(room(result)).toMatchObject({instability:1,cubesByPlayer:{p1:1}});
  // Instability spent one; conversion spent one; healing returned that converted
  // p1 cube before p3; damage can then spend the returned p1 cube again.
  expect(result.players[1].wizard).toMatchObject({damageCubes:2,damageByPlayer:{p3:1,p1:1}});
  expect(result.players[0].cubes.available).toBe(0);conserved(result);
 });
 it('unconverted neutral cubes also return safely on evocation destruction',()=>{
  const s=fixture();prepare(s,card('EVOCATION',{damage:1}));s.evocations[1].health=2;wound(s,'EVOCATION',1,{[BLACK_ROSE_ID]:1});
  const result=cast(s,{targetEvocationId:'evoc-2'});expect(result.evocations.some(e=>e.id==='evoc-2')).toBe(false);conserved(result);
 });
});