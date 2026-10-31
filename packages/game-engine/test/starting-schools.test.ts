import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
 applyAction, canStartGame, createGame, MAGE_DRAFT_POOL, MAGE_SPELL_COPIES, STARTING_SCHOOL_CARDS,
} from '../src';
import type { GameAction, GameState, MageDraftId } from '../src';

const start=(s:GameState)=>applyAction(s,{type:'START_GAME',playerId:s.hostId});
function lobby(count=2) {
 const s=createGame(count);
 for(const p of s.players)p.connected=true;
 s.eventDeck=[{id:'quiet',name:'Quiet',description:'No effect',kind:'INSTABILITY',amount:0,rooms:0}];
 return s;
}
function ready(s:GameState) {
 for(const p of s.players)s=applyAction(s,{type:'SET_READY',playerId:p.id,ready:true});
 return s;
}
function draftSchool(s:GameState,playerId:string,schoolId:string) {
 return applyAction(s,{type:'DRAFT_SCHOOL',playerId,schoolId});
}
function draftMage(s:GameState,playerId:string,mageId:MageDraftId) {
 return applyAction(s,{type:'DRAFT_MAGE',playerId,mageId});
}

describe('randomized school and mage setup',()=>{
 it('starts setup only after readiness, randomizes order and rooms, and validates each draft turn',()=>{
  vi.spyOn(Math,'random').mockReturnValue(0);
  try {
   let s=ready(lobby(2));
   expect(canStartGame(s)).toBe(true);
   expect(s.phase).toBe('LOBBY');
   s=start(s);
   expect(s.phase).toBe('SETUP');
   expect(s.setupStage).toBe('SCHOOL');
   expect(s.setupOrder).toEqual(['p2','p1']);
   expect(s.firstPlayerId).toBe('p2');
   expect(s.players.map(p=>s.board.rooms.find(room=>room.startingFor===p.id)?.id)).toHaveLength(2);
   expect(s.players.map(p=>p.wizard.startingRoomId)).toEqual(s.players.map(p=>s.board.rooms.find(room=>room.startingFor===p.id)?.id));
   expect(()=>draftSchool(s,'p1',s.library[0].id)).toThrow('Wait for your turn to draft a school');
   const before=structuredClone(s);
   expect(()=>draftSchool(s,'p2','missing')).toThrow('School not found');
   expect(s).toEqual(before);
   s=draftSchool(s,'p2',s.library[0].id);
   expect(s.players.find(p=>p.id==='p2')!.personalDeck).toHaveLength(6);
   expect(s.setupStage).toBe('SCHOOL');
   s=draftSchool(s,'p1',s.library[1].id);
   expect(s.setupStage).toBe('MAGE');
   expect(()=>draftMage(s,'p2','tizio')).toThrow('Wait for your turn to draft a mage');
  } finally { vi.restoreAllMocks(); }
 });

 it('drafts mages in reverse order, reserves all signature spells, and shuffles then discards one grimoire card',()=>{
  let s=ready(lobby(3));
  s=start(s);
  const schoolIds=s.library.map(deck=>deck.id);
  for(const [index,playerId] of s.setupOrder!.entries())s=draftSchool(s,playerId,schoolIds[index]);
  const reverse=[...s.setupOrder!].reverse();
  for(const [index,playerId] of reverse.entries())s=draftMage(s,playerId,MAGE_DRAFT_POOL[index].id);
  expect(s.phase).toBe('BLACK_ROSE');
  expect(s.round).toBe(1);
  expect(s.setupStage).toBeNull();
  for(const player of s.players) {
   expect(player.hand).toEqual([]);
   expect(player.personalDeck).toHaveLength(6);
   expect(player.discard).toHaveLength(1);
   expect(player.startingSchoolId).toBeTruthy();
   expect(player.mageId).toBeTruthy();
   expect(player.mageSpellSupply).toHaveLength(2);
   expect(player.personalDeck.filter(card=>card.id.startsWith(`mage-${player.mageId}-`)).length+
    player.discard.filter(card=>card.id.startsWith(`mage-${player.mageId}-`)).length).toBe(1);
   expect(player.wizard).toMatchObject({health:10,attack:2,movement:2});
  }
  expect(new Set(s.players.map(player=>player.startingSchoolId)).size).toBe(3);
  expect(new Set(s.players.map(player=>player.mageId)).size).toBe(3);
  expectTypeOf<Extract<GameAction,{type:'DRAFT_MAGE'}>['mageId']>().toEqualTypeOf<MageDraftId>();
  expect(STARTING_SCHOOL_CARDS).toBe(6);
  expect(MAGE_SPELL_COPIES).toBe(3);
 });

  it('awards each mage the next signature spell when a score crosses both moon thresholds',()=>{
   let s=ready(lobby(2));
   s=start(s);
   const schoolIds=s.library.map(deck=>deck.id);
   for(const [index,playerId] of s.setupOrder!.entries())s=draftSchool(s,playerId,schoolIds[index]);
   for(const [index,playerId] of [...s.setupOrder!].reverse().entries())s=draftMage(s,playerId,MAGE_DRAFT_POOL[index].id);
   s.phase='ACTION';
   s.round=1;
   s.currentPlayerId='p1';
   s.players[0].victoryPoints=4;
   s.activation={playerId:'p1',actionsUsed:0,exploring:0,spellsCast:0,sequencedSpellUsed:false,discardedExit:false,roomEffectUsed:false};
   const quest=s.questDeck.shift()!;
   Object.assign(quest,{progress:quest.amount,completed:true,claimed:false,reward:11,rewardAction:undefined});
   s.players[0].quest=quest;
   s=applyAction(s,{type:'USE_QUEST_REWARD',playerId:'p1',questId:quest.id});
   expect(s.moon).toBe(3);
   expect(s.moonEvents).toEqual([2,3]);
   for(const player of s.players) {
    expect(player.hand.map(card=>card.id).filter(id=>id.startsWith(`mage-${player.mageId}-`)).sort())
     .toEqual([`mage-${player.mageId}-2`,`mage-${player.mageId}-3`].sort());
    expect(player.mageSpellSupply).toEqual([]);
   }

   s.players[0].victoryPoints=4;
   s.phase='ACTION';
   s.currentPlayerId='p1';
   s.activation={playerId:'p1',actionsUsed:0,exploring:0,spellsCast:0,sequencedSpellUsed:false,discardedExit:false,roomEffectUsed:false};
   const nextQuest=s.questDeck.shift()!;
   Object.assign(nextQuest,{progress:nextQuest.amount,completed:true,claimed:false,reward:11,rewardAction:undefined});
   s.players[0].quest=nextQuest;
   s=applyAction(s,{type:'USE_QUEST_REWARD',playerId:'p1',questId:nextQuest.id});
   expect(s.moon).toBe(3);
   expect(s.moonEvents).toEqual([2,3]);
   for(const player of s.players)expect(player.hand.filter(card=>card.id.startsWith(`mage-${player.mageId}-`))).toHaveLength(2);

   s.moon=1;
   s.moonEvents=[];
   s.blackRose.victoryPoints=4;
   s.players.forEach(player=>{
    player.victoryPoints=0;
    player.mageSpellSupply=player.hand.filter(card=>card.id.startsWith(`mage-${player.mageId}-`));
    player.hand=player.hand.filter(card=>!card.id.startsWith(`mage-${player.mageId}-`));
   });
   s.eventDeck=[{id:'moon-threshold-event',name:'Moon threshold',description:'',kind:'ONGOING',amount:0,rooms:0,ongoing:{entryPoints:1,exitPoints:0}}];
   s.phase='CLEANUP';
   s.round=1;
   s.currentPlayerId=null;
   s.activation=null;
   s=applyAction(s,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:'CLEANUP',expectedRound:1});
   expect(s.moon).toBe(2);
   expect(s.moonEvents).toEqual([2]);
   expect(s.players.every(player=>player.hand.some(card=>card.id===`mage-${player.mageId}-2`))).toBe(true);
  });
});
