import { mainEffects, unstableEffects, getMainMoments } from '../src/cards';
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src';
import type { Card, GameState, Quest } from '../src';

function fixture(questName:string):GameState {
 const s=createGame(2);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,spellsCast:0,sequencedSpellUsed:false,exploring:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 const index=s.questDeck.findIndex(q=>q.name===questName);expect(index).toBeGreaterThanOrEqual(0);
 s.players[0].quest=s.questDeck.splice(index,1)[0];
 return s;
}
function prepare(s:GameState,card:Omit<Card,'id'|'kind'>) {
 const id=s.library[0].cards.shift()!.id;
 s.players[0].prepared.rapid={used:false,card:{id,kind:'SPELL',...card}};
}
const cast=(s:GameState)=>applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid'});

describe('quest effect-group triggers',()=>{
 it('advances a card-type objective once for the whole moment group',()=>{
  const s=fixture('Warrior Wizard'),quest=s.players[0].quest!;
  prepare(s,{name:'Three moments',spellType:'COMBAT',range:0,target:'SELF',effects:mainEffects([
   {effect:'HEAL',amount:1},{effect:'HEAL',amount:1},{effect:'HEAL',amount:1},
  ])});
  const after=cast(s);
  expect(after.players[0].quest).toMatchObject({id:quest.id,progress:1,completed:false});
 });
 it('counts printed central instability independently from the spell moment group',()=>{
  const s=fixture('Channeling Instability');
  prepare(s,{name:'Separate prelude',spellType:'COMBAT',range:0,target:'SELF',effects:unstableEffects([{effect:'HEAL',amount:1}])});
  const after=cast(s);
  expect(after.players[0].quest).toMatchObject({progress:1,completed:false});
  expect(after.board.rooms.find(room=>room.id==='room-0,0')!.instability).toBe(1);
 });
 it('counts a multi-moment instability effect group once, not once per moment',()=>{
  const s=fixture('Channeling Instability');
  prepare(s,{name:'Instability group',spellType:'COMBAT',range:0,target:'SELF',effects:mainEffects([
   {effect:'INSTABILITY',amount:1},{effect:'INSTABILITY',amount:1},
  ])});
  const after=cast(s);
  expect(after.players[0].quest).toMatchObject({progress:1,completed:false});
  expect(after.board.rooms.find(room=>room.id==='room-0,0')!.instability).toBe(2);
 });
 it('uses only other revealed elemental preparations for elemental objectives',()=>{
  const s=fixture('Magic Stream'),p=s.players[0];
  p.prepared.slot1={used:true,card:{id:'revealed-fire-1',kind:'SPELL',name:'Fire 1',spellType:'COMBAT',range:0,target:'SELF',element:'fire',effects:mainEffects([])}};
  p.prepared.slot2={used:true,card:{id:'revealed-fire-2',kind:'SPELL',name:'Fire 2',spellType:'COMBAT',range:0,target:'SELF',element:'fire',effects:mainEffects([])}};
  p.prepared.slot3={used:true,card:{id:'hidden-water',kind:'SPELL',name:'Hidden water',spellType:'PROTECTION',range:0,target:'SELF',element:'water',effects:mainEffects([])}};
  s.readiedSpells!.push({id:'hidden-protection',playerId:'p1',card:p.prepared.slot3.card});
  prepare(s,{name:'Element check',spellType:'COMBAT',range:0,target:'SELF',effects:mainEffects([{effect:'HEAL',amount:1}])});
  const after=cast(s);
  expect(after.players[0].quest).toMatchObject({progress:0,completed:false});
 });
 it('counts the just-resolved spell among revealed elements',()=>{
  const s=fixture('Magic Stream'),p=s.players[0];
  p.prepared.slot1={used:true,card:{id:'revealed-fire-1',kind:'SPELL',name:'Fire 1',spellType:'COMBAT',range:0,target:'SELF',element:'fire',effects:mainEffects([])}};
  p.prepared.slot2={used:true,card:{id:'revealed-water-1',kind:'SPELL',name:'Water 1',spellType:'COMBAT',range:0,target:'SELF',element:'water',effects:mainEffects([])}};
  prepare(s,{name:'Water current',spellType:'COMBAT',range:0,target:'SELF',element:'water',effects:mainEffects([{effect:'HEAL',amount:1}])});
  expect(cast(s).players[0].quest).toMatchObject({progress:1,completed:true});
 });
 it('advances a room-color objective after its room effect resolves',()=>{
  const s=fixture('Dominate Fear'),room=s.board.rooms.find(candidate=>candidate.id==='room-0,0')!;
  room.color='grey';room.effect='DRAW_GRIMOIRE';
  const begun=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'});
  const after=applyAction(begun,{type:'ACTIVATE_ROOM',playerId:'p1'});
  expect(after.players[0].quest).toMatchObject({progress:1,completed:false});
 });
 it('counts instability placed by a resolved room effect',()=>{
  const s=fixture('Channeling Instability'),room=s.board.rooms.find(candidate=>candidate.id==='room-0,0')!;
  room.effect='INSTABILITY';
  const begun=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'});
  const after=applyAction(begun,{type:'ACTIVATE_ROOM',playerId:'p1'});
  expect(after.players[0].quest).toMatchObject({progress:1,completed:false});
 });
 it('advances a summon objective once for a room effect even when the effect summons multiple models',()=>{
  const s=fixture('Summoner Wizard'),room=s.board.rooms.find(candidate=>candidate.id==='room-0,0')!;
  room.effect='SUMMON_CADAVER';room.rebuiltEffect='SUMMON_CADAVER';room.reconstructed=true;
  const begun=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'});
  const after=applyAction(begun,{type:'ACTIVATE_ROOM',playerId:'p1'});
  expect(after.players[0].quest).toMatchObject({progress:1,completed:false});
  expect(after.evocations.filter(evocation=>evocation.playerId==='p1')).toHaveLength(2);
 });
 it('advances a summon objective for a summon in a quest reward effect',()=>{
  const s=fixture('Summoner Wizard'),quest=s.questDeck.shift()!;
  Object.assign(quest,{kind:'INSTABILITY',amount:1,progress:1,completed:true,claimed:false,
   rewardAction:{id:'quest-summon',name:'Quest summon',kind:'SPELL',range:2,target:'ROOM',effects:mainEffects([{effect:'SUMMON',kind:'CADAVER',position:'TARGET'}])}});
  s.players[0].additionalQuests.push(quest);
  const after=applyAction(s,{type:'USE_QUEST_REWARD',playerId:'p1',questId:quest.id,roomId:'room-1,0'});
  expect(after.players[0].quest).toMatchObject({name:'Summoner Wizard',progress:1,completed:false});
  expect(after.evocations).toHaveLength(1);
 });
 it('creates the supplied quest set with rewards as ordered moments',()=>{
  const s=createGame(2),quests=[...s.questDeck,...s.questDiscard];
  const names=new Set(quests.map(quest=>quest.name));
  for(const name of ['Conspirator Mage','Channeling Instability','Contingent Mage','Warrior Wizard','Summoner Wizard','Dominate Fear','Shattered Illusion','Guarding Wisdom','Acquire Wealth','Field Test','Rest the Limbs','Guardian Mage','Magic Stream','Earth Tempest','Holy Corruption'])expect(names.has(name)).toBe(true);
  const stream=quests.find(quest=>quest.name==='Magic Stream') as Quest;
  expect(getMainMoments(stream.rewardAction!).map(moment=>moment.effect)).toEqual(['RETURN_REVEALED','CONVERT']);
  expect(stream.trigger).toMatchObject({event:'SPELL_EFFECT',elementGroup:['fire','water'],minimumElements:3});
 });
});
