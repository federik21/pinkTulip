import { describe, expect, it } from 'vitest';
import { applyAction, BLACK_ROSE_ID, createGame, createNightmareDeck, EVOCATION_TYPES, getEvocationSupply, getMageEvocationCount, summonEvocation } from '../src';
import type { Card, GameState } from '../src';

const card=(name:string):Card=>({...createNightmareDeck('n','nightmare').find(c=>c.name===name)!,id:`n-${name}`});
function fixture():GameState {
 const s=createGame(2);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 return s;
}
const choose=(s:GameState,choiceId:string)=>{
 const d=s.pendingDecision;if(d?.kind!=='CHOICE')throw new Error('Expected a choice');
 return applyAction(s,{type:'RESPOND_CHOICE',playerId:d.playerId,key:d.key,choiceId});
};
function retake(s:GameState){s.phase='ACTION';s.currentPlayerId='p1';s.pendingDecision=null;s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};}
function castHumiliationAfterAssign(s:GameState) {
 s.players[0].prepared.rapid={used:false,card:card('Recurring Nightmare')};
 return choose(applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'}),'2');
}

describe('Nightmare school',()=>{
 it('adds a 36-card school with 12 spells and a 9-model Umbra supply',()=>{
  const s=createGame(2),deck=s.library.find(d=>d.id==='nightmare')!;
  expect(deck.cards).toHaveLength(36);
  expect(new Set(deck.cards.map(c=>c.name)).size).toBe(12);
  expect(EVOCATION_TYPES.UMBRA).toMatchObject({archetype:'NIGHTMARE',movement:0,attack:1,health:2});
  expect(getEvocationSupply(s).UMBRA).toBe(9);
 });
 it('assigns an Umbra in the chosen slot, activates it and hits the mage',()=>{
  const s=castHumiliationAfterAssign(fixture());
  const umbra=s.evocations.find(e=>e.kind==='UMBRA')!;
  expect(umbra).toMatchObject({playerId:BLACK_ROSE_ID,assignedTo:'p2',slot:2});
  expect(s.players[1].wizard.damageCubes).toBe(2); // attack 1 + 1 bonus
  expect(getEvocationSupply(s).UMBRA).toBe(8);
 });
 it('also damages the evocation in the assigned slot',()=>{
  const s=fixture();
  const own=summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0})!;
  expect(own.number).toBe(1);
  s.players[0].prepared.rapid={used:false,card:card('Recurring Nightmare')};
  const done=choose(applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'}),'1');
  expect(done.evocations.find(e=>e.id===own.id)!.damageCubes).toBe(1);
 });
 it('lets an Umbra share a slot with an evocation; a full retinue refuses outside a spell',()=>{
  const s=fixture();
  for(let i=0;i<3;i++)summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0});
  s.players[0].prepared.rapid={used:false,card:card('Recurring Nightmare')};
  const assigned=choose(applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'}),'2');
  expect(assigned.evocations.find(e=>e.kind==='UMBRA')).toMatchObject({assignedTo:'p2',slot:2});
  expect(getMageEvocationCount(assigned,'p2')).toBe(3);
  expect(summonEvocation(assigned,assigned.players[1],'CADAVER',{q:0,r:0})).toBeUndefined();
 });
 it('activates on Humiliation and is removed when its mage is defeated',()=>{
  let s=castHumiliationAfterAssign(fixture());
  const id=s.evocations.find(e=>e.kind==='UMBRA')!.id;
  s.players[0].prepared.rapid={used:false,card:card('Humiliation')};
  retake(s);
  const hit=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
  expect(hit.players[1].wizard.damageCubes).toBe(5); // 2 + umbra 1
  expect(hit.evocations.find(e=>e.id===id)).toBeDefined();
  s=hit;
  s.players[1].wizard.damageCubes=s.players[1].wizard.health-1;
  s.players[0].prepared.rapid={used:false,card:card('Humiliation')};
  retake(s);
  const dead=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
  expect(dead.evocations.find(e=>e.id===id)).toBeUndefined();
 });
});
