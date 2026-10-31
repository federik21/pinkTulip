import { describe, expect, it, vi } from 'vitest';
import { addPlayerToLobby, applyAction, canPlayerAct, createGame, getDefaultRoomsPerColor, getRoomRewards, hexDistance, hexKey, ROOM_COLORS, MAGE_DRAFT_POOL } from '../src';
import type { GameAction, GameState, RoomColor, RoomEffect } from '../src';

const player=(s:GameState,id='p1')=>s.players.find(p=>p.id===id)!;
const advance=(s:GameState)=>applyAction(s,{type:'ADVANCE_PHASE',playerId:s.hostId,expectedPhase:s.phase,expectedRound:s.round});
function reject(s:GameState,action:unknown,error:RegExp) {
 const before=structuredClone(s);expect(()=>applyAction(s,action as GameAction)).toThrow(error);expect(s).toEqual(before);
}
function cardIds(s:GameState) {
 return [...s.library.flatMap(d=>[...d.cards,...d.discard]),...s.powerfulDeck,...s.removedCards,
  ...[...s.readiedSpells??[],...s.ongoingSpells??[]].map(a=>a.card),
  ...s.players.flatMap(p=>[...p.hand,...p.personalDeck,...p.discard,...Object.values(p.prepared).flatMap(c=>c&&!c.used?[c.card]:[])])].map(c=>c.id).sort();
}
function conserved(s:GameState,ids:string[]) {
 expect(cardIds(s)).toEqual(ids);expect(ids).toHaveLength(120);expect(new Set(cardIds(s)).size).toBe(120);
}
function lobby(count=2) {
 const s=createGame(count);for(const p of s.players)p.connected=true;
 s.eventDeck=[{id:'quiet',name:'Quiet',description:'No effect',kind:'INSTABILITY',amount:0,rooms:0}];return s;
}
function ready(s:GameState) {
 for(const p of s.players)s=applyAction(s,{type:'SET_READY',playerId:p.id,ready:true});
 return s;
}
function study() {
 let s=applyAction(ready(lobby()),{type:'START_GAME',playerId:'p1'});
 for(const [index,id] of s.setupOrder!.entries())s=applyAction(s,{type:'DRAFT_SCHOOL',playerId:id,schoolId:s.library[index].id});
 for(const [index,id] of [...s.setupOrder!].reverse().entries())s=applyAction(s,{type:'DRAFT_MAGE',playerId:id,mageId:MAGE_DRAFT_POOL[index].id});
 return advance(s);
}

describe('two to four unique prepared spells with optional flexible slot',()=>{
 function preparation() {
  const s=createGame();s.phase='PREPARATION';player(s).hand.push(...s.library[0].cards.splice(0,6));return s;
 }
 function supportAction(numbered:readonly (number|null)[],quick?:number) {
  let s=createGame();s.phase='PREPARATION';s.round=1;
  const deck=s.library.find(d=>d.id==='transmutation')!;
  // Reserve canonical, harmless support cards before any random hand allocation.
  const cards=deck.cards.filter(c=>c.name==='Renewing Word');
  const opponent=deck.cards.filter(c=>c.name==='Mending Light').slice(0,2);
  expect(cards).toHaveLength(3);expect(opponent).toHaveLength(2);
  const selected=new Set([...cards,...opponent].map(c=>c.id));deck.cards=deck.cards.filter(c=>!selected.has(c.id));
  player(s).hand.push(...cards);player(s,'p2').hand.push(...opponent);
  for(const p of s.players)p.wizard.position={q:0,r:0};
  s=applyAction(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:numbered.map(i=>i===null?null:cards[i].id),...(quick===undefined?{}:{rapidCardId:cards[quick].id})});
  s=applyAction(s,{type:'PREPARE_CARDS',playerId:'p2',preparedCardIds:opponent.map(c=>c.id)});
  expect(s.phase).toBe('ACTION');return {s,cards};
 }
 it.each([[0,false],[1,false],[0,true],[4,false],[4,true],[5,false]] as const)('rejects invalid %i ordered spells with flexible=%s atomically',(ordered,flexible)=>{
  const s=preparation();reject(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:player(s).hand.slice(0,ordered).map(c=>c.id),...(flexible?{rapidCardId:player(s).hand[ordered].id}:{})},/2 to 4/);
 });
 it('rejects duplicate, absent and malformed selections and still enforces the hand limit first',()=>{
  const s=preparation(),[a,b]=player(s).hand;
  for(const payload of [{preparedCardIds:[a.id,a.id]},{preparedCardIds:[a.id,b.id],rapidCardId:a.id},{preparedCardIds:[a.id,'absent']},{preparedCardIds:null},{preparedCardIds:[a.id,b.id],rapidCardId:null}])
   reject(s,{type:'PREPARE_CARDS',playerId:'p1',...payload},/different spells|not in hand|ordered spells|card ID/);
  player(s).hand.push(...s.library[1].cards.splice(0,2));
  reject(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:[a.id,b.id]},/hand limit/);
 });
});

describe('host room-count configuration and atomic roster-scaled startup',()=>{
 it.each([[1,1],[2,1],[3,2],[4,3]])('exports the %i-player default/preview of %i rooms per color',(count,expected)=>expect(getDefaultRoomsPerColor(count)).toBe(expected));
 it.each([0,5,-1,2.5,NaN,Infinity])('rejects unsupported default roster %s',count=>expect(()=>getDefaultRoomsPerColor(count)).toThrow(/1 and 4/));
});