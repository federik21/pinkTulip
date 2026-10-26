import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAction, createGame, upgradeLegacyCards } from '../src';
import type { GameState, RoomEffect } from '../src';

afterEach(()=>vi.restoreAllMocks());
function actionRoom(effect:RoomEffect):GameState {
 const s=createGame(2);s.round=1;s.phase='ACTION';s.currentPlayerId='p1';
 s.players.forEach(p=>{p.connected=true;p.wizard.position={q:0,r:0};});
 s.activation={playerId:'p1',actionsUsed:1,exploring:0,spellsCast:0,sequencedSpellUsed:false,discardedExit:false,roomEffectUsed:false,
  physicalAction:{kind:'EXPLORE',mainEffectUsed:false,movementStarted:false}};
 Object.assign(s.board.rooms.find(r=>r.id==='room-0,0')!,{effect,reconstructed:true});
 return s;
}
const activate=(s:GameState)=>applyAction(s,{type:'ACTIVATE_ROOM',playerId:'p1'});
const ids=(cards:{id:string}[])=>cards.map(c=>c.id);
const spellIds=(s:GameState)=>ids([...s.library.flatMap(d=>[...d.cards,...d.discard]),...s.powerfulDeck,...s.removedCards,
 ...s.players.flatMap(p=>[...p.personalDeck,...p.discard,...p.hand])]).sort();

describe('every discard-backed deck refills when exhausted, even partway through a draw',()=>{
 it.each([0,1])('draws two personal spells when %i remain before the shuffle',remaining=>{
  const s=actionRoom('DRAW_GRIMOIRE'),p=s.players[0];
  p.personalDeck=s.library[0].cards.splice(0,remaining);p.discard=s.library[0].cards.splice(0,4);
  const first=ids(p.personalDeck),available=ids([...p.personalDeck,...p.discard]),before=spellIds(s);
  const after=activate(s),mage=after.players[0];
  expect(mage.hand).toHaveLength(2);expect(ids(mage.hand).slice(0,remaining)).toEqual(first);
  expect(mage.discard).toEqual([]);expect(mage.personalDeck).toHaveLength(available.length-2);
  expect(new Set(ids([...mage.hand,...mage.personalDeck]))).toEqual(new Set(available));
  expect(spellIds(after)).toEqual(before);expect(s.players[0].hand).toEqual([]);
 });
 it('does not mix a nonempty draw pile with its discard before needed',()=>{
  const s=actionRoom('DRAW_GRIMOIRE'),p=s.players[0];
  p.personalDeck=s.library[0].cards.splice(0,3);p.discard=s.library[0].cards.splice(0,2);
  const top=ids(p.personalDeck),discard=structuredClone(p.discard);const after=activate(s).players[0];
  expect(ids(after.hand)).toEqual(top.slice(0,2));expect(ids(after.personalDeck)).toEqual(top.slice(2));expect(after.discard).toEqual(discard);
 });
 it('draws only the available personal spells without borrowing other piles or duplicating cards',()=>{
  const s=actionRoom('DRAW_GRIMOIRE');s.players[0].discard=s.library[0].cards.splice(0,1);
  const before=spellIds(s),peer=structuredClone(s.players[1]),library=structuredClone(s.library);
  const after=activate(s);expect(after.players[0].hand).toHaveLength(1);expect(after.players[0].discard).toEqual([]);
  expect(after.players[1]).toEqual(peer);expect(after.library).toEqual(library);expect(spellIds(after)).toEqual(before);
 });
 it('refills personal draws at the beginning of Study, not just in rooms',()=>{
  const s=actionRoom('DRAW_GRIMOIRE');s.phase='BLACK_ROSE';s.activation=null;s.currentPlayerId=null;
  s.players[0].personalDeck=s.library[0].cards.splice(0,1);s.players[0].discard=s.library[0].cards.splice(0,3);
  const first=s.players[0].personalDeck[0].id,before=spellIds(s);
  const after=applyAction(s,{type:'ADVANCE_PHASE',playerId:s.hostId,expectedPhase:'BLACK_ROSE',expectedRound:1});
  expect(after.phase).toBe('STUDY');expect(after.players[0].hand).toHaveLength(2);expect(after.players[0].hand[0].id).toBe(first);
  expect(after.players[0].discard).toEqual([]);expect(spellIds(after)).toEqual(before);
 });
 it.each([0,1,2,3])('continues all four blind school draws with only %i cards in its draw pile',remaining=>{
  const s=createGame(2);s.phase='STUDY';const deck=s.library[0];
  deck.discard=deck.cards.splice(remaining);const first=ids(deck.cards),before=spellIds(s);
  const after=applyAction(s,{type:'DRAW_STUDY',playerId:'p1',deckIds:Array(4).fill(deck.id)});
  expect(after.players[0].hand).toHaveLength(4);expect(ids(after.players[0].hand).slice(0,remaining)).toEqual(first);
  expect(after.players[0].studyCardIds).toEqual(ids(after.players[0].hand));expect(after.library[0].discard).toEqual([]);
  expect(spellIds(after)).toEqual(before);
 });
 it('shuffles the discard rather than just transferring its original order',()=>{
  const s=actionRoom('DRAW_GRIMOIRE');s.players[0].discard=s.library[0].cards.splice(0,4);
  const original=ids(s.players[0].discard);vi.spyOn(Math,'random').mockReturnValue(0);
  const after=activate(s).players[0];expect(ids([...after.hand,...after.personalDeck])).not.toEqual(original);
  expect(new Set(ids([...after.hand,...after.personalDeck]))).toEqual(new Set(original));
 });
 it('refills the quest pile between two draws and resets recycled progress and rewards',()=>{
  const s=actionRoom('DRAW_QUEST');s.questDiscard=s.questDeck.splice(1);
  const first=s.questDeck[0].id,available=ids([...s.questDeck,...s.questDiscard]).sort();
  for(const quest of s.questDiscard)Object.assign(quest,{progress:quest.amount,completed:true,claimed:true});
  const after=activate(s),quests=[after.players[0].quest!,...after.players[0].additionalQuests];
  expect(quests).toHaveLength(2);expect(quests[0].id).toBe(first);
  for(const quest of quests)expect(quest).toMatchObject({progress:0,completed:false,claimed:false});
  expect(after.questDiscard).toEqual([]);expect(ids([...after.questDeck,...quests]).sort()).toEqual(available);
 });
 it('refills event cards at the start of a new round',()=>{
  const s=createGame(2);s.phase='CLEANUP';s.round=1;s.eventDiscard=s.eventDeck.splice(0);
  const available=ids(s.eventDiscard).sort();const after=applyAction(s,{type:'ADVANCE_PHASE',playerId:s.hostId,expectedPhase:'CLEANUP',expectedRound:1});
  expect(after.phase).toBe('BLACK_ROSE');expect(after.usedEvent).toBeTruthy();expect(after.eventDiscard).toEqual([after.usedEvent]);
  expect(ids([...after.eventDeck,...after.eventDiscard]).sort()).toEqual(available);
 });
 it('replays the identical shuffle after a reaction pauses a drawing room action, even through JSON',()=>{
  const s=actionRoom('DRAW_GRIMOIRE');s.players[0].discard=s.library[0].cards.splice(0,4);
    const card={id:s.library[0].cards.shift()!.id,name:'Draw observer',kind:'SPELL' as const,target:'SELF' as const,range:0,moments:[],spellType:'PROTECTION' as const,
   trigger:{event:'ROOM_ACTIVATED' as const,relation:'ENEMY' as const,scope:'ANY' as const},triggerEffects:[]};
  s.readiedSpells!.push({id:'draw-observer',playerId:'p2',card});s.activeSpellOrder!.push('draw-observer');
  const paused=activate(s);expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL');
  expect(paused.pendingDecision!.resume!.entropy!.random.length).toBeGreaterThan(0);
  const restored:GameState=JSON.parse(JSON.stringify(paused));upgradeLegacyCards(restored);
  const action={type:'RESPOND_REACTIVE_SPELL' as const,playerId:'p2',key:paused.pendingDecision!.key};
  vi.spyOn(Math,'random').mockImplementation(()=>{throw new Error('Shuffle must use saved entropy');});
  const first=applyAction(paused,action),second=applyAction(restored,action);
  expect(ids(first.players[0].hand)).toEqual(ids(second.players[0].hand));
  expect(ids(first.players[0].personalDeck)).toEqual(ids(second.players[0].personalDeck));
  expect(first.players[0].hand).toHaveLength(2);expect(first.players[0].discard).toEqual([]);
 });
 it('does not recycle permanently removed Forgotten spells or another deck\'s discard',()=>{
  const s=actionRoom('DRAW_POWERFUL');s.removedCards=s.powerfulDeck.splice(0);const removed=structuredClone(s.removedCards);
  s.players[0].discard=s.library[0].cards.splice(0,2);const discard=structuredClone(s.players[0].discard);
  const after=activate(s);expect(after.players[0].hand).toEqual([]);expect(after.removedCards).toEqual(removed);expect(after.players[0].discard).toEqual(discard);
 });
});