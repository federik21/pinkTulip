import { describe, expect, it } from 'vitest';
import { applyAction, createAgonyDeck, createEnchantmentDeck, createGame, moment } from '../src';
import type { ActiveSpell, Card, GameAction, GameState, PendingDecision } from '../src';

function fixture(count=3):GameState {
 const s=createGame(count);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 return s;
}
function prepare(s:GameState,card:Card,owner='p1') {s.players.find(p=>p.id===owner)!.prepared.rapid={card,used:false};}
function card(name:string):Card {return [...createAgonyDeck('test'),...createEnchantmentDeck()].find(c=>c.name===name)!;}
function active(s:GameState,spell:Card,owner='p1',id=spell.name):ActiveSpell {
 const a={id,playerId:owner,card:spell};s.readiedSpells!.push(a);s.activeSpellOrder!.push(a.id);return a;
}
function strike(s:GameState,moments=[moment.damage(1),moment.damage(1)]):GameState {
 prepare(s,{id:'attack',name:'Two moments',kind:'SPELL',target:'MAGE',range:2,moments});
 return applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
}
function decision(s:GameState):Extract<PendingDecision,{kind:'REACTIVE_SPELL'}> {
 expect(s.pendingDecision?.kind).toBe('REACTIVE_SPELL');
 return s.pendingDecision as Extract<PendingDecision,{kind:'REACTIVE_SPELL'}>;
}
function respond(s:GameState,spellId?:string,targetId?:string):GameState {
 const d=decision(s);
 return applyAction(s,{type:'RESPOND_REACTIVE_SPELL',playerId:d.playerId,key:d.key,...(spellId?{activeSpellId:spellId,targetId}:{} )});
}
function ward(name:string,amount=1):Card {
 return {id:name,name,kind:'SPELL',spellType:'PROTECTION',target:'SELF',range:0,moments:[moment.heal(amount)],trigger:{event:'DAMAGE_TAKEN',relation:'ENEMY',scope:'BOUND_MODEL'}};
}
function conserved(s:GameState) {
 for(const p of s.players){
  expect(Object.values(p.cubes).reduce((a,b)=>a+b,0)).toBe(25);
  expect(p.cubes.onWizard).toBe(s.players.reduce((n,t)=>n+(t.wizard.damageByPlayer[p.id]??0),0));
 }
}

describe('target-free Trap and Protection activation',()=>{
 it.each(['Torment','Threshold Snare','Thorn Retort','Mending Ward',"Servant's Safeguard",'Hearth Ward','Tripwire','Cinder Seal'])('activates %s with no model, room or cast event',name=>{
  const s=fixture();const c=card(name);prepare(s,c);
  s.ongoingSpells!.push({id:'cast-listener',playerId:'p2',card:{...ward('cast-listener'),spellType:'CONTINGENCY',ongoing:{trigger:{event:'SPELL_CAST',relation:'ENEMY',scope:'ANY'},effects:[{effect:'DAMAGE',amount:1,target:'EVENT_ACTOR'}]}}});
  const before=structuredClone(s);
  const result=applyAction(s,{type:'ACTIVATE_SPELL',playerId:'p1',slot:'rapid'});
  expect(result.readiedSpells).toHaveLength(1);
  expect(Object.keys(result.readiedSpells![0]).sort()).toEqual(['card','id','playerId']);
  expect(result.readiedSpells![0].card).toEqual(c);
  expect(result.activation).toMatchObject({actionsUsed:1});
  expect(result.players[0].actionTokens).toBe(s.players[0].actionTokens);
  expect(result.players.map(p=>p.wizard.damageCubes)).toEqual([0,0,0]);
  expect(result.feedbackEvents).toEqual([]);
  expect(result.log.join(' ')).not.toContain(c.name);
  expect(s).toEqual(before);
 });
 it.each([{roomId:'room-0,0'},{targetPlayerId:'p2'},{targetEvocationId:'missing'},{dummy:true}])('rejects forged activation targeting %j atomically',payload=>{
  const s=fixture();prepare(s,card('Torment'));const before=structuredClone(s);
  expect(()=>applyAction(s,{type:'ACTIVATE_SPELL',playerId:'p1',slot:'rapid',...payload} as GameAction)).toThrow(/without choosing|Dummy targeting/);
  expect(s).toEqual(before);
 });
 it('does not use ACTIVATE_SPELL for ordinary spells',()=>{
  const s=fixture();prepare(s,card('Grim Torment'));
  expect(()=>applyAction(s,{type:'ACTIVATE_SPELL',playerId:'p1',slot:'rapid'})).toThrow(/Only Trap and Protection/);
 });
 it('preserves compatibility with target-free legacy CAST_SPELL activation',()=>{
  const s=fixture();prepare(s,card('Torment'));
  expect(applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid'}).readiedSpells).toHaveLength(1);
 });
});

describe('optional reveal, interrupt ordering and resumption',()=>{
 it('lets an owner decline and save a Protection for a later moment',()=>{
  const s=fixture();active(s,ward('saved'),'p2');
  const first=strike(s);expect(decision(first).playerId).toBe('p2');
  expect(first.players[1].wizard.damageCubes).toBe(0); // Root action remains atomic while paused.
  const second=respond(first);expect(decision(second).key).not.toBe(decision(first).key);
  const result=respond(second,'saved','p2');
  expect(result.pendingDecision).toBeUndefined();
  expect(result.players[1].wizard.damageCubes).toBe(1);
  expect(result.readiedSpells).toEqual([]);
  expect(result.players[1].discard.map(c=>c.id)).toContain('saved');
  expect(result.feedbackEvents!.filter(e=>e.kind==='SPELL_TRIGGERED')).toHaveLength(1);
  conserved(result);
 });
 it('declines all occurrences without revealing or consuming the card',()=>{
  const s=fixture();active(s,ward('saved'),'p2');
  const result=respond(respond(strike(s)));
  expect(result.readiedSpells!.map(a=>a.id)).toEqual(['saved']);
  expect(result.players[1].wizard.damageCubes).toBe(2);
  expect(result.log.join(' ')).not.toContain('saved');
  expect(result.feedbackEvents!.some(e=>e.kind==='SPELL_TRIGGERED')).toBe(false);
 });
 it('allows the owner to choose their own matching spell order',()=>{
  const s=fixture();active(s,ward('first'),'p2');active(s,ward('second'),'p2');
  const prompt=strike(s,[moment.damage(2)]);
  expect(decision(prompt).options.map(o=>o.activeSpellId)).toEqual(['first','second']);
  const next=respond(prompt,'second','p2');
  expect(decision(next).options.map(o=>o.activeSpellId)).toEqual(['first']);
  const result=respond(next,'first','p2');
  expect(result.feedbackEvents!.filter(e=>e.kind==='SPELL_TRIGGERED').map(e=>e.kind==='SPELL_TRIGGERED'&&e.cardName)).toEqual(['second','first']);
  expect(result.players[1].wizard.damageCubes).toBe(0);conserved(result);
 });
 it('resolves different owners in play order from the first-player token',()=>{
  const s=fixture();s.firstPlayerId='p3';
  for(const owner of ['p2','p3'])active(s,{...ward(owner),target:'MAGE',range:2,trigger:{event:'SPELL_CAST',relation:'ENEMY',scope:'ANY'}},owner);
  const first=strike(s);expect(decision(first).playerId).toBe('p3');
  const next=respond(first);expect(decision(next).playerId).toBe('p2');
  expect(respond(next).pendingDecision).toBeUndefined();
 });
 it('finishes every target of a room moment before interrupting, then resumes the next moment',()=>{
  const s=fixture();active(s,ward('ward'),'p2');
  prepare(s,{id:'room-hit',name:'Room hit',kind:'SPELL',target:'ROOM',range:2,moments:[moment.damage(1),moment.damage(1)]});
  const prompt=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
  const result=respond(prompt,'ward','p2');
  const facts=result.feedbackEvents!;
  expect(facts.map(e=>e.kind)).toEqual(['DAMAGE','DAMAGE','SPELL_TRIGGERED','HEAL','DAMAGE','DAMAGE']);
  expect(result.players.map(p=>p.wizard.damageCubes)).toEqual([0,1,2]);
 });
 it('supports nested optional interrupts and consumes each card only once',()=>{
  const s=fixture();
  active(s,{...ward('retort'),moments:[],triggerEffects:[{effect:'DAMAGE',amount:1,target:'EVENT_ACTOR'}]},'p2');
  active(s,ward('nested'),'p1');
  const prompt=strike(s,[moment.damage(1)]);
  const nested=respond(prompt,'retort','p2');expect(decision(nested).playerId).toBe('p1');
  const result=respond(nested,'nested','p1');
  expect(result.pendingDecision).toBeUndefined();
  const triggers=result.feedbackEvents!.filter(e=>e.kind==='SPELL_TRIGGERED');
  expect(triggers.map(e=>e.kind==='SPELL_TRIGGERED'&&e.cardName)).toEqual(['retort','nested']);
  expect(triggers[1].interruptId).toBe(triggers[0].id);
  expect(result.readiedSpells).toEqual([]);conserved(result);
 });
 it('keeps a newly summoned Succubus identity stable across its nested Soul Tithe decisions',()=>{
  const s=fixture();
  active(s,{...ward('summoning'),moments:[moment.summon('SUCCUBUS'),moment.pain(1)],trigger:{event:'SPELL_CAST',relation:'ENEMY',scope:'ANY'}},'p2');
  let result=respond(strike(s,[moment.damage(1)]),'summoning','p2');
  expect(result.pendingDecision?.kind).toBe('SOUL_TITHE');
  const first=result.pendingDecision;
  const id=first?.kind==='SOUL_TITHE'?first.evocationId:'';
  for(let i=0;i<4&&result.pendingDecision;i++) {
   expect(result.pendingDecision.kind).toBe('SOUL_TITHE');
   result=applyAction(result,{type:'RESPOND_SOUL_TITHE',playerId:'p2',accept:true});
  }
  expect(result.pendingDecision).toBeUndefined();
  expect(result.evocations[0]).toMatchObject({id,damageCubes:2});
  expect(result.players[1].wizard.damageCubes).toBe(0);conserved(result);
 });
 it('snapshots the original action and never mutates a paused replay during response',()=>{
  const s=fixture();active(s,ward('ward'),'p2');
  prepare(s,{id:'hit',name:'Hit',kind:'SPELL',range:2,target:'MAGE',moments:[moment.damage(1)]});
  const action:GameAction={type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'};
  const prompt=applyAction(s,action),before=structuredClone(prompt);
  action.targetPlayerId='p3';
  expect(prompt).toEqual(before);
  const result=respond(prompt,'ward','p2');
  expect(prompt).toEqual(before);
  expect(result.players[2].wizard.damageCubes).toBe(0);
 });
 it('forces Torment onto the damage dealer after damage, not onto a bystander or victim',()=>{
  const s=fixture();s.currentPlayerId='p2';s.activation!.playerId='p2';
  s.players[2].wizard.position={q:1,r:1};
  active(s,card('Torment'));
  prepare(s,{id:'dealer',name:'Dealer',kind:'SPELL',spellType:'COMBAT',target:'MAGE',range:Infinity,moments:[moment.damage(1)]},'p2');
  const prompt=applyAction(s,{type:'CAST_SPELL',playerId:'p2',slot:'rapid',targetPlayerId:'p3'});
  expect(decision(prompt).event).toBe('DAMAGE_DEALT');
  expect(decision(prompt).options[0].targets.map(t=>t.id)).toEqual(['p2']);
  const result=respond(prompt,'Torment','p2');
  expect(result.players[1].wizard.damageCubes).toBe(2);
  expect(result.players[2].wizard.damageCubes).toBe(1);
  expect(result.evocations[0]).toMatchObject({playerId:'p1',name:'Succubus',position:{q:0,r:0},activated:true});
 });
 it('cancels remaining physical effects if the acting mage is defeated by a trap',()=>{
  const s=fixture();s.players[0].wizard.health=1;
  const trap={...ward('fatal'),target:'MAGE',range:2,moments:[moment.damage(1)],trigger:{event:'ROOM_ACTIVATED',relation:'ENEMY',scope:'ANY'}} as Card;
  active(s,trap,'p2');s.board.rooms.find(r=>r.id==='room-0,0')!.effect='INSTABILITY';
  const begun=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'});
  const result=respond(applyAction(begun,{type:'ACTIVATE_ROOM',playerId:'p1'}),'fatal','p1');
  expect(result.players[0].wizard.position).not.toEqual({q:0,r:0});
  expect(result.activation?.physicalAction).toBeNull();
  expect(result.activation?.exploring).toBe(0);
  expect(()=>applyAction(result,{type:'PERFORM_MOVEMENT',playerId:'p1'})).toThrow(/Begin a physical action|Not your turn/);
 });
 it('forces Liquefy the Pain to its own defeated mage room before respawn',()=>{
  const s=fixture();s.players[1].wizard.health=1;s.players[1].wizard.position={q:1,r:0};active(s,card('Liquefy the Pain'),'p2');
  const prompt=strike(s,[moment.damage(1)]);
  expect(decision(prompt).playerId).toBe('p2');
  expect(decision(prompt).options[0].targets.map(t=>t.id)).toEqual(['room-1,0']);
  const result=respond(prompt,'Liquefy the Pain','room-1,0');
  expect(result.evocations[0]).toMatchObject({playerId:'p2',name:'Succubus',position:{q:1,r:0},activated:true});
  expect(result.players[1].wizard.position).not.toEqual(result.evocations[0].position);
 });
 it('rejects other players, stale prompts, forged targets, and unrelated actions atomically',()=>{
  const s=fixture();active(s,ward('ward'),'p2');const prompt=strike(s);
  const d=decision(prompt),base={type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:d.key} as const;
  for(const [action,error] of [
   [{...base,playerId:'p1'},/another mage/],
   [{...base,key:'stale'},/Stale/],
   [{...base,activeSpellId:'ward',targetId:'p3'},/eligible/],
   [{type:'END_ACTIVATION',playerId:'p1'},/Waiting/],
  ] as [GameAction,RegExp][]){const before=structuredClone(prompt);expect(()=>applyAction(prompt,action)).toThrow(error);expect(prompt).toEqual(before);}
 });
});

describe('reactive Cleanup',()=>{
 it('returns unrevealed spells to hand while revealed spells stay in Memories',()=>{
  const s=fixture(2);active(s,ward('saved'),'p2');active(s,ward('revealed'),'p2');
  let result=respond(respond(strike(s,[moment.damage(1)]),'revealed','p2'));
  for(const p of result.players){p.actionTokens=0;p.prepared={rapid:null,slot1:null,slot2:null,slot3:null};}
  result=applyAction(result,{type:'END_ACTIVATION',playerId:'p1'});
  expect(result.phase).toBe('CLEANUP');
  expect(result.players[1].hand.map(c=>c.id)).toContain('saved');
  expect(result.players[1].discard.map(c=>c.id)).toContain('revealed');
  expect(result.readiedSpells).toEqual([]);expect(result.activeSpellOrder).toEqual([]);
 });
 it('lets an owner send an unrevealed card to Memories instead of Hand',()=>{
  const s=fixture(2);active(s,ward('saved'),'p2');s.activation!.actionsUsed=1;
  for(const p of s.players)p.actionTokens=0;
  const configured=applyAction(s,{type:'SET_ACTIVE_SPELL_CLEANUP',playerId:'p2',activeSpellId:'saved',destination:'MEMORIES'});
  const result=applyAction(configured,{type:'END_ACTIVATION',playerId:'p1'});
  expect(result.phase).toBe('CLEANUP');
  expect(result.players[1].discard.map(c=>c.id)).toContain('saved');
  expect(result.players[1].hand).toEqual([]);
  expect(()=>applyAction(s,{type:'SET_ACTIVE_SPELL_CLEANUP',playerId:'p1',activeSpellId:'saved',destination:'HAND'})).toThrow(/own active spell/);
 });
});