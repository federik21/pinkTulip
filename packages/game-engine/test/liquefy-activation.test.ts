import { describe, expect, it } from 'vitest';
import { applyAction, createGame, moment, summonEvocation, upgradeLegacyCards } from '../src';
import type { GameState } from '../src';

function arm(s:GameState,owner='p2') {
 const deck=s.library[0],index=deck.cards.findIndex(c=>c.name==='Liquefy the Pain'),card=deck.cards.splice(index,1)[0];
 const active={id:`liquefy-${owner}`,playerId:owner,card};s.readiedSpells!.push(active);s.activeSpellOrder!.push(active.id);return active;
}
function fixture(actionsUsed=0) {
 const s=createGame(3);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 s.players[1].wizard.health=1;arm(s);
 s.players[0].prepared.rapid={used:false,card:{id:'lethal',kind:'SPELL',name:'Lethal',spellType:'COMBAT',target:'MAGE',range:Infinity,moments:[moment.damage(1)]}};
 return s;
}
function cast(s:GameState) {return applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});}
function reveal(s:GameState) {
 const d=s.pendingDecision;if(d?.kind!=='REACTIVE_SPELL')throw new Error('Expected Liquefy reveal');
 return applyAction(s,{type:'RESPOND_REACTIVE_SPELL',playerId:d.playerId,key:d.key,activeSpellId:`liquefy-${d.playerId}`});
}
function finish(s:GameState,playerId='p2') {return applyAction(s,{type:'END_EVOCATION',playerId});}
function conserved(s:GameState) {
 for(const p of s.players) {
  expect(Object.values(p.cubes).reduce((a,b)=>a+b,0)).toBe(25);
  expect(p.cubes.onWizard).toBe(s.players.reduce((n,t)=>n+(t.wizard.damageByPlayer[p.id]??0),0));
  expect(p.cubes.onEvocations).toBe(s.evocations.reduce((n,e)=>n+(e.damageByPlayer[p.id]??0),0));
 }
}
function dealer(s:GameState) {return summonEvocation(s,s.players[0],'CADAVER',{q:0,r:0})!;}

describe('Liquefy the Pain free Succubus activation',()=>{
 it('prints a separate activation after summoning in the defeat room',()=>{
  expect(fixture().readiedSpells![0].card.triggerEffects).toEqual([
   {effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_ROOM'},
   {effect:'ACTIVATE_EVOCATION',kind:'SUCCUBUS',target:'EVENT_ROOM'},
  ]);
 });
 it('hands control to the defeated owner for a free move and attack, then restores the opponent turn',()=>{
  const s=fixture(),paused=cast(s),before=structuredClone(paused),result=reveal(paused);
  expect(paused).toEqual(before);expect(result.pendingDecision).toBeUndefined();
  const succubus=result.evocations[0],activation=structuredClone(result.activation);
  expect(result.currentPlayerId).toBe('p2');expect(result.evocationActivation).toMatchObject({playerId:'p2',evocationId:succubus.id,movesRemaining:2,returnToAction:true});
  expect(succubus).toMatchObject({kind:'SUCCUBUS',playerId:'p2',activated:true,position:{q:0,r:0}});
  expect(result.activation).toMatchObject({playerId:'p1',actionsUsed:1});expect(result.players.map(p=>p.actionTokens)).toEqual(s.players.map(p=>p.actionTokens));
  expect(result.players[1].wizard.position).not.toEqual(succubus.position);expect(result.players[0].victoryPoints).toBe(5);
  expect(()=>applyAction(result,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p2',kind:'EXPLORE'})).toThrow();
  expect(()=>finish(result,'p1')).toThrow(/No active evocation/);
  const attacked=applyAction(result,{type:'EVOCATION_ATTACK',playerId:'p2',targetId:'p1'});
  expect(attacked.players[0].wizard.damageCubes).toBe(1);
  const moved=applyAction(attacked,{type:'EVOCATION_STEP',playerId:'p2',destination:{q:1,r:0}}),done=finish(moved);
  expect(done.currentPlayerId).toBe('p1');expect(done.evocationActivation).toBeNull();expect(done.activation).toEqual(activation);
  expect(done.players.map(p=>p.actionTokens)).toEqual(s.players.map(p=>p.actionTokens));conserved(done);
 });
 it('keeps the last paid action open until the out-of-turn Succubus finishes',()=>{
  const result=reveal(cast(fixture(1)));expect(result.activation).toMatchObject({playerId:'p1',actionsUsed:2});
  expect(result.currentPlayerId).toBe('p2');expect(result.evocationActivation?.playerId).toBe('p2');
  const done=finish(result);expect(done.evocationActivation).toBeNull();expect(done.activation).toMatchObject({playerId:'p2',actionsUsed:0});
 });
 it('restores the attacker’s pending physical effects rather than consuming or replacing them',()=>{
  const s=fixture(),begun=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'ATTACK'});
  const result=reveal(applyAction(begun,{type:'INFLICT_ATTACK',playerId:'p1',targetId:'p2'}));
  expect(result.evocationActivation?.playerId).toBe('p2');
  const activation=structuredClone(result.activation),done=finish(result);
  expect(done.currentPlayerId).toBe('p1');expect(done.activation).toEqual(activation);
  expect(done.activation?.physicalAction).toMatchObject({kind:'ATTACK',mainEffectUsed:true});
  expect(applyAction(done,{type:'SKIP_PHYSICAL_EFFECTS',playerId:'p1'}).activation?.physicalAction).toBeNull();conserved(done);
 });
 for(const phase of ['ACTION','EVOCATION'] as const)it(`suspends and restores an attacking evocation during ${phase}`,()=>{
  const s=fixture(),source=dealer(s);summonEvocation(s,s.players[2],'CADAVER',{q:1,r:0});
  s.phase=phase;if(phase==='EVOCATION')s.activation=null;
  const active=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:source.id});
  const result=reveal(applyAction(active,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'}));
  expect(result.currentPlayerId).toBe('p2');expect(result.evocationActivation?.evocationId).not.toBe(source.id);
  const done=finish(result);expect(done.currentPlayerId).toBe('p1');expect(done.evocationActivation).toMatchObject({evocationId:source.id,playerId:'p1',movesRemaining:2,attackUsed:true,returnToAction:phase==='ACTION'});
  expect(done.players[0].actionTokens).toBe(phase==='ACTION'?s.players[0].actionTokens-1:s.players[0].actionTokens);
  const ended=finish(done,'p1');expect(ended.evocationActivation).toBeNull();expect(ended.currentPlayerId).toBe(phase==='ACTION'?'p1':'p3');conserved(ended);
 });
 for(const phase of ['ACTION','EVOCATION'] as const)it(`finishes an exhausted suspended ${phase} evocation instead of restoring a dead end`,()=>{
  const s=fixture(),source=dealer(s);summonEvocation(s,s.players[2],'CADAVER',{q:1,r:0});
  s.phase=phase;if(phase==='EVOCATION')s.activation=null;
  let active=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:source.id});
  active=applyAction(active,{type:'END_EVOCATION_MOVEMENT',playerId:'p1'});
  const result=reveal(applyAction(active,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'})),done=finish(result);
  expect(done.evocationActivation).toBeNull();expect(done.currentPlayerId).toBe(phase==='ACTION'?'p1':'p3');
  if(phase==='ACTION')expect(done.activation?.actionsUsed).toBe(1);else expect(done.activation).toBeNull();conserved(done);
 });
 for(const phase of ['ACTION','EVOCATION'] as const)it(`releases a suspended ${phase} attacker destroyed by the new Succubus`,()=>{
  const s=fixture(),source=dealer(s);source.damageCubes=1;summonEvocation(s,s.players[2],'CADAVER',{q:1,r:0});
  s.phase=phase;if(phase==='EVOCATION')s.activation=null;
  const active=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:source.id});
  const result=reveal(applyAction(active,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'}));
  const attacked=applyAction(result,{type:'EVOCATION_ATTACK',playerId:'p2',targetId:source.id}),done=finish(attacked);
  expect(done.evocations.some(e=>e.id===source.id)).toBe(false);expect(done.evocationActivation).toBeNull();expect(done.currentPlayerId).toBe(phase==='ACTION'?'p1':'p3');conserved(done);
 });
 it('supports a nested Liquefy activation and resumes both interrupted owners in order',()=>{
  const s=fixture(),source=dealer(s);arm(s,'p1');s.players[0].wizard.health=1;
  const active=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:source.id});
  const outer=reveal(applyAction(active,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'}));
  const inner=reveal(applyAction(outer,{type:'EVOCATION_ATTACK',playerId:'p2',targetId:'p1'}));
  expect(inner.evocationActivation?.playerId).toBe('p1');expect(inner.evocationActivation?.evocationId).not.toBe(source.id);
  const resumed=finish(inner,'p1');expect(resumed.currentPlayerId).toBe('p2');expect(resumed.evocationActivation).toMatchObject({playerId:'p2',attackUsed:true});
  const done=finish(resumed);expect(done.currentPlayerId).toBe('p1');expect(done.evocationActivation).toMatchObject({evocationId:source.id,attackUsed:true});conserved(done);
 });
 for(const limit of ['owner','supply'] as const)it(`does not activate an older model when the ${limit} limit blocks summoning`,()=>{
  const s=fixture();
  if(limit==='owner')for(let i=0;i<3;i++)summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0});
  else for(let i=0;i<3;i++)summonEvocation(s,s.players[i===2?2:0],'SUCCUBUS',{q:0,r:0});
  const ids=s.evocations.map(e=>e.id),result=reveal(cast(s));
  expect(result.evocations.map(e=>e.id)).toEqual(ids);expect(result.evocations.every(e=>!e.activated)).toBe(true);
  expect(result.evocationActivation).toBeNull();expect(result.currentPlayerId).toBe('p1');conserved(result);
 });
 it('restores the interrupted turn if an activation reaction destroys the new Succubus',()=>{
  const s=fixture();s.ongoingSpells!.push({id:'destroy-summon',playerId:'p3',card:{id:'destroy',name:'Destroy summon',kind:'SPELL',target:'MODEL',range:Infinity,moments:[],
   ongoing:{trigger:{event:'EVOCATION_ACTIVATED',relation:'ENEMY',scope:'ANY'},effects:[{effect:'DAMAGE',amount:20,target:'EVENT_MODEL'}]}}});
  s.activeSpellOrder!.push('destroy-summon');const result=reveal(cast(s));
  expect(result.evocations).toEqual([]);expect(result.evocationActivation).toBeNull();expect(result.currentPlayerId).toBe('p1');conserved(result);
 });
 it('also gives control after neutral Pain defeats the caster during their own turn',()=>{
  const s=fixture();s.readiedSpells=[];s.activeSpellOrder=[];arm(s,'p1');s.players[0].wizard.health=1;
  Object.assign(s.players[0].prepared.rapid!.card,{target:'SELF',moments:[moment.pain(1)]});
  const result=reveal(applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid'}));
  expect(result.evocationActivation?.playerId).toBe('p1');expect(result.currentPlayerId).toBe('p1');
  expect(result.blackRose.kills).toBe(1);expect(finish(result,'p1').evocationActivation).toBeNull();conserved(result);
 });
 it('replays a saved reveal and preserves suspended activation across serialization',()=>{
  const s=fixture(),source=dealer(s),active=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:source.id});
  const paused=applyAction(active,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'}),saved:GameState=JSON.parse(JSON.stringify(paused));upgradeLegacyCards(saved);
    const result=reveal(saved);expect(result.evocationActivation).toMatchObject({playerId:'p2',resume:{currentPlayerId:'p1',evocationActivation:{evocationId:source.id,attackUsed:true}}});
  const restored:GameState=JSON.parse(JSON.stringify(result));upgradeLegacyCards(restored);
  expect(finish(restored)).toEqual(finish(result));conserved(restored);
 });
 it('upgrades the canonical summon-only saved card without replacing its physical ID or custom effects',()=>{
  const s=fixture(),card=s.readiedSpells![0].card,id=card.id;card.triggerEffects=[{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_ROOM'}];
    const custom=structuredClone(card);custom.id=`custom-${id}`;custom.triggerEffects=[...card.triggerEffects,{effect:'HEAL',amount:1,target:'OWNER'}];s.players[0].hand.push(custom);
  const restored:GameState=JSON.parse(JSON.stringify(s));upgradeLegacyCards(restored);
  expect(restored.readiedSpells![0].card).toMatchObject({id,triggerEffects:[{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_ROOM'},{effect:'ACTIVATE_EVOCATION',kind:'SUCCUBUS',target:'EVENT_ROOM'}]});
  expect(restored.players[0].hand[0].triggerEffects).toEqual(custom.triggerEffects);
  const before=structuredClone(restored);upgradeLegacyCards(restored);expect(restored).toEqual(before);
  expect(reveal(cast(restored)).evocationActivation?.playerId).toBe('p2');
 });
});