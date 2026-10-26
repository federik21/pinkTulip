import { moment } from '../src/cards';
import { describe, expect, it } from 'vitest';
import { addPlayerToLobby, applyAction, canStartGame, createGame, hexKey } from '../src';
import type { GameState } from '../src';

function actionFixture(count=4) {
 const g=createGame(count);g.phase='ACTION';g.round=1;g.currentPlayerId='p1';
 g.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of g.players){p.wizard.position={q:0,r:0};p.actionTokens=0;}
 return g;
}
function settleRoom(contributions:Record<string,number>,central=false) {
 const g=actionFixture();
 const r=g.board.rooms.find(r=>central?r.id==='room-0,0':!r.startingFor&&r.id!=='room-0,0')!;
 r.reconstructed=true;r.cubesByPlayer={...contributions};r.instability=Object.values(contributions).reduce((n,c)=>n+c,0);
 for(const p of g.players){const n=contributions[p.id]??0;p.cubes.available-=n;p.cubes.onBoard=n;}
 return {g:applyAction(g,{type:'PASS_ROUND',playerId:'p1'}),roomId:r.id};
}
function defeat(contributions:Record<string,number>,black=0) {
 const g=actionFixture();const victim=g.players[3];
 victim.wizard.damageByPlayer={...contributions};victim.wizard.blackDamage=black;
 victim.wizard.damageCubes=Object.values(contributions).reduce((n,c)=>n+c,0)+black;
 for(const p of g.players){const n=contributions[p.id]??0;p.cubes.available-=n;p.cubes.onWizard=n;}
 // A real neutral event supplies the final point, preserving the specified rank totals.
 g.phase='CLEANUP';g.currentPlayerId=null;g.activation=null;
 g.eventDeck=[{id:'finisher',name:'Thorns',description:'One black damage',kind:'BLACK_DAMAGE',amount:1,rooms:0}];
 return applyAction(g,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:'CLEANUP',expectedRound:1});
}

describe('two to four mage setup',()=>{
 it.each([1,2,3,4])('creates %i unique seats without sharing cards or starting spaces',count=>{
  const g=createGame(count);
  expect(g.players).toHaveLength(count);
  expect(new Set(g.players.map(p=>hexKey(p.wizard.position))).size).toBe(count);
  for(const p of g.players) {
   expect(p.personalDeck).toEqual([]);expect(p.hand).toEqual([]);expect(p.discard).toEqual([]);
  }
  const cards=[...g.library.flatMap(d=>[...d.cards,...d.discard]),...g.powerfulDeck];
  expect(cards).toHaveLength(120);expect(new Set(cards.map(c=>c.id)).size).toBe(120);
  expect(cards.filter(c=>!c.powerful)).toHaveLength(108);expect(cards.filter(c=>c.powerful)).toHaveLength(12);
  expect(cards.some(c=>/^p[1-4]-/.test(c.id))).toBe(false);
  expect(g.players.every(p=>g.board.rooms.find(r=>r.id===p.wizard.startingRoomId)?.startingFor===p.id)).toBe(true);
 });

 it('waits for a second participant and every joined mage, then supports all four ready seats',()=>{
  let g=createGame(1);g.players[0].connected=true;
  g=applyAction(g,{type:'SELECT_STARTING_SCHOOL',playerId:'p1',schoolId:'cantrip'});
  g=applyAction(g,{type:'SET_READY',playerId:'p1',ready:true});
  expect(canStartGame(g)).toBe(false);
  expect(()=>applyAction(g,{type:'START_GAME',playerId:'p1'})).toThrow(/At least 2/);
  for(let count=2;count<=4;count++) {
   const before=structuredClone(g);const joined=addPlayerToLobby(g);expect(g).toEqual(before);g=joined;
    expect(g.players[count-1]).toMatchObject({hand:[],personalDeck:[],discard:[]});
    expect(g.library).toEqual(before.library);expect(g.powerfulDeck).toEqual(before.powerfulDeck);
  expect(canStartGame(g)).toBe(false);g.players[count-1].connected=true;
  g=applyAction(g,{type:'SELECT_STARTING_SCHOOL',playerId:`p${count}`,schoolId:'cantrip'});
  g=applyAction(g,{type:'SET_READY',playerId:`p${count}`,ready:true});
   expect(canStartGame(g)).toBe(true);
  }
  expect(()=>addPlayerToLobby(g)).toThrow(/full/);
  const stock=[...g.library[0].cards];
  g=applyAction(g,{type:'START_GAME',playerId:'p1'});expect(g.phase).toBe('BLACK_ROSE');
  for(const [i,p] of g.players.entries()) {
   expect(p.hand).toEqual([]);expect(p.personalDeck).toEqual(stock.slice(7*i,7*i+6));expect(p.discard).toEqual([stock[7*i+6]]);
   expect([...p.personalDeck,...p.discard].every(c=>c.schoolId==='cantrip')).toBe(true);
  }
  expect(g.library[0].cards).toEqual(stock.slice(28));expect(g.library[0].discard).toEqual([]);
  const cards=[...g.library.flatMap(d=>[...d.cards,...d.discard]),...g.powerfulDeck,...g.players.flatMap(p=>[...p.personalDeck,...p.hand,...p.discard])];
  expect(cards).toHaveLength(120);expect(new Set(cards.map(c=>c.id)).size).toBe(120);
  expect(()=>addPlayerToLobby(g)).toThrow(/in progress/);
 });

 it('gives all rooms unique non-coordinate names that stay stable through actions',()=>{
  let g=createGame();const names=g.board.rooms.map(r=>r.name);
  expect(new Set(names).size).toBe(23);expect(names).toContain('Pink Tulip Chamber');
  expect(names.every(n=>!/-?\d+,\s*-?\d+/.test(n))).toBe(true);
  g.players[0].connected=true;
  g=applyAction(g,{type:'SELECT_STARTING_SCHOOL',playerId:'p1',schoolId:'cantrip'});
  expect(applyAction(g,{type:'SET_READY',playerId:'p1',ready:true}).board.rooms.map(r=>r.name)).toEqual(names);
 });
});

describe('dense contribution ranks and tie reduction',()=>{
 it('gives tied defeat leaders 3 each, then tied one-cube mage and Pink Tulip second-rank 1 each',()=>{
  const g=defeat({p1:4,p2:4,p3:1});
  expect(g.players.map(p=>p.victoryPoints)).toEqual([3,3,1,0]);expect(g.blackRose).toEqual({victoryPoints:1,kills:1});
  expect(g.players.every(p=>p.cubes.onWizard===0&&p.cubes.available===25)).toBe(true);
 });
 it('keeps untied defeat prizes 4/2/1',()=>{
  expect(defeat({p1:5,p2:3,p3:1}).players.map(p=>p.victoryPoints)).toEqual([4,2,1,0]);
 });
 it('reduces tied second-rank defeat prizes to the minimum of 1',()=>{
  expect(defeat({p1:5,p2:2,p3:2}).players.map(p=>p.victoryPoints)).toEqual([4,1,1,0]);
 });
 it('deducts one for a three-way tie, not one per extra tied contributor',()=>{
  expect(defeat({p1:3,p2:3,p3:3}).players.map(p=>p.victoryPoints)).toEqual([3,3,3,0]);
 });
 it('applies dense ties and the room minimum including Pink Tulip in ranking',()=>{
  const {g}=settleRoom({p1:2,p2:2,p3:1});
  expect(g.players.map(p=>p.victoryPoints)).toEqual([3,3,2,0]);
  expect(g.players.every(p=>p.cubes.onBoard===0&&p.cubes.available===25)).toBe(true);
    const tied=settleRoom({p1:1,p2:1,p3:1,p4:1,'black-rose':1}).g;
    expect(tied.players.map(p=>p.victoryPoints)).toEqual([3,3,3,3]);expect(tied.blackRose.victoryPoints).toBe(3);
 });
 it('retains the central room reward values and does not skip second rank behind tied leaders',()=>{
  expect(settleRoom({p1:4,p2:4,p3:2},true).g.players.map(p=>p.victoryPoints)).toEqual([5,5,3,0]);
 });
 it('never gives noncontributors a room award, and never scores a room twice',()=>{
  let {g,roomId}=settleRoom({p1:4,'black-rose':1});
    expect(g.players.map(p=>p.victoryPoints)).toEqual([4,0,0,0]);expect(g.blackRose.victoryPoints).toBe(2);
  g.phase='ACTION';g.currentPlayerId='p1';g.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
  g=applyAction(g,{type:'PASS_ROUND',playerId:'p1'});
  expect(g.board.rooms.find(r=>r.id===roomId)?.scored).toBe(true);
    expect(g.players.map(p=>p.victoryPoints)).toEqual([4,0,0,0]);expect(g.blackRose.victoryPoints).toBe(2);
 });
});

describe('exclusive color completion bonuses',()=>{
 function finishRoom(neutral:number) {
  const g=actionFixture(2),r=g.board.rooms.find(r=>!r.startingFor&&r.id!=='room-0,0')!;
  g.players[0].wizard.position={...r.tiles[0]};g.players[1].actionTokens=2;
    const placed=r.instabilityLimit-1;
    r.instability=placed;r.cubesByPlayer={p1:placed-neutral,...(neutral?{'black-rose':neutral}:{})};
    g.players[0].cubes.onBoard=placed-neutral;g.players[0].cubes.available-=placed-neutral;
  const card={...g.library[0].cards.shift()!,target:'ROOM' as const,range:0,moments:[moment.instability(1)]};
  g.players[0].prepared.slot1={card,used:false};
  return {g:applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:r.id}),roomId:r.id};
 }
 it('awards one immediate VP for completing an entirely one-color room, once only',()=>{
  let {g,roomId}=finishRoom(0);
    expect(g.players[0].victoryPoints).toBe(1);expect(g.board.rooms.find(r=>r.id===roomId)?.reconstructed).toBe(false);
  // Exhaust the other mage through real actions, then score the finished room at Cleanup.
  for(let i=0;i<2;i++){g=applyAction(g,{type:'EXPLORE',playerId:'p2'});g=applyAction(g,{type:'END_EXPLORE',playerId:'p2'});}
    expect(g.phase).toBe('CLEANUP');expect(g.players[0].victoryPoints).toBe(5);expect(g.board.rooms.find(r=>r.id===roomId)?.reconstructed).toBe(true);
 });
 it('does not award the exclusive room bonus when neutral cubes contributed',()=>{
  expect(finishRoom(1).g.players[0].victoryPoints).toBe(0);
 });
 it('adds one to a solo all-colored defeat, but not to a neutral-finisher defeat',()=>{
  let g=actionFixture(2);g.players[0].actionTokens=2;
  const victim=g.players[1];victim.wizard.damageCubes=8;victim.wizard.damageByPlayer={p1:8};
  g.players[0].cubes.available=17;g.players[0].cubes.onWizard=8;
  g=applyAction(g,{type:'PUNCH',playerId:'p1',targetId:'p2'});
  expect(g.players[0].victoryPoints).toBe(5);expect(g.players[0].kills).toBe(1);
  expect(g.players[0].cubes.available).toBe(25);expect(g.players[0].cubes.onWizard).toBe(0);
  expect(defeat({p1:9}).players[0].victoryPoints).toBe(4);
 });
 it('does not award a solo defeat bonus for unplaced damage after cube supply runs out',()=>{
  let g=actionFixture(2);g.players[0].actionTokens=2;
  g.players[1].wizard.damageCubes=8;g.players[1].wizard.damageByPlayer={p1:1};
  g.players[0].cubes.available=0;g.players[0].cubes.onWizard=1;
  g=applyAction(g,{type:'PUNCH',playerId:'p1',targetId:'p2'});
  expect(g.players[0].victoryPoints).toBe(4);
 });
});