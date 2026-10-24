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
 const card={...g.library[0].cards.shift()!,damage:0,instability:0,range:4,target:'ROOM' as const,...changes};
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
 it('initializes scoring state and captures the first seated mage when START_GAME succeeds',()=>{
  let g=createGame(3);expect(g.blackRose).toEqual({victoryPoints:0,kills:0});expect(g.firstPlayerId).toBeNull();expect(g.endgameScored).toBe(false);
  expect(g.history).toBeUndefined();expect(BLACK_ROSE_ID).toBe('black-rose');expect(ENDGAME_REWARDS).toEqual([4,2,1]);
  for(const p of g.players){expect(p.hand).toEqual([]);expect(p.personalDeck).toEqual([]);expect(p.discard).toEqual([]);}
  conservation(g);const startingCards=g.library[0].cards.slice(0,21);
  for(const p of g.players)p.connected=true;
  for(const p of g.players){g=applyAction(g,{type:'SELECT_STARTING_SCHOOL',playerId:p.id,schoolId:'cantrip'});g=applyAction(g,{type:'SET_READY',playerId:p.id,ready:true});}
  g.hostId='p2';g=applyAction(g,{type:'START_GAME',playerId:'p2'});expect(g.firstPlayerId).toBe('p1');
  for(const [i,p] of g.players.entries()) {
   expect(p.hand).toEqual([]);expect(p.personalDeck).toEqual(startingCards.slice(i*7,i*7+6));expect(p.discard).toEqual([startingCards[i*7+6]]);
   expect([...p.personalDeck,...p.discard].every(c=>c.schoolId==='cantrip')).toBe(true);
  }
  expect(g.library[0].cards).toHaveLength(15);expect(g.library[0].discard).toEqual([]);
  conservation(g);
 });
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
 it('includes Black Rose in dense contribution ranks and returns no awards for zero or negative counts',()=>{
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
 it('reports Black Rose room majorities alone or tied, never zero-count winners',()=>{
  expect(getRoomMajorityWinners({cubesByPlayer:{p1:1,[BLACK_ROSE_ID]:3}})).toEqual([BLACK_ROSE_ID]);
  expect(getRoomMajorityWinners({cubesByPlayer:{p1:3,[BLACK_ROSE_ID]:3,p2:0}})).toEqual(['p1',BLACK_ROSE_ID]);
  expect(getRoomMajorityWinners({cubesByPlayer:{p1:0,[BLACK_ROSE_ID]:0}})).toEqual([]);
 });
});

describe('Black Rose defeat contributions and kills',()=>{
 it('wins a black-only defeat, gets kill credit but never the player-only solo-color bonus or physical cubes',()=>{
  const g=neutralDefeat({},9);expect(g.blackRose).toEqual({victoryPoints:4,kills:1});
  expect(g.players.map(p=>p.victoryPoints)).toEqual([0,0,0,0]);conservation(g);
 });
 it('can lead a damage ranking while a player receives second prize and the final-hit kill',()=>{
  let g=actionFixture();const victim=player(g,'p2');victim.wizard.damageCubes=8;victim.wizard.blackDamage=8;
  prepare(g,{target:'MODEL',damage:2});player(g,'p3').actionTokens=1;
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
  expect(g.blackRose).toEqual({victoryPoints:4,kills:0});expect(player(g).victoryPoints).toBe(2);expect(player(g).kills).toBe(1);
  expect(victim.wizard.damageCubes).toBe(8);expect(player(g,'p2').wizard).toMatchObject({damageCubes:0,blackDamage:0,damageByPlayer:{}});conservation(g);
 });
 it('applies ties between black damage and player cubes, and only returns actual players cubes',()=>{
  const g=neutralDefeat({p1:4,p2:1},3);
  expect(g.players.map(p=>p.victoryPoints)).toEqual([3,2,0,0]);expect(g.blackRose).toEqual({victoryPoints:3,kills:1});
  expect(g.players.every(p=>p.cubes.available===25&&p.cubes.onWizard===0)).toBe(true);conservation(g);
 });
 it('gives fourth distinct damage rank zero without withholding the returned physical cubes',()=>{
  const g=neutralDefeat({p1:4,p2:3,p3:2},0);
  expect(g.players.map(p=>p.victoryPoints)).toEqual([4,2,1,0]);expect(g.blackRose).toEqual({victoryPoints:0,kills:1});conservation(g);
 });
});

describe('room completion and Cleanup reconstruction',()=>{
 it('locks capacity immediately, preserves finisher bonuses/quests, but keeps ordinary Grey effects until Cleanup',()=>{
  let g=actionFixture(2);const source=g.board.rooms.find(r=>r.color==='grey')!,id=source.id;
  placeLedger(g,source,{p1:source.instabilityLimit-2});player(g).wizard.position={...source.tiles[0]};player(g).actionTokens=1;
  player(g).quest={id:'rebuild-now',name:'Rebuild now',description:'Rebuild',kind:'REBUILD',amount:1,reward:3};
  prepare(g,{instability:2},'p1','slot1');prepare(g,{instability:4},'p2');
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:id});
  expect(room(g,id)).toMatchObject({instability:source.instabilityLimit,reconstructed:false,scored:false,specialUsed:false});
  expect(player(g).victoryPoints).toBe(4);expect(player(g).questsCompleted).toBe(1);expect(player(g).cubes.onBoard).toBe(source.instabilityLimit);
  expect(g.log.some(l=>l.includes('wait until Cleanup'))).toBe(true);
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});expect(g.evocations).toHaveLength(1);
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});const otherSupply=player(g,'p2').cubes.available;
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p2',slot:'rapid',roomId:id});
  expect(room(g,id).cubesByPlayer).toEqual({p1:source.instabilityLimit});expect(player(g,'p2').cubes.available).toBe(otherSupply);
  expect(room(g,id).reconstructed).toBe(false);expect(g.phase).toBe('EVOCATION');
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:g.evocations[0].id});g=applyAction(g,{type:'END_EVOCATION',playerId:'p1'});
  expect(g.phase).toBe('CLEANUP');expect(room(g,id)).toMatchObject({reconstructed:true,scored:true,specialUsed:false});
  expect(player(g).victoryPoints).toBe(4+getRoomRewards(source.instabilityLimit)[0]);expect(player(g).cubes.available).toBe(25);
  expect(room(g,id).cubesByPlayer).toEqual({p1:source.instabilityLimit});
  expect(g.log.filter(l=>l.includes('completes “Rebuild now”'))).toHaveLength(1);conservation(g);
 });
 it.each([4,5,6,10])('scores completed capacity-%i rooms including Black Rose, only once, retaining historical ledgers',capacity=>{
  let g=actionFixture();const source=g.board.rooms.find(r=>!r.startingFor&&r.instabilityLimit===capacity)!;
  placeLedger(g,source,{[BLACK_ROSE_ID]:capacity-2,p1:1,p2:1});const ledger=structuredClone(source.cubesByPlayer);
    g=settle(g);const rewards=getRoomRewards(capacity);
    expect(g.blackRose.victoryPoints).toBe(rewards[0]);expect(player(g).victoryPoints).toBe(Math.max(1,rewards[1]-1));
  expect(room(g,source.id)).toMatchObject({reconstructed:true,scored:true,cubesByPlayer:ledger});conservation(g);
  const before=g.players.map(p=>p.victoryPoints),black=g.blackRose.victoryPoints;
  // Replay a Cleanup boundary fixture, retaining the authoritative scored guards.
  g.phase='ACTION';g.currentPlayerId='p1';g.activation=actionFixture().activation;g=settle(g);
  expect(g.players.map(p=>p.victoryPoints)).toEqual(before);expect(g.blackRose.victoryPoints).toBe(black);conservation(g);
 });
 it('does not rebuild incomplete rooms and honors legacy reconstructed-but-unscored fixtures at Cleanup',()=>{
  let g=actionFixture();const [incomplete,legacy]=g.board.rooms.filter(r=>r.color==='crimson');
  placeLedger(g,incomplete,{p1:1});placeLedger(g,legacy,{p2:1});legacy.reconstructed=true;
  g=settle(g);expect(room(g,incomplete.id)).toMatchObject({reconstructed:false,scored:false});
  expect(room(g,legacy.id).scored).toBe(true);expect(player(g).cubes.onBoard).toBe(1);expect(player(g,'p2').cubes.available).toBe(25);
  expect(player(g,'p2').victoryPoints).toBe(legacy.rewards[0]);conservation(g);
 });
 it('keeps Black Rose event completions pending and excludes already-full rooms from future event placements',()=>{
  let g=createGame(2);
  for(const p of g.players)p.connected=true;
  g=applyAction(g,{type:'SET_ROOM_COUNT',playerId:'p1',roomsPerColor:3});
  for(const p of g.players){g=applyAction(g,{type:'SELECT_STARTING_SCHOOL',playerId:p.id,schoolId:'cantrip'});g=applyAction(g,{type:'SET_READY',playerId:p.id,ready:true});}
  g.eventDeck=[{id:'quiet',name:'Quiet',description:'No effect',kind:'INSTABILITY',amount:0,rooms:0}];
  g=applyAction(g,{type:'START_GAME',playerId:'p1'});
  const [full,almost]=g.board.rooms.filter(r=>r.color==='crimson');
  for(const r of g.board.rooms)if(!r.startingFor&&r.id!==full.id&&r.id!==almost.id){r.reconstructed=true;r.scored=true;}
  placeLedger(g,full,{[BLACK_ROSE_ID]:full.instabilityLimit});placeLedger(g,almost,{[BLACK_ROSE_ID]:almost.instabilityLimit-1});
  // START builds a fresh board. Isolate a later event boundary to retain the
  // pre-existing full/incomplete-room regression without overwriting that setup.
  g.phase='CLEANUP';g.eventDeck=[{id:'event-fill',name:'Fill',description:'Instability',kind:'INSTABILITY',amount:3,rooms:99}];
  g=applyAction(g,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:'CLEANUP',expectedRound:1});
  expect(room(g,full.id)).toMatchObject({reconstructed:false,scored:false,instability:full.instabilityLimit});
  expect(room(g,almost.id)).toMatchObject({reconstructed:false,scored:false,instability:almost.instabilityLimit});
  expect(g.log.filter(l=>l.includes('places 1 instability'))).toHaveLength(1);expect(g.blackRose.victoryPoints).toBe(0);
  // Isolate the phase boundary; all event-filled rooms still await real Cleanup settlement.
  g.phase='ACTION';g.currentPlayerId='p1';g.activation=actionFixture().activation;
  for(const p of g.players){p.actionTokens=0;p.wizard.position={q:0,r:0};}
  g=settle(g);expect(g.blackRose.victoryPoints).toBe(full.rewards[0]+almost.rewards[0]);
  expect(g.players.every(p=>p.victoryPoints===0)).toBe(true);conservation(g);
 });
 it('gives an explicit third-place zero prize at capacity four, but returns that contributor cube',()=>{
  let g=actionFixture();const source=g.board.rooms.find(r=>r.color&&r.instabilityLimit===4)!;
  // Legacy fixture permits three distinct ranks despite the printed capacity.
  placeLedger(g,source,{p1:3,p2:2,[BLACK_ROSE_ID]:1});source.reconstructed=true;
  g=settle(g);expect(g.players.map(p=>p.victoryPoints)).toEqual([2,1,0,0]);expect(g.blackRose.victoryPoints).toBe(0);conservation(g);
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
 it('ranks nonzero kills including Black Rose and quests excluding it using dense 4/2/1 prizes',()=>{
  const g=actionFixture();g.round=3;g.firstPlayerId='p2';
  [5,5,2,0].forEach((n,i)=>g.players[i].kills=n);g.blackRose.kills=1;
  [3,1,1,0].forEach((n,i)=>g.players[i].questsCompleted=n);
  const n=settle(g);expect(n.players.map(p=>p.victoryPoints)).toEqual([7,5,3,0]);expect(n.blackRose.victoryPoints).toBe(1);expect(n.winner).toBe('p1');
  expect(n.log.some(l=>l.includes('Black Rose: +1 VP for endgame kills majority'))).toBe(true);
  expect(n.log.some(l=>l.includes('Black Rose')&&l.includes('quests majority'))).toBe(false);
 });
 it('awards no fourth or fifth distinct endgame rank, including Black Rose, even with nonzero counts',()=>{
  const g=actionFixture();g.round=3;
  [5,4,3,2].forEach((n,i)=>{g.players[i].kills=n;g.players[i].questsCompleted=n;});g.blackRose.kills=1;
  const n=settle(g);expect(n.players.map(p=>p.victoryPoints)).toEqual([8,4,2,0]);expect(n.blackRose.victoryPoints).toBe(0);
 });
 it('reduces a tied human/Black Rose kill majority by exactly one and preserves dense second rank',()=>{
  const g=actionFixture();g.round=3;player(g).kills=2;g.blackRose.kills=2;player(g,'p2').kills=1;
  const n=settle(g);expect(n.players.map(p=>p.victoryPoints)).toEqual([3,2,0,0]);expect(n.blackRose.victoryPoints).toBe(3);expect(n.winner).toBe('p1');
 });
 it('scores room VP before the 30-point trigger and compares scores only after endgame awards',()=>{
  const g=actionFixture();const source=g.board.rooms.find(r=>r.color==='crimson')!;placeLedger(g,source,{p1:source.instabilityLimit});
  player(g).victoryPoints=26;player(g,'p2').victoryPoints=29;player(g,'p2').kills=1;player(g,'p2').questsCompleted=1;g.firstPlayerId='p2';
  const n=settle(g);expect(n.phase).toBe('GAME_OVER');expect(player(n).victoryPoints).toBe(30);expect(player(n,'p2').victoryPoints).toBe(38);expect(n.winner).toBe('p2');conservation(n);
 });
 it('allows Black Rose alone to trigger 30 at Cleanup and win after kill-majority awards',()=>{
  const g=actionFixture();const source=g.board.rooms.find(r=>r.color==='crimson')!;placeLedger(g,source,{[BLACK_ROSE_ID]:source.instabilityLimit});
  g.blackRose={victoryPoints:26,kills:2};player(g).victoryPoints=29;player(g).kills=1;g.firstPlayerId='p1';
  const n=settle(g);expect(n.phase).toBe('GAME_OVER');expect(n.blackRose).toEqual({victoryPoints:34,kills:2});expect(player(n).victoryPoints).toBe(32);expect(n.winner).toBe(BLACK_ROSE_ID);
  const blackOnly=actionFixture();blackOnly.blackRose.victoryPoints=30;
  const winner=settle(blackOnly);expect(winner.winner).toBe(BLACK_ROSE_ID);expect(winner.endgameScored).toBe(true);
 });
 it('breaks equal final scores deterministically by player seating order before Black Rose',()=>{
  const g=actionFixture();g.round=3;g.blackRose.victoryPoints=30;player(g).victoryPoints=30;player(g,'p2').victoryPoints=30;
  const n=settle(g);expect(n.winner).toBe('p1');expect(n.players.map(p=>p.victoryPoints)).toEqual([30,30,0,0]);
 });
 it('does not award twice, rejects further game actions, and is guarded even in replayed Cleanup fixtures',()=>{
  const g=actionFixture();g.round=3;g.firstPlayerId='p1';player(g).kills=2;player(g).questsCompleted=1;
  let n=settle(g);expect(player(n).victoryPoints).toBe(9);const log=[...n.log];
  reject(n,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:'GAME_OVER',expectedRound:3},/game is over/);
  n.phase='ACTION';n.currentPlayerId='p1';n.activation=actionFixture().activation;n=settle(n);
  expect(player(n).victoryPoints).toBe(9);expect(n.blackRose.victoryPoints).toBe(0);
  expect(n.log.filter(l=>l.includes('VP for endgame')||l.includes('first-player token'))).toEqual(log.filter(l=>l.includes('VP for endgame')||l.includes('first-player token')));
 });
 it('defers a human reaching 30 during an action until all actions and evocations finish',()=>{
  let g=actionFixture(2);player(g).victoryPoints=29;player(g,'p2').actionTokens=1;
  player(g).quest={id:'finish',name:'Final quest',description:'Instability',kind:'INSTABILITY',amount:1,reward:1};prepare(g,{instability:1});
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});expect(player(g).victoryPoints).toBe(30);expect(g.phase).toBe('ACTION');expect(g.endgameScored).toBe(false);
  g=applyAction(g,{type:'EXPLORE',playerId:'p2'});g=applyAction(g,{type:'END_EXPLORE',playerId:'p2'});expect(g.phase).toBe('GAME_OVER');expect(player(g).victoryPoints).toBe(34);
 });
 it('waits for the last free evocation before resolving a 30-point or round-limit endgame',()=>{
  let g=actionFixture(2);g.round=3;player(g).victoryPoints=30;
  g.evocations=[{id:'last-model',number:1,playerId:'p1',name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:2,passive:'WOUNDED_FURY',position:{q:0,r:0},damageCubes:0,damageByPlayer:{},activated:false}];
  g=settle(g);expect(g.phase).toBe('EVOCATION');expect(g.endgameScored).toBe(false);
  g=applyAction(g,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'last-model'});expect(g.phase).toBe('EVOCATION');expect(g.endgameScored).toBe(false);
  g=applyAction(g,{type:'END_EVOCATION',playerId:'p1'});expect(g.phase).toBe('GAME_OVER');expect(g.endgameScored).toBe(true);
 });
});

describe('power preparation, supply exhaustion, quest logs and model numbers',()=>{
 it('held powers do not enable actions or block passing; unused preparations do block passing',()=>{
  const g=actionFixture(2),power=g.powerfulDeck.shift()!;player(g).hand.push(power);
  expect(ROOM_EFFECT_LABELS.DRAW_POWERFUL).toMatch(/prepare.*later Preparation/);
  expect(canPlayerAct(g,player(g))).toBe(false);expect(canPassActionPhase(g,player(g))).toBe(true);
  reject(g,{type:'CAST_POWERFUL_SPELL',playerId:'p1',cardId:power.id,roomId:'room-0,0'},/cannot be cast from hand.*prepare/);
  const passed=settle(g);expect(passed.phase).toBe('CLEANUP');expect(player(passed).hand).toEqual([power]);conservation(passed);
  player(g).hand=[];player(g).prepared.rapid={card:power,used:false};
  expect(canPlayerAct(g,player(g))).toBe(true);expect(canPassActionPhase(g,player(g))).toBe(false);
  const n=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0',...(power.target==='MODEL'?{dummy:true}:{})});
  expect(n.removedCards).toEqual([power]);expect(n.players.flatMap(p=>p.discard)).not.toContainEqual(power);conservation(n);
 });
 it.each([0,1,2,3])('caps room and mage cube placement at a shared remaining supply of %i without reducing wounds',available=>{
  let g=actionFixture(2);player(g).cubes.available=available;player(g).cubes.onBoard=25-available;
  const storage=g.board.rooms.find(r=>r.color==='grey')!;storage.instabilityLimit=30;storage.instability=25-available;storage.cubesByPlayer={p1:25-available};
  player(g,'p2').wizard.health=20;player(g,'p2').actionTokens=1;prepare(g,{damage:4,instability:2});
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
  expect(room(g,'room-0,0').instability).toBe(Math.min(2,available));expect(player(g,'p2').wizard.damageCubes).toBe(4);
  expect(player(g,'p2').wizard.damageByPlayer.p1??0).toBe(Math.max(0,available-2));expect(player(g).cubes.available).toBe(0);conservation(g);
 });
 it('logs each completed matching quest with its name and reward exactly once, retaining unmet quests',()=>{
  let g=actionFixture(2);player(g,'p2').actionTokens=1;
  const quest=(id:string,amount:number,reward:number)=>({id,name:id,description:id,kind:'INSTABILITY' as const,amount,reward});
  player(g).quest=quest('First fracture',2,2);player(g).additionalQuests=[quest('Second fracture',2,3),quest('Unmet fracture',3,5)];
  prepare(g,{instability:2},'p1','slot1');prepare(g,{instability:1});
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0'});
  expect(g.log).toContain('Crimson Mage completes “First fracture”: +2 VP.');expect(g.log).toContain('Crimson Mage completes “Second fracture”: +3 VP.');
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
  expect(g.log.filter(l=>l.includes('completes “'))).toHaveLength(2);expect(player(g).questsCompleted).toBe(2);expect(player(g).quest?.name).toBe('Unmet fracture');
  expect(g.questDiscard.map(q=>q.name)).toEqual(['First fracture','Second fracture']);conservation(g);
 });
 it('logs a final-hitter kill quest once, without attributing it to the Black Rose damage leader',()=>{
  let g=actionFixture(2);player(g,'p2').wizard.damageCubes=9;player(g,'p2').wizard.blackDamage=9;
  player(g).quest={id:'kill-log',name:'Last thorn',description:'Defeat a mage',kind:'KILL',amount:1,reward:3};prepare(g,{target:'MODEL',damage:1});
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
  expect(g.log.filter(l=>l.includes('completes “Last thorn”'))).toEqual(['Crimson Mage completes “Last thorn”: +3 VP.']);
  expect(g.blackRose).toEqual({victoryPoints:4,kills:0});expect(player(g)).toMatchObject({kills:1,questsCompleted:1,victoryPoints:5,quest:null});conservation(g);
 });
 it('reuses the lowest free owner-local slot without renumbering surviving evocations',()=>{
  let g=actionFixture(2);const grey=g.board.rooms.find(r=>r.color==='grey')!;
  for(const p of g.players){p.wizard.position={...grey.tiles[0]};p.actionTokens=1;}
  const cadaver=(id:string,number:number,owner='p1'):Evocation=>({id,number,playerId:owner,name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:2,passive:'WOUNDED_FURY',position:{...grey.tiles[0]},damageCubes:0,damageByPlayer:{},activated:false});
  g.evocations=[cadaver('one',1),cadaver('two',2),cadaver('three',3),cadaver('enemy-one',1,'p2')];
  g.currentPlayerId='p2';g.activation!.playerId='p2';const survivors=structuredClone([g.evocations[0],g.evocations[2]]);
  g=applyAction(g,{type:'PUNCH',playerId:'p2',targetId:'two'});expect(g.currentPlayerId).toBe('p1');
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  expect(g.evocations.filter(e=>e.playerId==='p1').map(e=>e.number)).toEqual([1,3,2]);
  expect(g.evocations.filter(e=>e.id==='one'||e.id==='three')).toEqual(survivors);
  expect(g.evocations.find(e=>e.id==='enemy-one')!.number).toBe(1);conservation(g);
 });
});