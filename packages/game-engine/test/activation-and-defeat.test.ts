import { describe, expect, it } from 'vitest';
import { applyAction, createGame, moment, spellCanTargetModel, summonEvocation } from '../src';
import type { Card, GameAction, GameState } from '../src';

const origin={q:0,r:0};
function fixture():GameState {
 const s=createGame(3);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players)p.wizard.position={...origin};
 return s;
}
function reject(s:GameState,action:GameAction,message:RegExp) {
 const before=structuredClone(s);expect(()=>applyAction(s,action)).toThrow(message);expect(s).toEqual(before);
}
function activated(phase:'ACTION'|'EVOCATION') {
 const s=fixture();s.phase=phase;
 if(phase==='ACTION')s.activation!.actionsUsed=1;
 else s.activation=null;
 const e=summonEvocation(s,s.players[0],'CADAVER',origin)!;
 summonEvocation(s,s.players[1],'CADAVER',origin);
 return applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:e.id});
}
const attack:GameAction={type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'};
const stop:GameAction={type:'END_EVOCATION_MOVEMENT',playerId:'p1'};
const finish:GameAction={type:'END_EVOCATION',playerId:'p1'};

describe.each(['ACTION','EVOCATION'] as const)('%s evocation effects in either order',phase=>{
 it('attacks once, retains movement, and waits for the final step before handing off',()=>{
  let s=activated(phase);const tokens=s.players[0].actionTokens;
  s=applyAction(s,attack);
  expect(s.evocationActivation).toMatchObject({attackUsed:true,movesRemaining:2});expect(s.currentPlayerId).toBe('p1');
  reject(s,attack,/attack already used/);
  reject(s,{type:'END_ACTIVATION',playerId:'p1'},phase==='ACTION'?/active evocation/:/unavailable/);
  s=applyAction(s,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:1,r:0}});
  expect(s.evocationActivation?.movesRemaining).toBe(1);
  s=applyAction(s,{type:'EVOCATION_STEP',playerId:'p1',destination:origin});
  expect(s.evocationActivation).toBeNull();expect(s.currentPlayerId).toBe('p2');
  expect(s.players[1].wizard.damageCubes).toBe(2);expect(s.players[0].actionTokens).toBe(tokens);
 });
 it('stops movement early and can still attack afterward',()=>{
  let s=activated(phase);s.players[1].wizard.position={q:1,r:0};
  s=applyAction(s,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:1,r:0}});
  s=applyAction(s,stop);
  expect(s.evocationActivation).toMatchObject({movesRemaining:0});
  reject(s,{type:'EVOCATION_STEP',playerId:'p1',destination:origin},/movement remaining/);
  s=applyAction(s,attack);expect(s.evocationActivation).toBeNull();expect(s.currentPlayerId).toBe('p2');
 });
 it('can attack only, then skip its unused movement',()=>{
  const s=applyAction(applyAction(activated(phase),attack),stop);
  expect(s.evocationActivation).toBeNull();expect(s.players[1].wizard.damageCubes).toBe(2);
 });
 it('can move only and finish without an attack',()=>{
  let s=activated(phase);
  s=applyAction(s,{type:'EVOCATION_STEP',playerId:'p1',destination:{q:1,r:0}});
  s=applyAction(s,stop);expect(s.evocationActivation?.movesRemaining).toBe(0);
  s=applyAction(s,finish);expect(s.evocationActivation).toBeNull();
  expect(s.players[1].wizard.damageCubes).toBe(0);
 });
});

describe('only printed SELF spells select the caster mage',()=>{
 it.each(['MAGE','MODEL'] as const)('rejects self-mage %s selections even with healing, conversion, Protection or ongoing effects',target=>{
  for(const effects of [[moment.heal(1)],[moment.convert(1)],[]]) {
   const card:Card={id:'support',name:'Support',kind:'SPELL',target,range:1,moments:effects,spellType:'CONTINGENCY',
    ongoing:{trigger:{event:'DAMAGE_TAKEN',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'HEAL',amount:1,target:'BOUND_MODEL'}]}};
   expect(spellCanTargetModel(card,'p1','p1','MAGE')).toBe(false);
   expect(spellCanTargetModel({...card,spellType:'PROTECTION'},'p1','p1','MAGE')).toBe(false);
   expect(spellCanTargetModel(card,'p1','p2','MAGE')).toBe(true);
   const s=fixture();s.players[0].prepared.rapid={card,used:false};
   reject(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p1'},/cannot target/);
  }
 });
 it('keeps SELF healing and friendly-evocation support legal',()=>{
  const s=fixture(),card:Card={id:'self-heal',name:'Self heal',kind:'SPELL',target:'SELF',range:0,moments:[moment.heal(1)]};
  s.players[0].wizard.damageCubes=1;s.players[0].wizard.blackDamage=1;s.players[0].prepared.rapid={card,used:false};
  expect(applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid'}).players[0].wizard.damageCubes).toBe(0);
  expect(spellCanTargetModel({...card,target:'MODEL'},'p1','p1','EVOCATION')).toBe(true);
 });
});

function lethalFixture(moments=[moment.damage(1)],trigger:'DAMAGE_TAKEN'|'MAGE_DEFEATED'='MAGE_DEFEATED') {
 const s=fixture();s.players[1].wizard.damageCubes=9;s.players[1].wizard.damageByPlayer={p1:9};
 s.players[1].wizard.damageOrder=Array(9).fill('p1');s.players[0].cubes.available=16;s.players[0].cubes.onWizard=9;
 s.players[0].prepared.rapid={used:false,card:{id:'lethal',name:'Lethal',kind:'SPELL',target:'MAGE',range:0,moments}};
 s.readiedSpells!.push({id:'rescue',playerId:'p2',card:{id:'rescue-card',name:'Last chance',kind:'SPELL',spellType:'PROTECTION',target:'SELF',range:0,
  moments:[moment.heal(2)],trigger:{event:trigger,relation:'ENEMY',scope:'BOUND_MODEL'}}});
 s.activeSpellOrder!.push('rescue');return s;
}
function strike(s:GameState) {return applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});}
function respond(s:GameState,reveal=true) {
 const d=s.pendingDecision;if(d?.kind!=='REACTIVE_SPELL')throw new Error('Expected a defeat reaction');
 return applyAction(s,{type:'RESPOND_REACTIVE_SPELL',playerId:d.playerId,key:d.key,...(reveal?{activeSpellId:d.options[0].activeSpellId,targetId:'p2'}:{})});
}
describe('defeat reactions happen before scoring and respawn',()=>{
 it('allows a SELF heal to rescue a lethally wounded mage without points, kills or trophy',()=>{
  const s=lethalFixture(),before=structuredClone(s),paused=strike(s);
  expect(s).toEqual(before);expect(paused.pendingDecision).toMatchObject({kind:'REACTIVE_SPELL',event:'MAGE_DEFEATED',playerId:'p2'});
  expect(paused.players[0]).toMatchObject({victoryPoints:0,kills:0,trophies:[]});
  const result=respond(paused);
  expect(result.players[1].wizard).toMatchObject({damageCubes:8,damageByPlayer:{p1:8},position:origin});
  expect(result.players[0]).toMatchObject({victoryPoints:0,kills:0,trophies:[],cubes:{available:17,onWizard:8}});
  expect(result.feedbackEvents!.some(e=>e.kind==='MAGE_DEFEATED')).toBe(false);
  expect(result.players[1].discard.some(c=>c.name==='Last chance')).toBe(true);
 });
 it('scores and respawns only if the owner declines rescue',()=>{
  const result=respond(strike(lethalFixture()),false);
  expect(result.players[0]).toMatchObject({victoryPoints:5,kills:1,trophies:['p2'],cubes:{available:25,onWizard:0}});
  expect(result.players[1].wizard.damageCubes).toBe(0);expect(result.players[1].wizard.position).not.toEqual(origin);
  expect(result.feedbackEvents!.filter(e=>e.kind==='MAGE_DEFEATED')).toHaveLength(1);
 });
 it('cancels the defeat window when an earlier DAMAGE_TAKEN reaction already healed the mage',()=>{
  const result=respond(strike(lethalFixture(undefined,'DAMAGE_TAKEN')));
  expect(result.pendingDecision).toBeUndefined();expect(result.players[1].wizard.damageCubes).toBe(8);
  expect(result.players[0].victoryPoints).toBe(0);expect(result.feedbackEvents!.some(e=>e.kind==='MAGE_DEFEATED')).toBe(false);
 });
 it('resumes later spell moments against a rescued mage, then settles a later lethal hit once',()=>{
  const result=respond(strike(lethalFixture([moment.damage(1),moment.damage(2)])));
  expect(result.players[0]).toMatchObject({victoryPoints:5,kills:1,trophies:['p2']});
  expect(result.feedbackEvents!.filter(e=>e.kind==='MAGE_DEFEATED')).toHaveLength(1);
  expect(result.feedbackEvents!.filter(e=>e.kind==='DAMAGE').map(e=>e.kind==='DAMAGE'&&e.amount)).toEqual([1,2]);
 });
 it('ranks the post-reaction contribution ledger, not the ledger at the lethal hit',()=>{
  const s=lethalFixture();s.readiedSpells=[];s.activeSpellOrder=[];
  s.readiedSpells.push({id:'convert',playerId:'p3',card:{id:'convert-card',name:'Last conversion',kind:'SPELL',spellType:'TRAP',target:'MODEL',range:0,
   moments:[moment.convert(3)],trigger:{event:'MAGE_DEFEATED',relation:'ENEMY',scope:'ANY'}}});s.activeSpellOrder.push('convert');
  const result=respond(strike(s));
  expect(result.players[0].victoryPoints).toBe(4);expect(result.players[2].victoryPoints).toBe(2);
  const recap=result.feedbackEvents!.find(e=>e.kind==='MAGE_DEFEATED');
  expect(recap).toMatchObject({contributions:{p1:7,p3:3}});
  const kinds=result.feedbackEvents!.map(e=>e.kind);expect(kinds.indexOf('CONVERT')).toBeLessThan(kinds.indexOf('MAGE_DEFEATED'));
 });
 it('does not run the target-defeated moment when a reaction prevents defeat',()=>{
  const result=respond(strike(lethalFixture([moment.damage(1),moment.ifTargetDefeated(moment.nearTarget(moment.damage(2),1))])));
  expect(result.players[2].wizard.damageCubes).toBe(0);expect(result.players[1].wizard.damageCubes).toBe(8);
 });
 it('also cancels Pink Tulip defeat credit and the defeated-mage reward when Pain is healed',()=>{
  const s=fixture();s.players[0].wizard.damageCubes=9;s.players[0].wizard.blackDamage=9;
  s.players[0].prepared.rapid={used:false,card:{id:'pain',name:'Pain',kind:'SPELL',target:'SELF',range:0,moments:[moment.pain(1)]}};
  s.readiedSpells=[{id:'neutral-rescue',playerId:'p1',card:{id:'neutral-card',name:'Neutral rescue',kind:'SPELL',spellType:'PROTECTION',target:'SELF',range:0,
   moments:[moment.heal(2)],trigger:{event:'MAGE_DEFEATED',relation:'ANY',scope:'BOUND_MODEL'}}}];s.activeSpellOrder=['neutral-rescue'];
  const paused=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid'}),d=paused.pendingDecision!;
  const result=applyAction(paused,{type:'RESPOND_REACTIVE_SPELL',playerId:'p1',key:d.key,activeSpellId:'neutral-rescue',targetId:'p1'});
  expect(result.players[0].wizard).toMatchObject({damageCubes:8,blackDamage:8,position:origin});
  expect(result.players[0].victoryPoints).toBe(0);expect(result.blackRose).toEqual({victoryPoints:0,kills:0});
 });
 it('settles each lethal room target independently, rescuing one without rescuing another',()=>{
  const s=lethalFixture();s.players[0].prepared.rapid!.card.target='ROOM';
  s.players[2].wizard.damageCubes=9;s.players[2].wizard.damageByPlayer={p1:9};s.players[2].wizard.damageOrder=Array(9).fill('p1');
  s.players[0].cubes.available=7;s.players[0].cubes.onWizard=18;
  const paused=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
  const result=respond(paused);
  expect(result.players[1].wizard).toMatchObject({damageCubes:8,position:origin});
  expect(result.players[2].wizard.damageCubes).toBe(0);expect(result.players[2].wizard.position).not.toEqual(origin);
  expect(result.players[0]).toMatchObject({victoryPoints:5,kills:1,trophies:['p3'],cubes:{available:17,onWizard:8}});
  expect(result.feedbackEvents!.filter(e=>e.kind==='MAGE_DEFEATED')).toHaveLength(1);
 });
});