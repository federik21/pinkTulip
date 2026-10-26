import { moment } from '../src/cards';
import { describe, expect, it } from 'vitest';
import { applyAction, canPlayerAct, createGame, hexDistance, hexLineDistance } from '../src';
import type { Card, GameAction, GameState, Hex } from '../src';

const axes: Hex[] = [{q:1,r:0},{q:0,r:1},{q:-1,r:1},{q:-1,r:0},{q:0,r:-1},{q:1,r:-1}];
const offAxis: Hex[] = [{q:1,r:-2},{q:-1,r:-1},{q:2,r:-1},{q:-2,r:1},{q:1,r:1},{q:-1,r:2}];
const modes = ['ROOM','DUMMY','MAGE','EVOCATION'] as const;
type Mode = typeof modes[number];

// Isolated Action fixture: real cards are moved out of their piles, not duplicated.
// The printed enemy evocation isolates targeting from the separately tested summon flow.
function fixture(mode: Mode, target: Hex, range: number, origin: Hex = {q:0,r:0}) {
 const g=createGame();g.phase='ACTION';g.round=1;g.currentPlayerId='p1';
 g.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 g.players[0].wizard.position={...origin};g.players[1].wizard.position={...target};
 if(mode==='EVOCATION')g.evocations.push({id:'enemy-cadaver',playerId:'p2',name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:2,passive:'WOUNDED_FURY',position:{...target},damageCubes:0,damageByPlayer:{},activated:false});
 const physicalCard=g.library[0].cards.shift()!;
 const card:Card={id:physicalCard.id,name:'Range test',kind:'SPELL',spellType:'COMBAT',range,target:mode==='ROOM'?'ROOM':'MODEL',moments:[moment.instability(1),moment.damage(1)]};
 g.players[0].prepared.slot1={card,used:false};
 const targeting=mode==='ROOM'?{roomId:`room-${target.q},${target.r}`}:
  mode==='DUMMY'?{roomId:`room-${target.q},${target.r}`,dummy:true}:
  mode==='MAGE'?{targetPlayerId:'p2'}:{targetEvocationId:'enemy-cadaver'};
 const action:GameAction={type:'CAST_SPELL',playerId:'p1',slot:'slot1',...targeting};
 return {g,action,card};
}

function expectRejected(g:GameState,action:GameAction) {
 const before=structuredClone(g);
 expect(()=>applyAction(g,action)).toThrow(/out of range/);
 expect(g).toEqual(before);
}

function physicalCards(g:GameState) {
 return [
  ...g.library.flatMap(d=>[...d.cards,...d.discard]),...g.powerfulDeck,...g.removedCards,
  ...g.players.flatMap(p=>[...p.personalDeck,...p.hand,...p.discard,...Object.values(p.prepared).flatMap(c=>c&&!c.used?[c.card]:[])]),
  ...[...g.readiedSpells??[],...g.ongoingSpells??[]].map(a=>a.card),
 ].map(c=>c.id).sort();
}

describe('authoritative straight-line spell range',()=>{
 for(const mode of modes) {
  for(const range of [2,4]) {
   it.each(offAxis)(`rejects off-axis ${mode} at $q,$r even at range ${range}`,target=>{
    const {g,action}=fixture(mode,target,range);
    expect(hexDistance({q:0,r:0},target)).toBe(2);
    expectRejected(g,action);
   });
  }

  for(const range of [1,2]) {
   it.each(axes)(`casts ${mode} exactly ${range} steps along axis $q,$r`,direction=>{
    const target={q:direction.q*range,r:direction.r*range};
    const {g,action,card}=fixture(mode,target,range),before=structuredClone(g);
    const next=applyAction(g,action);
    expect(g).toEqual(before);
    expect(next.players[0].prepared.slot1?.used).toBe(true);
    expect(next.library[0].discard).toContainEqual(card);
    expect(next.board.rooms.find(r=>r.id===`room-${target.q},${target.r}`)?.cubesByPlayer.p1).toBe(1);
    expect(next.players[1].wizard.damageCubes).toBe(mode==='ROOM'||mode==='MAGE'?1:0);
    if(mode==='EVOCATION')expect(next.evocations[0].damageCubes).toBe(1);
    expect(next.players[0].actionTokens).toBe(2);
    expect(next.activation).toMatchObject({playerId:'p1',actionsUsed:1,spellsCast:1,sequencedSpellUsed:true});
    expect(physicalCards(next)).toEqual(physicalCards(before));
    expect(new Set(physicalCards(next)).size).toBe(physicalCards(before).length);
   });
  }

  it(`allows same-hex ${mode} at range zero, but rejects an adjacent target`,()=>{
   const same=fixture(mode,{q:0,r:0},0);
   expect(applyAction(same.g,same.action).players[0].prepared.slot1?.used).toBe(true);
   const adjacent=fixture(mode,{q:1,r:0},0);
   expectRejected(adjacent.g,adjacent.action);
  });

  it(`rejects an aligned ${mode} beyond the printed range`,()=>{
   const {g,action}=fixture(mode,{q:2,r:-2},1);
   expectRejected(g,action);
  });

  it(`measures ${mode} relative to a noncentral caster, not the board center`,()=>{
   const aligned=fixture(mode,{q:-1,r:1},2,{q:1,r:-1});
   expect(applyAction(aligned.g,aligned.action).players[0].prepared.slot1?.used).toBe(true);
   const offLine=fixture(mode,{q:0,r:1},4,{q:1,r:-1});
   expectRejected(offLine.g,offLine.action);
  });
 }

 it('keeps dummy casts available without physical tokens or enemy targets, then exhausts normally',()=>{
  const {g,action}=fixture('DUMMY',{q:0,r:0},0);
  g.players[0].actionTokens=0;g.players[1].actionTokens=0;
  g.players[1].wizard.position={q:-3,r:2};
  expect(canPlayerAct(g,g.players[0])).toBe(true);
  expect(applyAction(g,action).phase).toBe('CLEANUP');
 });

 it.each(['ROOM','MODEL'] as const)('enforces the same rule for prepared powerful %s spells',targetType=>{
  const {g}=fixture('ROOM',{q:1,r:1},4);
    g.library[0].cards.push(g.players[0].prepared.slot1!.card);
  g.players[0].prepared={rapid:null,slot1:null,slot2:null,slot3:null};
  const [power]=g.powerfulDeck.splice(g.powerfulDeck.findIndex(c=>c.target===targetType),1);
  g.players[0].prepared.rapid={card:power,used:false};
  const targeting=targetType==='ROOM'?{roomId:'room-1,1'}:{targetPlayerId:'p2'};
  const action:GameAction={type:'CAST_SPELL',playerId:'p1',slot:'rapid',...targeting};
  const cards=physicalCards(g);
  expectRejected(g,action);
  const next=applyAction(g,{...action,...(targetType==='ROOM'?{roomId:'room-2,0'}:{dummy:true,roomId:'room-2,0',targetPlayerId:undefined})});
  expect(next.removedCards).toContainEqual(power);
  expect(next.players[0].hand).not.toContainEqual(power);
  expect(next.players[0].actionTokens).toBe(2);
  expect(next.activation).toMatchObject({actionsUsed:1,spellsCast:1,sequencedSpellUsed:false});
  expect(physicalCards(next)).toEqual(cards);expect(new Set(cards).size).toBe(cards.length);
 });

 it('preserves four-step sight across the board and two-step movement that can turn',()=>{
  expect(hexLineDistance({q:-2,r:0},{q:2,r:0})).toBe(4);
  const {g,action}=fixture('MAGE',{q:2,r:0},4,{q:-2,r:0});
  expect(applyAction(g,action).players[1].wizard.damageCubes).toBe(1);
  let moved=applyAction(g,{type:'EXPLORE',playerId:'p1'});
  moved=applyAction(moved,{type:'EXPLORE_STEP',playerId:'p1',destination:{q:-1,r:0}});
  moved=applyAction(moved,{type:'EXPLORE_STEP',playerId:'p1',destination:{q:-1,r:1}});
  expect(moved.players[0].wizard.position).toEqual({q:-1,r:1});
 });
});