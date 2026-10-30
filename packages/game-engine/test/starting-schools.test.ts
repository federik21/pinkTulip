import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
 addPlayerToLobby, applyAction, BLACK_ROSE_ID, canStartGame, createEnchantmentDeck,
 createEvents, createGame, createSpellDeck, getSpellType, MAGE_COLOR_NAMES,
 ROOM_EFFECT_LABELS, STARTING_SCHOOL_CARDS,
} from '../src';
import type { GameAction, GameState, Player, SpellType } from '../src';

const select=(s:GameState,playerId='p1',schoolId='cantrip')=>applyAction(s,{type:'SELECT_STARTING_SCHOOL',playerId,schoolId});
const ready=(s:GameState,playerId='p1')=>applyAction(s,{type:'SET_READY',playerId,ready:true});
const start=(s:GameState)=>applyAction(s,{type:'START_GAME',playerId:s.hostId});
const advance=(s:GameState)=>applyAction(s,{type:'ADVANCE_PHASE',playerId:s.hostId,expectedPhase:s.phase,expectedRound:s.round});
function lobby(count=2) {
 const s=createGame(count);
 for(const p of s.players)p.connected=true;
 s.eventDeck=[{id:'quiet',name:'Quiet',description:'No effect',kind:'INSTABILITY',amount:0,rooms:0}];
 return s;
}
function readyLobby(schools=['cantrip','cantrip']) {
 let s=lobby(schools.length);
 for(const [i,school] of schools.entries())s=ready(select(s,`p${i+1}`,school),`p${i+1}`);
 return s;
}
function reject(s:GameState,action:GameAction,error:RegExp) {
 const before=structuredClone(s);
 expect(()=>applyAction(s,action)).toThrow(error);
 expect(s).toEqual(before);
}
function physicalCards(s:GameState) {
 return [
  ...s.library.flatMap(d=>[...d.cards,...d.discard]),...s.powerfulDeck,...s.removedCards,
  ...[...s.readiedSpells??[],...s.ongoingSpells??[]].map(a=>a.card),
  ...s.players.flatMap(p=>[...p.personalDeck,...p.hand,...p.discard,...Object.values(p.prepared).filter(c=>c&&!c.used).map(c=>c!.card)]),
 ];
}

describe('explicit starting-school lobby contract',()=>{
 it('exports the setup count, stable color names and legacy-optional public choice',()=>{
  expect(STARTING_SCHOOL_CARDS).toBe(7);
  expect(MAGE_COLOR_NAMES).toEqual({p1:'Rose',p2:'Blue',p3:'Amber',p4:'Green'});
  expectTypeOf<Player['startingSchoolId']>().toEqualTypeOf<string|null|undefined>();
  expectTypeOf<Extract<GameAction,{type:'SELECT_STARTING_SCHOOL'}>>().toEqualTypeOf<{type:'SELECT_STARTING_SCHOOL';playerId:string;schoolId:string}>();
  expectTypeOf<SpellType>().toEqualTypeOf<'COMBAT'|'CONTINGENCY'|'TRAP'|'PROTECTION'>();
 });
 it('rejects unknown players and requires connection before selection/readiness',()=>{
  const s=createGame();
  reject(s,{type:'SELECT_STARTING_SCHOOL',playerId:'unknown',schoolId:'cantrip'},/Player not found/);
  reject(s,{type:'SELECT_STARTING_SCHOOL',playerId:'p1',schoolId:'cantrip'},/Join the room first/);
  reject(s,{type:'SET_READY',playerId:'p1',ready:true},/Join the room first/);
 });
});