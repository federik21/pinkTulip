import { describe, expect, it } from 'vitest';
import {
 applyAction, BLACK_ROSE_ID, canPlayerAct, canUseSpellDummy, createGame,
 createLibrary, createSpellDeck, createTransmutationDeck, evocationAttack, spellCanTargetModel,
} from '../src';
import type { Card, Evocation, GameAction, GameState, Hex, SpellTarget } from '../src';

const origin:Hex={q:0,r:0};
const targets:SpellTarget[]=['SELF','ROOM','MAGE','EVOCATION','MODEL'];
type Cast=Extract<GameAction,{type:'CAST_SPELL'}>;
type Selection=Omit<Cast,'type'|'playerId'|'slot'>;
const card=(target:SpellTarget,changes:Partial<Card>={}):Card=>({id:'test-spell',name:'Test spell',kind:'SPELL',damage:0,instability:0,range:2,target,...changes});
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

describe('Transmutation physical school contract',()=>{
 it('adds exactly one independent 36-card school, 12 distinct printed patterns with three copies each',()=>{
  const library=createLibrary();expect(library.map(d=>[d.id,d.name])).toEqual([['cantrip','Cantrip'],['transmutation','Transmutation'],['enchantment','Enchantment']]);
  expect(new Set(library.map(d=>d.id)).size).toBe(3);
  const deck=createTransmutationDeck();expect(deck).toHaveLength(36);expect(new Set(deck.map(c=>c.id)).size).toBe(36);
  const expected:[string,SpellTarget,number,number,number,number,number][]=[
   ['Mending Light','SELF',3,0,0,0,0],['Vital Thread','MODEL',2,0,0,0,2],
   ["Summoner's Balm",'EVOCATION',2,0,0,0,3],['Renewing Word','MAGE',3,0,0,0,2],
   ['Sanctuary','ROOM',2,0,0,0,1],['Restorative Tide','ROOM',1,0,0,1,2],
   ['Stolen Sigil','MODEL',0,2,0,0,2],["Mage's Due",'MAGE',0,3,0,0,2],
   ['Reclaimed Servant','EVOCATION',0,2,0,0,3],['Rewrite the Lodge','ROOM',0,3,0,0,2],
   ["Alchemist's Refuge",'SELF',2,1,0,0,0],['Transmuting Surge','MODEL',0,1,1,0,2],
  ];
  expect(new Set(deck.map(c=>c.name)).size).toBe(12);
  for(const [name,target,heal,convert,damage,instability,range] of expected) {
   const copies=deck.filter(c=>c.name===name);expect(copies).toHaveLength(3);
   for(const c of copies) {
    expect(c).toMatchObject({name,target,damage,instability,range,kind:'SPELL',schoolId:'transmutation'});
    expect(c.heal??0).toBe(heal);expect(c.convert??0).toBe(convert);
   }
  }
  expect(library[0].cards.slice().sort((a,b)=>a.id.localeCompare(b.id))).toEqual(createSpellDeck('cantrip','cantrip').sort((a,b)=>a.id.localeCompare(b.id)));
  expect(library[1].cards.map(c=>c.id).sort()).toEqual(deck.map(c=>c.id).sort());
 });

 it.each([1,2,3,4])('creates %i seats with empty personal zones and exactly 108 shared plus 12 forgotten physical cards',count=>{
  const s=createGame(count),cards=physicalCards(s);
  expect(cards).toHaveLength(120);expect(new Set(cards).size).toBe(120);
  expect(s.library.flatMap(d=>d.cards)).toHaveLength(108);expect(s.library.every(d=>d.discard.length===0)).toBe(true);
  expect(s.powerfulDeck).toHaveLength(12);expect(s.powerfulDeck.every(c=>c.powerful)).toBe(true);
  for(const p of s.players) {
   expect(p.personalDeck).toEqual([]);expect(p.hand).toEqual([]);expect(p.discard).toEqual([]);
   expect(p.prepared).toEqual({rapid:null,slot1:null,slot2:null,slot3:null});
  }
 });

 describe.each(['cantrip','transmutation','enchantment'])('%s starting grimoire',schoolId=>{
  it.each([2,3,4])('allocates seven actual school cards for %i mages, then Study keeps four cards with normal school routing',count=>{
   let s=createGame(count);const cards=physicalCards(s),school=s.library.find(d=>d.id===schoolId)!;
   const stock=[...school.cards],studySchool=s.library.find(d=>d.id!==schoolId)!;
   s.eventDeck=[{id:'quiet',name:'Quiet',description:'No effect',kind:'BLACK_DAMAGE',amount:0,rooms:0}];
   for(const p of s.players)p.connected=true;
   for(const p of s.players) {
    s=applyAction(s,{type:'SELECT_STARTING_SCHOOL',playerId:p.id,schoolId});
    s=applyAction(s,{type:'SET_READY',playerId:p.id,ready:true});
   }
   const lobby=structuredClone(s);s=applyAction(s,{type:'START_GAME',playerId:'p1'});
   expect(lobby.players.every(p=>p.hand.length+p.personalDeck.length+p.discard.length===0)).toBe(true);
   expect(s.phase).toBe('BLACK_ROSE');
   for(const [i,p] of s.players.entries()) {
    expect(p.startingSchoolId).toBe(schoolId);expect(p.hand).toEqual([]);
    expect(p.personalDeck).toEqual(stock.slice(i*7,i*7+6));expect(p.discard).toEqual([stock[i*7+6]]);
    expect([...p.personalDeck,...p.discard].every(c=>c.schoolId===schoolId)).toBe(true);
   }
   expect(s.library.find(d=>d.id===schoolId)!.cards).toEqual(stock.slice(count*7));
   expect(s.library.filter(d=>d.id!==schoolId)).toEqual(lobby.library.filter(d=>d.id!==schoolId));
   expect(s.powerfulDeck).toEqual(lobby.powerfulDeck);expect(physicalCards(s)).toEqual(cards);
   s=applyAction(s,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:'BLACK_ROSE',expectedRound:1});
   expect(s.phase).toBe('STUDY');
   for(const [i,p] of s.players.entries()) {
    expect(p.hand).toEqual(stock.slice(i*7,i*7+2));expect(p.personalDeck).toEqual(stock.slice(i*7+2,i*7+6));
    expect(p.discard).toEqual([stock[i*7+6]]);
   }
   expect(physicalCards(s)).toEqual(cards);
   for(const [i,p] of s.players.entries()) {
    const drawn=studySchool.cards.slice(i*4,i*4+4);
    s=applyAction(s,{type:'DRAW_STUDY',playerId:p.id,deckId:studySchool.id});
    expect(s.players[i].hand).toEqual([...stock.slice(i*7,i*7+2),...drawn]);
    expect(physicalCards(s)).toEqual(cards);
    const before=structuredClone(s);
    expect(()=>applyAction(s,{type:'DISCARD_STUDY',playerId:p.id,cardIds:[stock[i*7].id,drawn[0].id]})).toThrow(/this Study/);
    expect(s).toEqual(before);
    s=applyAction(s,{type:'DISCARD_STUDY',playerId:p.id,cardIds:drawn.slice(0,2).map(c=>c.id)});
    expect(s.players[i].hand).toEqual([...stock.slice(i*7,i*7+2),...drawn.slice(2)]);
    expect(s.players[i].personalDeck).toEqual(stock.slice(i*7+2,i*7+6));
    expect(s.players[i].discard).toEqual([stock[i*7+6]]);
    expect(s.library.find(d=>d.id===schoolId)!.discard).toEqual([]);
    expect(s.library.find(d=>d.id===studySchool.id)!.discard).toEqual(Array.from({length:i+1},(_,j)=>studySchool.cards.slice(j*4,j*4+2)).flat());
    expect(physicalCards(s)).toEqual(cards);
   }
   expect(s.phase).toBe('PREPARATION');expect(s.players.every(p=>p.studyDrawn&&p.studyDone&&p.hand.length===4)).toBe(true);
   expect(new Set(physicalCards(s)).size).toBe(120);
  });
 });

 it('draws and recycles only Transmutation in Study, and routes support discards back to that school',()=>{
  let s=createGame();s.phase='STUDY';const cantrip=structuredClone(s.library[0]);
  const trans=s.library[1];trans.discard=trans.cards.splice(2);
  const before=physicalCards(s);s=applyAction(s,{type:'DRAW_STUDY',playerId:'p1',deckId:'transmutation'});
  expect(s.players[0].hand).toHaveLength(4);expect(s.players[0].hand.every(c=>c.schoolId==='transmutation')).toBe(true);
  const ids=s.players[0].hand.slice(0,2).map(c=>c.id);
  s=applyAction(s,{type:'DISCARD_STUDY',playerId:'p1',cardIds:ids});
  expect(s.library[1].discard.map(c=>c.id)).toEqual(ids);expect(s.library[0]).toEqual(cantrip);expect(physicalCards(s)).toEqual(before);
 });
});

describe.each(targets)('%s public target helpers',target=>{
 for(const kind of ['MAGE','EVOCATION'] as const)for(const own of [false,true]) {
  it.each([{damage:2},{},{heal:1},{convert:1},{damage:2,heal:1},{damage:2,convert:1}])(`validates ${own?'own':'enemy'} ${kind} with %j`,effects=>{
   const spell=card(target,effects),before=structuredClone(spell);
   const category=target==='MODEL'||target===kind;
   const expected=target==='SELF'?own&&kind==='MAGE':category&&(!own||!!(spell.heal||spell.convert));
   expect(spellCanTargetModel(spell,'p1',own?'p1':'p2',kind)).toBe(expected);expect(spell).toEqual(before);
  expect(canUseSpellDummy(spell)).toBe(['MAGE','EVOCATION','MODEL'].includes(target));
  });
 }
});

describe('authoritative target selection and legality',()=>{
 it.each([{}, {targetPlayerId:'p1'}, {targetPlayerId:'p1-wizard'}])('infers or explicitly accepts the own mage for SELF: %j',selection=>{
  const s=fixture();prepare(s,'Mending Light');wound(s,'MAGE',0,{p2:4});
  const before=structuredClone(s),result=cast(s,selection);
  expect(result.players[0].wizard.damageCubes).toBe(1);expect(result.players[0].wizard.damageByPlayer).toEqual({p2:1});
  expect(s).toEqual(before);conserved(result);
 });
 it.each([
  {targetPlayerId:'p2'},{targetPlayerId:'p2-wizard'},{targetEvocationId:'evoc-1'},
  {targetPlayerId:'evoc-1'},{targetEvocationId:'p1'},{roomId:'room-0,0'},
  {dummy:true,roomId:'room-0,0'},{targetPlayerId:'p1',targetEvocationId:'evoc-1'},
 ])('rejects non-self, forged or room SELF selection %j immutably',selection=>{
  const s=fixture();prepare(s,'Mending Light');reject(s,selection,/Spell cannot target|payload|room|Dummy|Select one/);
 });

 for(const target of ['MAGE','EVOCATION','MODEL'] as const)for(const kind of ['MAGE','EVOCATION'] as const)for(const own of [false,true]) {
  it(`${target} support ${target==='MODEL'||target===kind?'accepts':'rejects'} ${own?'own':'enemy'} ${kind}`,()=>{
   const s=fixture(),index=own?0:1;prepare(s,card(target,{heal:1}));wound(s,kind,index,{p3:2});
   const selection=kind==='MAGE'?{targetPlayerId:s.players[index].id}:{targetEvocationId:s.evocations[index].id};
   if(target!=='MODEL'&&target!==kind)reject(s,selection,/Spell cannot target/);
   else {const result=cast(s,selection);expect(model(result,kind,index).damageCubes).toBe(1);conserved(result);}
  });
 }
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
 it('accepts wizard IDs only in the mage field',()=>{
  const s=fixture();prepare(s,'Renewing Word');wound(s,'MAGE',1,{p3:4});
  const result=cast(s,{targetPlayerId:'p2-wizard'});expect(result.players[1].wizard.damageCubes).toBe(1);conserved(result);
 });
 it('ROOM rejects individual target fields even when accompanied by a valid room',()=>{
  const s=fixture();prepare(s,'Sanctuary');
  for(const selection of [{targetPlayerId:'p2'},{targetEvocationId:'evoc-2'},
   {roomId:'room-0,0',targetPlayerId:'p2'},{roomId:'room-0,0',targetEvocationId:'evoc-2'},
   {roomId:'room-0,0',dummy:true}])reject(s,selection,/room\/dummy|Dummy/);
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
 it('canPlayerAct sees the next-turn evocation dummy without bypassing the current numbered quota or turn cap',()=>{
  const s=fixture();s.players[0].actionTokens=0;s.evocations=[];
  prepare(s,'Mending Light','slot1');prepare(s,"Summoner's Balm",'slot2');
  const result=cast(s,{},'slot1');expect(result.currentPlayerId).toBe('p2');
  expect(canPlayerAct(result,result.players[0])).toBe(true);
  reject(result,{dummy:true,roomId:'room-0,0'},/Not your turn/,'slot2');
  const other=fixture();other.players[0].actionTokens=0;prepare(other,'Mending Light');other.activation!.actionsUsed=2;
  expect(canPlayerAct(other,other.players[0])).toBe(false);
 });
});

describe('healing wounds and returning only actual physical cubes',()=>{
 for(const kind of ['MAGE','EVOCATION'] as const)for(const index of [0,1]) {
  it(`heals ${index===0?'own':'enemy'} ${kind} in seat order, then Black Rose, then unattributed wounds`,()=>{
   const s=fixture();prepare(s,card(kind,{heal:3}));
   // Deliberately reverse insertion order; deterministic behavior follows seats.
   wound(s,kind,index,{p4:1,p3:1,p2:1,p1:1,[BLACK_ROSE_ID]:1},1,kind==='MAGE'?1:0);
   const result=cast(s,kind==='MAGE'?{targetPlayerId:s.players[index].id}:{targetEvocationId:s.evocations[index].id});
   expect(model(result,kind,index).damageByPlayer).toEqual({p4:1,[BLACK_ROSE_ID]:1});
   expect(model(result,kind,index).damageCubes).toBe(kind==='MAGE'?4:3);
   expect(result.players.slice(0,3).every(p=>p.cubes.available===25)).toBe(true);conserved(result);
  });
 }
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
 it('ROOM healing affects every mage and evocation across all its tiles, each for the printed amount',()=>{
  const s=fixture();mergeRoom(s,{q:1,r:0});prepare(s,'Sanctuary');
  for(const i of [0,1,2,3]) {
   s.players[i].wizard.position=i%2?{q:1,r:0}:{...origin};s.evocations[i].position={...s.players[i].wizard.position};
   wound(s,'MAGE',i,{p4:3});wound(s,'EVOCATION',i,{p3:3});
  }
  // One model outside the multihex room must remain untouched.
  s.evocations[3].position={q:0,r:1};const before=structuredClone(s);
  const result=cast(s,{roomId:'room-0,0'});
  expect(result.players.map(p=>p.wizard.damageCubes)).toEqual([1,1,1,1]);expect(result.evocations.map(e=>e.damageCubes)).toEqual([1,1,1,3]);
  expect(result.blackRose).toEqual(before.blackRose);expect(result.players.every(p=>p.kills===0&&p.victoryPoints===0&&p.questsCompleted===0)).toBe(true);conserved(result);
 });
 it('healing Wounded Fury reduces the actual subsequent evocation attack',()=>{
  const s=fixture();prepare(s,"Summoner's Balm");s.evocations[0].health=2;wound(s,'EVOCATION',0,{p2:1});
  expect(evocationAttack(s.evocations[0])).toBe(3);
  let result=cast(s,{targetEvocationId:'evoc-1'});expect(evocationAttack(result.evocations[0])).toBe(2);
  result=applyAction(result,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'evoc-1'});
  result=applyAction(result,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'});
  expect(result.players[1].wizard.damageCubes).toBe(2);expect(result.players[1].wizard.damageByPlayer).toEqual({p1:2});conserved(result);
 });
});

describe('conversion replaces ownership without creating wounds, instability or rewards',()=>{
 for(const kind of ['MAGE','EVOCATION'] as const)for(const own of [false,true]) {
  it(`${kind} conversion legally selects ${own?'own models without changing them':'enemy models, skipping own cubes in seat order'}`,()=>{
   const s=fixture(),i=own?0:1;prepare(s,card(kind,{convert:3}));
   wound(s,kind,i,{p4:1,[BLACK_ROSE_ID]:1,p3:1,p2:2,p1:1});
   const before=structuredClone(s);
   const result=cast(s,kind==='MAGE'?{targetPlayerId:s.players[i].id}:{targetEvocationId:s.evocations[i].id});
   expect(model(result,kind,i).damageCubes).toBe(6);
   if(own) {
    expect(model(result,kind,i)).toEqual(model(before,kind,i));
    expect(result.players.map(p=>p.cubes)).toEqual(before.players.map(p=>p.cubes));
    expect(result.feedbackEvents).toEqual(before.feedbackEvents);
   } else {
    expect(model(result,kind,i).damageByPlayer).toEqual({p4:1,[BLACK_ROSE_ID]:1,p1:4});
    expect(result.players[0].cubes[kind==='MAGE'?'onWizard':'onEvocations']).toBe(4);
    expect(result.players[1].cubes.available).toBe(25);expect(result.players[2].cubes.available).toBe(25);
   }
   expect(result.activation).toMatchObject({actionsUsed:1,spellsCast:1});
   expect(result.players[0].prepared.rapid?.used).toBe(true);expect(result.players[0].actionTokens).toBe(2);
   expect(s).toEqual(before);conserved(result);
  });
 }
 for(const kind of ['MAGE','EVOCATION'] as const)for(const available of [0,1,20]) {
  it.each([
   {label:'other-colored',ledger:{p3:3},black:0,unattributed:0},
   {label:'neutral ledger',ledger:{[BLACK_ROSE_ID]:3},black:0,unattributed:0},
   {label:'neutral wounds',ledger:{},black:kind==='MAGE'?2:0,unattributed:1},
   {label:'own-colored',ledger:{p1:2},black:0,unattributed:0},
   {label:'mixed colors and neutral wounds',ledger:{p1:1,p2:1,p3:1,[BLACK_ROSE_ID]:1},black:kind==='MAGE'?1:0,unattributed:1},
  ])(`own ${kind} ignores $label conversion with ${available} available cubes`,({ledger,black,unattributed})=>{
   const s=fixture(),spell=prepare(s,kind==='MAGE'?"Mage's Due":'Reclaimed Servant');
   wound(s,kind,0,ledger as Record<string,number>,unattributed,black);limitStock(s,'p1',available);
   const before=structuredClone(s),cards=physicalCards(s);
   const result=cast(s,kind==='MAGE'?{targetPlayerId:'p1-wizard'}:{targetEvocationId:'evoc-1'});
   expect(result.players.map(p=>p.wizard)).toEqual(before.players.map(p=>p.wizard));
   expect(result.evocations).toEqual(before.evocations);expect(result.board).toEqual(before.board);
   expect(result.players.map(p=>p.cubes)).toEqual(before.players.map(p=>p.cubes));
   expect(result.feedbackEvents).toEqual(before.feedbackEvents);
   expect(result.activation).toMatchObject({actionsUsed:1,spellsCast:1});
   expect(result.players[0].actionTokens).toBe(2);expect(result.players[0].prepared.rapid).toMatchObject({used:true});
   expect(result.library[1].discard).toContainEqual(spell);expect(physicalCards(result)).toEqual(cards);
   expect(s).toEqual(before);conserved(result);
  });
 }
 it.each([0,1,2,25])('model conversion is capped at the %i caster cubes actually available',available=>{
  const s=fixture();prepare(s,'Stolen Sigil');wound(s,'MAGE',1,{p3:3});limitStock(s,'p1',available);
  const result=cast(s,{targetPlayerId:'p2'}),n=Math.min(2,available);
  expect(result.players[1].wizard.damageCubes).toBe(3);expect(result.players[1].wizard.damageByPlayer.p1??0).toBe(n);
  expect(result.players[1].wizard.damageByPlayer.p3).toBe(3-n);expect(result.players[0].cubes.available).toBe(available-n);conserved(result);
 });
 it('converts actual mage Black Rose ledger/blackDamage, but not unattributed wounds',()=>{
  const s=fixture();prepare(s,card('MAGE',{convert:20}));wound(s,'MAGE',1,{p3:1,[BLACK_ROSE_ID]:1},3,2);
  const result=cast(s,{targetPlayerId:'p2'});
  expect(result.players[1].wizard).toMatchObject({damageCubes:7,blackDamage:0,damageByPlayer:{p1:4}});
  expect(result.players[2].cubes.available).toBe(25);expect(result.players[0].cubes.available).toBe(21);
  expect(result.blackRose).toEqual(s.blackRose);conserved(result);
 });
 it('converts neutral evocation cubes with no neutral physical supply return',()=>{
  const s=fixture();prepare(s,'Reclaimed Servant');wound(s,'EVOCATION',1,{[BLACK_ROSE_ID]:1},2);
  const result=cast(s,{targetEvocationId:'evoc-2'});
  expect(result.evocations[1]).toMatchObject({damageCubes:3,damageByPlayer:{p1:1}});
  expect(result.players[0].cubes).toEqual({available:24,onWizard:0,onBoard:0,onEvocations:1});conserved(result);
 });
 it.each(['MAGE','EVOCATION'] as const)('enemy %s conversion cannot spend supply on caster-colored cubes or unattributed wounds',kind=>{
  for(const ledger of [{p1:2},{}] as Record<string,number>[]) {
   const s=fixture();prepare(s,card(kind,{convert:5}));wound(s,kind,1,ledger,2);
   const before=structuredClone(s),result=cast(s,kind==='MAGE'?{targetPlayerId:'p2'}:{targetEvocationId:'evoc-2'});
   expect(model(result,kind)).toEqual(model(before,kind));expect(result.players.map(p=>p.cubes)).toEqual(before.players.map(p=>p.cubes));
   expect(result.feedbackEvents).toEqual(before.feedbackEvents);expect(s).toEqual(before);conserved(result);
  }
 });
 it.each([false,true])('ROOM conversion changes live instability only, including full-unbuilt rooms (full=%s)',full=>{
  const s=fixture();prepare(s,'Rewrite the Lodge');const r=room(s);r.instability=full?r.instabilityLimit:5;
  r.cubesByPlayer={p4:1,p3:1,p2:2,[BLACK_ROSE_ID]:r.instability-5,p1:1};
  wound(s,'MAGE',0,{p3:2,[BLACK_ROSE_ID]:1},1,1);wound(s,'EVOCATION',0,{p2:2,[BLACK_ROSE_ID]:1});
  wound(s,'MAGE',1,{p3:3});wound(s,'EVOCATION',1,{p2:2});
  const before=structuredClone(s);const result=cast(s,{roomId:r.id});
  expect(room(result)).toMatchObject({instability:r.instability,reconstructed:false,scored:false,cubesByPlayer:{p4:1,p1:4,[BLACK_ROSE_ID]:r.instability-5}});
  expect(result.players.map(p=>p.wizard)).toEqual(before.players.map(p=>p.wizard));expect(result.evocations).toEqual(before.evocations);
  expect(result.players[0].cubes).toEqual({...before.players[0].cubes,available:before.players[0].cubes.available-3,onBoard:before.players[0].cubes.onBoard+3});
  expect(result.players[1].cubes.available).toBe(before.players[1].cubes.available+2);
  expect(result.players[2].cubes.available).toBe(before.players[2].cubes.available+1);
  expect(result.feedbackEvents).toMatchObject([{kind:'CONVERT',target:{kind:'ROOM',id:r.id},sourceId:'p1',amount:3,total:r.instability}]);
  expect(result.players.every(p=>p.kills===0&&p.victoryPoints===0&&p.questsCompleted===0)).toBe(true);expect(s).toEqual(before);conserved(result);
 });
 it.each([0,1,2,24])('ROOM conversion obeys stock %i and sources colored seats before neutral cubes',available=>{
  const s=fixture();prepare(s,'Rewrite the Lodge');room(s).instability=5;room(s).cubesByPlayer={p1:1,p2:1,[BLACK_ROSE_ID]:3};syncCubes(s);limitStock(s,'p1',available);
  const result=cast(s,{roomId:'room-0,0'}),n=Math.min(3,available);
  expect(room(result).cubesByPlayer.p1).toBe(1+n);expect(room(result).cubesByPlayer.p2??0).toBe(n>0?0:1);
  expect(room(result).cubesByPlayer[BLACK_ROSE_ID]).toBe(3-Math.max(0,n-1));expect(room(result).instability).toBe(5);conserved(result);
 });
 it.each([{scored:true,reconstructed:true},{scored:true,reconstructed:false},{scored:false,reconstructed:true}])('never converts historical room contributions %j',flags=>{
  const s=fixture();prepare(s,'Rewrite the Lodge');Object.assign(room(s),flags,{instability:10,cubesByPlayer:{p2:10}});
  syncCubes(s);const before=structuredClone(s);const result=cast(s,{roomId:'room-0,0'});
  expect(room(result)).toEqual(room(before));expect(result.players.map(p=>p.cubes)).toEqual(before.players.map(p=>p.cubes));conserved(result);
 });
 it('conversion of a completed all-enemy room earns no immediate solo/completion/instability/kill quests or VP',()=>{
  const s=fixture();prepare(s,card('ROOM',{convert:10}));room(s).instability=10;room(s).cubesByPlayer={p2:10};syncCubes(s);
  s.players[0].quest={id:'inst',name:'Instability',description:'Place instability',kind:'INSTABILITY',amount:2,reward:2};
  s.players[0].additionalQuests=[{id:'rebuild',name:'Rebuild',description:'Complete room',kind:'REBUILD',amount:1,reward:3},{id:'kill',name:'Kill',description:'Defeat mage',kind:'KILL',amount:1,reward:3}];
  const result=cast(s,{roomId:'room-0,0'});expect(room(result).cubesByPlayer).toEqual({p1:10});
  expect(result.players[0]).toMatchObject({victoryPoints:0,kills:0,questsCompleted:0,quest:s.players[0].quest,additionalQuests:s.players[0].additionalQuests});
  expect(room(result)).toMatchObject({reconstructed:false,scored:false,instability:10});expect(result.questDiscard).toEqual(s.questDiscard);conserved(result);
 });
 it('later Cleanup scores converted room ownership and returns those cubes exactly once',()=>{
  const s=fixture();prepare(s,'Rewrite the Lodge');room(s).instability=10;room(s).cubesByPlayer={p2:7,[BLACK_ROSE_ID]:3};syncCubes(s);
  let result=cast(s,{roomId:'room-0,0'});expect(result.players[0].victoryPoints).toBe(0);
  for(const p of result.players){p.actionTokens=0;p.prepared={rapid:null,slot1:null,slot2:null,slot3:null};}
  result.evocations=[];result=applyAction(result,{type:'END_ACTIVATION',playerId:'p1'});
  expect(result.phase).toBe('CLEANUP');expect(room(result)).toMatchObject({scored:true,reconstructed:true,cubesByPlayer:{p1:3,p2:4,[BLACK_ROSE_ID]:3}});
  expect(result.players[1].victoryPoints).toBe(6);expect(result.players[0].victoryPoints).toBe(2);expect(result.blackRose.victoryPoints).toBe(2);
  expect(result.players[0].cubes.available).toBe(25);expect(result.players[1].cubes.available).toBe(25);conserved(result);
 });
});

describe('mixed support, damage immunity, resolution order and settlement',()=>{
 it.each(['MAGE','EVOCATION'] as const)('canonical Transmuting Surge legally targets own %s but ignores both conversion and damage',kind=>{
  const s=fixture(),spell=prepare(s,'Transmuting Surge');wound(s,kind,0,{p3:2,[BLACK_ROSE_ID]:1});
  const before=structuredClone(s),cards=physicalCards(s);
  const result=cast(s,kind==='MAGE'?{targetPlayerId:'p1'}:{targetEvocationId:'evoc-1'});
  expect(result.players.map(p=>p.wizard)).toEqual(before.players.map(p=>p.wizard));expect(result.evocations).toEqual(before.evocations);
  expect(result.players.map(p=>p.cubes)).toEqual(before.players.map(p=>p.cubes));expect(result.board).toEqual(before.board);
  expect(result.feedbackEvents).toEqual([]);expect(result.activation).toMatchObject({actionsUsed:1,spellsCast:1});
  expect(result.players[0].actionTokens).toBe(2);expect(result.players[0].prepared.rapid?.used).toBe(true);
  expect(result.library[1].discard).toContainEqual(spell);expect(physicalCards(result)).toEqual(cards);expect(s).toEqual(before);conserved(result);
 });
 for(const kind of ['MAGE','EVOCATION'] as const) {
  it.each([1,2])(`mixed MODEL conversion and damage ignore own ${kind} without suppressing instability with %i available cubes`,available=>{
   // Transmuting Surge has no printed instability; exercise the independent
   // instability instruction with a composite MODEL fixture, not a catalog edit.
   const s=fixture();prepare(s,card('MODEL',{damage:1,convert:1,instability:1}));
   wound(s,kind,0,{p3:2,[BLACK_ROSE_ID]:1});limitStock(s,'p1',available);const before=structuredClone(s);
   const result=cast(s,kind==='MAGE'?{targetPlayerId:'p1'}:{targetEvocationId:'evoc-1'});
   expect(result.players.map(p=>p.wizard)).toEqual(before.players.map(p=>p.wizard));expect(result.evocations).toEqual(before.evocations);
   expect(room(result)).toMatchObject({instability:1,cubesByPlayer:{p1:1}});
   expect(result.players[0].cubes).toEqual({...before.players[0].cubes,available:available-1,onBoard:before.players[0].cubes.onBoard+1});
   expect(result.players.slice(1).map(p=>p.cubes)).toEqual(before.players.slice(1).map(p=>p.cubes));
   expect(result.feedbackEvents).toEqual([]);expect(result.activation).toMatchObject({actionsUsed:1,spellsCast:1});
   expect(s).toEqual(before);conserved(result);
  });
 }
 it.each(['MAGE','EVOCATION'] as const)('mixed support+damage on own %s ignores conversion and damage but still heals',kind=>{
  const s=fixture();prepare(s,card('MODEL',{damage:8,convert:1,heal:1}));wound(s,kind,0,{p2:3});
  const before=structuredClone(s);
  const result=cast(s,kind==='MAGE'?{targetPlayerId:'p1'}:{targetEvocationId:'evoc-1'});
  expect(model(result,kind,0)).toMatchObject({damageCubes:2,damageByPlayer:{p2:2}});
  expect(result.feedbackEvents).toMatchObject([{kind:'HEAL',sourceId:'p1',amount:1,target:{kind,id:kind==='MAGE'?'p1':'evoc-1'}}]);
  expect(result.players[0].cubes).toEqual(before.players[0].cubes);expect(result.players[1].cubes.available).toBe(before.players[1].cubes.available+1);
  expect(result.players[0].kills).toBe(0);expect(s).toEqual(before);conserved(result);
 });
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
 it.each([0,1,25])("Alchemist's Refuge ignores own-mage conversion but heals with %i available cubes",available=>{
  const s=fixture();prepare(s,"Alchemist's Refuge");wound(s,'MAGE',0,{p2:3});
  limitStock(s,'p1',available);const before=structuredClone(s);
  const result=cast(s);expect(result.players[0].wizard).toMatchObject({damageCubes:1,damageByPlayer:{p2:1}});
  expect(result.players[0].cubes).toEqual(before.players[0].cubes);expect(result.players[1].cubes.available).toBe(24);
  expect(result.feedbackEvents).toMatchObject([{kind:'HEAL',target:{kind:'MAGE',id:'p1'},sourceId:'p1',amount:2}]);
  expect(result.activation).toMatchObject({actionsUsed:1,spellsCast:1});expect(s).toEqual(before);conserved(result);
 });
 it('a converted mage defeat scores new contributors and returns only the defeated model cubes',()=>{
  const s=fixture();prepare(s,card('MODEL',{convert:3,instability:1,damage:1}));
  wound(s,'MAGE',1,{p3:4},2,3);wound(s,'MAGE',3,{p3:1});wound(s,'EVOCATION',0,{p3:1});
  s.players[0].quest={id:'kill',name:'Kill',description:'Defeat mage',kind:'KILL',amount:1,reward:3};
  const result=cast(s,{targetPlayerId:'p2'});
  expect(result.players[1].wizard).toMatchObject({damageCubes:0,damageByPlayer:{},blackDamage:0,position:{q:-3,r:2}});
  // Converted 3 + final 1 ranks first; Black Rose 3 second; p3 1 third.
  expect(result.players[0]).toMatchObject({victoryPoints:7,kills:1,questsCompleted:1});expect(result.blackRose.victoryPoints).toBe(2);expect(result.players[2].victoryPoints).toBe(1);
  expect(result.players[2].cubes).toMatchObject({available:23,onWizard:1,onEvocations:1});
  expect(result.players[0].cubes).toEqual({available:24,onWizard:0,onEvocations:0,onBoard:1});
  expect(room(result).instability).toBe(1);expect(room(result,'room--3,2').instability).toBe(0);conserved(result);
 });
 it('converted evocation destruction returns colored cubes, ignores neutral supply, and grants no kill/VP',()=>{
  const s=fixture();prepare(s,'Transmuting Surge');s.evocations[1].health=4;wound(s,'EVOCATION',1,{p3:1,[BLACK_ROSE_ID]:2});
  const result=cast(s,{targetEvocationId:'evoc-2'});expect(result.evocations.some(e=>e.id==='evoc-2')).toBe(false);
  expect(result.players.every(p=>p.cubes.available===25&&p.kills===0&&p.victoryPoints===0)).toBe(true);expect(result.blackRose).toEqual(s.blackRose);conserved(result);
 });
 it('unconverted neutral cubes also return safely on evocation destruction',()=>{
  const s=fixture();prepare(s,card('EVOCATION',{damage:1}));s.evocations[1].health=2;wound(s,'EVOCATION',1,{[BLACK_ROSE_ID]:1});
  const result=cast(s,{targetEvocationId:'evoc-2'});expect(result.evocations.some(e=>e.id==='evoc-2')).toBe(false);conserved(result);
 });
});

describe('support casts preserve turn, discard, conservation and immutable command contracts',()=>{
 it.each(['Mending Light','Stolen Sigil','Sanctuary','Rewrite the Lodge'])('%s may have zero effect but still consumes one action and one physical card, not a token',name=>{
  const s=fixture();const spell=prepare(s,name);const before=structuredClone(s),cards=physicalCards(s);
  const selection=spell.target==='SELF'?{}:spell.target==='ROOM'?{roomId:'room-0,0'}:{targetPlayerId:'p1'};
  const result=cast(s,selection);expect(result.activation).toMatchObject({actionsUsed:1,spellsCast:1});
  expect(result.players[0].actionTokens).toBe(2);expect(result.players[0].prepared.rapid?.used).toBe(true);
  expect(result.library[1].discard.map(c=>c.id)).toContain(spell.id);expect(result.library[0]).toEqual(before.library[0]);expect(result.players[0].discard).toEqual([]);
  expect(physicalCards(result)).toEqual(cards);expect(s).toEqual(before);reject(result,selection,/Spell unavailable/);conserved(result);
 });
 it('support obeys numbered ordering/quota, shared two-action cap, and automatic handoff',()=>{
  const s=fixture();prepare(s,'Mending Light','slot1');prepare(s,'Renewing Word','slot2');prepare(s,'Vital Thread');
  reject(s,{targetPlayerId:'p1'},/in order/,'slot2');
  let result=cast(s,{},'slot1');reject(result,{targetPlayerId:'p1'},/one sequenced/,'slot2');
  result=cast(result,{targetPlayerId:'p1'});expect(result.currentPlayerId).toBe('p2');expect(result.players[0].actionTokens).toBe(2);
  reject(result,{targetPlayerId:'p1'},/Not your turn/,'slot2');
  const capped=fixture();prepare(capped,'Mending Light');capped.activation!.actionsUsed=2;reject(capped,{},/both turn actions/);
 });
 it('support cannot interrupt pending physical effects, exploration, or an evocation activation',()=>{
  const s=fixture();prepare(s,'Mending Light');
  const physical=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'});reject(physical,{},/pending physical/);
  const exploring=applyAction(s,{type:'EXPLORE',playerId:'p1'});reject(exploring,{},/Finish exploring/);
  const evoc=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'evoc-1'});reject(evoc,{},/active evocation/);
 });
});