import { describe, expect, it } from 'vitest';
import { applyAction, createGame, moment, summonEvocation, upgradeLegacyCards } from '../src';
import type { Card, GameState, Moment } from '../src';

function fixture() {
 const s=createGame(4);s.round=1;s.phase='ACTION';s.currentPlayerId='p2';s.firstPlayerId='p1';
 s.activation={playerId:'p2',actionsUsed:0,exploring:0,spellsCast:0,sequencedSpellUsed:false,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 const index=s.library[0].cards.findIndex(c=>c.name==='Pain Mark'),card=s.library[0].cards.splice(index,1)[0];
 s.ongoingSpells!.push({id:'mark',playerId:'p1',targetPlayerId:'p2',card});s.activeSpellOrder!.push('mark');return s;
}
function prepare(s:GameState,steps:Moment[],target:Card['target']='MAGE',owner='p2') {
 const card:Card={id:s.library[0].cards.shift()!.id,name:'Source test',kind:'SPELL',spellType:'COMBAT',range:Infinity,target,moments:steps};
 s.players.find(p=>p.id===owner)!.prepared.rapid={used:false,card};return card;
}
const marks=(s:GameState)=>s.feedbackEvents!.filter(e=>e.kind==='SPELL_TRIGGERED'&&e.activeSpellId==='mark');
function conserved(s:GameState) {
 for(const p of s.players){expect(Object.values(p.cubes).reduce((a,b)=>a+b,0)).toBe(25);
  expect(p.cubes.onWizard).toBe(s.players.reduce((n,m)=>n+(m.wizard.damageByPlayer[p.id]??0),0));
  expect(p.cubes.onEvocations).toBe(s.evocations.reduce((n,m)=>n+(m.damageByPlayer[p.id]??0),0));}
}
function wounded(s:GameState,id:string) {
 const mage=s.players.find(p=>p.id===id),model=mage?.wizard??s.evocations.find(e=>e.id===id)!;
 model.damageCubes=2;model.damageByPlayer={p3:2};if(mage){mage.wizard.damageOrder=['p3','p3'];}
 s.players[2].cubes.available-=2;s.players[2].cubes[mage?'onWizard':'onEvocations']+=2;return model;
}

describe('Pain Mark only reacts to the bound mage’s own physical or spell damage',()=>{
 it.each(['INFLICT_ATTACK','PUNCH'] as const)('reacts to a mage physical attack via %s',type=>{
  let s=fixture();
  if(type==='INFLICT_ATTACK')s=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p2',kind:'ATTACK'});
  const after=applyAction(s,{type,playerId:'p2',targetId:'p3'});
  expect(marks(after)).toHaveLength(1);expect(after.players[1].wizard.damageByPlayer).toEqual({p1:2});expect(after.players[2].wizard.damageCubes).toBe(2);conserved(after);
 });
 it.each(['MAGE','EVOCATION','ROOM'] as const)('reacts to actual spell damage to %s targets',target=>{
  const s=fixture();prepare(s,[moment.damage(1)],target);let id='p3';
  if(target==='EVOCATION')id=summonEvocation(s,s.players[2],'CADAVER',{q:0,r:0})!.id;
  const payload=target==='ROOM'?{roomId:'room-0,0'}:target==='EVOCATION'?{targetEvocationId:id}:{targetPlayerId:id};
  const after=applyAction(s,{type:'CAST_SPELL',playerId:'p2',slot:'rapid',...payload});
  expect(marks(after)).toHaveLength(target==='ROOM'?3:1);expect(after.players[1].wizard.damageByPlayer.p1).toBe(target==='ROOM'?6:2);conserved(after);
 });
 it('retaliates once per damaging spell moment and never on a harmless spell',()=>{
  const s=fixture();prepare(s,[moment.damage(1),moment.damage(1)]);
  const after=applyAction(s,{type:'CAST_SPELL',playerId:'p2',slot:'rapid',targetPlayerId:'p3'});
  expect(marks(after)).toHaveLength(2);expect(after.players[1].wizard.damageCubes).toBe(4);conserved(after);
  const t=fixture();prepare(t,[moment.heal(2)]);expect(marks(applyAction(t,{type:'CAST_SPELL',playerId:'p2',slot:'rapid',targetPlayerId:'p3'}))).toEqual([]);
 });
 it.each(['ACTION','EVOCATION'] as const)('ignores both activation and attacks by a controlled evocation during %s',phase=>{
  let s=fixture();const e=summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0})!;
  s.phase=phase;if(phase==='EVOCATION')s.activation=null;
  s=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:e.id});expect(marks(s)).toEqual([]);
  const after=applyAction(s,{type:'EVOCATION_ATTACK',playerId:'p2',targetId:'p3'});
  expect(marks(after)).toEqual([]);expect(after.players[1].wizard.damageCubes).toBe(0);expect(after.players[2].wizard.damageByPlayer).toEqual({p2:2});conserved(after);
 });
 it('also ignores an evocation attack when Pain Mark is bound directly to that evocation',()=>{
  let s=fixture();const e=summonEvocation(s,s.players[1],'SUCCUBUS',{q:0,r:0})!;
  delete s.ongoingSpells![0].targetPlayerId;s.ongoingSpells![0].targetEvocationId=e.id;
  s=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p2',evocationId:e.id});s=applyAction(s,{type:'EVOCATION_ATTACK',playerId:'p2',targetId:'p3'});
  expect(marks(s)).toEqual([]);expect(s.evocations.find(m=>m.id===e.id)!.damageCubes).toBe(0);conserved(s);
 });
 it.each(['EXPLORE','ATTACK'] as const)('ignores room damage even when activated inside the %s physical menu',kind=>{
  let s=fixture();s.board.rooms.find(r=>r.id==='room-0,0')!.effect='ROOM_DAMAGE';
  s=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p2',kind});s=applyAction(s,{type:'ACTIVATE_ROOM',playerId:'p2'});
  expect(marks(s)).toEqual([]);expect(s.players[0].wizard.damageByPlayer).toEqual({p2:1});expect(s.players[1].wizard.damageCubes).toBe(0);
  if(kind==='ATTACK'){s=applyAction(s,{type:'INFLICT_ATTACK',playerId:'p2',targetId:'p3'});expect(marks(s)).toHaveLength(1);}
  conserved(s);
 });
 it.each(['START','END'] as const)('ignores legacy PUNCH room damage at %s without suppressing the actual punch',roomEffect=>{
  const s=fixture();s.board.rooms.find(r=>r.id==='room-0,0')!.effect='ROOM_DAMAGE';
  const after=applyAction(s,{type:'PUNCH',playerId:'p2',targetId:'p3',roomEffect});expect(marks(after)).toHaveLength(1);expect(after.players[1].wizard.damageCubes).toBe(2);conserved(after);
 });
 it.each([false,true])('ignores a quest reward’s damage and quest solving itself (damaging=%s)',damaging=>{
  const s=fixture(),quest=s.questDeck.shift()!;quest.completed=true;quest.claimed=false;
  if(damaging)quest.rewardAction=prepare(s,[moment.damage(1)]);else delete quest.rewardAction;
  s.players[1].prepared.rapid=null;s.players[1].quest=quest;
  const after=applyAction(s,{type:'USE_QUEST_REWARD',playerId:'p2',questId:quest.id,...(damaging?{targetPlayerId:'p3'}:{})});
  expect(marks(after)).toEqual([]);expect(after.players[1].wizard.damageCubes).toBe(0);expect(after.players[2].wizard.damageCubes).toBe(damaging?1:0);conserved(after);
 });
 it('tracks nested spell damage as a spell, not as the surrounding room activation',()=>{
  const s=fixture();s.currentPlayerId='p3';s.activation!.playerId='p3';s.board.rooms.find(r=>r.id==='room-0,0')!.effect='ROOM_DAMAGE';
  const card:Card={id:s.library[0].cards.shift()!.id,name:'Room retaliation',kind:'SPELL',target:'MAGE',range:Infinity,moments:[moment.damage(1)],spellType:'TRAP',trigger:{event:'ROOM_ACTIVATED',relation:'ENEMY',scope:'ANY'}};
  s.readiedSpells!.push({id:'retaliation',playerId:'p2',card});s.activeSpellOrder!.push('retaliation');
  let paused=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p3',kind:'EXPLORE'});paused=applyAction(paused,{type:'ACTIVATE_ROOM',playerId:'p3'});
  expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL');const restored:GameState=JSON.parse(JSON.stringify(paused));upgradeLegacyCards(restored);
  const after=applyAction(restored,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:paused.pendingDecision!.key,activeSpellId:'retaliation',targetId:'p3'});
  expect(marks(after)).toHaveLength(1);expect(after.players[1].wizard.damageByPlayer).toEqual({p3:1,p1:2});conserved(after);
 });
 it('still filters legacy in-flight Pain Marks without the newly declared damage origins',()=>{
  const s=fixture();delete s.ongoingSpells![0].card.ongoing!.trigger.damageOrigins;s.board.rooms.find(r=>r.id==='room-0,0')!.effect='ROOM_DAMAGE';
  const started=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p2',kind:'EXPLORE'});expect(marks(applyAction(started,{type:'ACTIVATE_ROOM',playerId:'p2'}))).toEqual([]);
  const saved=JSON.parse(JSON.stringify(s));upgradeLegacyCards(saved);expect(saved.ongoingSpells[0].card.ongoing.trigger.damageOrigins).toEqual(['MAGE_PHYSICAL','SPELL']);
 });
});

describe('friendly damage and ordinary damage conversion remain blocked',()=>{
 it('still converts recent foreign cubes on an enemy mage and returns their physical supply',()=>{
  const s=fixture(),mage=s.players[2].wizard;mage.damageCubes=4;mage.blackDamage=1;mage.damageByPlayer={p1:2,p3:1};mage.damageOrder=['p1','p3','black-rose','p1'];
  s.players[0].cubes.available-=2;s.players[0].cubes.onWizard+=2;s.players[2].cubes.available--;s.players[2].cubes.onWizard++;
  prepare(s,[moment.blackRoseConvert(2)]);
  const after=applyAction(s,{type:'CAST_SPELL',playerId:'p2',slot:'rapid',targetPlayerId:'p3'});
  expect(after.players[2].wizard).toMatchObject({damageCubes:4,blackDamage:3,damageByPlayer:{p3:1},damageOrder:['black-rose','p3','black-rose','black-rose']});
  expect(after.players[0].cubes.available).toBe(25);expect(marks(after)).toEqual([]);conserved(after);
 });
 it.each(['DAMAGE','CONVERT','BLACK_ROSE_CONVERT'] as const)('ignores %s on the caster, including stale includeFriendly flags',effect=>{
  const s=fixture();wounded(s,'p2');const before=structuredClone(s.players[1].wizard);
  prepare(s,[{effect,amount:2,includeFriendly:true} as Moment],'SELF');
  const after=applyAction(s,{type:'CAST_SPELL',playerId:'p2',slot:'rapid'});
  expect(after.players[1].wizard).toEqual(before);expect(after.feedbackEvents!.filter(e=>e.kind==='DAMAGE'||e.kind==='CONVERT')).toEqual([]);conserved(after);
 });
 it.each(['DAMAGE','CONVERT','BLACK_ROSE_CONVERT'] as const)('ignores %s on a friendly evocation while preserving support effects',effect=>{
  const s=fixture(),e=summonEvocation(s,s.players[1],'SUCCUBUS',{q:0,r:0})!;wounded(s,e.id);
  prepare(s,[{effect,amount:2,includeFriendly:true} as Moment,moment.heal(1)],'EVOCATION');
  const after=applyAction(s,{type:'CAST_SPELL',playerId:'p2',slot:'rapid',targetEvocationId:e.id});
  expect(after.evocations.find(m=>m.id===e.id)!.damageCubes).toBe(1);expect(after.evocations.find(m=>m.id===e.id)!.damageByPlayer).toEqual({p3:1});
  expect(after.feedbackEvents!.filter(e=>e.kind==='DAMAGE'||e.kind==='CONVERT')).toEqual([]);conserved(after);
 });
 it('does not let EVENT_ACTOR instructions hurt their owner or recursively trigger their own mark',()=>{
  const s=fixture();s.ongoingSpells![0].playerId='p2';prepare(s,[moment.damage(1)]);
  const after=applyAction(s,{type:'CAST_SPELL',playerId:'p2',slot:'rapid',targetPlayerId:'p3'});
  expect(marks(after)).toHaveLength(1);expect(after.players[1].wizard.damageCubes).toBe(0);expect(after.players[1].cubes.onWizard).toBe(1);conserved(after);
 });
 it('keeps death splash off the caster while still damaging nearby enemy mages',()=>{
  const s=fixture();s.players[2].wizard.health=1;prepare(s,[moment.damage(1,{range:1,when:'AFTER_DEFEAT'})]);
  const after=applyAction(s,{type:'CAST_SPELL',playerId:'p2',slot:'rapid',targetPlayerId:'p3'});
  expect(after.feedbackEvents!.filter(e=>e.kind==='DAMAGE'&&e.target.id==='p2').every(e=>e.sourceId==='p1')).toBe(true);
  expect(after.feedbackEvents!.some(e=>e.kind==='DAMAGE'&&e.target.id==='p4'&&e.sourceId==='p2')).toBe(true);conserved(after);
 });
 it('keeps neutral Pain and its optional Soul Tithe separate from friendly player damage',()=>{
  const s=fixture(),e=summonEvocation(s,s.players[1],'SUCCUBUS',{q:0,r:0})!;prepare(s,[moment.pain(1)],'SELF');
  const paused=applyAction(s,{type:'CAST_SPELL',playerId:'p2',slot:'rapid'});expect(paused.pendingDecision?.kind).toBe('SOUL_TITHE');
  const after=applyAction(paused,{type:'RESPOND_SOUL_TITHE',playerId:'p2',accept:true});
  expect(after.evocations.find(m=>m.id===e.id)!.damageCubes).toBe(1);expect(marks(after)).toEqual([]);conserved(after);
 });
});