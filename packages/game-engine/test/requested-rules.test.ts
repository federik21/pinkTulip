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
 const card={...g.library[0].cards.shift()!,moments:[],range:4,target:'ROOM' as const,...changes};
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
 it('starts with exactly two tokens, complete cube ledgers, unused specials and no evocations',()=>{
  const g=createGame();expect(PHYSICAL_TOKENS_PER_ROUND).toBe(2);
  expect(g.players.map(p=>p.actionTokens)).toEqual([2,2]);
  for(const p of g.players) {
   expect(p.cubes).toEqual({available:25,onBoard:0,onWizard:0,onEvocations:0});
   expect(p.hand).toEqual([]);expect(p.personalDeck).toEqual([]);expect(p.discard).toEqual([]);
  }
  expect(g.board.rooms.every(r=>r.specialUsed===false)).toBe(true);
  expect(g.evocations).toEqual([]);expect(g.evocationActivation).toBeNull();expectCardsConserved(g);
 });

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

 it('cannot pass with any unused preparation, including numbered spells blocked until future turns',()=>{
  let g=actionFixture();for(const slot of ['slot1','slot2','slot3','rapid'] as const)prepare(g,slot);
  g=explore(g);g=explore(g);expect(player(g).actionTokens).toBe(0);
  expect(g.currentPlayerId).toBe('p2');expect(canPassActionPhase(g,player(g))).toBe(false);
  // Real opposing turns, not reset counters, make the remaining spells available again.
  g=explore(g,'p2');g=applyAction(g,{type:'END_ACTIVATION',playerId:'p2'});
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0'});
  expect(g.activation?.actionsUsed).toBe(1);expect(player(g).actionTokens).toBe(0);
  expectRejected(g,{type:'PASS_ROUND',playerId:'p1'},/no unused spells/);
  expectRejected(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot2',roomId:'room-0,0'},/one sequenced/);
  expect(canPassActionPhase(g,player(g))).toBe(false);
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
  expect(g.currentPlayerId).toBe('p2');expect(player(g).passed).toBe(false);
  g=explore(g,'p2');
  expect(g.currentPlayerId).toBe('p1');expectRejected(g,{type:'PASS_ROUND',playerId:'p1'},/no unused spells/);
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot2',roomId:'room-0,0'});
  expect(canPassActionPhase(g,player(g))).toBe(false);
  // Only p1 remains eligible: the blocked numbered quota starts a fresh activation.
  expect(g.currentPlayerId).toBe('p1');expect(g.activation).toMatchObject({actionsUsed:0,sequencedSpellUsed:false});
  expectRejected(g,{type:'PASS_ROUND',playerId:'p1'},/no unused spells/);
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot3',roomId:'room-0,0'});
  expect(g.phase).toBe('CLEANUP');expect(player(g).passed).toBe(false);expect(canPassActionPhase(g,player(g))).toBe(true);expectCardsConserved(g);
 });

 it('ignores held powers after spending both tokens and retains them for later preparation',()=>{
  let g=actionFixture();const power=holdPower(g);player(g,'p2').wizard.position={q:-3,r:2};
  g=explore(g);g=explore(g);expect(g.currentPlayerId).toBe('p2');expect(player(g).actionTokens).toBe(0);
  expect(canPassActionPhase(g,player(g))).toBe(true);expect(player(g).hand).toEqual([power]);
  g=explore(g,'p2');g=applyAction(g,{type:'END_ACTIVATION',playerId:'p2'});
  expect(g.currentPlayerId).toBe('p2');expect(canPassActionPhase(g,player(g))).toBe(true);
  g=explore(g,'p2');expect(g.phase).toBe('CLEANUP');expect(g.removedCards).toEqual([]);expect(player(g).hand).toEqual([power]);
  expect(player(g).passed).toBe(false);expectCardsConserved(g);
 });
});

describe('Cadavers and token activations',()=>{
 it('summons one printed Cadaver per ordinary Grey activation without an extra action or token',()=>{
  let {g}=greyFixture();const before=structuredClone(g);
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  const summoned=g.evocations[0];expect(g.evocations).toHaveLength(1);expect(g.evocations[0].id).toBeTruthy();
  expect(summoned).toMatchObject(cadaver(summoned.id,'p1',player(g).wizard.position));expect(summoned.number).toBe(1);
  expect(player(g).actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);expect(g.evocationActivation).toBeNull();
  expect(g.activation?.roomEffectUsed).toBe(true);expect(before.evocations).toEqual([]);
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  expect(g.evocations).toHaveLength(2);expect(new Set(g.evocations.map(e=>e.id)).size).toBe(2);
  expect(player(g).actionTokens).toBe(0);expect(g.activation?.actionsUsed).toBe(2);
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});expect(g.currentPlayerId).toBe('p2');expectCardsConserved(g);expectCubesConserved(g);
 });

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

 it('locks every mage command during a paid activation and restores the same mage turn after END_EVOCATION',()=>{
  let g=actionFixture();g.evocations=[cadaver('own'),cadaver('enemy','p2')];const ordinary=prepare(g),power=holdPower(g);
  expectRejected(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'enemy'},/only your own/);
  expectRejected(g,{type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:'enemy'},/turn/);
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'own'});
  expect(g.evocationActivation).toEqual({evocationId:'own',playerId:'p1',movesRemaining:2,returnToAction:true});
  expect(player(g).actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);
  const commands:GameAction[]=[
   {type:'EXPLORE',playerId:'p1'}, {type:'EXPLORE_STEP',playerId:'p1',destination:{q:1,r:0}},
   {type:'END_EXPLORE',playerId:'p1'}, {type:'PUNCH',playerId:'p1',targetId:'p2'},
    {type:'END_ACTIVATION',playerId:'p1'}, {type:'PASS_ROUND',playerId:'p1'},
   {type:'DISCARD_EXIT',playerId:'p1',cardId:ordinary.id,destination:{q:1,r:0}},
   {type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'},
   {type:'CAST_POWERFUL_SPELL',playerId:'p1',cardId:power.id,dummy:true,roomId:'room-0,0'},
   {type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'own'},
  ];
  for(const command of commands)expectRejected(g,command,/active evocation/);
  for(const command of [
   {type:'EVOCATION_STEP',playerId:'p2',destination:{q:1,r:0}},
   {type:'EVOCATION_ATTACK',playerId:'p2',targetId:'p1'}, {type:'END_EVOCATION',playerId:'p2'},
  ] as GameAction[])expectRejected(g,command,/No active evocation/);
  g=applyAction(g,{type:'END_EVOCATION',playerId:'p1'});
  expect(g.evocationActivation).toBeNull();expect(g.phase).toBe('ACTION');expect(g.currentPlayerId).toBe('p1');
  expect(player(g).actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
  expect(player(g).prepared.rapid?.used).toBe(true);expect(g.library[0].discard).toContainEqual(ordinary);
  expect(g.currentPlayerId).toBe('p2');expect(g.activation).toMatchObject({actionsUsed:0,spellsCast:0});
  expect(player(g).actionTokens).toBe(1);expect(player(g).hand).toEqual([power]);expectCardsConserved(g);
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

 it('keeps the Cadaver effect blank: wounds do not raise its base attack',()=>{
  let g=actionFixture();g.evocations=[cadaver('wounded','p2')];expect(evocationAttack(g.evocations[0])).toBe(2);
  prepare(g,'rapid',{target:'MODEL',moments:[moment.damage(1)]});
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetEvocationId:'wounded'});
  expect(g.evocations[0].health).toBe(2);expect(g.evocations[0].damageCubes).toBe(1);expect(evocationAttack(g.evocations[0])).toBe(2);
  expect(g.evocations[0].damageByPlayer).toEqual({p1:1});expectCubesConserved(g);
  g=applyAction(g,{type:'END_ACTIVATION',playerId:'p1'});
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:'wounded'});
  g=applyAction(g,{type:'EVOCATION_ATTACK',playerId:'p2',targetId:'p1'});
  expect(player(g).wizard.damageCubes).toBe(2);expect(player(g).wizard.damageByPlayer).toEqual({p2:2});
  expect(g.evocationActivation).toBeNull();expect(g.currentPlayerId).toBe('p2');expectCubesConserved(g);
 });
});

describe('Grey room summoning regressions',()=>{
 it('gives all three Grey rooms the normal one-Cadaver effect, with no Ivory or School draw effect',()=>{
  const initial=actionFixture(),sources=initial.board.rooms.filter(r=>r.color==='grey');expect(sources).toHaveLength(3);
  expect(initial.board.rooms.map(r=>r.color)).not.toContain('ivory');expect(initial.board.rooms.map(r=>r.effect)).not.toContain('DRAW_LIBRARY');
  for(const source of sources) {
   let g=structuredClone(initial);player(g).wizard.position={...source.tiles[0]};const before=structuredClone(g);
   expect(source.effect).toBe('SUMMON_CADAVER');
   g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  expect(g.evocations).toHaveLength(1);expect(g.evocations[0]).toMatchObject(cadaver(g.evocations[0].id,'p1',source.tiles[0]));
   expect(g.library).toEqual(before.library);expect(player(g).hand).toEqual(before.players[0].hand);
   expect(player(g).actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);expectCardsConserved(g);expectCubesConserved(g);
  }
 });

 it.each([false,true])('summons at the final Explore position when finishing early=%s, never on an intermediate step',finishEarly=>{
  let {g,source}=greyFixture();
  const middle=g.board.rooms.find(r=>!r.startingFor && hexDistance(r.tiles[0],source.tiles[0])===1)!;
  const origin=g.board.rooms.find(r=>!r.startingFor && hexDistance(r.tiles[0],middle.tiles[0])===1 && hexDistance(r.tiles[0],source.tiles[0])===2)!;
  player(g).wizard.position={...(finishEarly?middle:origin).tiles[0]};
  g=applyAction(g,{type:'EXPLORE',playerId:'p1'});expect(g.evocations).toEqual([]);
  if(!finishEarly) {
   g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:middle.tiles[0],activateRoomAtEnd:true});
   expect(g.activation?.exploring).toBe(1);expect(g.activation?.roomEffectUsed).toBe(false);expect(g.evocations).toEqual([]);
  }
  g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:source.tiles[0],activateRoomAtEnd:!finishEarly});
  if(finishEarly){expect(g.evocations).toEqual([]);g=applyAction(g,{type:'END_EXPLORE',playerId:'p1',activateRoomAtEnd:true});}
  expect(g.evocations).toHaveLength(1);expect(g.evocations[0]).toMatchObject(cadaver(g.evocations[0].id,'p1',source.tiles[0]));
  expect(player(g).wizard.position).toEqual(source.tiles[0]);expect(player(g).actionTokens).toBe(1);
  expect(g.activation).toMatchObject({actionsUsed:1,exploring:0,roomEffectUsed:true});expect(g.evocationActivation).toBeNull();expectCardsConserved(g);
 });

 it.each(['START','END'] as const)('summons for free around a Punch at %s while retaining the ordinary punch damage',roomEffect=>{
  let {g,source}=greyFixture();const before=structuredClone(g);
  g=applyAction(g,{type:'PUNCH',playerId:'p1',targetId:'p2',roomEffect});
  expect(g.evocations).toHaveLength(1);expect(g.evocations[0]).toMatchObject(cadaver(g.evocations[0].id,'p1',source.tiles[0]));
  expect(player(g,'p2').wizard.damageCubes).toBe(2);expect(player(g,'p2').wizard.damageByPlayer).toEqual({p1:2});
  expect(player(g).cubes).toEqual({available:23,onBoard:0,onWizard:2,onEvocations:0});
  expect(player(g).actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);expect(g.activation?.roomEffectUsed).toBe(true);
  expect(g.library).toEqual(before.library);expect(player(g).hand).toEqual(before.players[0].hand);expect(g.evocationActivation).toBeNull();expectCardsConserved(g);expectCubesConserved(g);
 });

 it('does not summon merely by occupying, traversing or punching in Grey without opting into the room effect',()=>{
  const initial=greyFixture().g;
  let g=explore(initial);expect(g.evocations).toEqual([]);
  g=applyAction(g,{type:'PUNCH',playerId:'p1',targetId:'p2'});expect(g.evocations).toEqual([]);expect(player(g).actionTokens).toBe(0);
  g=structuredClone(initial);const source=g.board.rooms.find(r=>r.color==='grey')!;
  const neighbor=g.board.rooms.find(r=>!r.startingFor && hexDistance(r.tiles[0],source.tiles[0])===1)!;
  player(g).wizard.position={...neighbor.tiles[0]};g=applyAction(g,{type:'EXPLORE',playerId:'p1'});
  g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:source.tiles[0]});g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expect(g.evocations).toEqual([]);expect(g.activation?.roomEffectUsed).toBe(false);expectCardsConserved(g);
 });

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

 it('counts owned models independently, so enemy Cadavers do not prevent another mage from summoning',()=>{
  let {g,source}=greyFixture();
  for(const owner of ['p1','p2'])for(let i=0;i<2;i++) {
   g=applyAction(g,{type:'EXPLORE',playerId:owner,activateRoomAtStart:true});
  const summoned=g.evocations.at(-1)!;expect(summoned).toMatchObject(cadaver(summoned.id,owner,source.tiles[0]));expect(summoned.number).toBe(i+1);
   g=applyAction(g,{type:'END_EXPLORE',playerId:owner});
  }
  expect(g.evocations).toHaveLength(4);expect(g.evocations.filter(e=>e.playerId==='p1')).toHaveLength(2);expect(g.evocations.filter(e=>e.playerId==='p2')).toHaveLength(2);
  expect(new Set(g.evocations.map(e=>e.id)).size).toBe(4);expect(g.players.map(p=>p.actionTokens)).toEqual([0,0]);expectCardsConserved(g);expectCubesConserved(g);
 });

 it('doubles a reconstructed Grey reward to two and locks that room globally for the Action phase',()=>{
  let {g,source}=greyFixture(true);
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});expect(g.evocations).toHaveLength(2);
  for(const e of g.evocations)expect(e).toMatchObject(cadaver(e.id,'p1',source.tiles[0]));
  expect(room(g,source.id).specialUsed).toBe(true);expect(player(g).actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expectRejected(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true},/special already used/);
  g=applyAction(g,{type:'END_ACTIVATION',playerId:'p1'});
  expectRejected(g,{type:'PUNCH',playerId:'p2',targetId:'p1',roomEffect:'END'},/special already used/);
  expect(g.evocations).toHaveLength(2);expectCardsConserved(g);expectCubesConserved(g);
 });

 it('uses only the one remaining owned slot when a reconstructed Grey activation offers two Cadavers',()=>{
  let {g,source,destination}=approachGreyWithTwo(true);const existing=structuredClone(g.evocations);
  g=applyAction(g,{type:'EXPLORE',playerId:'p1'});expect(g.activation?.actionsUsed).toBe(2);expect(player(g).actionTokens).toBe(0);
  g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:destination.tiles[0]});
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1',activateRoomAtEnd:true});
  expect(g.evocations).toHaveLength(3);expect(g.evocations.slice(0,2)).toEqual(existing);
  expect(existing.every(e=>hexDistance(e.position,source.tiles[0])===0)).toBe(true);
  expect(g.evocations[2]).toMatchObject(cadaver(g.evocations[2].id,'p1',destination.tiles[0]));expect(g.evocations[2].number).toBe(3);
  expect(new Set(g.evocations.map(e=>e.id)).size).toBe(3);expect(room(g,destination.id).specialUsed).toBe(true);
  expect(g.currentPlayerId).toBe('p2');expect(player(g).actionTokens).toBe(0);expectCardsConserved(g);expectCubesConserved(g);
 });

 it.each([false,true])('is a graceful no-op at three owned models (reconstructed=%s), costing only the triggering Explore',reconstructed=>{
  let {g,source}=greyAtCapacityFixture(reconstructed);const before=structuredClone(g);
  expect(room(g,source.id).specialUsed).toBe(false);
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  expect(g.evocations).toEqual(before.evocations);expect(g.evocationActivation).toBeNull();
  expect(player(g).actionTokens).toBe(1);expect(g.activation).toMatchObject({actionsUsed:1,exploring:2,roomEffectUsed:true});
  expect(room(g,source.id).specialUsed).toBe(reconstructed);expect(g.library).toEqual(before.library);
  expect(player(g).hand).toEqual(before.players[0].hand);expect(player(g).cubes).toEqual(before.players[0].cubes);expect(player(g,'p2')).toEqual(before.players[1]);
  expectRejected(g,{type:'END_EXPLORE',playerId:'p1',activateRoomAtEnd:true},/already used/);
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});expect(g.evocations).toEqual(before.evocations);
  if(reconstructed)expectRejected(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true},/special already used/);
  expectCardsConserved(g);expectCubesConserved(g);
 });

 it('frees an owned slot on real destruction and can refill it through a later Grey activation',()=>{
  let {g}=greyAtCapacityFixture(true);
  const victim=g.evocations.find(e=>hexDistance(e.position,player(g,'p2').wizard.position)===0)!;
  g=explore(g);g=applyAction(g,{type:'END_ACTIVATION',playerId:'p1'});
  g=applyAction(g,{type:'PUNCH',playerId:'p2',targetId:victim.id});
  expect(g.evocations).toHaveLength(2);expect(g.evocations.some(e=>e.id===victim.id)).toBe(false);expect(player(g,'p2').cubes.onEvocations).toBe(0);
  g=applyAction(g,{type:'END_ACTIVATION',playerId:'p2'});
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  expect(g.evocations).toHaveLength(3);expect(g.evocations.at(-1)).toMatchObject(cadaver(g.evocations.at(-1)!.id,'p1',player(g).wizard.position));expect(g.evocations.at(-1)!.number).toBe(victim.number);
  expect(player(g).actionTokens).toBe(0);expect(g.activation?.actionsUsed).toBe(1);expectCardsConserved(g);expectCubesConserved(g);
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

 it('still pays one action/token to activate an existing model in Grey, without summoning or reusing the room effect',()=>{
  for(const reconstructed of [false,true]) {
   let {g,source}=greyFixture(reconstructed);
   expectRejected(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'missing'},/only your own/);
   g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
   const before=structuredClone(g),model=g.evocations[0];
   g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:model.id});
   expect(g.evocations).toEqual(before.evocations);expect(player(g).actionTokens).toBe(0);expect(g.activation?.actionsUsed).toBe(2);
   expect(g.evocationActivation).toEqual({evocationId:model.id,playerId:'p1',movesRemaining:2,returnToAction:true});
   expect(room(g,source.id)).toEqual(room(before,source.id));expect(g.library).toEqual(before.library);expect(player(g).hand).toEqual(before.players[0].hand);
   g=applyAction(g,{type:'END_EVOCATION',playerId:'p1'});expect(g.evocations).toEqual(before.evocations);expect(g.currentPlayerId).toBe('p2');
   expect(player(g).actionTokens).toBe(0);expectCardsConserved(g);expectCubesConserved(g);
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

 it('evocations attack enemy models only in the same room and attacking finishes the activation',()=>{
  for(const targetId of ['p2','enemy']) {
   let g=actionFixture();g.evocations=[cadaver('attacker'),cadaver('friendly'),cadaver('enemy','p2',{q:1,r:0})];
   g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'attacker'});
   for(const friendly of ['p1','friendly','attacker'])expectRejected(g,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:friendly},/friendly/);
   expectRejected(g,{type:'EVOCATION_ATTACK',playerId:'p1',targetId},/^Target must be in the same room$/);
   const distant=structuredClone(g);player(distant,'p2').wizard.position={q:2,r:0};expectRejected(distant,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'},/same room/);
   const protectedModel=structuredClone(g);protectedModel.evocations[0].position={q:2,r:-2};player(protectedModel,'p2').wizard.position={q:3,r:-2};
   expectRejected(protectedModel,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'},/starting room/);
   g=applyAction(g,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:1,r:0}});
   g=applyAction(g,{type:'EVOCATION_ATTACK',playerId:'p1',targetId});expect(g.evocationActivation).toBeNull();
   if(targetId==='p2')expect(player(g,'p2').wizard.damageByPlayer).toEqual({p1:2});
   else {expect(g.evocations.some(e=>e.id==='enemy')).toBe(false);expect(player(g).kills).toBe(0);expect(player(g).victoryPoints).toBe(0);}
   expectRejected(g,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'},/No active evocation/);expectCubesConserved(g);
  }
 });

 it('credits evocation mage kills to their owner, including normal 4/2/1 contribution points and kill quests',()=>{
  let g=actionFixture();const p3=addPlayer(g,'p3'),p4=addPlayer(g,'p4');g.evocations=[cadaver('killer')];
  player(g).quest={id:'owner-kill',name:'Owner kill',description:'Kill',kind:'KILL',amount:1,reward:3};
  player(g,'p2').wizard.damageCubes=9;player(g,'p2').wizard.damageByPlayer={p1:4,p3:3,p4:2};
  for(const [p,n] of [[player(g),4],[p3,3],[p4,2]] as const){p.cubes.available-=n;p.cubes.onWizard=n;}
  expectCubesConserved(g);g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'killer'});
  g=applyAction(g,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:1,r:0}});
  g=applyAction(g,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'});
  expect(g.players.map(p=>p.victoryPoints)).toEqual([7,0,2,1]);expect(g.players.map(p=>p.kills)).toEqual([1,0,0,0]);
  expect(player(g).questsCompleted).toBe(1);expect(player(g).quest).toBeNull();expect(g.questDiscard.map(q=>q.id)).toEqual(['owner-kill']);
  expect(player(g,'p2').wizard.position).toEqual({q:-3,r:2});expect(player(g,'p2').wizard.damageByPlayer).toEqual({});expectCubesConserved(g);
 });

 it('MODEL spells select an enemy evocation, enforce exclusive targets/range and preserve dummy behavior',()=>{
  let g=actionFixture();g.evocations=[cadaver('enemy','p2',{q:1,r:0}),cadaver('friendly')];
  prepare(g,'slot1',{target:'MODEL',moments:[moment.instability(1),moment.damage(1)],range:1});
  const cast={type:'CAST_SPELL' as const,playerId:'p1',slot:'slot1' as const,targetEvocationId:'enemy'};
  expectRejected(g,{...cast,targetPlayerId:'p2'},/Select one mage or evocation/);
  expectRejected(g,{...cast,targetEvocationId:'friendly'},/category or ownership/);
  expectRejected(g,{...cast,targetEvocationId:'missing'},/not found/);
  expectRejected(g,{...cast,dummy:true,roomId:'room-0,0'},/either/);
  const far=structuredClone(g);far.evocations[0].position={q:2,r:0};expectRejected(far,cast,/range/);
  g=applyAction(g,cast);expect(g.evocations[0].damageCubes).toBe(1);expect(room(g,'room-1,0').cubesByPlayer).toEqual({p1:1});
  expect(player(g).cubes).toEqual({available:23,onWizard:0,onBoard:1,onEvocations:1});expectCubesConserved(g);expectCardsConserved(g);
 });

 it('prepared powerful MODEL spells target evocations, exile once and place instability in the destroyed model room',()=>{
  let g=actionFixture();g.evocations=[cadaver('enemy','p2',{q:1,r:0}),cadaver('friendly')];const power=holdPower(g);
  player(g).hand.splice(player(g).hand.indexOf(power),1);player(g).prepared.rapid={card:power,used:false};
  const cast={type:'CAST_SPELL' as const,playerId:'p1',slot:'rapid' as const,targetEvocationId:'enemy'};
  expectRejected(g,{...cast,targetPlayerId:'p2'},/Select one mage or evocation/);
  expectRejected(g,{...cast,targetEvocationId:'friendly'},/category or ownership/);
  expectRejected(g,{...cast,dummy:true,roomId:'room-0,0'},/either/);
  g=applyAction(g,cast);expect(g.evocations.map(e=>e.id)).toEqual(['friendly']);expect(g.removedCards).toEqual([power]);
  expect(room(g,'room-1,0').cubesByPlayer).toEqual({p1:momentTotal(power,'INSTABILITY')});expect(room(g).instability).toBe(0);
  expect(player(g).kills).toBe(0);expect(player(g).victoryPoints).toBe(0);expect(player(g).cubes.onEvocations).toBe(0);
  expectRejected(g,cast,/unavailable/);expectCubesConserved(g);expectCardsConserved(g);
 });

 it('normal and powerful ROOM spells hit all enemy mages/evocations but exclude own models and outsiders',()=>{
  for(const powerful of [false,true]) {
   let g=actionFixture();addPlayer(g,'p3').wizard.position={q:0,r:0};player(g,'p2').wizard.position={q:0,r:0};
   g.evocations=[cadaver('own'),cadaver('enemy2','p2'),cadaver('enemy3','p3'),cadaver('outside','p2',{q:2,r:0})];
   let damage:number;
   if(powerful) {
    const power=holdPower(g,'ROOM');damage=momentTotal(power,'DAMAGE');
    player(g).hand.splice(player(g).hand.indexOf(power),1);player(g).prepared.rapid={card:power,used:false};
    g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});expect(g.removedCards).toEqual([power]);
   } else {
    damage=1;prepare(g,'rapid',{moments:[moment.damage(damage)]});g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
   }
   expect(g.players.map(p=>p.wizard.damageCubes)).toEqual([0,damage,damage]);
   expect(g.evocations.find(e=>e.id==='own')).toEqual(cadaver('own'));expect(g.evocations.find(e=>e.id==='outside')!.damageCubes).toBe(0);
   for(const id of ['enemy2','enemy3']) {
    if(powerful)expect(g.evocations.some(e=>e.id===id)).toBe(false);
    else expect(g.evocations.find(e=>e.id===id)!.damageByPlayer).toEqual({p1:1});
   }
   expect(player(g).kills).toBe(0);expect(player(g).victoryPoints).toBe(0);expectCubesConserved(g);expectCardsConserved(g);
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

 it('skips the eliminated last model of an owner and cleans up when the remaining ready model is done',()=>{
  let g=actionFixture();g.evocations=[cadaver('killer'),cadaver('last'),cadaver('enemy','p2',{q:1,r:0})];g=evocationPhaseFixture(g);
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'killer'});
  g=applyAction(g,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:1,r:0}});
  g=applyAction(g,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'enemy'});
  expect(g.phase).toBe('EVOCATION');expect(g.currentPlayerId).toBe('p1');expect(g.evocations.map(e=>e.id)).toEqual(['killer','last']);
  expectRejected(g,{type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:'enemy'},/only your own/);
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'last'});g=applyAction(g,{type:'END_EVOCATION',playerId:'p1'});
  expect(g.phase).toBe('CLEANUP');expect(player(g).kills).toBe(0);expectCubesConserved(g);
  // Eliminating the only opposing model can also finish the phase immediately.
  let last=actionFixture();last.evocations=[cadaver('killer'),cadaver('enemy','p2')];last=evocationPhaseFixture(last);
  last=applyAction(last,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'killer'});
  last=applyAction(last,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'enemy'});expect(last.phase).toBe('CLEANUP');
 });

 it('preserves surviving evocations and their wounds across rounds, refreshes two tokens, and resets activation only on phase entry',()=>{
  let g=actionFixture();g.evocations=[cadaver('survivor')];g.evocations[0].damageCubes=1;g.evocations[0].damageByPlayer={p2:1};
  player(g,'p2').cubes.available=24;player(g,'p2').cubes.onEvocations=1;g=evocationPhaseFixture(g);
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'survivor'});g=applyAction(g,{type:'END_EVOCATION',playerId:'p1'});
  const survivor=structuredClone(g.evocations[0]);expect(survivor.activated).toBe(true);
  for(const p of g.players)seedPersonalDeck(g,2,p.id);
  g.eventDeck=[{id:'no-model-damage',name:'Quiet',description:'No damage',kind:'INSTABILITY',amount:0,rooms:0}];
  g=advance(g);expect(g.round).toBe(2);expect(g.players.map(p=>p.actionTokens)).toEqual([2,2]);expect(g.evocations).toEqual([survivor]);expectCubesConserved(g);
  g=advance(g);
  for(const id of ['p1','p2']) {
    g=applyAction(g,{type:'DRAW_STUDY',playerId:id,deckId:'cantrip'});
  g=applyAction(g,{type:'DISCARD_STUDY',playerId:id,cardIds:player(g,id).studyCardIds!.slice(0,2)});
  }
  for(const id of ['p1','p2']) {
   const cards=player(g,id).hand.slice(0,4);
   g=applyAction(g,{type:'PREPARE_CARDS',playerId:id,preparedCardIds:cards.slice(0,3).map(c=>c.id),rapidCardId:cards[3].id});
  }
  expect(g.evocations).toEqual([survivor]);
  // TEST FIXTURE ONLY: return unused preparations to hand, preserving all cards while
  // isolating the next Evocation-phase reset from another full mage-action round.
  for(const p of g.players)for(const slot of ['rapid','slot1','slot2','slot3'] as const){p.hand.push(p.prepared[slot]!.card);p.prepared[slot]=null;}
  g=evocationPhaseFixture(g);expect(g.phase).toBe('EVOCATION');expect(g.evocations[0]).toEqual({...survivor,activated:false});
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'survivor'});expect(evocationAttack(g.evocations[0])).toBe(2);expectCardsConserved(g);
 });
});

describe('reconstructed room specials',()=>{
 it('doubles the reward of all seven effects, without doubling Emerald range or modifying standard effects',()=>{
  const effects:RoomEffect[]=['ROOM_DAMAGE','DRAW_DISCARD','INSTABILITY','DRAW_QUEST','DRAW_GRIMOIRE','SUMMON_CADAVER','DRAW_POWERFUL'];
  const random=vi.spyOn(Math,'random').mockReturnValue(0);
  try {
   for(const effect of effects)for(const reconstructed of [false,true]) {
    let g=actionFixture();const source=g.board.rooms.find(r=>r.effect===effect)!;source.reconstructed=reconstructed;
    player(g).wizard.position={...source.tiles[0]};player(g,'p2').wizard.position={...source.tiles[0]};
    if(effect==='DRAW_DISCARD'){seedPersonalDeck(g,3);player(g).discard.push(...player(g).personalDeck.splice(0,3));}
    if(effect==='DRAW_GRIMOIRE')seedPersonalDeck(g,2);
    const before=structuredClone(g),reward=reconstructed?2:1;
    const adjacent=g.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],source.tiles[0])===1)!;
    const roomTargetId=effect==='INSTABILITY'?adjacent.id:undefined;
    if(effect==='INSTABILITY') {
     const far=g.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],source.tiles[0])===2)!;
     expectRejected(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true,roomTargetId:far.id},/range.*1/);
    }
    g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true,roomTargetId});
    expect(room(g,source.id).specialUsed).toBe(reconstructed);expect(player(g).actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);
    switch(effect) {
     case 'ROOM_DAMAGE':expect(player(g,'p2').wizard.damageByPlayer).toEqual({p1:reward});expect(player(g).wizard.damageCubes).toBe(0);break;
     case 'DRAW_DISCARD':expect(player(g).hand).toEqual(before.players[0].discard.slice(0,reward));expect(player(g).discard).toEqual(before.players[0].discard.slice(reward));break;
     case 'INSTABILITY':expect(room(g,adjacent.id).cubesByPlayer).toEqual({p1:reward});expect(room(g,source.id).instability).toBe(0);break;
     case 'DRAW_QUEST':expect([player(g).quest,...player(g).additionalQuests]).toEqual(before.questDeck.slice(0,reward));expect(g.questDeck).toEqual(before.questDeck.slice(reward));break;
     case 'DRAW_GRIMOIRE':expect(player(g).hand).toEqual(before.players[0].personalDeck.slice(0,reward));expect(player(g).personalDeck).toEqual(before.players[0].personalDeck.slice(reward));break;
    case 'SUMMON_CADAVER':expect(g.evocations).toHaveLength(reward);for(const e of g.evocations)expect(e).toMatchObject(cadaver(e.id,'p1',source.tiles[0]));expect(player(g).hand).toEqual(before.players[0].hand);expect(g.library).toEqual(before.library);break;
     case 'DRAW_POWERFUL':expect(player(g).hand).toEqual(before.powerfulDeck.slice(0,reward));expect(g.powerfulDeck).toEqual(before.powerfulDeck.slice(reward));break;
    }
    expectCubesConserved(g);expectCardsConserved(g);
   }
  } finally {random.mockRestore();}
 });

 it('locks a reconstructed room globally across both mages, but not another room with the same effect',()=>{
  let g=actionFixture();const sources=g.board.rooms.filter(r=>r.effect==='DRAW_GRIMOIRE');for(const r of sources)r.reconstructed=true;
  for(const p of g.players)seedPersonalDeck(g,2,p.id);
  player(g).wizard.position={...sources[0].tiles[0]};player(g,'p2').wizard.position={...sources[0].tiles[0]};
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expectRejected(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true},/special already used/);
  g=applyAction(g,{type:'END_ACTIVATION',playerId:'p1'});expect(g.currentPlayerId).toBe('p2');
  expectRejected(g,{type:'PUNCH',playerId:'p2',targetId:'p1',roomEffect:'END'},/special already used/);
  expectRejected(g,{type:'EXPLORE',playerId:'p2',activateRoomAtStart:true},/special already used/);
  player(g,'p2').wizard.position={...sources[1].tiles[0]};const hand=player(g,'p2').hand.length;
  g=applyAction(g,{type:'EXPLORE',playerId:'p2',activateRoomAtStart:true});expect(player(g,'p2').hand).toHaveLength(hand+2);
  expect(sources.slice(0,2).map(r=>room(g,r.id).specialUsed)).toEqual([true,true]);expect(room(g,sources[2].id).specialUsed).toBe(false);
 });

 it('keeps filled rooms ordinary until Cleanup, then unlocks and refreshes the upgraded special',()=>{
  let g=actionFixture();const emerald=g.board.rooms.find(r=>r.effect==='INSTABILITY')!;
  player(g).wizard.position={...emerald.tiles[0]};emerald.instability=emerald.instabilityLimit-2;emerald.cubesByPlayer={'black-rose':emerald.instability};
  const adjacent=g.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],emerald.tiles[0])===1)!;
  // Filling later in this phase must not unlock the upgraded effect yet.
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expect(room(g,emerald.id).reconstructed).toBe(false);expect(room(g,emerald.id).specialUsed).toBe(false);
  prepare(g,'rapid',{moments:[moment.instability(1)]});g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:emerald.id});
  expect(room(g,emerald.id).instability).toBe(emerald.instabilityLimit);expect(room(g,emerald.id).reconstructed).toBe(false);expect(room(g,emerald.id).specialUsed).toBe(false);
  expect(g.currentPlayerId).toBe('p2');g=explore(g,'p2');g=applyAction(g,{type:'END_ACTIVATION',playerId:'p2'});
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true,roomTargetId:adjacent.id});g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expect(room(g,adjacent.id).cubesByPlayer).toEqual({p1:1});expect(room(g,emerald.id).specialUsed).toBe(false);
  g=explore(g,'p2');expect(g.phase).toBe('CLEANUP');expect(room(g,emerald.id).reconstructed).toBe(true);expect(room(g,emerald.id).specialUsed).toBe(false);expect(room(g,emerald.id).scored).toBe(true);
  for(const p of g.players)seedPersonalDeck(g,2,p.id);
  g.eventDeck=[{id:'quiet',name:'Quiet',description:'Quiet',kind:'INSTABILITY',amount:0,rooms:0}];g=advance(g);g=advance(g);
  for(const id of ['p1','p2']) {
    g=applyAction(g,{type:'DRAW_STUDY',playerId:id,deckId:'cantrip'});
  g=applyAction(g,{type:'DISCARD_STUDY',playerId:id,cardIds:player(g,id).studyCardIds!.slice(0,2)});
  }
  for(const id of ['p1','p2']) {
   const cards=player(g,id).hand.slice(0,4);g=applyAction(g,{type:'PREPARE_CARDS',playerId:id,preparedCardIds:cards.slice(0,3).map(c=>c.id),rapidCardId:cards[3].id});
  }
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true,roomTargetId:adjacent.id});
  expect(room(g,emerald.id).specialUsed).toBe(true);expect(room(g,adjacent.id).cubesByPlayer).toEqual({p1:3});expectCubesConserved(g);expectCardsConserved(g);
 });

 it('never doubles up room effects at both Explore ends, even when moving between different reconstructed rooms',()=>{
  let g=actionFixture();const origin=room(g);origin.reconstructed=true;
  const destination=g.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],origin.tiles[0])===1)!;destination.reconstructed=true;
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});expect(player(g).hand).toHaveLength(2);
  g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:destination.tiles[0]});
  expectRejected(g,{type:'END_EXPLORE',playerId:'p1',activateRoomAtEnd:true},/already used/);
  const next=g.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],destination.tiles[0])===1)!;
  expectRejected(g,{type:'EXPLORE_STEP',playerId:'p1',destination:next.tiles[0],activateRoomAtEnd:true},/already used/);
  expect(room(g,destination.id).specialUsed).toBe(false);expect(player(g).hand).toHaveLength(2);
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});expect(g.activation?.actionsUsed).toBe(1);expect(room(g).specialUsed).toBe(true);expectCardsConserved(g);
 });
});