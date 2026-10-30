import { moment } from '../src/cards';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
 applyAction, BLACK_ROSE_ID, canPassActionPhase, canPlayerAct, createGame,
 ENDGAME_REWARDS, getContributionAwards, getRoomMajorityWinners, getRoomRewards, ROOM_COLORS, ROOM_EFFECT_LABELS,
} from '../src';
import type { Card, Evocation, GameAction, GameState, Player, Room } from '../src';

// Focused, card-conserving fixtures: only real cards move between their piles.
function actionFixture(count=4) {
 const g=createGame(count);g.phase='ACTION';g.round=1;g.currentPlayerId='p1';
 g.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of g.players){p.actionTokens=0;p.wizard.position={q:0,r:0};}
 return g;
}
const player=(g:GameState,id='p1')=>g.players.find(p=>p.id===id)!;
const room=(g:GameState,id:string)=>g.board.rooms.find(r=>r.id===id)!;
function prepare(g:GameState,changes:Partial<Card>={},id='p1',slot:keyof Player['prepared']='rapid') {
 const card={...g.library[0].cards.shift()!,spellType:undefined,ongoing:undefined,trigger:undefined,moments:[],range:4,target:'ROOM' as const,...changes};
 player(g,id).prepared[slot]={card,used:false};return card;
}
const settle=(g:GameState)=>applyAction(g,{type:'PASS_ROUND',playerId:g.currentPlayerId!});
const advance=(g:GameState)=>applyAction(g,{type:'ADVANCE_PHASE',playerId:g.hostId,expectedPhase:g.phase,expectedRound:g.round});
function reject(g:GameState,action:GameAction,error:RegExp) {
 const before=structuredClone(g);expect(()=>applyAction(g,action)).toThrow(error);expect(g).toEqual(before);
}
function placeLedger(g:GameState,r:Room,contributions:Record<string,number>) {
 r.cubesByPlayer={...contributions};r.instability=Object.values(contributions).reduce((a,b)=>a+b,0);
 for(const p of g.players){const n=contributions[p.id]??0;p.cubes.available-=n;p.cubes.onBoard+=n;}
}
function conservation(g:GameState) {
 for(const p of g.players) {
  expect(p.cubes.available+p.cubes.onWizard+p.cubes.onBoard+p.cubes.onEvocations).toBe(25);
  expect(Object.values(p.cubes).every(n=>n>=0)).toBe(true);
 }
 const cards=[...g.powerfulDeck,...g.removedCards,...g.library.flatMap(d=>[...d.cards,...d.discard]),...[...g.readiedSpells??[],...g.ongoingSpells??[]].map(a=>a.card),...g.players.flatMap(p=>[...p.hand,...p.personalDeck,...p.discard,...Object.values(p.prepared).filter(c=>c&&!c.used).map(c=>c!.card)])];
 expect(cards).toHaveLength(120);expect(new Set(cards.map(c=>c.id)).size).toBe(120);
 expect(cards.filter(c=>!c.powerful)).toHaveLength(108);expect(cards.filter(c=>c.powerful)).toHaveLength(12);
}
function neutralDefeat(contributions:Record<string,number>,blackDamage:number) {
 const g=actionFixture(),victim=player(g,'p4');
 victim.wizard.damageByPlayer={...contributions};victim.wizard.blackDamage=blackDamage;
 victim.wizard.damageCubes=Object.values(contributions).reduce((a,b)=>a+b,0)+blackDamage;
 victim.wizard.health=victim.wizard.damageCubes+1;
 for(const p of g.players){const n=contributions[p.id]??0;p.cubes.available-=n;p.cubes.onWizard=n;}
 g.phase='CLEANUP';g.activation=null;g.currentPlayerId=null;
 g.eventDeck=[{id:'black-finisher',name:'Black finisher',description:'Black damage',kind:'BLACK_DAMAGE',amount:1,rooms:0}];
 return advance(g);
}

describe('public authoritative schema and history boundary',()=>{
 it('exposes only per-viewer history flags/labels, not snapshots or snapshot-bearing commands',()=>{
  expectTypeOf<NonNullable<GameState['history']>>().toEqualTypeOf<{canUndo:boolean;canRedo:boolean;undoLabel?:string;redoLabel?:string}>();
  expectTypeOf<Extract<GameAction,{type:'UNDO_ACTION'}>>().toEqualTypeOf<{type:'UNDO_ACTION';playerId:string}>();
  expectTypeOf<Extract<GameAction,{type:'REDO_ACTION'}>>().toEqualTypeOf<{type:'REDO_ACTION';playerId:string}>();
  const g=createGame();g.history={canUndo:true,canRedo:false,undoLabel:'Explore'};
  expect(Object.keys(JSON.parse(JSON.stringify(g.history))).sort()).toEqual(['canRedo','canUndo','undoLabel']);
 });
 it.each(['UNDO_ACTION','REDO_ACTION'] as const)('rejects %s without processing server history or mutating state',type=>{
  for(const phase of ['LOBBY','BLACK_ROSE','STUDY','PREPARATION','ACTION','EVOCATION','CLEANUP'] as const) {
   const g=actionFixture();g.phase=phase;g.history={canUndo:true,canRedo:true,undoLabel:'Attack',redoLabel:'Spell'};
   reject(g,{type,playerId:'p1'},/intercepted by the server/);
  }
 });
});

describe('capacity-dependent triple prizes and finite dense rankings',()=>{
 it.each([[4,[2,1,0]],[5,[4,2,1]],[6,[5,3,1]],[10,[6,3,1]]] as const)('returns capacity %i prizes', (capacity,rewards)=>{
  expect(getRoomRewards(capacity)).toEqual(rewards);
  const changed=getRoomRewards(capacity);changed[0]=999;expect(getRoomRewards(capacity)).toEqual(rewards);
 });
 it('rejects unsupported printed capacities rather than silently inventing prizes',()=>{
  expect(()=>getRoomRewards(7)).toThrow(/Unsupported room capacity/);
 });
 it('keeps 18 colored rooms, six colors times three, and deterministic capacity distribution',()=>{
  const a=createGame().board,b=createGame().board,colored=a.rooms.filter(r=>r.color!==null);
  expect(colored).toHaveLength(18);for(const color of ROOM_COLORS)expect(colored.filter(r=>r.color===color)).toHaveLength(3);
  expect([4,5,6].map(n=>colored.filter(r=>r.instabilityLimit===n).length)).toEqual([3,12,3]);
  expect(a.rooms.map(r=>[r.id,r.instabilityLimit,r.rewards])).toEqual(b.rooms.map(r=>[r.id,r.instabilityLimit,r.rewards]));
  expect(a.rooms.find(r=>r.id==='room-0,0')).toMatchObject({instabilityLimit:10,rewards:[6,3,1]});
  expect(a.rooms.filter(r=>r.startingFor)).toHaveLength(4);
  for(const r of colored)expect(r.rewards).toEqual(getRoomRewards(r.instabilityLimit));
 });
 it('includes Pink Tulip in dense contribution ranks and returns no awards for zero or negative counts',()=>{
  expect(getContributionAwards({p1:4,p2:4,[BLACK_ROSE_ID]:1,p3:0,p4:-1},ENDGAME_REWARDS)).toEqual([
   {playerId:'p1',cubes:4,rank:1,tied:true,points:3},
   {playerId:'p2',cubes:4,rank:1,tied:true,points:3},
   {playerId:BLACK_ROSE_ID,cubes:1,rank:2,tied:false,points:2},
  ]);
  expect(getContributionAwards({},ENDGAME_REWARDS)).toEqual([]);
 });
 it('keeps explicit zero prizes zero even when tied, and ranks beyond the table never receive an endless one',()=>{
  expect(getContributionAwards({p1:5,p2:4,p3:3,p4:3,[BLACK_ROSE_ID]:1},[2,1,0]).map(a=>a.points)).toEqual([2,1,0,0,0]);
  expect(getContributionAwards({p1:2,p2:2},[1]).map(a=>a.points)).toEqual([1,1]);
  expect(getContributionAwards({p1:1},[])[0].points).toBe(0);
 });
 it('reports Pink Tulip room majorities alone or tied, never zero-count winners',()=>{
  expect(getRoomMajorityWinners({cubesByPlayer:{p1:1,[BLACK_ROSE_ID]:3}})).toEqual([BLACK_ROSE_ID]);
  expect(getRoomMajorityWinners({cubesByPlayer:{p1:3,[BLACK_ROSE_ID]:3,p2:0}})).toEqual(['p1',BLACK_ROSE_ID]);
  expect(getRoomMajorityWinners({cubesByPlayer:{p1:0,[BLACK_ROSE_ID]:0}})).toEqual([]);
 });
});

describe('endgame timing, majorities and deterministic victory',()=>{
 it.each([1,2])('does not end below 30 after round %i, even if a future majority could cross 30',round=>{
  const g=actionFixture();g.round=round;player(g).victoryPoints=29;player(g).kills=9;g.firstPlayerId='p1';
  const n=settle(g);expect(n.phase).toBe('CLEANUP');expect(n.endgameScored).toBe(false);expect(player(n).victoryPoints).toBe(29);
 });
 it.each([3,4])('ends at Cleanup on round %i without requiring 30 VP, awards no zero-count prizes',round=>{
  const g=actionFixture();g.round=round;g.firstPlayerId='p2';const n=settle(g);
  expect(n.phase).toBe('GAME_OVER');expect(n.endgameScored).toBe(true);expect(n.winner).toBe('p2');
  expect(n.players.map(p=>p.victoryPoints)).toEqual([0,1,0,0]);expect(n.blackRose).toEqual({victoryPoints:0,kills:0});
  expect(n.log.filter(l=>l.includes('endgame')&&l.includes('majority'))).toEqual([]);
 });
 it('breaks equal final scores deterministically by player seating order before Pink Tulip',()=>{
  const g=actionFixture();g.round=3;g.blackRose.victoryPoints=30;player(g).victoryPoints=30;player(g,'p2').victoryPoints=30;
  const n=settle(g);expect(n.winner).toBe('p1');expect(n.players.map(p=>p.victoryPoints)).toEqual([30,30,0,0]);
 });
 it('waits for the last free evocation before resolving a 30-point or round-limit endgame',()=>{
  let g=actionFixture(2);g.round=3;player(g).victoryPoints=30;
  g.evocations=[{id:'last-model',number:1,playerId:'p1',name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:2,passive:'WOUNDED_FURY',position:{q:0,r:0},damageCubes:0,damageByPlayer:{},activated:false}];
  g=settle(g);expect(g.phase).toBe('EVOCATION');expect(g.endgameScored).toBe(false);
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'last-model'});expect(g.phase).toBe('EVOCATION');expect(g.endgameScored).toBe(false);
  g=applyAction(g,{type:'END_EVOCATION',playerId:'p1'});expect(g.phase).toBe('GAME_OVER');expect(g.endgameScored).toBe(true);
 });
});