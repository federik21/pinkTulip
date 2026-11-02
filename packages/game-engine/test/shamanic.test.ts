import { afterEach, describe, expect, it, vi } from 'vitest';
import {
 applyAction, BLACK_ROSE_ID, createGame, createShamanicDeck, EVOCATION_TYPES, getEvocationKind, getEvocationSupply, getQuestRewardTargets, spellCanTargetModel, spellFilterAllows, summonEvocation,
} from '../src';
import type { GameState } from '../src';

const activation=(playerId:string)=>({playerId,actionsUsed:0,exploring:0,spellsCast:0,sequencedSpellUsed:false,discardedExit:false,roomEffectUsed:false});
afterEach(()=>vi.restoreAllMocks());
function fixture():GameState {
 const s=createGame(2),origin=s.board.rooms.find(room=>room.id==='room-0,0')!.tiles[0];
 s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';s.activation=activation('p1');
 for(const p of s.players)p.wizard.position={...origin};
 return s;
}

describe('Shamanic school',()=>{
 it('adds a 36-card school with the twelve requested spells and reactive types',()=>{
  const cards=createShamanicDeck('shamanic','shamanic');
  expect(cards).toHaveLength(36);
  expect(new Set(cards.map(card=>card.name))).toEqual(new Set([
   'Binding Totem','Astral Path','Earth Totem','Wind Spirit','Valor Totem','River Spirit',
   'Dominion Token','Channeling Energy','Rain Totem','Steppe Spirit','Pyre Spirit','Source of Life',
  ]));
  expect(cards.find(card=>card.name==='Earth Totem')).toMatchObject({spellType:'PROTECTION',trigger:{event:'SPELL_TARGETED',spellTypes:['COMBAT']}});
  expect(cards.find(card=>card.name==='Channeling Energy')?.ongoing?.trigger).toMatchObject({event:'SPELL_CAST',spellTypes:['COMBAT']});
  expect(cards.find(card=>card.name==='Pyre Spirit')).toMatchObject({target:'EVOCATION',range:2,targetFilter:{maxHealth:3}});
 });

 it('adds the five-model Altar supply and Totem template',()=>{
  const s=fixture();
  expect(EVOCATION_TYPES.TOTEM).toMatchObject({name:'Totem',archetype:'ALTAR',movement:0,attack:0,health:3,ability:'TOTEM'});
  expect(getEvocationSupply(s).TOTEM).toBe(5);
  const totem=summonEvocation(s,s.players[0],'TOTEM',s.players[0].wizard.position)!;
  expect(totem).toMatchObject({kind:'TOTEM',archetype:'ALTAR',movement:0,attack:0,health:3});
  expect(getEvocationKind(totem)).toBe('TOTEM');
  expect(getEvocationSupply(s).TOTEM).toBe(4);
 });

 it('enforces the shared limit of five Totems across mage owners',()=>{
  const s=fixture();
  for(let i=0;i<5;i++)expect(summonEvocation(s,s.players[i<3?0:1],'TOTEM',s.players[i<3?0:1].wizard.position)).toBeDefined();
  expect(getEvocationSupply(s).TOTEM).toBe(0);
  expect(summonEvocation(s,s.players[1],'TOTEM',s.players[1].wizard.position)).toBeUndefined();
  expect(s.log.at(-1)).toMatch(/shared supply/);
 });

 it('lets an activated Totem heal a model within range 1',()=>{
  let s=fixture(),totem=summonEvocation(s,s.players[0],'TOTEM',s.players[0].wizard.position)!;
  const target=s.players[1].wizard;target.damageCubes=1;target.damageByPlayer={p1:1};s.players[0].cubes.onWizard=1;
  s=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:totem.id});
  s=applyAction(s,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2-wizard'});
  expect(s.players[1].wizard.damageCubes).toBe(0);
  expect(s.evocationActivation).toBeNull();
 });

 it('lets an activated Totem convert damage from another mage',()=>{
  let s=fixture(),totem=summonEvocation(s,s.players[0],'TOTEM',s.players[0].wizard.position)!;
  const target=s.players[1].wizard;target.damageCubes=1;target.damageByPlayer={p2:1};s.players[1].cubes.onWizard=1;s.players[1].cubes.available--;
  s=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:totem.id});
  s=applyAction(s,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2-wizard'});
  expect(s.pendingDecision?.kind).toBe('CHOICE');
  s=applyAction(s,{type:'RESPOND_CHOICE',playerId:'p1',key:s.pendingDecision!.key,choiceId:'CONVERT'});
  expect(s.players[1].wizard.damageByPlayer).toEqual({p1:1});
  expect(s.players[0].cubes.onWizard).toBe(1);
  expect(s.evocationActivation).toBeNull();
 });

 it('prevents a targeted combat spell with Earth Totem and summons a Totem',()=>{
  let s=fixture();
  const earth=createShamanicDeck('shamanic','shamanic').find(card=>card.name==='Earth Totem')!;
  s.players[1].prepared.rapid={card:earth,used:false};
  s.currentPlayerId='p2';s.activation=activation('p2');
  s=applyAction(s,{type:'ACTIVATE_SPELL',playerId:'p2',slot:'rapid'});
  s.currentPlayerId='p1';s.activation=activation('p1');
  const spell={id:'combat',name:'Combat spell',kind:'SPELL' as const,spellType:'COMBAT' as const,target:'MAGE' as const,range:2,moments:[{effect:'DAMAGE' as const,amount:2}]};
  s.players[0].prepared.rapid={card:spell,used:false};
  s=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
  expect(s.pendingDecision?.kind).toBe('REACTIVE_SPELL');
  const decision=s.pendingDecision!;
  s=applyAction(s,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:decision.key,activeSpellId:decision.options[0].activeSpellId,targetId:'p2'});
  expect(s.players[1].wizard.damageCubes).toBe(0);
  expect(s.evocations.some(e=>e.playerId==='p2'&&e.kind==='TOTEM')).toBe(true);
 });

 it('prevents the effect of an ongoing combat spell on the protected mage',()=>{
  let s=fixture();
  const earth=createShamanicDeck('shamanic','shamanic').find(card=>card.name==='Earth Totem')!;
  s.players[1].prepared.rapid={card:earth,used:false};
  s.currentPlayerId='p2';s.activation=activation('p2');
  s=applyAction(s,{type:'ACTIVATE_SPELL',playerId:'p2',slot:'rapid'});
  const ongoing={id:'ongoing-combat',playerId:'p1',targetPlayerId:'p2',card:{
   id:'ongoing-card',name:'Ongoing combat',kind:'SPELL' as const,spellType:'COMBAT' as const,target:'MAGE' as const,range:2,moments:[],
   ongoing:{trigger:{event:'SPELL_CAST' as const,relation:'ANY' as const,scope:'ANY' as const},effects:[{effect:'DAMAGE' as const,amount:1,target:'BOUND_MODEL' as const}]},
  }};
  s.ongoingSpells=[ongoing];s.activeSpellOrder=[ongoing.id];
  const cast={id:'ordinary-combat',name:'Ordinary combat',kind:'SPELL' as const,spellType:'COMBAT' as const,target:'SELF' as const,range:0,moments:[]};
  s.players[0].prepared.rapid={card:cast,used:false};
  s.currentPlayerId='p1';s.activation=activation('p1');
  s=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid'});
  expect(s.pendingDecision?.kind).toBe('REACTIVE_SPELL');
  const decision=s.pendingDecision!;
  s=applyAction(s,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:decision.key,activeSpellId:decision.options[0].activeSpellId,targetId:'p2'});
  expect(s.players[1].wizard.damageCubes).toBe(0);
  expect(s.evocations.some(e=>e.playerId==='p2'&&e.kind==='TOTEM')).toBe(true);
 });

 it('offers Channeling Energy in response to a combat spell and awards BR VP for the Altar damage',()=>{
  let s=fixture();
  const totem=summonEvocation(s,s.players[0],'TOTEM',s.players[0].wizard.position)!;
  const channeling=createShamanicDeck('shamanic','shamanic').find(card=>card.name==='Channeling Energy')!;
  s.ongoingSpells=[{id:'channeling-active',playerId:'p1',card:channeling}];
  s.activeSpellOrder=['channeling-active'];
  const spell={id:'combat',name:'Combat spell',kind:'SPELL' as const,spellType:'COMBAT' as const,target:'SELF' as const,range:0,moments:[]};
  s.players[1].prepared.rapid={card:spell,used:false};
  s.currentPlayerId='p2';s.activation=activation('p2');
  s=applyAction(s,{type:'CAST_SPELL',playerId:'p2',slot:'rapid'});
  expect(s.pendingDecision?.kind).toBe('CHOICE');
  const decision=s.pendingDecision!;
  s=applyAction(s,{type:'RESPOND_CHOICE',playerId:'p1',key:decision.key,choiceId:totem.id});
  expect(s.evocations.find(e=>e.id===totem.id)?.damageCubes).toBe(1);
  expect(s.blackRose.victoryPoints).toBe(1);
 });

 it('lets Astral Path pay the moon-level VP cost to complete an active quest',()=>{
  const s=fixture(),p=s.players[0],card=createShamanicDeck('shamanic','shamanic').find(c=>c.name==='Astral Path')!;
  s.moon=2;p.victoryPoints=2;
  p.quest={id:'active-quest',name:'Active quest',description:'',kind:'REBUILD',amount:2,reward:2,progress:0,completed:false,claimed:false};
  p.prepared.rapid={card,used:false};
  const result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid'});
  expect(result.players[0].victoryPoints).toBe(0);
  expect(result.players[0].quest).toMatchObject({completed:true,progress:2});
 });

 it('lets Wind Spirit choose two grimoire cards, then shuffles the remaining deck',()=>{
  const s=fixture(),p=s.players[0],cards=createShamanicDeck('shamanic','shamanic');
  const windSpirit=cards.find(c=>c.name==='Wind Spirit')!;
  const grimoire=cards.filter(c=>c!==windSpirit).slice(0,6);
  p.personalDeck=grimoire.slice(0,4);p.discard=grimoire.slice(4);
  p.prepared.rapid={card:windSpirit,used:false};
  const random=vi.spyOn(Math,'random').mockReturnValue(0);
  let result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid'});
  expect(result.pendingDecision?.kind).toBe('CHOICE');
  if(result.pendingDecision?.kind!=='CHOICE')throw new Error('Expected Wind Spirit to ask for a grimoire card');
  let decision=result.pendingDecision;
  const first=decision.options[0];
  result=applyAction(result,{type:'RESPOND_CHOICE',playerId:'p1',key:decision.key,choiceId:first.id});
  expect(result.pendingDecision?.kind).toBe('CHOICE');
  if(result.pendingDecision?.kind!=='CHOICE')throw new Error('Expected Wind Spirit to ask for a second grimoire card');
  decision=result.pendingDecision;
  expect(decision.options.map(option=>option.id)).not.toContain(first.id);
  const second=decision.options[0];
  result=applyAction(result,{type:'RESPOND_CHOICE',playerId:'p1',key:decision.key,choiceId:second.id});
  expect(result.pendingDecision).toBeFalsy();
  expect(result.players[0].hand.map(card=>card.id)).toEqual([first.id,second.id]);
  expect(result.players[0].personalDeck).toHaveLength(4);
  expect(result.players[0].discard).toHaveLength(0);
  expect([...result.players[0].hand,...result.players[0].personalDeck].map(card=>card.id).sort()).toEqual(grimoire.map(card=>card.id).sort());
  expect(result.log.some(line=>line.includes('chooses 2 grimoire cards:'))).toBe(true);
  expect(random).toHaveBeenCalledTimes(8);
 });

 it('removes an evocation with health 3 or less and awards Pyre Spirit VP',()=>{
  const s=fixture(),target=summonEvocation(s,s.players[1],'SUCCUBUS',s.players[1].wizard.position)!;
  const card=createShamanicDeck('shamanic','shamanic').find(c=>c.name==='Pyre Spirit')!;
  s.players[0].prepared.rapid={card,used:false};
  const result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetEvocationId:target.id});
  expect(result.evocations.some(e=>e.id===target.id)).toBe(false);
  expect(result.players[0].victoryPoints).toBe(1);
 });

 it('lets Pyre Spirit and ordinary evocation spells target an assigned Umbra',()=>{
  const s=fixture(),umbra={
   id:'assigned-umbra',playerId:BLACK_ROSE_ID,assignedTo:'p2',slot:1,number:1,kind:'UMBRA' as const,
   name:'Umbra',archetype:'NIGHTMARE' as const,movement:0,attack:1,health:2,
   position:{...s.players[1].wizard.position},damageCubes:0,damageByPlayer:{},activated:true,
  };
  s.evocations.push(umbra);
  const pyre=createShamanicDeck('shamanic','shamanic').find(c=>c.name==='Pyre Spirit')!;
  expect(spellCanTargetModel(pyre,'p1',BLACK_ROSE_ID,'EVOCATION')).toBe(true);
  expect(spellFilterAllows(pyre,'p1',{playerId:umbra.playerId,evocation:umbra})).toBe(true);
  expect(getQuestRewardTargets(s,s.players[0],pyre).some(target=>target.id===umbra.id)).toBe(true);
  s.players[0].prepared.rapid={card:pyre,used:false};
  const result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetEvocationId:umbra.id});
  expect(result.evocations.some(e=>e.id===umbra.id)).toBe(false);
  expect(result.players[0].victoryPoints).toBe(1);
  expect(getEvocationSupply(result).UMBRA).toBe(9);

  const ordinary={...pyre,id:'ordinary-spell',name:'Ordinary spell',targetFilter:undefined,moments:[{effect:'DAMAGE' as const,amount:1}]};
  expect(spellCanTargetModel(ordinary,'p1',BLACK_ROSE_ID,'EVOCATION')).toBe(true);
  expect(spellFilterAllows(ordinary,'p1',{playerId:umbra.playerId,evocation:umbra})).toBe(true);
  expect(getQuestRewardTargets(s,s.players[0],ordinary).some(target=>target.id===umbra.id)).toBe(true);
  s.players[0].prepared.rapid={card:ordinary,used:false};
  const damaged=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetEvocationId:umbra.id});
  expect(damaged.evocations.find(e=>e.id===umbra.id)?.damageCubes).toBe(1);
 });

 it('excludes assigned Umbras from MOVE_MODEL choices',()=>{
  const s=fixture(),umbra={
   id:'assigned-umbra',playerId:BLACK_ROSE_ID,assignedTo:'p2',slot:1,number:1,kind:'UMBRA' as const,
   name:'Umbra',archetype:'NIGHTMARE' as const,movement:0,attack:1,health:2,
   position:{...s.players[1].wizard.position},damageCubes:0,damageByPlayer:{},activated:true,
  };
  s.evocations.push(umbra);
  const card={id:'move-model',name:'Move Model',kind:'SPELL' as const,target:'ROOM' as const,range:2,moments:[{effect:'MOVE_MODEL' as const,distance:1}]};
  s.players[0].prepared.rapid={card,used:false};
  const result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
  expect(result.pendingDecision?.kind).toBe('CHOICE');
  if(result.pendingDecision?.kind!=='CHOICE')throw new Error('Expected model choice for MOVE_MODEL');
  expect(result.pendingDecision.options.some(option=>option.id===umbra.id)).toBe(false);
 });

 it('lets Source of Life move any model near the selected room, then heal all models in that room',()=>{
  let s=fixture(),p=s.players[0],targetRoom=s.board.rooms.find(room=>room.id==='room-0,0')!;
  const distantRoom=s.board.rooms.find(room=>!room.startingFor&&Math.min(...room.tiles.flatMap(h=>targetRoom.tiles.map(g=>Math.max(Math.abs(h.q-g.q),Math.abs(h.r-g.r),Math.abs(h.q+h.r-g.q-g.r)))))>1)!;
  const moved=summonEvocation(s,p,'SUCCUBUS',distantRoom.tiles[0])!;
  moved.damageCubes=2;
  for(const player of s.players)player.wizard.damageCubes=2;
  const card=createShamanicDeck('shamanic','shamanic').find(c=>c.name==='Source of Life')!;
  p.prepared.rapid={card,used:false};
  s=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:targetRoom.id});
  expect(s.pendingDecision?.kind).toBe('CHOICE');
  let decision=s.pendingDecision!;
  s=applyAction(s,{type:'RESPOND_CHOICE',playerId:'p1',key:decision.key,choiceId:moved.id});
  expect(s.pendingDecision?.kind).toBe('CHOICE');
  decision=s.pendingDecision!;
  const destination=decision.options.find(option=>option.id!==targetRoom.id)!;
  s=applyAction(s,{type:'RESPOND_CHOICE',playerId:'p1',key:decision.key,choiceId:destination.id});
  expect(s.players.map(player=>player.wizard.damageCubes)).toEqual([0,0]);
  const movedResult=s.evocations.find(evocation=>evocation.id===moved.id)!;
  expect(movedResult.damageCubes).toBe(2);
  expect(s.board.rooms.find(room=>room.id===destination.id)?.tiles.some(tile=>tile.q===movedResult.position.q&&tile.r===movedResult.position.r)).toBe(true);
  expect(s.players[0].victoryPoints).toBe(1);
 });

 it('draws a quest and activates River Spirit’s chosen room',()=>{
  const s=fixture(),p=s.players[0],card=createShamanicDeck('shamanic','shamanic').find(c=>c.name==='River Spirit')!;
  const room=s.board.rooms.filter(candidate=>candidate.effect&&candidate.effect!=='DRAW_POWERFUL'&&!candidate.startingFor)
   .sort((a,b)=>Math.min(...a.tiles.map(tile=>Math.abs(tile.q)+Math.abs(tile.r)))-Math.min(...b.tiles.map(tile=>Math.abs(tile.q)+Math.abs(tile.r))))[0];
  expect(room).toBeDefined();
  p.prepared.rapid={card,used:false};
  const result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:room.id});
  expect(result.players[0].quest||result.players[0].additionalQuests.length).toBeTruthy();
  expect(result.log.some(line=>line.includes(`activates ${room.name}`))).toBe(true);
 });

 it('lets River Spirit choose an instability target relative to the activated room',()=>{
  const s=fixture(),p=s.players[0],card=createShamanicDeck('shamanic','shamanic').find(c=>c.name==='River Spirit')!;
  const room=s.board.rooms.find(candidate=>candidate.effect==='INSTABILITY'&&!candidate.startingFor)!;
  p.wizard.position={...room.tiles[0]};
  p.prepared.rapid={card,used:false};
  let result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:room.id});
  expect(result.pendingDecision?.kind).toBe('CHOICE');
  if(result.pendingDecision?.kind!=='CHOICE')throw new Error('Expected a room choice for instability placement');
  const decision=result.pendingDecision;
  const destination=decision.options.find(option=>option.roomId&&option.roomId!==room.id);
  expect(destination).toBeDefined();
  result=applyAction(result,{type:'RESPOND_CHOICE',playerId:'p1',key:decision.key,choiceId:destination!.id});
  expect(result.board.rooms.find(candidate=>candidate.id===room.id)!.instability).toBe(0);
  expect(result.board.rooms.find(candidate=>candidate.id===destination!.roomId)!.instability).toBe(1);
  expect(result.log.some(line=>line.includes(`activates ${room.name}`))).toBe(true);
 });

 it('places River Spirit room-effect summons in the selected room',()=>{
  const s=fixture(),p=s.players[0],card=createShamanicDeck('shamanic','shamanic').find(c=>c.name==='River Spirit')!;
  const room=s.board.rooms.find(candidate=>candidate.effect==='SUMMON_CADAVER'&&!candidate.startingFor)!;
  room.name='Obsidian Study';
  p.prepared.rapid={card,used:false};
  const result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:room.id});
  expect(result.evocations.some(evocation=>evocation.name==='Cadaver'&&evocation.position.q===room.tiles[0].q&&evocation.position.r===room.tiles[0].r)).toBe(true);
  expect(result.log.some(line=>line.includes('activates Obsidian Study'))).toBe(true);
 });

 it('does not strand River Spirit on an unaffordable central-chamber activation',()=>{
  const s=fixture(),p=s.players[0],card=createShamanicDeck('shamanic','shamanic').find(c=>c.name==='River Spirit')!;
  p.prepared.rapid={card,used:false};
  const result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
  expect(result.pendingDecision).toBeUndefined();
  expect(result.players[0].quest).toBeTruthy();
  expect(result.log.some(line=>line.includes('cannot pay the central chamber'))).toBe(true);
 });
});
