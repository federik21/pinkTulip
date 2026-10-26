import { describe, expect, it } from 'vitest';
import { applyAction, createGame, moment, summonEvocation } from '../src';
import type { GameState } from '../src';

function fixture(actionsUsed=0):GameState {
 const s=createGame(2);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players)p.wizard.position={q:0,r:0};
 const deck=s.library[0],index=deck.cards.findIndex(c=>c.name==='Cross and Delight');
 s.players[0].prepared.rapid={card:deck.cards.splice(index,1)[0],used:false};
 return s;
}
function cast(s:GameState,redirect=false):GameState {
 let result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
 if(result.pendingDecision?.kind==='SOUL_TITHE')result=applyAction(result,{type:'RESPOND_SOUL_TITHE',playerId:'p1',accept:redirect});
 return result;
}

describe('Cross and Delight final activation moment',()=>{
 it('prints Summon, Pain 1, then Activate Succubus without restoring older damage/instability',()=>{
  expect(fixture().players[0].prepared.rapid!.card.moments).toEqual([
   {effect:'SUMMON',kind:'SUCCUBUS',position:'CASTER'},
   {effect:'PAIN',amount:1},
   {effect:'ACTIVATE_EVOCATION',kind:'SUCCUBUS'},
  ]);
 });
 it('finishes Pain before giving the user movement and attack control, for no extra cost',()=>{
  const s=fixture(),before=structuredClone(s),result=cast(s);
  expect(s).toEqual(before);
  expect(result.pendingDecision).toBeUndefined();
  expect(result.players[0].wizard.blackDamage).toBe(1);
  const succubus=result.evocations[0];
  expect(succubus).toMatchObject({name:'Succubus',playerId:'p1',activated:true});
  expect(result.evocationActivation).toEqual({evocationId:succubus.id,playerId:'p1',movesRemaining:2,returnToAction:true});
  expect(result.currentPlayerId).toBe('p1');
  expect(result.activation?.actionsUsed).toBe(1);
  expect(result.players[0].actionTokens).toBe(s.players[0].actionTokens);
  const pain=result.log.findIndex(line=>line.includes('suffers 1 black damage'));
  const activation=result.log.findIndex(line=>line.includes('activates Succubus'));
  expect(pain).toBeGreaterThan(-1);expect(activation).toBeGreaterThan(pain);
  const moved=applyAction(result,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:1,r:0}});
  expect(moved.evocationActivation?.movesRemaining).toBe(1);
  expect(moved.evocations[0].position).toEqual({q:1,r:0});
 });
 it('lets the summoned Succubus absorb Pain before using its increased attack',()=>{
  const result=cast(fixture(),true);
  expect(result.players[0].wizard.damageCubes).toBe(0);
  expect(result.evocations[0].damageCubes).toBe(1);
  const attacked=applyAction(result,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'});
  expect(attacked.players[1].wizard.damageCubes).toBe(2);
    expect(attacked.evocationActivation).toMatchObject({attackUsed:true,movesRemaining:2});
    expect(applyAction(attacked,{type:'END_EVOCATION',playerId:'p1'}).evocationActivation).toBeNull();
  expect(attacked.activation?.actionsUsed).toBe(1);
 });
 it('does not hand off the last turn action until the Succubus finishes',()=>{
  const result=cast(fixture(1));
  expect(result.activation?.actionsUsed).toBe(2);
  expect(result.currentPlayerId).toBe('p1');
  expect(result.evocationActivation?.playerId).toBe('p1');
  expect(()=>applyAction(result,{type:'END_ACTIVATION',playerId:'p1'})).toThrow(/Finish the active evocation/);
  const finished=applyAction(result,{type:'END_EVOCATION',playerId:'p1'});
  expect(finished.evocationActivation).toBeNull();expect(finished.currentPlayerId).toBe('p2');
 });
 it('does not activate an unrelated model when the summon cannot fit',()=>{
  const s=fixture();
  for(let i=0;i<3;i++)summonEvocation(s,s.players[0],'CADAVER',{q:0,r:0});
  const ids=s.evocations.map(e=>e.id),result=cast(s);
  expect(result.evocations.map(e=>e.id)).toEqual(ids);
  expect(result.evocations.every(e=>!e.activated)).toBe(true);
  expect(result.evocationActivation).toBeNull();
  expect(result.players[0].wizard.blackDamage).toBe(1);
 });
 it('keeps the original summon when a nested interrupt summons another Succubus',()=>{
  const s=fixture();
  s.readiedSpells!.push({id:'nested-summon',playerId:'p1',card:{id:'nested-card',name:'Nested summon',kind:'SPELL',spellType:'PROTECTION',target:'SELF',range:0,
   trigger:{event:'DAMAGE_TAKEN',relation:'ANY',scope:'BOUND_MODEL'},moments:[moment.summon('SUCCUBUS')]}});
  s.activeSpellOrder!.push('nested-summon');
  const paused=cast(s),decision=paused.pendingDecision;
  expect(decision?.kind).toBe('REACTIVE_SPELL');
  if(decision?.kind!=='REACTIVE_SPELL')throw new Error('Expected nested summon reveal');
  const result=applyAction(paused,{type:'RESPOND_REACTIVE_SPELL',playerId:'p1',key:decision.key,activeSpellId:'nested-summon',targetId:'p1'});
  expect(result.evocations).toHaveLength(2);
  expect(result.evocationActivation?.evocationId).toBe(result.evocations[0].id);
  expect(result.evocationActivation?.evocationId).not.toBe(result.evocations[1].id);
  expect(result.players[0].wizard.blackDamage).toBe(1);
 });
});