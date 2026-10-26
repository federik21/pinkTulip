import { describe, expect, it } from 'vitest';
import { applyAction, createAgonyDeck, createGame, moment, summonEvocation } from '@brw/game-engine';
import type { Card, GameState } from '@brw/game-engine';
import { ActionHistory } from '../src/action-history';
import { publicState } from '../src/public-state';

function fixture():GameState {
 const s=createGame(2);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 return s;
}
const ward:Card={id:'private-physical-id',name:'Private Protection',kind:'SPELL',schoolId:'agony',spellType:'PROTECTION',target:'SELF',range:0,moments:[moment.heal(1)],rulesText:'Private damage trigger',trigger:{event:'DAMAGE_TAKEN',relation:'ENEMY',scope:'BOUND_MODEL'}};
function paused():GameState {
 const s=fixture();s.readiedSpells=[{id:'private-active-id',playerId:'p2',card:ward}];s.activeSpellOrder=['private-active-id'];
 s.players[0].prepared.rapid={used:false,card:{id:'attack',name:'Strike',kind:'SPELL',target:'MAGE',range:2,moments:[moment.damage(1)]}};
 return applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
}

describe('reactive decision privacy and history',()=>{
 it('keeps forced trigger targets private, rejects redirection, and reveals without requiring a target choice',()=>{
  const s=fixture(),history=new ActionHistory(),card=createAgonyDeck('forced').find(c=>c.name==='Torment')!;
  s.readiedSpells=[{id:'forced-trap',playerId:'p2',card}];s.activeSpellOrder=['forced-trap'];
  s.players[0].prepared.rapid={used:false,card:{id:'hit',name:'Hit',kind:'SPELL',spellType:'COMBAT',target:'MAGE',range:0,moments:[moment.damage(1)]}};
  const paused=history.apply(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'},'p1');
  const own=publicState(paused,'p2',history),foreign=publicState(paused,'p1',history);
  expect(own.pendingDecision).toMatchObject({kind:'REACTIVE_SPELL',options:[{card:{triggerTarget:'EVENT_ACTOR'},targets:[{kind:'MAGE',id:'p1'}]}]});
  expect(own.pendingDecision).not.toHaveProperty('resume');
  expect(foreign.pendingDecision).toEqual({kind:'WAITING',playerId:'p2',key:'waiting'});
  expect(foreign.readiedSpells![0].card).not.toHaveProperty('triggerTarget');
  const before=structuredClone(paused);
  expect(()=>history.apply(paused,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:paused.pendingDecision!.key,activeSpellId:'forced-trap',targetId:'p2'},'p2')).toThrow(/eligible spell and target/);
  expect(paused).toEqual(before);
  const result=history.apply(paused,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:paused.pendingDecision!.key,activeSpellId:'forced-trap'},'p2');
  expect(result.players[0].wizard.damageCubes).toBe(2);expect(result.players[1].wizard.damageCubes).toBe(1);
  expect(result.players[1].discard).toContainEqual(card);
  expect(history.status(result,'p1').canUndo).toBe(false);expect(history.status(result,'p2').canUndo).toBe(false);
 });
 it('only exposes matching cards and targets to their owner, never the replay payload',()=>{
  const s=paused(),history=new ActionHistory();
  const own=publicState(s,'p2',history);
  expect(own.pendingDecision).toMatchObject({kind:'REACTIVE_SPELL',options:[{card:{name:ward.name},targets:[{id:'p2'}]}]});
  expect(own.pendingDecision).not.toHaveProperty('resume');
  for(const viewer of ['p1',null]) {
   const visible=publicState(s,viewer,history);
   expect(visible.pendingDecision).toEqual({kind:'WAITING',playerId:'p2',key:'waiting'});
   const wire=JSON.stringify(visible.pendingDecision);
   expect(wire).not.toContain(ward.id);expect(wire).not.toContain(ward.name);
   expect(wire).not.toContain('DAMAGE_TAKEN');expect(wire).not.toContain('options');
   expect(visible.readiedSpells![0].card).toMatchObject({name:'Hidden spell',spellType:'PROTECTION'});
   expect(visible.readiedSpells![0].card).not.toHaveProperty('trigger');
  }
  expect(s.pendingDecision).toHaveProperty('resume');
 });
 it('keeps ignoring a trigger private and prevents undo across the decision',()=>{
  const s=paused(),history=new ActionHistory();
  const result=history.apply(s,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:s.pendingDecision!.key},'p2');
  expect(result.pendingDecision).toBeUndefined();
  expect(result.readiedSpells).toHaveLength(1);
  expect(publicState(result,'p1',history).readiedSpells![0].card.name).toBe('Hidden spell');
  expect(result.log.join(' ')).not.toContain(ward.name);
  expect(history.status(result,'p2').canUndo).toBe(false);
 });
 it('reveals the spell into personal Memories and prevents re-hiding it using history',()=>{
  const s=paused(),history=new ActionHistory();
  const result=history.apply(s,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:s.pendingDecision!.key,activeSpellId:'private-active-id',targetId:'p2'},'p2');
  expect(result.players[1].discard).toContainEqual(ward);
  expect(result.readiedSpells).toEqual([]);
  expect(publicState(result,'p1',history).players[1].discard).toContainEqual(ward);
  expect(history.status(result,'p1').canUndo).toBe(false);
  expect(history.status(result,'p2').canUndo).toBe(false);
 });
 it('supports exact activation undo/redo without revealing the card to a peer',()=>{
  const s=fixture();s.players[0].prepared.rapid={used:false,card:ward};
  const history=new ActionHistory(),activated=history.apply(s,{type:'ACTIVATE_SPELL',playerId:'p1',slot:'rapid'},'p1');
  expect(history.status(activated,'p1')).toMatchObject({canUndo:true,undoLabel:'Activate hidden spell'});
  const undone=history.apply(activated,{type:'UNDO_ACTION',playerId:'p1'},'p1');
  expect(undone.readiedSpells).toEqual([]);
  const redone=history.apply(undone,{type:'REDO_ACTION',playerId:'p1'},'p1');
  expect(redone.readiedSpells).toEqual(activated.readiedSpells);
  expect(publicState(redone,'p2',history).readiedSpells![0].card.name).toBe('Hidden spell');
 });
 it('keeps a Cleanup destination private until Cleanup',()=>{
  const s=fixture();s.readiedSpells=[{id:'active',playerId:'p2',card:ward}];s.activeSpellOrder=['active'];
  const result=applyAction(s,{type:'SET_ACTIVE_SPELL_CLEANUP',playerId:'p2',activeSpellId:'active',destination:'MEMORIES'});
  expect(publicState(result,'p2',new ActionHistory()).readiedSpells![0].cleanupDestination).toBe('MEMORIES');
  expect(publicState(result,'p1',new ActionHistory()).readiedSpells![0]).not.toHaveProperty('cleanupDestination');
 });
 it('undoes and redoes early evocation movement completion without resetting its used attack',()=>{
  const s=fixture(),e=summonEvocation(s,s.players[0],'CADAVER',{q:0,r:0})!,history=new ActionHistory();
  let result=history.apply(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:e.id},'p1');
  result=history.apply(result,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'},'p1');
  expect(result.evocationActivation).toMatchObject({attackUsed:true,movesRemaining:2});
  const stopped=history.apply(result,{type:'END_EVOCATION_MOVEMENT',playerId:'p1'},'p1');
  expect(stopped.evocationActivation).toBeNull();
  expect(history.status(stopped,'p1')).toMatchObject({canUndo:true,undoLabel:'End evocation movement'});
  const undone=history.apply(stopped,{type:'UNDO_ACTION',playerId:'p1'},'p1');
  expect(undone.evocationActivation).toMatchObject({attackUsed:true,movesRemaining:2});
  expect(()=>history.apply(undone,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'},'p1')).toThrow(/attack already used/);
  expect(history.apply(undone,{type:'REDO_ACTION',playerId:'p1'},'p1')).toEqual(stopped);
 });
});