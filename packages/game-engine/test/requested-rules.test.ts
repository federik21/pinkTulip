import { moment, momentTotal } from '../src/cards';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { applyAction, canPassActionPhase, createGame, evocationAttack, hexDistance, hexLineDistance, PHYSICAL_TOKENS_PER_ROUND } from '../src';
import type { Card, Evocation, GameAction, GameState, Player, RoomEffect } from '../src';

// Focused state fixtures deliberately omit dealing/Study, which the legacy suite covers.
// All real cards remain in their piles unless explicitly moved to a hand/preparation.
function actionFixture() {
 const g=createGame();g.phase='ACTION';g.round=1;g.currentPlayerId='p1';
 g.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 g.players[0].wizard.position={q:0,r:0};g.players[1].wizard.position={q:1,r:0};
 return g;
}
const player=(g:GameState,id='p1')=>g.players.find(p=>p.id===id)!;
const room=(g:GameState,id='room-0,0')=>g.board.rooms.find(r=>r.id===id)!;
// TEST FIXTURE ONLY: move real library cards into the personal draw supply needed by a scenario.
function seedPersonalDeck(g:GameState,count=2,playerId='p1') {
 const cards=g.library[0].cards.splice(0,count);expect(cards).toHaveLength(count);
 player(g,playerId).personalDeck.push(...cards);
}
// TEST FIXTURE ONLY: printed models for isolated combat/activation tests, never a summon API.
const cadaver=(id:string,playerId='p1',position={q:0,r:0}):Evocation=>({id,playerId,name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:2,passive:'WOUNDED_FURY',position:{...position},damageCubes:0,damageByPlayer:{},activated:false});
function greyFixture(reconstructed=false) {
 const g=actionFixture(),source=g.board.rooms.find(r=>r.color==='grey')!;
 if(reconstructed){source.instability=source.instabilityLimit;source.cubesByPlayer={'black-rose':source.instability};source.reconstructed=true;}
 for(const p of g.players)p.wizard.position={...source.tiles[0]};
 return {g,source};
}
function prepare(g:GameState,slot:keyof Player['prepared']='rapid',changes:Partial<Card>={},playerId='p1') {
 const card={...g.library[0].cards.shift()!,spellType:undefined,ongoing:undefined,trigger:undefined,moments:[],instability:false,range:4,target:'ROOM' as const,...changes};
 player(g,playerId).prepared[slot]={card,used:false};return card;
}
function holdPower(g:GameState,target:Card['target']='MODEL',playerId='p1') {
 const [card]=g.powerfulDeck.splice(g.powerfulDeck.findIndex(c=>c.target===target),1);player(g,playerId).hand.push(card);return card;
}
function addPlayer(g:GameState,id:string) {
 // Extra contributors have no duplicated physical cards; only the player/model template is cloned.
 const p=structuredClone(g.players[0]);p.id=id;p.name=id;p.wizard.id=`${id}-wizard`;p.wizard.playerId=id;
 p.hand=[];p.personalDeck=[];p.discard=[];p.prepared={rapid:null,slot1:null,slot2:null,slot3:null};
 p.cubes={available:25,onBoard:0,onWizard:0,onEvocations:0};p.quest=null;p.additionalQuests=[];
 g.players.push(p);return p;
}
function expectRejected(g:GameState,action:GameAction,error?:RegExp) {
 const before=structuredClone(g);expect(()=>applyAction(g,action)).toThrow(error);expect(g).toEqual(before);
}
const advance=(g:GameState)=>applyAction(g,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:g.phase,expectedRound:g.round});
function explore(g:GameState,playerId='p1') {
 g=applyAction(g,{type:'EXPLORE',playerId});return applyAction(g,{type:'END_EXPLORE',playerId});
}
// TEST FIXTURE ONLY: exhaust the mage phase for isolated evocation/cleanup scheduling tests.
// No card is removed or marked used: callers must have no unused preparations or held powers.
function evocationPhaseFixture(g:GameState) {
 g=structuredClone(g);
 for(const p of g.players){expect(Object.values(p.prepared).some(c=>c&&!c.used)).toBe(false);expect(p.hand.some(c=>c.powerful)).toBe(false);p.actionTokens=0;}
 return applyAction(g,{type:'PASS_ROUND',playerId:g.currentPlayerId!});
}
function expectCubesConserved(g:GameState) {
 for(const p of g.players) {
  expect(p.cubes.available+p.cubes.onBoard+p.cubes.onWizard+p.cubes.onEvocations).toBe(25);
  expect(p.cubes.onWizard).toBe(g.players.reduce((n,t)=>n+(t.wizard.damageByPlayer[p.id]??0),0));
  expect(p.cubes.onEvocations).toBe(g.evocations.reduce((n,e)=>n+(e.damageByPlayer[p.id]??0),0));
 }
}
function expectCardsConserved(g:GameState) {
 const cards=[...g.powerfulDeck,...g.removedCards,...g.library.flatMap(d=>[...d.cards,...d.discard]),...[...g.readiedSpells??[],...g.ongoingSpells??[]].map(a=>a.card),...g.players.flatMap(p=>[...p.hand,...p.personalDeck,...p.discard,...Object.values(p.prepared).filter(c=>c&&!c.used).map(c=>c!.card)])];
 expect(cards).toHaveLength(120);expect(new Set(cards.map(c=>c.id)).size).toBe(120);
 expect(cards.filter(c=>!c.powerful)).toHaveLength(108);expect(cards.filter(c=>c.powerful)).toHaveLength(12);
}

describe('hex range calculus',()=>{
 it('treats spell range as contiguous hex-line sight, not a loose hex radius',()=>{
  const origin={q:0,r:0};
  const valid=[{q:2,r:0},{q:0,r:-2},{q:-2,r:0},{q:0,r:2},{q:2,r:-2},{q:-2,r:2}];
  const invalid=[{q:1,r:-2},{q:-1,r:-1},{q:2,r:-1},{q:-2,r:1},{q:1,r:1},{q:-1,r:2}];
  for(const target of valid) expect(hexLineDistance(origin,target)).toBe(2);
  for(const target of invalid) expect(Number.isFinite(hexLineDistance(origin,target))).toBe(false);
 });
});
// Capacity fixtures create every model through legal Grey effects, never by inserting evocations.
// The first Explore summons two in a rebuilt Grey room, then moves toward a different Grey room.
function approachGreyWithTwo(reconstructedDestination=false) {
 let {g,source}=greyFixture(true);
 const destination=g.board.rooms.find(r=>r.color==='grey' && r.id!==source.id)!;
 if(reconstructedDestination){destination.instability=destination.instabilityLimit;destination.cubesByPlayer={'black-rose':destination.instability};destination.reconstructed=true;}
 const middle=g.board.rooms.find(r=>!r.startingFor && hexDistance(source.tiles[0],r.tiles[0])===1 && hexDistance(r.tiles[0],destination.tiles[0])===2)!;
 const approach=g.board.rooms.find(r=>!r.startingFor && hexDistance(middle.tiles[0],r.tiles[0])===1 && hexDistance(r.tiles[0],destination.tiles[0])===1)!;
 g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
 g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:middle.tiles[0]});
 g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:approach.tiles[0]});
 expect(g.evocations).toHaveLength(2);expect(player(g).actionTokens).toBe(1);
 return {g,source,destination};
}
function nextActionRound(g:GameState) {
 // Finish real remaining physical actions and free model activations before refreshing round tokens.
 for(const p of g.players){expect(Object.values(p.prepared).some(c=>c&&!c.used)).toBe(false);expect(p.hand.some(c=>c.powerful)).toBe(false);}
 while(g.phase==='ACTION'){expect(player(g,g.currentPlayerId!).actionTokens).toBeGreaterThan(0);g=explore(g,g.currentPlayerId!);}
 while(g.phase==='EVOCATION') {
  const owner=g.currentPlayerId!,model=g.evocations.find(e=>e.playerId===owner&&!e.activated)!;
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:owner,evocationId:model.id});
  g=applyAction(g,{type:'END_EVOCATION',playerId:owner});
 }
 expect(g.phase).toBe('CLEANUP');
 for(const p of g.players)seedPersonalDeck(g,2,p.id);
 g.eventDeck=[{id:'quiet-grey-round',name:'Quiet',description:'No damage',kind:'INSTABILITY',amount:0,rooms:0}];
 g=advance(g);g=advance(g);
 for(const id of ['p1','p2']) {
  g=applyAction(g,{type:'DRAW_STUDY',playerId:id,deckId:'cantrip'});
  g=applyAction(g,{type:'DISCARD_STUDY',playerId:id,cardIds:player(g,id).studyCardIds!.slice(0,2)});
 }
 for(const id of ['p1','p2']) {
  const cards=player(g,id).hand.slice(0,4);
  g=applyAction(g,{type:'PREPARE_CARDS',playerId:id,preparedCardIds:cards.slice(0,3).map(c=>c.id),rapidCardId:cards[3].id});
 }
 expect(g.phase).toBe('ACTION');expectCardsConserved(g);expectCubesConserved(g);return g;
}
function greyAtCapacityFixture(reconstructed=false) {
 let {g,destination}=approachGreyWithTwo(reconstructed);
 g=applyAction(g,{type:'EXPLORE',playerId:'p1'});
 g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:destination.tiles[0]});
 g=applyAction(g,{type:'END_EXPLORE',playerId:'p1',activateRoomAtEnd:true});
 expect(g.evocations).toHaveLength(3);
 return {g:nextActionRound(g),source:destination};
}

describe('strict Action-phase exhaustion',()=>{

 it('rejects passes with either remaining token and while exploring, then automatically skips real exhaustion',()=>{
  let g=actionFixture();
  expect(canPassActionPhase(g,player(g))).toBe(false);expectRejected(g,{type:'PASS_ROUND',playerId:'p1'},/no physical tokens/);
  g=explore(g);expect(player(g).actionTokens).toBe(1);
  expect(canPassActionPhase(g,player(g))).toBe(false);expectRejected(g,{type:'PASS_ROUND',playerId:'p1'},/no physical tokens/);
  g=applyAction(g,{type:'EXPLORE',playerId:'p1'});expect(player(g).actionTokens).toBe(0);
  expectRejected(g,{type:'PASS_ROUND',playerId:'p1'},/Finish exploring/);
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expect(g.currentPlayerId).toBe('p2');expect(player(g).passed).toBe(false);expect(canPassActionPhase(g,player(g))).toBe(true);
  g=explore(g,'p2');g=explore(g,'p2');expect(g.phase).toBe('CLEANUP');expect(g.players.every(p=>!p.passed)).toBe(true);
 });
});

describe('Cadavers and token activations',()=>{

 it('rejects paid activations from starts, while exploring, without tokens or after two shared actions',()=>{
  const initial=actionFixture();initial.evocations=[cadaver('outside')];
  for(const start of initial.board.rooms.filter(r=>r.startingFor)) {
   const g=structuredClone(initial);player(g).wizard.position={...start.tiles[0]};
    expectRejected(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'outside'},/starting room/);
    const phase=evocationPhaseFixture(g);
    expect(applyAction(phase,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'outside'}).evocationActivation?.returnToAction).toBe(false);
  }
  const activate={type:'ACTIVATE_EVOCATION' as const,playerId:'p1',evocationId:'outside'};
  const noTokens=structuredClone(initial);player(noTokens).actionTokens=0;expectRejected(noTokens,activate,/tokens/);
  // TEST FIXTURE ONLY: an exhausted activation isolates the shared-budget validation.
  const quota=structuredClone(initial);quota.activation!.actionsUsed=2;expectRejected(quota,activate,/both turn actions/);
  const exploring=applyAction(initial,{type:'EXPLORE',playerId:'p1'});expectRejected(exploring,activate,/Finish exploring/);
  expectRejected(initial,{...activate,playerId:'p2'},/only your own/);
  const otherTurn=structuredClone(initial);otherTurn.evocations[0].playerId='p2';expectRejected(otherTurn,{...activate,playerId:'p2'},/turn/);
 });

 it('permits repeated paid activations independently of the free phase once-per-model activation',()=>{
  let g=actionFixture();g.evocations=[cadaver('own')];
  for(let i=0;i<2;i++) {
   g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'own'});
   expect(g.evocations[0].activated).toBe(false);g=applyAction(g,{type:'END_EVOCATION',playerId:'p1'});
  }
  expect(player(g).actionTokens).toBe(0);expect(g.currentPlayerId).toBe('p2');
  g=explore(g,'p2');g=explore(g,'p2');expect(g.phase).toBe('EVOCATION');
  expect(g.evocations[0].activated).toBe(false);
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'own'});
  expect(g.evocations[0].activated).toBe(true);expect(g.evocationActivation?.returnToAction).toBe(false);expect(player(g).actionTokens).toBe(0);
  g=applyAction(g,{type:'END_EVOCATION',playerId:'p1'});expect(g.phase).toBe('CLEANUP');
 });

 it('moves at most two adjacent board steps and cannot enter any starting room or leave the board',()=>{
  let g=actionFixture();g.evocations=[cadaver('walker')];
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'walker'});
  expectRejected(g,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:2,r:0}},/adjacent/);
  expectRejected(g,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:0,r:0}},/adjacent/);
  for(const start of g.board.rooms.filter(r=>r.startingFor)) {
   const edge=structuredClone(g);edge.evocations[0].position={...edge.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],start.tiles[0])===1)!.tiles[0]};
   expectRejected(edge,{type:'EVOCATION_STEP',playerId:'p1',destination:start.tiles[0]},/starting rooms/);
  }
  const edge=structuredClone(g);edge.evocations[0].position={q:2,r:0};expectRejected(edge,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:3,r:0}},/outside board/);
  g=applyAction(g,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:1,r:0}});
  g=applyAction(g,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:1,r:-1}});
  expect(g.evocationActivation?.movesRemaining).toBe(0);expect(player(g).wizard.position).toEqual({q:0,r:0});
  expectRejected(g,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:0,r:0}},/movement remaining/);
  g=applyAction(g,{type:'END_EVOCATION',playerId:'p1'});expect(g.evocations[0].position).toEqual({q:1,r:-1});
 });
});

describe('Grey room summoning regressions',()=>{

 it('leaves a START summon at its original mage position and cannot summon again at Explore END',()=>{
  let {g,source}=greyFixture();
  const destination=g.board.rooms.find(r=>!r.startingFor && hexDistance(r.tiles[0],source.tiles[0])===1)!;
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:destination.tiles[0]});
  expectRejected(g,{type:'END_EXPLORE',playerId:'p1',activateRoomAtEnd:true},/already used/);
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expect(g.evocations).toHaveLength(1);expect(g.evocations[0].position).toEqual(source.tiles[0]);expect(player(g).wizard.position).toEqual(destination.tiles[0]);
  expect(player(g).actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);
 });

 it('rejects room activation in all four protected starts without spending a token or creating a model',()=>{
  const initial=actionFixture();
  for(const start of initial.board.rooms.filter(r=>r.startingFor)) {
   const g=structuredClone(initial);player(g).wizard.position={...start.tiles[0]};
   player(g,'p2').wizard.position={...g.board.rooms.find(r=>!r.startingFor && hexDistance(r.tiles[0],start.tiles[0])===1)!.tiles[0]};
   expectRejected(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true},/No room effect in a starting room/);
   const exploring=applyAction(g,{type:'EXPLORE',playerId:'p1'});
   expectRejected(exploring,{type:'END_EXPLORE',playerId:'p1',activateRoomAtEnd:true},/No room effect in a starting room/);
   for(const roomEffect of ['START','END'] as const)expectRejected(g,{type:'PUNCH',playerId:'p1',targetId:'p2',roomEffect},/Leave the starting room/);
   expect(g.evocations).toEqual([]);expect(player(g).actionTokens).toBe(2);expect(exploring.evocations).toEqual([]);
  }
 });

 it('rejects the removed direct summon as an unknown untrusted action without any state or token change',()=>{
  expectTypeOf<Extract<GameAction,{type:'SUMMON_EVOCATION'}>>().toBeNever();
  const initial=actionFixture();initial.evocations=[cadaver('own')];
  const starting=structuredClone(initial);player(starting).wizard.position={q:3,r:-2};
  const noTokens=structuredClone(initial);player(noTokens).actionTokens=0;
  const quota=structuredClone(initial);quota.activation!.actionsUsed=2;
  const states=[createGame(),initial,greyFixture().g,starting,noTokens,quota,
   applyAction(initial,{type:'EXPLORE',playerId:'p1'}),
   applyAction(initial,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'own'}),evocationPhaseFixture(initial)];
  for(const g of states)for(const owner of ['p1','p2']) {
   // Deliberate boundary cast: deserialized legacy commands must fail runtime validation too.
   const untrusted:unknown=JSON.parse(JSON.stringify({type:'SUMMON_EVOCATION',playerId:owner}));
   expectRejected(g,untrusted as GameAction,/^Unknown game action$/);
  }
 });
});

describe('all-model targeting and physical damage cubes',()=>{
 it('lets a mage punch enemy evocations only at distance zero, never adjacent, friendly or protected models',()=>{
  for(const position of [{q:0,r:0}]) {
   let g=actionFixture();g.evocations=[cadaver('enemy','p2',position),cadaver('friendly')];
   g.evocations[0].health=3;
   expectRejected(g,{type:'PUNCH',playerId:'p1',targetId:'friendly'},/own evocations/);
   expectRejected(g,{type:'PUNCH',playerId:'p1',targetId:'p1'},/yourself/);
  for(const q of [1,2]) {
   const distant=structuredClone(g);distant.evocations[0].position={q,r:0};expectRejected(distant,{type:'PUNCH',playerId:'p1',targetId:'enemy'},/same hex/);
  }
   const protectedModel=structuredClone(g);player(protectedModel).wizard.position={q:2,r:-2};protectedModel.evocations[0].position={q:3,r:-2};
   expectRejected(protectedModel,{type:'PUNCH',playerId:'p1',targetId:'enemy'},/starting room/);
   g=applyAction(g,{type:'PUNCH',playerId:'p1',targetId:'enemy'});
  expect(g.evocations.find(e=>e.id==='enemy')!.damageByPlayer).toEqual({p1:2});
  expect(player(g).cubes.onEvocations).toBe(2);expect(player(g).cubes.onWizard).toBe(0);expectCubesConserved(g);
  }
 });

 it('Crimson damages every enemy model in the activated room, excluding own mage/models and outsiders',()=>{
  let g=actionFixture();const crimson=g.board.rooms.find(r=>r.effect==='ROOM_DAMAGE')!;
  player(g).wizard.position={...crimson.tiles[0]};player(g,'p2').wizard.position={...crimson.tiles[0]};
  addPlayer(g,'p3').wizard.position={...crimson.tiles[0]};
  g.evocations=[cadaver('own','p1',crimson.tiles[0]),cadaver('enemy2','p2',crimson.tiles[0]),cadaver('enemy3','p3',crimson.tiles[0]),cadaver('outside','p2')];
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  expect(g.players.map(p=>p.wizard.damageCubes)).toEqual([0,1,1]);expect(g.evocations.map(e=>e.damageCubes)).toEqual([0,1,1,0]);
  expect(player(g).cubes).toEqual({available:21,onWizard:2,onBoard:0,onEvocations:2});expectCubesConserved(g);
  // A START Crimson finisher destroys the intended punch target; do not punch it again or award a mage kill.
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  g=applyAction(g,{type:'PUNCH',playerId:'p1',targetId:'enemy2',roomEffect:'START'});
  expect(g.evocations.map(e=>e.id)).toEqual(['own','outside']);expect(player(g).kills).toBe(0);expect(player(g).victoryPoints).toBe(0);expectCubesConserved(g);
 });

 it('caps summon cubes at health/supply, deals full damage without cubes, and returns every contributing owner cube on destruction',()=>{
  for(const available of [0,1,25]) {
   let g=actionFixture();g.evocations=[cadaver('victim','p2')];prepare(g,'rapid',{target:'MODEL',moments:[moment.damage(9)]});
   // Account for unavailable supply on a real unrebuilt room; no phantom cubes.
   player(g).cubes.available=available;player(g).cubes.onBoard=25-available;
   room(g).instability=25-available;room(g).instabilityLimit=30;room(g).cubesByPlayer={p1:25-available};
   g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetEvocationId:'victim'});
   expect(g.evocations).toEqual([]);expect(player(g).cubes.available).toBe(available);expect(player(g).cubes.onEvocations).toBe(0);
   expect(player(g).kills).toBe(0);expect(player(g).victoryPoints).toBe(0);
   expect(g.log.some(l=>l.includes(`suffers 2 damage`)&&l.includes(`places ${Math.min(2,available)} damage cubes`))).toBe(true);expectCubesConserved(g);
  }
  let g=actionFixture();addPlayer(g,'p3');g.evocations=[cadaver('victim','p2'),cadaver('other','p2')];
  g.evocations[0].damageCubes=1;g.evocations[0].damageByPlayer={p3:1};g.evocations[1].damageCubes=1;g.evocations[1].damageByPlayer={p1:1};
  player(g,'p3').cubes.available=24;player(g,'p3').cubes.onEvocations=1;player(g).cubes.available=24;player(g).cubes.onEvocations=1;
  player(g).quest={id:'not-a-mage-kill',name:'Kill',description:'Kill',kind:'KILL',amount:1,reward:3};
  expectCubesConserved(g);g=applyAction(g,{type:'PUNCH',playerId:'p1',targetId:'victim'});
  expect(g.evocations.map(e=>e.id)).toEqual(['other']);expect(player(g,'p3').cubes.available).toBe(25);expect(player(g,'p3').cubes.onEvocations).toBe(0);
  expect(player(g).cubes.available).toBe(24);expect(player(g).cubes.onEvocations).toBe(1);
  expect(g.players.every(p=>p.kills===0&&p.victoryPoints===0)).toBe(true);expect(player(g).quest?.id).toBe('not-a-mage-kill');expectCubesConserved(g);
 });
});

describe('free Evocation phase scheduling',()=>{
 it('alternates owners after each model, skips owners without ready models and forbids a second free activation',()=>{
  let g=actionFixture();addPlayer(g,'p3');g.evocations=[cadaver('a'),cadaver('b'),cadaver('enemy','p2')];g=evocationPhaseFixture(g);
  expect(g.phase).toBe('EVOCATION');expect(g.currentPlayerId).toBe('p1');expect(g.activation).toBeNull();
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'a'});
  expectRejected(g,{type:'EXPLORE',playerId:'p1'},/unavailable in EVOCATION/);
  g=applyAction(g,{type:'END_EVOCATION',playerId:'p1'});expect(g.currentPlayerId).toBe('p2');
  expectRejected(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'b'},/turn/);
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:'enemy'});g=applyAction(g,{type:'END_EVOCATION',playerId:'p2'});
  expect(g.currentPlayerId).toBe('p1');expectRejected(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'a'},/already activated/);
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'b'});g=applyAction(g,{type:'END_EVOCATION',playerId:'p1'});
  expect(g.phase).toBe('CLEANUP');expect(g.currentPlayerId).toBeNull();expect(g.evocationActivation).toBeNull();
  expect(g.evocations.every(e=>e.activated)).toBe(true);expect(g.players.map(p=>p.actionTokens)).toEqual([0,0,0]);
 });
});