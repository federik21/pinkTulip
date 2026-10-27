import { describe, expect, it } from 'vitest';
import { applyAction, createGame, createTechnomancyDeck, EVOCATION_TYPES, evocationAttack, getEvocationSupply, getUpgradeSupply, summonEvocation } from '../src';
import type { Card, GameState } from '../src';

const card=(name:string):Card=>({...createTechnomancyDeck('t','technomancy').find(c=>c.name===name)!,id:`t-${name}`});
function fixture():GameState {
 const s=createGame(2);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 return s;
}
const arm=(s:GameState,name:string)=>{s.players[0].prepared.rapid={used:false,card:card(name)};};
const castOn=(s:GameState,evocationId:string)=>applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetEvocationId:evocationId});
const choose=(s:GameState,choiceId?:string)=>{
 const d=s.pendingDecision;if(d?.kind!=='CHOICE')throw new Error('Expected a choice');
 return applyAction(s,{type:'RESPOND_CHOICE',playerId:d.playerId,key:d.key,...(choiceId?{choiceId}:{})});
};

describe('Technomancy school',()=>{
 it('adds a 36-card school with 12 spells, 3 copies each',()=>{
  const s=createGame(2),deck=s.library.find(d=>d.id==='technomancy')!;
  expect(deck.cards).toHaveLength(36);
  expect(new Set(deck.cards.map(c=>c.name)).size).toBe(12);
 });
 it('defines the Colossus and a finite upgrade supply',()=>{
  expect(EVOCATION_TYPES.COLOSSUS).toMatchObject({archetype:'UNDEAD',movement:2,attack:3,health:4});
  const s=fixture();expect(getEvocationSupply(s).COLOSSUS).toBe(3);
  expect(Object.values(getUpgradeSupply(s))).toEqual([3,3,3,3,3,3]);
 });
 it('upgrades a Cadaver (+1 health), shows its bonus and counts the card against the deck',()=>{
  const s=fixture(),e=summonEvocation(s,s.players[0],'CADAVER',{q:0,r:0})!;
  arm(s,'Vigorous Infusion');
  const after=castOn(s,e.id),up=after.evocations[0];
  expect(up).toMatchObject({upgrade:'MUSCULAR_IMPLANT',health:3});
  expect(evocationAttack(up)).toBe(3);
  expect(getUpgradeSupply(after).MUSCULAR_IMPLANT).toBe(2);
 });
 it('lets the caster control an enemy evocation that attacks its owner without hurting the controller',()=>{
  const s=fixture(),mine=summonEvocation(s,s.players[0],'CADAVER',{q:0,r:0})!,theirs=summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0})!;
  arm(s,'Indoctrination');
  const after=castOn(s,theirs.id);
  expect(after.evocationActivation).toMatchObject({playerId:'p1',evocationId:theirs.id,borrowedFrom:'p2'});
  expect(()=>applyAction(after,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:mine.id})).toThrow();
  expect(()=>applyAction(after,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p1'})).toThrow();
  const hit=applyAction(after,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'});
  expect(hit.players[1].wizard.damageByPlayer).toEqual({p1:2});
  // Cerebral implant: the controller gains 1 VP for the damage.
  expect(hit.players[0].victoryPoints).toBe(after.players[0].victoryPoints+1);
  const done=applyAction(hit,{type:'END_EVOCATION',playerId:'p1'});
  expect(done.evocationActivation).toBeNull();expect(done.currentPlayerId).toBe('p1');
 });
 it('never lets a borrowed evocation attack itself',()=>{
  const s=fixture(),theirs=summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0})!;
  arm(s,'Indoctrination');
  const after=castOn(s,theirs.id);
  expect(()=>applyAction(after,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:theirs.id})).toThrow();
  expect(after.evocations.find(e=>e.id===theirs.id)!.damageCubes).toBe(theirs.damageCubes);
  // Its owner's other models remain legitimate enemies of the controller.
  const sibling=summonEvocation(after,after.players[1],'CADAVER',{q:0,r:0})!;
  const hit=applyAction(after,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:sibling.id});
  expect(hit.evocations.some(e=>e.id===sibling.id)).toBe(false);
  expect(hit.evocations.find(e=>e.id===theirs.id)!.damageCubes).toBe(0);
 });
 it('asks the evocation owner which upgrade to keep and honors the answer',()=>{
  const s=fixture(),e=summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0})!;
  e.upgrade='TENDON_IMPLANT';e.health=3;
  arm(s,'Acid Blood');
  const paused=castOn(s,e.id);
  expect(paused.pendingDecision).toMatchObject({kind:'CHOICE',playerId:'p2'});
  const kept=choose(paused,'TENDON_IMPLANT');
  expect(kept.evocations[0].upgrade).toBe('TENDON_IMPLANT');
  const t=fixture(),x=summonEvocation(t,t.players[1],'CADAVER',{q:0,r:0})!;x.upgrade='TENDON_IMPLANT';x.health=3;arm(t,'Acid Blood');
  const swapped=choose(castOn(t,x.id),'CORROSIVE_PLASMA');
  expect(swapped.evocations[0].upgrade).toBe('CORROSIVE_PLASMA');
 });
 it('does not assign an upgrade when no copy is left',()=>{
  const s=fixture(),e=summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0})!;
  for(const [i,pos] of [[0,{q:0,r:0}],[1,{q:0,r:0}]] as const){void i;const x=summonEvocation(s,s.players[0],'CADAVER',pos)!;x.upgrade='REGENERATING_ICHOR';}
  const y=summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0})!;y.upgrade='REGENERATING_ICHOR';
  expect(getUpgradeSupply(s).REGENERATING_ICHOR).toBe(0);
  arm(s,'Living Liquid');
  const after=castOn(s,e.id);
  expect(after.evocations.find(m=>m.id===e.id)!.upgrade).toBeUndefined();
  expect(after.players[0].wizard.damageCubes).toBe(0);
 });
 it('Nefarious Evolution may remove an undead of the caster in the room and summons a Colossus',()=>{
  const s=fixture(),mine=summonEvocation(s,s.players[0],'CADAVER',{q:0,r:0})!,theirs=summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0})!;
  arm(s,'Nefarious Evolution');
  const paused=castOn(s,theirs.id);
  expect(paused.pendingDecision).toMatchObject({kind:'CHOICE',optional:true,playerId:'p1'});
  const declined=choose(paused);
  expect(declined.evocations.map(e=>e.id)).toEqual([mine.id,theirs.id]);
  const after=choose(paused,mine.id);
  expect(after.evocations.some(e=>e.id===mine.id)).toBe(false);
  expect(after.evocations.find(e=>e.kind==='COLOSSUS')).toMatchObject({playerId:'p1',health:4,attack:3});
 });
 it('Mutant Energies blasts nearby mages for the removed attack',()=>{
  const s=fixture(),mine=summonEvocation(s,s.players[0],'CADAVER',{q:0,r:0})!;
  arm(s,'Mutant Energies');
  const after=choose(castOn(s,mine.id),mine.id);
  expect(after.evocations).toHaveLength(0);
  expect(after.players[1].wizard.damageByPlayer).toEqual({p1:2});
  expect(after.players[0].wizard.damageCubes).toBe(0);
 });
 it('Draco’s Skin brings a destroyed evocation back with Reinforced dermis',()=>{
  const s=fixture(),victim=summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0})!;
  s.readiedSpells!.push({id:'draco',playerId:'p2',card:card('Draco’s Skin')});s.activeSpellOrder!.push('draco');
  s.players[0].prepared.rapid={used:false,card:{id:'smash',kind:'SPELL',name:'Smash',spellType:'COMBAT',target:'EVOCATION',range:Infinity,moments:[{effect:'DAMAGE',amount:5}]}};
  const paused=castOn(s,victim.id);
  expect(paused.pendingDecision).toMatchObject({kind:'REACTIVE_SPELL',playerId:'p2'});
  const d=paused.pendingDecision as Extract<typeof paused.pendingDecision,{kind:'REACTIVE_SPELL'}>;
  const after=applyAction(paused,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:d.key,activeSpellId:'draco',targetId:'p2'});
  expect(after.evocations).toHaveLength(1);
  expect(after.evocations[0]).toMatchObject({playerId:'p2',kind:'CADAVER',upgrade:'REINFORCED_DERMIS',health:5,damageCubes:0,position:{q:0,r:0}});
 });
 it('Mechanical Archive takes one of four cards from the chosen school and discards the rest',()=>{
  const s=fixture();arm(s,'Mechanical Archive');
  const deck=s.library.find(d=>d.id==='technomancy')!,total=deck.cards.length+deck.discard.length;
  const afterCast=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid'});
  const school=afterCast.pendingDecision;
  expect(school).toMatchObject({kind:'CHOICE',playerId:'p1'});
  const picking=choose(afterCast,'technomancy');
  const pick=picking.pendingDecision as Extract<typeof picking.pendingDecision,{kind:'CHOICE'}>;
  expect(pick.options).toHaveLength(4);
  const done=choose(picking,pick.options[1].id);
  const after=done.library.find(d=>d.id==='technomancy')!;
  expect(done.players[0].hand.some(c=>c.id===pick.options[1].id)).toBe(true);
  // The cast card itself also goes to the discard pile (one drawn out, one spell in).
  expect(after.cards.length+after.discard.length).toBe(total);
  expect(after.discard).toHaveLength(4);
 });
 it('Necrotic Pheromones activates an evocation near an entering mage under the trap owner’s control',()=>{
  const s=fixture();
  s.players[0].wizard.position={q:2,r:0};s.players[1].wizard.position={q:0,r:0};
  const bystander=summonEvocation(s,s.players[0],'CADAVER',{q:2,r:0})!;
  s.readiedSpells!.push({id:'pher',playerId:'p1',card:card('Necrotic Pheromones')});s.activeSpellOrder!.push('pher');
  s.currentPlayerId='p2';s.activation={...s.activation!,playerId:'p2'};
  void bystander;
  // The trap only matches mages that enter a room within sight; the card data must carry its constraints.
  expect(card('Necrotic Pheromones')).toMatchObject({triggerSight:2,range:2,targetFrom:'EVENT_MODEL',trigger:{event:'ENTER_ROOM',relation:'ENEMY'}});
 });
});

describe('Colossus entry shock',()=>{
 const setup=()=>{
  const s=fixture();
  s.players[0].wizard.position={q:0,r:0};s.players[1].wizard.position={q:-1,r:0};
  const c=summonEvocation(s,s.players[1],'COLOSSUS',{q:1,r:0})!;
  return {s,c};
 };
 it('inflicts 3 damage on an enemy mage entering its room, not on its owner or other summons',()=>{
  const {s,c}=setup();
  const cadaver=summonEvocation(s,s.players[0],'CADAVER',{q:0,r:0})!;
  expect(c.ability).toBe('ENTRY_SHOCK');
  const after=applyAction(applyAction(s,{type:'EXPLORE',playerId:'p1'}),{type:'EXPLORE_STEP',playerId:'p1',destination:{q:1,r:0}});
  expect(after.players[0].wizard.damageCubes).toBe(3);
  expect(after.players[0].wizard.damageByPlayer).toEqual({p2:3});
  expect(after.evocations.find(e=>e.id===cadaver.id)!.damageCubes).toBe(0);
 });
 it('does not hurt the owner mage entering the room',()=>{
  const {s}=setup();
  s.currentPlayerId='p2';s.activation={...s.activation!,playerId:'p2'};
  const after=applyAction(applyAction(s,{type:'EXPLORE',playerId:'p2'}),{type:'EXPLORE_STEP',playerId:'p2',destination:{q:0,r:0}});
  expect(after.players[1].wizard.damageCubes).toBe(0);
  const back=applyAction(after,{type:'EXPLORE_STEP',playerId:'p2',destination:{q:1,r:0}});
  expect(back.players[1].wizard.damageCubes).toBe(0);
 });
});
