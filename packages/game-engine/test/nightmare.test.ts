import { describe, expect, it } from 'vitest';
import { applyAction, BLACK_ROSE_ID, createGame, createNightmareDeck, EVOCATION_TYPES, getEvocationSupply, getMageEvocationCount, summonEvocation } from '../src';
import type { Card, EventCard, GameState } from '../src';

const card=(name:string):Card=>({...createNightmareDeck('n','nightmare').find(c=>c.name===name)!,id:`n-${name}`});
function fixture(playerCount=2):GameState {
 const s=createGame(playerCount);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
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
 it('credits an assigned Umbra lethal hit to Black Rose without the Liquefy bonus',()=>{
  const s=castHumiliationAfterAssign(fixture(3));
  const target=s.players[1],umbra=s.evocations.find(e=>e.kind==='UMBRA')!;
  expect(umbra.assignedTo).toBe(target.id);
  target.wizard.damageCubes=9;target.wizard.blackDamage=0;
  target.wizard.damageByPlayer={p1:9};target.wizard.damageOrder=Array(9).fill('p1');
  s.players[0].cubes.available=16;s.players[0].cubes.onWizard=9;
  for(const player of s.players)player.actionTokens=0;

  const result=applyAction(s,{type:'END_ACTIVATION',playerId:'p1'});

  expect(result.phase).toBe('CLEANUP');
  expect(result.blackRose).toMatchObject({kills:1,victoryPoints:2,trophies:['p2']});
  expect(result.players.map(player=>player.victoryPoints)).toEqual([4,0,0]);
  expect(result.players.map(player=>player.trophies)).toEqual([[],[],[]]);
  expect(result.evocations.some(e=>e.id===umbra.id)).toBe(false);
  expect(result.feedbackEvents!.find(event=>event.kind==='MAGE_DEFEATED')).toMatchObject({sourceId:BLACK_ROSE_ID});
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
 it('assigns multiple Umbras to distinct slots and wastes assignments after all slots are occupied',()=>{
  const s=fixture();
  s.players[0].prepared.rapid={used:false,card:card('Anguish')};
  let assigned=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
  assigned=choose(assigned,'1');
  expect(assigned.pendingDecision?.kind).toBe('CHOICE');
  if(assigned.pendingDecision?.kind!=='CHOICE')throw new Error('Expected the second Umbra slot choice');
  expect(assigned.pendingDecision.options.map(option=>option.id)).toEqual(['2','3']);
  assigned=choose(assigned,'2');
  expect(assigned.evocations.filter(e=>e.kind==='UMBRA').map(e=>e.slot)).toEqual([1,2]);

  assigned.players[0].prepared.rapid={used:false,card:card('Anguish')};
  retake(assigned);
  const full=choose(applyAction(assigned,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'}),'3');
  expect(full.evocations.filter(e=>e.kind==='UMBRA').map(e=>e.slot)).toEqual([1,2,3]);
  expect(full.pendingDecision).toBeUndefined();
  expect(full.log.some(line=>line.includes('has an Umbra in every evocation slot; none assigned.'))).toBe(true);
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
 it('lets Traitor Nightmare reactivate a used reconstructed Whispering Library',()=>{
  const s=castHumiliationAfterAssign(fixture());
  const umbra=s.evocations.find(e=>e.kind==='UMBRA')!;
  const library=s.board.rooms.find(r=>!r.startingFor&&r.id!=='room-0,0')!;
  library.name='Whispering Library';library.effect='DRAW_GRIMOIRE';library.reconstructed=true;library.specialUsed=true;
  umbra.position={...library.tiles[0]};
  s.players[0].personalDeck=[card('Anguish')];
  s.players[0].prepared.rapid={used:false,card:card('Traitor Nightmare')};
  retake(s);

  const activated=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:library.id});

  expect(activated.players[0].hand.map(c=>c.id)).toContain('n-Anguish');
  expect(activated.log.some(line=>line.includes('Whispering Library special already used'))).toBe(false);
 });
 it('lets Ephialtes assign to one mage without removing that mage’s evocations',()=>{
  const s=fixture();
  for(let i=0;i<3;i++)summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0});
  const event=(id:string):EventCard=>({id,name:id,description:id,kind:'ONGOING',amount:0,rooms:0,ongoing:{entryPoints:0,exitPoints:0}});
  s.eventBoard=[event('board-1'),event('board-2'),event('board-3')];
  s.eventDeck=[event('drawn')];
  s.players[0].prepared.rapid={used:false,card:card('Ephialtes')};

  let result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid'});
  const assignedSlots:number[]=[];
  while(result.pendingDecision) {
   if(result.pendingDecision.kind!=='CHOICE')throw new Error('Expected Ephialtes choice');
   const decision=result.pendingDecision;
   const choiceId=decision.prompt.startsWith('Ephialtes: choose a mage')?'p2':String(assignedSlots.length+1);
   result=choose(result,choiceId);
   if(decision.prompt.startsWith('Assign an Umbra'))assignedSlots.push(Number(choiceId));
  }

  expect(result.evocations.filter(e=>e.playerId==='p2').map(e=>e.kind)).toEqual(['CADAVER','CADAVER','CADAVER']);
  expect(result.evocations.filter(e=>e.kind==='UMBRA'&&e.assignedTo==='p2').map(e=>e.slot)).toEqual([1,2,3]);
  expect(result.log.some(line=>line.includes('is removed'))).toBe(false);
 });
});
