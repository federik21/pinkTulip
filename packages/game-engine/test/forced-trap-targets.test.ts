import { describe, expect, it } from 'vitest';
import { applyAction, createAgonyDeck, createGame, moment, summonEvocation, upgradeLegacyCards } from '../src';
import type { ActiveSpell, Card, GameAction, GameState, Hex, Moment, PendingDecision } from '../src';

const origin:Hex={q:0,r:0};
const offAxis:Hex={q:1,r:1};
type TrapName='Torment'|'Master of Pleasure'|'Liquefy the Pain';

function fixture():GameState {
 const s=createGame(4);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={...origin};}
 return s;
}
function arm(s:GameState,name:TrapName,owner='p3',id=name as string):ActiveSpell {
 // Reserve a real, unique physical copy rather than inheriting shuffled metadata.
 const deck=s.library.find(d=>d.id==='agony')!;
 const card=createAgonyDeck('agony','agony').find(c=>c.name===name&&deck.cards.some(stock=>stock.id===c.id))!;
 expect(card).toBeDefined();deck.cards.splice(deck.cards.findIndex(c=>c.id===card.id),1);
 const active={id,playerId:owner,card};s.readiedSpells!.push(active);s.activeSpellOrder!.push(id);return active;
}
function prepare(s:GameState,moments:Moment[]=[moment.damage(1)],target:Card['target']='MODEL') {
 const card:Card={id:'fixture-strike',name:'Fixture strike',kind:'SPELL',spellType:'COMBAT',target,range:Infinity,moments};
 s.players[0].prepared.rapid={card,used:false};
}
function cast(s:GameState,moments:Moment[]=[moment.damage(1)],targetId='p2') {
 prepare(s,moments);
 return applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',
  ...(s.players.some(p=>p.id===targetId)?{targetPlayerId:targetId}:{targetEvocationId:targetId})});
}
function physicalHit(s:GameState,targetId='p2') {
 const begun=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'ATTACK'});
 return applyAction(begun,{type:'INFLICT_ATTACK',playerId:'p1',targetId});
}
function cadaver(s:GameState,owner:string,id:string,position:Hex=origin) {
 const e=summonEvocation(s,s.players.find(p=>p.id===owner)!,'CADAVER',position)!;
 expect(e).toBeDefined();e.id=id;return e;
}
function evocationHit(s:GameState,targetId='p2') {
 const activated=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'dealer'});
 return applyAction(activated,{type:'EVOCATION_ATTACK',playerId:'p1',targetId});
}
function decision(s:GameState):Extract<PendingDecision,{kind:'REACTIVE_SPELL'}> {
 expect(s.pendingDecision?.kind).toBe('REACTIVE_SPELL');
 if(s.pendingDecision?.kind!=='REACTIVE_SPELL')throw new Error('Expected a reactive spell decision');
 return s.pendingDecision;
}
function targets(s:GameState,activeSpellId=decision(s).options[0].activeSpellId) {
 const option=decision(s).options.find(o=>o.activeSpellId===activeSpellId)!;
 expect(option).toBeDefined();return option.targets.map(t=>t.id);
}
function respond(s:GameState,activeSpellId?:string,targetId?:string) {
 const d=decision(s);
 return applyAction(s,{type:'RESPOND_REACTIVE_SPELL',playerId:d.playerId,key:d.key,
  ...(activeSpellId?{activeSpellId}:{}),...(targetId===undefined?{}:{targetId})});
}
function reject(s:GameState,action:GameAction) {
 const before=structuredClone(s);expect(()=>applyAction(s,action)).toThrow(/eligible spell and target/);expect(s).toEqual(before);
}
function forgedTargets(s:GameState,activeSpellId:string,ids:string[]) {
 const d=decision(s);
 for(const targetId of ids)reject(s,{type:'RESPOND_REACTIVE_SPELL',playerId:d.playerId,key:d.key,activeSpellId,targetId});
}
const hits=(s:GameState,id:string)=>s.feedbackEvents!.flatMap(e=>e.kind==='DAMAGE'&&e.target.id===id?[e.amount]:[]);
const triggers=(s:GameState)=>s.feedbackEvents!.filter(e=>e.kind==='SPELL_TRIGGERED');
const succubi=(s:GameState,owner:string)=>s.evocations.filter(e=>e.kind==='SUCCUBUS'&&e.playerId===owner);
function hidden(s:GameState,active:ActiveSpell) {
 expect(s.readiedSpells).toContainEqual(active);
 expect(s.players.find(p=>p.id===active.playerId)!.discard.some(c=>c.id===active.card.id)).toBe(false);
 expect(triggers(s).some(e=>e.activeSpellId===active.id)).toBe(false);
 expect(s.log.join(' ')).not.toContain(active.card.name);
}
function conserved(s:GameState) {
 for(const p of s.players) {
  expect(Object.values(p.cubes).reduce((a,b)=>a+b,0)).toBe(25);
  expect(p.cubes.onWizard).toBe(s.players.reduce((n,t)=>n+(t.wizard.damageByPlayer[p.id]??0),0));
  expect(p.cubes.onEvocations).toBe(s.evocations.reduce((n,e)=>n+(e.damageByPlayer[p.id]??0),0));
 }
}
function solveQuest(s:GameState) {
 // No rewardAction (and no VP change) can accidentally supply the tested event.
 s.players[0].quest={id:'completed-quest',name:'Harmless completed quest',description:'Already complete.',kind:'ROOM_ACTIVATE',
  amount:1,progress:1,completed:true,claimed:false,reward:0};
 return applyAction(s,{type:'USE_QUEST_REWARD',playerId:'p1',questId:'completed-quest'});
}
function ownDefeat() {
 const s=fixture();s.players[1].wizard.position={...offAxis};s.players[1].wizard.health=1;
 const trap=arm(s,'Liquefy the Pain','p2');return {s,trap};
}
function roundTrip(s:GameState):GameState {
 const restored:GameState=JSON.parse(JSON.stringify(s));upgradeLegacyCards(restored);return restored;
}

describe('Agony forced-target card contracts',()=>{
 it('prints the corrected event, relation, forced target and ordered effects on actual cards',()=>{
  const cards=createAgonyDeck('catalog');
  expect(cards.find(c=>c.name==='Torment')).toMatchObject({spellType:'TRAP',target:'MODEL',range:Infinity,
   trigger:{event:'DAMAGE_DEALT',relation:'ENEMY',scope:'ANY'},triggerTarget:'EVENT_ACTOR',
   moments:[moment.damage(2),moment.summon('SUCCUBUS','TARGET')]});
  expect(cards.find(c=>c.name==='Master of Pleasure')).toMatchObject({spellType:'TRAP',target:'MAGE',range:Infinity,moments:[],
   trigger:{event:'QUEST_SOLVED',relation:'ENEMY',scope:'ANY'},triggerTarget:'EVENT_MODEL',
   triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_MODEL'},{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_MODEL'}]});
  expect(cards.find(c=>c.name==='Liquefy the Pain')).toMatchObject({spellType:'TRAP',target:'ROOM',range:Infinity,moments:[],
   trigger:{event:'MAGE_DEFEATED',relation:'SELF',relationTo:'EVENT_MODEL',scope:'ANY'},triggerTarget:'EVENT_ROOM',
    triggerEffects:[{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_ROOM'},{effect:'ACTIVATE_EVOCATION',kind:'SUCCUBUS',target:'EVENT_ROOM'}]});
 });
});

describe('Torment follows the actual damage dealer',()=>{
 it('damages the mage spell dealer, not its victim or a bystander, and infers an omitted target',()=>{
  const s=fixture(),trap=arm(s,'Torment');s.players[0].wizard.position={...offAxis};prepare(s);
  const before=structuredClone(s);
  const paused=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
  expect(s).toEqual(before);expect(decision(paused)).toMatchObject({playerId:'p3',event:'DAMAGE_DEALT'});
  expect(targets(paused)).toEqual(['p1']);
  const saved=structuredClone(paused),result=respond(paused,trap.id);
  expect(paused).toEqual(saved);expect(result.pendingDecision).toBeUndefined();
  expect(result.players.map(p=>p.wizard.damageCubes)).toEqual([2,1,0,0]);
  expect(triggers(result)[0].target).toMatchObject({kind:'MAGE',id:'p1',roomId:'room-1,1'});
  expect(succubi(result,'p3')).toHaveLength(1);
  expect(succubi(result,'p3')[0]).toMatchObject({position:offAxis,activated:true});
  expect(result.players[2].discard.map(c=>c.id)).toContain(trap.card.id);conserved(result);
 });

 it('also fires after a mage physical hit, with the attacker as its only candidate',()=>{
  const s=fixture(),trap=arm(s,'Torment'),paused=physicalHit(s);
  expect(targets(paused)).toEqual(['p1']);
  const result=respond(paused,trap.id,'p1');
  expect(result.pendingDecision).toBeUndefined();expect(hits(result,'p1')).toEqual([2]);expect(hits(result,'p2')).toEqual([2]);
  expect(result.players[0].actionTokens).toBe(1);expect(succubi(result,'p3')[0].position).toEqual(origin);conserved(result);
 });

 it('retaliates against an evocation that hits a mage, never against its controller',()=>{
  const s=fixture(),trap=arm(s,'Torment');cadaver(s,'p1','dealer');
  const paused=evocationHit(s);expect(targets(paused)).toEqual(['dealer']);
  const result=respond(paused,trap.id);
  expect(result.pendingDecision).toBeUndefined();expect(result.evocations.some(e=>e.id==='dealer')).toBe(false);
  expect(hits(result,'dealer')).toEqual([2]);expect(result.players[0].wizard.damageCubes).toBe(0);
  expect(result.players[1].wizard.damageCubes).toBe(2);expect(succubi(result,'p3')[0].position).toEqual(origin);
  expect(triggers(result)[0].target).toMatchObject({kind:'EVOCATION',id:'dealer'});conserved(result);
 });

 it('emits DAMAGE_DEALT for an evocation hitting and destroying another evocation',()=>{
  const s=fixture(),trap=arm(s,'Torment');cadaver(s,'p1','dealer');cadaver(s,'p2','victim');
  const paused=evocationHit(s,'victim');expect(targets(paused)).toEqual(['dealer']);
  const result=respond(paused,trap.id);
  expect(result.pendingDecision).toBeUndefined();expect(result.evocations.map(e=>e.id)).not.toContain('dealer');
  expect(result.evocations.map(e=>e.id)).not.toContain('victim');
  expect(hits(result,'victim')).toEqual([2]);expect(hits(result,'dealer')).toEqual([2]);
  expect(result.players.map(p=>p.wizard.damageCubes)).toEqual([0,0,0,0]);expect(succubi(result,'p3')).toHaveLength(1);conserved(result);
 });

 it('fires for spell and physical damage to evocations, including a destroyed victim',()=>{
  for(const mode of ['spell','physical'] as const) {
   const s=fixture(),trap=arm(s,'Torment');cadaver(s,'p2','victim');
   const paused=mode==='spell'?cast(s,[moment.damage(1)],'victim'):physicalHit(s,'victim');
   expect(targets(paused)).toEqual(['p1']);
   const result=respond(paused,trap.id);
   expect(result.pendingDecision).toBeUndefined();expect(hits(result,'p1')).toEqual([2]);
   expect(hits(result,'victim')).toEqual([mode==='spell'?1:2]);
   expect(result.evocations.some(e=>e.id==='victim')).toBe(mode==='spell');
   expect(result.players[1].wizard.damageCubes).toBe(0);expect(succubi(result,'p3')).toHaveLength(1);conserved(result);
  }
 });

 it('does not trigger merely because a room is activated without dealing damage',()=>{
  const s=fixture(),trap=arm(s,'Torment');s.board.rooms.find(r=>r.id==='room-0,0')!.effect='INSTABILITY';
  const begun=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'});
  const result=applyAction(begun,{type:'ACTIVATE_ROOM',playerId:'p1'});
  expect(result.pendingDecision).toBeUndefined();hidden(result,trap);expect(result.evocations).toEqual([]);
  expect(result.board.rooms.find(r=>r.id==='room-0,0')!.instability).toBe(1);conserved(result);
 });

 it('can decline one damage occurrence and reveal on a later repeated moment',()=>{
  const s=fixture(),trap=arm(s,'Torment'),first=cast(s,[moment.damage(1),moment.damage(1)]);
  const second=respond(first);expect(decision(second).key).not.toBe(decision(first).key);
  expect(targets(second)).toEqual(['p1']);expect(second.pendingDecision!.resume!.answers).toMatchObject([{accept:false}]);
  const result=respond(second,trap.id);
  expect(result.pendingDecision).toBeUndefined();expect(hits(result,'p2')).toEqual([1,1]);expect(hits(result,'p1')).toEqual([2]);
  expect(result.feedbackEvents!.map(e=>e.kind)).toEqual(['DAMAGE','DAMAGE','SPELL_TRIGGERED','DAMAGE']);
  expect(triggers(result)).toHaveLength(1);expect(succubi(result,'p3')).toHaveLength(1);conserved(result);
 });

 it('does not retarget a second trap after an earlier reaction destroys the evocation dealer',()=>{
  const s=fixture(),first=arm(s,'Torment','p3','first'),saved=arm(s,'Torment','p3','saved');cadaver(s,'p1','dealer');
  const paused=evocationHit(s);expect(decision(paused).options.map(o=>o.activeSpellId)).toEqual(['first','saved']);
  const result=respond(paused,first.id);
  expect(result.pendingDecision).toBeUndefined();expect(result.readiedSpells).toEqual([saved]);
  expect(triggers(result).map(e=>e.activeSpellId)).toEqual(['first']);expect(hits(result,'dealer')).toEqual([2]);
  expect(hits(result,'p1')).toEqual([]);expect(succubi(result,'p3')).toHaveLength(1);conserved(result);
 });

 it('does not bind the old mage dealer snapshot to its respawn after an earlier reaction defeats it',()=>{
  const s=fixture(),first=arm(s,'Torment','p3','first'),saved=arm(s,'Torment','p3','saved');s.players[0].wizard.health=2;
  // Remove starting-room filtering here so generation invalidation, not cell protection, must reject the respawn.
  const start=s.board.rooms.find(r=>r.id===s.players[0].wizard.startingRoomId)!;delete start.startingFor;
  const result=respond(cast(s),first.id);
  expect(result.pendingDecision).toBeUndefined();expect(result.readiedSpells).toEqual([saved]);
  expect(result.players[0].wizard).toMatchObject({position:start.tiles[0],damageCubes:0,alive:true});
  expect(triggers(result).map(e=>e.activeSpellId)).toEqual(['first']);expect(hits(result,'p1')).toEqual([2]);
  expect(succubi(result,'p3')[0].position).toEqual(origin);expect(result.players[2].kills).toBe(1);conserved(result);
 });

 it('rejects forged victims, bystanders, room IDs and mage aliases without mutating a paused action',()=>{
  const s=fixture(),trap=arm(s,'Torment'),paused=cast(s);
  forgedTargets(paused,trap.id,['p2','p4','p1-wizard','room-0,0','missing']);
  expect(respond(paused,trap.id).players[0].wizard.damageCubes).toBe(2);
 });
});

describe('Master of Pleasure follows the enemy quest solver',()=>{
 it('damages the exact solver and summons there after a completed quest with no reward action',()=>{
  const s=fixture(),trap=arm(s,'Master of Pleasure','p2');s.players[0].wizard.position={...offAxis};
  const paused=solveQuest(s);expect(decision(paused)).toMatchObject({playerId:'p2',event:'QUEST_SOLVED'});
  expect(targets(paused)).toEqual(['p1']);
  const result=respond(paused,trap.id);
  expect(result.pendingDecision).toBeUndefined();expect(result.players.map(p=>p.wizard.damageCubes)).toEqual([2,0,0,0]);
  expect(result.players[0]).toMatchObject({quest:null,questsCompleted:1,victoryPoints:0});expect(result.activation!.actionsUsed).toBe(0);
  expect(succubi(result,'p2')[0]).toMatchObject({position:offAxis,activated:true});
  expect(triggers(result)[0].target).toMatchObject({kind:'MAGE',id:'p1',roomId:'room-1,1'});conserved(result);
 });

 it('keeps the trap hidden and unspent when its owner declines an enemy quest',()=>{
  const s=fixture(),trap=arm(s,'Master of Pleasure','p2'),result=respond(solveQuest(s));
  expect(result.pendingDecision).toBeUndefined();hidden(result,trap);expect(result.evocations).toEqual([]);
  expect(result.players[0]).toMatchObject({quest:null,questsCompleted:1});expect(result.feedbackEvents).toEqual([]);conserved(result);
 });

 it('does not offer an illegal own-mage target when the trap owner solves their own quest',()=>{
  const s=fixture(),trap=arm(s,'Master of Pleasure','p1'),result=solveQuest(s);
  expect(result.pendingDecision).toBeUndefined();hidden(result,trap);expect(result.evocations).toEqual([]);
  expect(result.players[0]).toMatchObject({questsCompleted:1,wizard:{damageCubes:0}});
 });

 it('rejects an unrelated mage or evocation instead of redirecting the solver punishment',()=>{
  const s=fixture(),trap=arm(s,'Master of Pleasure','p2');cadaver(s,'p1','unrelated-servant');
  const paused=solveQuest(s);forgedTargets(paused,trap.id,['p3','unrelated-servant','room-0,0']);
  const result=respond(paused,trap.id,'p1');expect(result.players[2].wizard.damageCubes).toBe(0);
  expect(result.evocations.find(e=>e.id==='unrelated-servant')!.damageCubes).toBe(0);expect(hits(result,'p1')).toEqual([2]);
 });
});

describe('Liquefy the Pain follows its own defeated mage and original room',()=>{
 it('summons in the only original-room candidate before defeat recap, points, cube return and respawn',()=>{
  const {s,trap}=ownDefeat(),paused=cast(s);
  expect(decision(paused)).toMatchObject({playerId:'p2',event:'MAGE_DEFEATED'});expect(targets(paused)).toEqual(['room-1,1']);
  const result=respond(paused,trap.id);
  expect(result.pendingDecision).toBeUndefined();expect(succubi(result,'p2')[0]).toMatchObject({position:offAxis,activated:true});
  expect(result.players[1].wizard.position).not.toEqual(offAxis);expect(result.players[1].wizard.damageCubes).toBe(0);
  expect(result.players[0]).toMatchObject({victoryPoints:5,kills:1,trophies:['p2']});
  expect(result.feedbackEvents!.map(e=>e.kind)).toEqual(['DAMAGE','SPELL_TRIGGERED','MAGE_DEFEATED']);
  expect(triggers(result)[0]).toMatchObject({roomId:'room-1,1',target:{kind:'ROOM',id:'room-1,1'},effects:[expect.stringContaining('Summon'),expect.stringContaining('Activate')]});
  expect(result.feedbackEvents![2]).toMatchObject({target:{id:'p2',roomId:'room-1,1'},respawnRoomId:s.players[1].wizard.startingRoomId});
  const summon=result.log.findIndex(line=>line.includes('summons Succubus'));
  expect(summon).toBeGreaterThan(-1);
  for(const text of ['is defeated and returns','gains 4 VP','damage cubes returned']) {
   expect(result.log.findIndex(line=>line.includes(text))).toBeGreaterThan(summon);
  }
  conserved(result);
 });

 it('also triggers for a neutral lethal Pain moment, where the defeat actor is undefined',()=>{
  const s=fixture(),trap=arm(s,'Liquefy the Pain','p1');s.players[0].wizard.position={...offAxis};s.players[0].wizard.health=1;
  prepare(s,[moment.pain(1)],'SELF');
  const paused=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid'});
  expect(targets(paused)).toEqual(['room-1,1']);
  const result=respond(paused,trap.id);
  expect(result.pendingDecision).toBeUndefined();expect(succubi(result,'p1')[0].position).toEqual(offAxis);
  expect(result.blackRose).toEqual({victoryPoints:4,kills:1});expect(result.players[0].victoryPoints).toBe(2);
  expect(result.feedbackEvents!.at(-1)).toMatchObject({kind:'MAGE_DEFEATED',sourceId:'black-rose',target:{roomId:'room-1,1'}});conserved(result);
 });

 it('does not trigger on killing an enemy or on another owner being defeated',()=>{
  const s=fixture(),killerTrap=arm(s,'Liquefy the Pain','p1','killer-trap'),bystanderTrap=arm(s,'Liquefy the Pain','p3','bystander-trap');
  s.players[1].wizard.health=1;const result=cast(s);
  expect(result.pendingDecision).toBeUndefined();hidden(result,killerTrap);hidden(result,bystanderTrap);
  expect(result.evocations).toEqual([]);expect(result.players[0].kills).toBe(1);conserved(result);
 });

 it('can decline its own defeat without revealing, summoning or stopping normal settlement',()=>{
  const {s,trap}=ownDefeat(),result=respond(cast(s));
  expect(result.pendingDecision).toBeUndefined();hidden(result,trap);expect(result.evocations).toEqual([]);
  expect(result.players[0]).toMatchObject({victoryPoints:5,kills:1});
  expect(result.players[1].wizard.position).toEqual(s.board.rooms.find(r=>r.id===s.players[1].wizard.startingRoomId)!.tiles[0]);conserved(result);
 });

 it('rejects a different normal room and the future respawn room atomically',()=>{
  const {s,trap}=ownDefeat(),paused=cast(s);
  forgedTargets(paused,trap.id,['room-0,0','room-1,0',s.players[1].wizard.startingRoomId,'p2']);
  const result=respond(paused,trap.id,'room-1,1');expect(succubi(result,'p2')[0].position).toEqual(offAxis);
 });
});

describe('forced-target restrictions coexist with generic reaction choices and replay',()=>{
 it('retains multiple legal reveal-time choices for a generic trap without triggerTarget',()=>{
  const s=fixture();s.players[3].wizard.position={q:1,r:0};cadaver(s,'p2','enemy-servant',{q:0,r:1});cadaver(s,'p3','own-servant');
  const card:Card={id:'generic-card',name:'Generic choice',kind:'SPELL',spellType:'TRAP',target:'MODEL',range:1,moments:[moment.damage(1)],
   trigger:{event:'DAMAGE_DEALT',relation:'ENEMY',scope:'ANY'}};
  s.readiedSpells!.push({id:'generic',playerId:'p3',card});s.activeSpellOrder!.push('generic');
  const paused=cast(s);expect(targets(paused).sort()).toEqual(['p1','p2','p4','enemy-servant'].sort());
  const d=decision(paused);reject(paused,{type:'RESPOND_REACTIVE_SPELL',playerId:d.playerId,key:d.key,activeSpellId:'generic'});
  const result=respond(paused,'generic','p4');
  expect(result.pendingDecision).toBeUndefined();expect(hits(result,'p1')).toEqual([]);expect(hits(result,'p4')).toEqual([1]);conserved(result);
 });

 it('still applies target category, ownership, finite distance/LOS and starting-room guards',()=>{
  // Deliberately narrow copies isolate existing validation independently of printed infinite range.
  for(const guard of ['category','ownership','distance','line-of-sight'] as const) {
   const s=fixture(),trap=arm(s,'Torment',guard==='ownership'?'p1':'p3');
   if(guard==='category')trap.card.target='EVOCATION';
   if(guard==='ownership')trap.card.trigger={event:'DAMAGE_DEALT',relation:'ANY',scope:'ANY'};
   if(guard==='distance'){trap.card.range=0;s.players[2].wizard.position={q:1,r:0};}
   if(guard==='line-of-sight'){trap.card.range=100;s.players[2].wizard.position={...offAxis};}
   const result=cast(s);expect(result.pendingDecision).toBeUndefined();hidden(result,trap);expect(result.evocations).toEqual([]);
  }
  const s=fixture(),trap=arm(s,'Master of Pleasure','p2');
  s.players[0].wizard.position={...s.board.rooms.find(r=>r.startingFor==='p1')!.tiles[0]};
  const result=solveQuest(s);expect(result.pendingDecision).toBeUndefined();hidden(result,trap);
 });

 it('orders different owners from first player, lets one owner order forced traps, then resumes the quest',()=>{
  const s=fixture();s.firstPlayerId='p4';
  const first=arm(s,'Master of Pleasure','p4','first-owner');
  const a=arm(s,'Master of Pleasure','p3','owner-a'),b=arm(s,'Master of Pleasure','p3','owner-b');
  const one=solveQuest(s);expect(decision(one).playerId).toBe('p4');expect(targets(one)).toEqual(['p1']);
  const two=respond(one,first.id);expect(decision(two).playerId).toBe('p3');
  expect(decision(two).options.map(o=>o.activeSpellId)).toEqual([a.id,b.id]);
  expect(two.pendingDecision!.resume!.answers).toMatchObject([{accept:true,activeSpellId:first.id,targetId:'p1'}]);
  const three=respond(two,b.id);expect(decision(three).options.map(o=>o.activeSpellId)).toEqual([a.id]);
  const result=respond(three,a.id);
  expect(result.pendingDecision).toBeUndefined();expect(result.readiedSpells).toEqual([]);
  expect(triggers(result).map(e=>e.activeSpellId)).toEqual([first.id,b.id,a.id]);expect(hits(result,'p1')).toEqual([2,2,2]);
  expect(result.evocations).toHaveLength(3);expect(result.evocations.every(e=>e.activated&&e.position.q===0&&e.position.r===0)).toBe(true);
  expect(result.players[0]).toMatchObject({quest:null,questsCompleted:1});expect(result.activation!.actionsUsed).toBe(0);conserved(result);
 });

 it('round-trips a partially answered root action with restored Infinity and stable recorded summon/feedback IDs',()=>{
  const s=fixture(),first=arm(s,'Master of Pleasure','p3','first'),saved=arm(s,'Master of Pleasure','p3','saved');
  const paused=respond(solveQuest(s),first.id),restored=roundTrip(paused),before=structuredClone(restored);
  expect(restored.readiedSpells!.every(a=>a.card.range===Infinity)).toBe(true);
  expect(decision(restored).options[0].card.range).toBe(Infinity);expect(targets(restored)).toEqual(['p1']);
  expect(restored.pendingDecision!.resume!.answers).toMatchObject([{accept:true,activeSpellId:first.id,targetId:'p1'}]);
  const entropy=structuredClone(restored.pendingDecision!.resume!.entropy!);
  const direct=respond(paused),result=respond(restored);
  expect(restored).toEqual(before);expect(result).toEqual(direct);expect(result.pendingDecision).toBeUndefined();
  expect(result.readiedSpells).toEqual([saved]);expect(result.evocations).toHaveLength(1);
  expect(entropy.ids).toContain(result.evocations[0].id);
  expect(result.feedbackEvents!.every(e=>entropy.ids.includes(e.id))).toBe(true);expect(hits(result,'p1')).toEqual([2]);conserved(result);
 });
});