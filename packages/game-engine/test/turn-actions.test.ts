import { describe, expect, it } from 'vitest';
import { applyAction, canPassActionPhase, canPlayerAct, createGame } from '../src';
import type { GameAction, GameState, Player } from '../src';

function fixture() {
 const g=createGame();g.phase='ACTION';g.round=1;g.currentPlayerId='p1';
 g.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of g.players)p.wizard.position={q:0,r:0};
 return g;
}
function prepare(g:GameState,slot:keyof Player['prepared']) {
 const physical=g.library[0].cards.shift()!;
 // Budget tests need a deterministic immediate spell, not randomized Agony
 // Trap/ongoing metadata accidentally inherited from the physical draw.
 const card={id:physical.id,schoolId:physical.schoolId,name:'Turn budget spell',kind:'SPELL' as const,spellType:'COMBAT' as const,target:'ROOM' as const,moments:[],range:0};
 g.players[0].prepared[slot]={card,used:false};return card;
}
const cast=(slot:'rapid'|'slot1'|'slot2'):GameAction=>({type:'CAST_SPELL',playerId:'p1',slot,roomId:'room-0,0'});
function skipExplore(g:GameState) {
 g=applyAction(g,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'});
 return applyAction(g,{type:'SKIP_PHYSICAL_EFFECTS',playerId:'p1'});
}

describe('two shared turn actions',()=>{
 it('hands off after two Explores despite unused flexible and numbered spells',()=>{
  let g=fixture();prepare(g,'slot1');prepare(g,'rapid');
  g=skipExplore(g);expect(g.activation?.actionsUsed).toBe(1);
  g=skipExplore(g);
  expect(g.currentPlayerId).toBe('p2');expect(g.players[0].actionTokens).toBe(0);
  for(const slot of ['slot1','rapid'] as const) {
   expect(g.players[0].prepared[slot]?.used).toBe(false);
   expect(()=>applyAction(g,cast(slot))).toThrow(/Not your turn/);
  }
 });

 it.each(['rapid','slot1'] as const)('counts a %s spell before a physical action without spending its token',slot=>{
  let g=fixture();prepare(g,slot);
  g=applyAction(g,cast(slot));
  expect(g.activation?.actionsUsed).toBe(1);expect(g.players[0].actionTokens).toBe(2);
  g=skipExplore(g);
  expect(g.currentPlayerId).toBe('p2');expect(g.players[0].actionTokens).toBe(1);
 });

 it('counts numbered plus flexible as two actions and prevents a third spell or Attack',()=>{
  let g=fixture();prepare(g,'slot1');prepare(g,'slot2');prepare(g,'rapid');
  g=applyAction(g,cast('slot1'));g=applyAction(g,cast('rapid'));
  expect(g.currentPlayerId).toBe('p2');expect(g.players[0].actionTokens).toBe(2);
  expect(()=>applyAction(g,cast('slot2'))).toThrow(/Not your turn/);
  expect(()=>applyAction(g,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'ATTACK'})).toThrow(/Not your turn/);
 });

 it('counts each prepared powerful cast toward the same two-action limit',()=>{
  let g=fixture();const powers=g.powerfulDeck.splice(0,2);
  for(const [i,slot] of (['slot1','rapid'] as const).entries())g.players[0].prepared[slot]={card:powers[i],used:false};
  for(const slot of ['slot1','rapid'] as const) {
   const card=g.players[0].prepared[slot]!.card;
   g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot,roomId:'room-0,0',...(card.target==='MODEL'?{dummy:true}:{})});
  }
  expect(g.currentPlayerId).toBe('p2');expect(g.players[0].actionTokens).toBe(2);
  expect(g.removedCards.map(c=>c.id)).toEqual(powers.map(c=>c.id));
 });

 it('counts discard-to-move followed by Explore as two actions, without charging a token for discard',()=>{
  let g=fixture();g.players[0].wizard.position={q:3,r:-2};
  const card=prepare(g,'slot2');prepare(g,'rapid');
  g=applyAction(g,{type:'DISCARD_EXIT',playerId:'p1',cardId:card.id,destination:{q:2,r:-2}});
  expect(g.activation?.actionsUsed).toBe(1);expect(g.players[0].actionTokens).toBe(2);
  g=skipExplore(g);
  expect(g.currentPlayerId).toBe('p2');expect(g.players[0].actionTokens).toBe(1);
  expect(g.players[0].wizard.position).toEqual({q:2,r:-2});
 });

 it('finishes both movement steps and the room effect of the second action before handing off',()=>{
  let g=fixture();prepare(g,'slot1');g=applyAction(g,cast('slot1'));
  g=applyAction(g,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'});
  g=applyAction(g,{type:'PERFORM_MOVEMENT',playerId:'p1'});
  g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:{q:1,r:0}});
  g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:{q:1,r:-1}});
  expect(g.currentPlayerId).toBe('p1');expect(g.activation?.actionsUsed).toBe(2);
  g=applyAction(g,{type:'ACTIVATE_ROOM',playerId:'p1'});
  expect(g.evocations).toHaveLength(1);expect(g.currentPlayerId).toBe('p2');
 });

 it('rejects every new action in an exhausted activation without mutating state',()=>{
  const g=fixture();prepare(g,'slot1');g.activation!.actionsUsed=2;
  const card=g.players[0].prepared.slot1!.card;
  for(const action of [cast('slot1'),{type:'EXPLORE',playerId:'p1'},{type:'PUNCH',playerId:'p1',targetId:'p2'},
   {type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'}] as GameAction[]) {
   const before=structuredClone(g);
   expect(()=>applyAction(g,action)).toThrow(/actions/);expect(g).toEqual(before);
  }
  g.players[0].wizard.position={q:3,r:-2};
  expect(()=>applyAction(g,{type:'DISCARD_EXIT',playerId:'p1',cardId:card.id,destination:{q:2,r:-2}})).toThrow(/actions/);
  expect(canPlayerAct(g,g.players[0])).toBe(false);
  expect(canPassActionPhase(g,g.players[0])).toBe(false);
 });

 it('refreshes only the turn counter on handoff, preserving unused cards and round tokens',()=>{
  let g=fixture();prepare(g,'slot1');prepare(g,'rapid');
  g=applyAction(g,cast('slot1'));g=skipExplore(g);
  g=applyAction(g,{type:'EXPLORE',playerId:'p2'});g=applyAction(g,{type:'END_EXPLORE',playerId:'p2'});
  g=applyAction(g,{type:'END_ACTIVATION',playerId:'p2'});
  expect(g.currentPlayerId).toBe('p1');expect(g.activation?.actionsUsed).toBe(0);
  expect(g.players[0].actionTokens).toBe(1);expect(g.players[0].prepared.rapid?.used).toBe(false);
  g=applyAction(g,cast('rapid'));expect(g.activation?.actionsUsed).toBe(1);
 });
});