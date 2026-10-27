import { describe, expect, it } from 'vitest';
import { applyAction, createAgonyDeck, createGame, createLibrary, EVOCATION_TYPES, evocationAttack, summonEvocation } from '../src';
import type { Evocation, GameAction, GameState, Hex } from '../src';

const origin:Hex={q:0,r:0};
const far:Hex={q:9,r:9};

function evocationPhase(options:{succubi?:{id:string;position?:Hex;auto?:boolean}[]}={}) {
 const game=createGame(2);game.round=1;game.phase='EVOCATION';game.currentPlayerId='p1';game.activation=null;
 for(const player of game.players) {player.wizard.position={...origin};player.actionTokens=0;}
 const cadaver=summonEvocation(game,game.players[0],'CADAVER',origin)!;cadaver.id='attacker';
 for(const [i,spec] of (options.succubi??[]).entries()) {
  const succubus=summonEvocation(game,game.players[1],'SUCCUBUS',spec.position??far)!;
  succubus.id=spec.id;if(spec.auto)succubus.autoAbility=true;
  expect(succubus.number).toBe(i+1);
 }
 return game;
}
const strike=(game:GameState)=>applyAction(applyAction(game,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'attacker'}),{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'});
const answer=(game:GameState,accept:boolean,playerId='p2')=>applyAction(game,{type:'RESPOND_SOUL_TITHE',playerId,accept});
const model=(game:GameState,id:string)=>game.evocations.find(e=>e.id===id) as Evocation;
function cubesConserved(game:GameState) {
 for(const player of game.players) {
  expect(player.cubes.available+player.cubes.onWizard+player.cubes.onEvocations+player.cubes.onBoard).toBe(25);
  expect(player.cubes.onWizard).toBe(game.players.reduce((n,p)=>n+(p.wizard.damageByPlayer[player.id]??0),0));
  expect(player.cubes.onEvocations).toBe(game.evocations.reduce((n,e)=>n+(e.damageByPlayer[player.id]??0),0));
 }
}

describe('Succubus evocation',()=>{
 it('is a Demon with 2 movement, 1 attack, 3 health and +1 attack per damage cube',()=>{
  const game=createGame(2);
  const succubus=summonEvocation(game,game.players[0],'SUCCUBUS',origin)!;
  expect(succubus).toMatchObject({name:'Succubus',archetype:'DEMON',movement:2,attack:1,health:3,passive:'WOUNDED_FURY',ability:'SOUL_TITHE',number:1,damageCubes:0});
  expect(succubus.autoAbility).toBeFalsy();
  expect(evocationAttack(succubus)).toBe(1);
  succubus.damageCubes=2;expect(evocationAttack(succubus)).toBe(3);
  expect(EVOCATION_TYPES.SUCCUBUS).toMatchObject({movement:2,attack:1,health:3});
 });
 it('shares the three-model cap and leaves Cadavers without an ability',()=>{
  const game=createGame(2),p=game.players[0];
  expect(summonEvocation(game,p,'CADAVER',origin)).not.toHaveProperty('ability');
  summonEvocation(game,p,'SUCCUBUS',origin);summonEvocation(game,p,'SUCCUBUS',origin);
  expect(summonEvocation(game,p,'SUCCUBUS',origin)).toBeUndefined();
  expect(game.evocations.map(e=>e.number)).toEqual([1,2,3]);
 });
});

describe('Soul Tithe prompt',()=>{
 it('pauses the attack on a prompt for the owner and leaves the board untouched',()=>{
  const game=evocationPhase({succubi:[{id:'succ'}]});
  const activated=applyAction(game,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'attacker'});
  const paused=applyAction(activated,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'});
  expect(paused.pendingDecision).toMatchObject({kind:'SOUL_TITHE',playerId:'p2',evocationId:'succ',evocationName:'Succubus #1',targetId:'p2',sourceName:game.players[0].name,amount:2,evocationWounds:0,evocationHealth:3});
  expect(paused.pendingDecision?.resume?.action).toMatchObject({type:'EVOCATION_ATTACK'});
  const {pendingDecision,...rest}=paused;expect(pendingDecision).toBeTruthy();
  expect(rest).toEqual(activated);
 });
 it('blocks every other action while waiting, except the owner adjusting a switch',()=>{
  const paused=strike(evocationPhase({succubi:[{id:'succ'}]}));
  const blocked:GameAction[]=[{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'},{type:'END_EVOCATION',playerId:'p1'},{type:'END_ACTIVATION',playerId:'p2'}];
  for(const action of blocked)expect(()=>applyAction(paused,action)).toThrow(/Waiting for .* to decide/);
  expect(()=>answer(paused,true,'p1')).toThrow(/belongs to another mage/);
  const toggled=applyAction(paused,{type:'SET_EVOCATION_AUTO',playerId:'p2',evocationId:'succ',auto:true});
  expect(model(toggled,'succ').autoAbility).toBe(true);expect(toggled.pendingDecision).toBeTruthy();
 });
 it('rejects a response when nothing is pending',()=>{
  expect(()=>answer(evocationPhase({succubi:[{id:'succ'}]}),true)).toThrow(/No decision is waiting/);
 });
 it('moves exactly one cube onto the Succubus when accepted, wherever it stands',()=>{
  const paused=strike(evocationPhase({succubi:[{id:'succ',position:far}]}));
  const result=answer(paused,true);
  expect(result.pendingDecision).toBeUndefined();
  expect(result.players[1].wizard.damageCubes).toBe(1);
  expect(model(result,'succ')).toMatchObject({damageCubes:1,damageByPlayer:{p1:1}});
  expect(result.players[1].wizard.damageByPlayer).toEqual({p1:1});
  expect(result.log.some(line=>line.includes(`Succubus #1 takes a damage cube meant for ${result.players[1].name}`))).toBe(true);
    expect(result.evocationActivation).toMatchObject({attackUsed:true,movesRemaining:2});
  cubesConserved(result);
 });
 it('applies the full damage to the mage when declined',()=>{
  const result=answer(strike(evocationPhase({succubi:[{id:'succ'}]})),false);
  expect(result.pendingDecision).toBeUndefined();
  expect(result.players[1].wizard.damageCubes).toBe(2);expect(model(result,'succ').damageCubes).toBe(0);
  cubesConserved(result);
 });
 it('never prompts or redirects for the Succubus owner damaging their own model-free targets',()=>{
  const game=evocationPhase();
  const result=strike(game);
  expect(result.pendingDecision).toBeUndefined();expect(result.players[1].wizard.damageCubes).toBe(2);
 });
});

describe('Soul Tithe auto switch',()=>{
 it('redirects without a prompt when the switch is on',()=>{
  const result=strike(evocationPhase({succubi:[{id:'succ',auto:true}]}));
  expect(result.pendingDecision).toBeUndefined();
  expect(result.players[1].wizard.damageCubes).toBe(1);expect(model(result,'succ').damageCubes).toBe(1);
  cubesConserved(result);
 });
 it('can be toggled by the owner only, and only on a Succubus',()=>{
  const game=evocationPhase({succubi:[{id:'succ'}]});
  const on=applyAction(game,{type:'SET_EVOCATION_AUTO',playerId:'p2',evocationId:'succ',auto:true});
  expect(model(on,'succ').autoAbility).toBe(true);
  expect(model(applyAction(on,{type:'SET_EVOCATION_AUTO',playerId:'p2',evocationId:'succ',auto:false}),'succ').autoAbility).toBe(false);
  expect(()=>applyAction(game,{type:'SET_EVOCATION_AUTO',playerId:'p1',evocationId:'succ',auto:true})).toThrow(/your own evocations/);
  expect(()=>applyAction(game,{type:'SET_EVOCATION_AUTO',playerId:'p1',evocationId:'attacker',auto:true})).toThrow(/no ability/);
 });
 it('is still asked per Succubus when only some are automatic',()=>{
  const paused=strike(evocationPhase({succubi:[{id:'one',auto:true},{id:'two'}]}));
  expect(paused.pendingDecision).toMatchObject({evocationId:'two',amount:1});
  const result=answer(paused,true);
  expect(result.players[1].wizard.damageCubes).toBe(0);
  expect(model(result,'one').damageCubes).toBe(1);expect(model(result,'two').damageCubes).toBe(1);
  cubesConserved(result);
 });
});

describe('Progressable quests',()=>{
 it('awards a completed quest only after its free reward action resolves and then grants the points',()=>{
  const game=createGame(2);game.phase='ACTION';game.round=1;game.currentPlayerId='p1';game.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
  const quest={id:'room-quest',name:'Open the Lodge',description:'Activate 2 rooms.',kind:'ROOM_ACTIVATE',amount:2,reward:3,progress:2,completed:true,rewardAction:{id:'quest-reward',name:'Lodge Blessing',kind:'SPELL',moments:[{effect:'HEAL',amount:1}],range:0,target:'SELF'}} as any;
  game.players[0].quest=quest; game.players[0].additionalQuests=[];
  game.players[0].wizard.damageCubes=1; game.players[0].wizard.health=2;
  const used=applyAction(game,{type:'USE_QUEST_REWARD',playerId:'p1',questId:'room-quest'});
  expect(used.players[0].wizard.damageCubes).toBe(0);
  expect(used.players[0].victoryPoints).toBe(3);
  expect(used.players[0].questsCompleted).toBe(1);
  expect(used.players[0].quest).toBeNull();
 });
 it('defines Master of Pleasure as a mage trap that fires when a mage solves a quest',()=>{
  const card=createAgonyDeck('test').find(c=>c.name==='Master of Pleasure');
  expect(card).toBeTruthy();
  expect(card).toMatchObject({spellType:'TRAP',target:'MAGE',range:Number.POSITIVE_INFINITY});
  expect(card?.trigger).toMatchObject({event:'QUEST_SOLVED',relation:'ENEMY',scope:'ANY'});
  expect(card?.triggerTarget).toBe('EVENT_MODEL');
  expect(card?.triggerEffects).toContainEqual(expect.objectContaining({effect:'DAMAGE',amount:2,target:'EVENT_MODEL'}));
  expect(card?.triggerEffects).toContainEqual(expect.objectContaining({effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET'}));
 });
 it('defines Ineluctable Pain as a model spell that triggers on any VP change',()=>{
  const card=createAgonyDeck('test').find(c=>c.name==='Ineluctable Pain');
  expect(card).toBeTruthy();
  expect(card).toMatchObject({spellType:'CONTINGENCY',target:'MODEL',range:2});
  expect(card?.ongoing).toMatchObject({trigger:{event:'VP_CHANGED',relation:'ANY',scope:'BOUND_MODEL'}});
  expect(card?.ongoing?.effects).toContainEqual(expect.objectContaining({effect:'DAMAGE',amount:2,target:'EVENT_MODEL'}));
 });
 it('uses the Agony deck as the active library deck',()=>{
  const library=createLibrary();
  expect(library.map(d=>[d.id,d.name])).toEqual([['agony','Agony'],['technomancy','Technomancy'],['alchemy','Alchemy']]);
  expect(library[0].cards.every(c=>c.schoolId==='agony')).toBe(true);
 });
});

describe('Soul Tithe chains and edge cases',()=>{
 it('asks each Succubus in order and never takes more cubes than were inflicted',()=>{
  const game=evocationPhase({succubi:[{id:'one'},{id:'two'},{id:'three'}]});
  const first=strike(game);
  expect(first.pendingDecision).toMatchObject({evocationId:'one',amount:2});
  const second=answer(first,true);
  expect(second.pendingDecision).toMatchObject({evocationId:'two',amount:1});
  const result=answer(second,true);
  expect(result.pendingDecision).toBeUndefined();
  expect(result.players[1].wizard.damageCubes).toBe(0);
  expect(model(result,'three').damageCubes).toBe(0);
  expect(model(result,'one').damageCubes+model(result,'two').damageCubes).toBe(2);
  cubesConserved(result);
 });
 it('lets a mixed answer split damage between mage and Succubus',()=>{
  const game=evocationPhase({succubi:[{id:'one'},{id:'two'}]});
  const result=answer(answer(strike(game),true),false);
  expect(result.players[1].wizard.damageCubes).toBe(1);expect(model(result,'one').damageCubes).toBe(1);expect(model(result,'two').damageCubes).toBe(0);
  cubesConserved(result);
 });
 it('can destroy the Succubus, returning its cubes',()=>{
  const game=evocationPhase({succubi:[{id:'succ'}]});
  model(game,'succ').damageCubes=2;model(game,'succ').damageByPlayer={p1:2};game.players[0].cubes.available-=2;game.players[0].cubes.onEvocations=2;
  const result=answer(strike(game),true);
  expect(result.evocations.some(e=>e.id==='succ')).toBe(false);
  expect(result.players[0].cubes.onEvocations).toBe(0);
  cubesConserved(result);
 });
 it('takes no cube when the mage can only suffer less damage',()=>{
  const game=evocationPhase({succubi:[{id:'succ'}]});
  game.players[1].wizard.damageCubes=game.players[1].wizard.health-1;
  const paused=strike(game);
  expect(paused.pendingDecision?.amount).toBe(1);
  const result=answer(paused,true);
  expect(result.players[1].wizard.damageCubes).toBe(game.players[1].wizard.health-1);
  expect(model(result,'succ').damageCubes).toBe(1);
 });
 it('absorbs Pink Tulip damage as unattributed wounds and resumes the whole phase change',()=>{
  const game=createGame(2);game.round=1;game.phase='CLEANUP';game.activation=null;game.currentPlayerId=null;
  game.eventDeck=[{id:'thorns',name:'Thorns',description:'Black damage',kind:'BLACK_DAMAGE',amount:1,rooms:0}];
  const succubus=summonEvocation(game,game.players[0],'SUCCUBUS',far)!;succubus.id='succ';
  const advance:GameAction={type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:'CLEANUP',expectedRound:1};
  const paused=applyAction(game,advance);
  expect(paused.pendingDecision).toMatchObject({playerId:'p1',sourceName:'Pink Tulip',amount:1});
  expect(paused.phase).toBe('CLEANUP');expect(paused.eventDeck).toHaveLength(1);
  const result=answer(paused,true,'p1');
  expect(result.pendingDecision).toBeUndefined();
  expect(result.phase).toBe('BLACK_ROSE');expect(result.round).toBe(2);
  expect(result.players[0].wizard.damageCubes).toBe(0);expect(result.players[1].wizard.damageCubes).toBe(1);
  expect(model(result,'succ')).toMatchObject({damageCubes:1,damageByPlayer:{}});
  expect(result.eventDiscard.filter(c=>c.id==='thorns')).toHaveLength(1);
  cubesConserved(result);
 });
});
