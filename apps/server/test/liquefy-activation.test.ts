import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGame, summonEvocation } from '../../../packages/game-engine/src';
import { ActionHistory } from '../src/action-history';
import { publicState } from '../src/public-state';
import { SessionStore } from '../src/session-store';

function fixture() {
 const s=createGame(2);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,spellsCast:0,sequencedSpellUsed:false,exploring:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 s.players[1].wizard.health=1;
 const index=s.library[0].cards.findIndex(c=>c.name==='Liquefy the Pain'),card=s.library[0].cards.splice(index,1)[0];
 s.readiedSpells!.push({id:'liquefy',playerId:'p2',card});s.activeSpellOrder!.push('liquefy');
 const source=summonEvocation(s,s.players[0],'CADAVER',{q:0,r:0})!;return {s,source};
}
function trigger() {
 const {s,source}=fixture(),history=new ActionHistory();
 const active=history.apply(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:source.id},'p1');
 const paused=history.apply(active,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'},'p1'),d=paused.pendingDecision!;
 const result=history.apply(paused,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:d.key,activeSpellId:'liquefy'},'p2');
 return {history,result,source};
}

describe('Liquefy free activation transport and persistence',()=>{
 it('gives only the spell owner control and exposes no private root-action snapshot',()=>{
  const {history,result,source}=trigger();expect(result.currentPlayerId).toBe('p2');
  for(const viewer of ['p1','p2',null]) {
   const wire=publicState(result,viewer,history);
   expect(wire.evocationActivation?.resume).toEqual({currentPlayerId:'p1',evocationActivation:{evocationId:source.id,playerId:'p1',movesRemaining:2,returnToAction:true,attackUsed:true}});
   expect(wire.pendingDecision).toBeUndefined();expect(wire.history).toEqual({canUndo:false,canRedo:false});
  }
  const before=structuredClone(result);
  expect(()=>history.apply(result,{type:'END_EVOCATION',playerId:'p2'},'p1')).toThrow(/another player/);
  expect(()=>history.apply(result,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:1,r:0}},'p1')).toThrow(/No active evocation/);
  expect(result).toEqual(before);
 });
 it('exactly undoes/redoes free movement and finishing without losing the suspended attacker',()=>{
  const {history,result,source}=trigger();
  const moved=history.apply(result,{type:'EVOCATION_STEP',playerId:'p2',destination:{q:1,r:0}},'p2');
  const undone=history.apply(moved,{type:'UNDO_ACTION',playerId:'p2'},'p2');expect(undone).toEqual(result);
  const redone=history.apply(undone,{type:'REDO_ACTION',playerId:'p2'},'p2');expect(redone).toEqual(moved);
  const finished=history.apply(redone,{type:'END_EVOCATION',playerId:'p2'},'p2');
  expect(finished.currentPlayerId).toBe('p1');expect(finished.evocationActivation).toMatchObject({evocationId:source.id,attackUsed:true});
  const restored=history.apply(finished,{type:'UNDO_ACTION',playerId:'p2'},'p2');expect(restored).toEqual(moved);
  expect(history.apply(restored,{type:'REDO_ACTION',playerId:'p2'},'p2')).toEqual(finished);
 });
 it('restores an active free activation and its continuation after a real session save/load',()=>{
  const {result,source}=trigger(),directory=mkdtempSync(join(tmpdir(),'liquefy-activation-'));
  try {
   const store=new SessionStore(join(directory,'sessions.json'),()=>[{id:'liquefy',game:result}]);expect(store.flush()).not.toBeNull();
   const loaded=store.load()[0].game;expect(loaded.players.every(p=>!p.connected)).toBe(true);
   for(const p of loaded.players)p.connected=true;
   const done=new ActionHistory().apply(loaded,{type:'END_EVOCATION',playerId:'p2'},'p2');
   expect(done.currentPlayerId).toBe('p1');expect(done.evocationActivation).toMatchObject({evocationId:source.id,movesRemaining:2,attackUsed:true});
   expect(done.activation).toEqual(result.activation);
  } finally {rmSync(directory,{recursive:true,force:true});}
 });
 it('migrates summon-only copies in saved active spells before resolving the defeat',()=>{
  const {s,source}=fixture(),card=s.readiedSpells![0].card,id=card.id;card.triggerEffects=[{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_ROOM'}];
  const directory=mkdtempSync(join(tmpdir(),'liquefy-legacy-'));
  try {
   const store=new SessionStore(join(directory,'sessions.json'),()=>[{id:'liquefy',game:s}]);expect(store.flush()).not.toBeNull();
   const loaded=store.load()[0].game;for(const p of loaded.players)p.connected=true;
   expect(loaded.readiedSpells![0].card).toMatchObject({id,triggerEffects:[{effect:'SUMMON'},{effect:'ACTIVATE_EVOCATION'}]});
   const history=new ActionHistory(),active=history.apply(loaded,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:source.id},'p1');
   const paused=history.apply(active,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'},'p1');
   const result=history.apply(paused,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:paused.pendingDecision!.key,activeSpellId:'liquefy'},'p2');
   expect(result.evocationActivation?.playerId).toBe('p2');expect(result.currentPlayerId).toBe('p2');
  } finally {rmSync(directory,{recursive:true,force:true});}
 });
});