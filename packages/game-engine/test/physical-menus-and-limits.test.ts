import { moment } from '../src/cards';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { applyAction, canPassActionPhase, canPlayerAct, createGame, hexDistance } from '../src';
import type { Activation, GameAction, GameState, PhysicalAction, Player, RoomEffect, Wizard } from '../src';

const player=(g:GameState,id='p1')=>g.players.find(p=>p.id===id)!;
const room=(g:GameState,id:string)=>g.board.rooms.find(r=>r.id===id)!;
const advance=(g:GameState)=>applyAction(g,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:g.phase,expectedRound:g.round});
const begin=(g:GameState,kind:PhysicalAction['kind']='EXPLORE',playerId='p1')=>applyAction(g,{type:'BEGIN_PHYSICAL_ACTION',playerId,kind});
const skip=(g:GameState,playerId='p1')=>applyAction(g,{type:'SKIP_PHYSICAL_EFFECTS',playerId});
const activateRoom=(g:GameState,roomTargetId?:string)=>applyAction(g,{type:'ACTIVATE_ROOM',playerId:'p1',roomTargetId});
const move=(g:GameState)=>applyAction(g,{type:'PERFORM_MOVEMENT',playerId:'p1'});
const attack=(g:GameState,targetId='p2')=>applyAction(g,{type:'INFLICT_ATTACK',playerId:'p1',targetId});
function rejected(g:GameState,action:GameAction,error?:RegExp) {
 const before=structuredClone(g);expect(()=>applyAction(g,action)).toThrow(error);expect(g).toEqual(before);
}
// TEST FIXTURE ONLY: transfer physical library cards; createGame supplies no personal cards.
function seedPersonalDeck(g:GameState,count=2,playerId='p1') {
 const seeded=g.library[0].cards.splice(0,count);expect(seeded).toHaveLength(count);
 player(g,playerId).personalDeck.push(...seeded);
}
function actionFixture(effect:RoomEffect='DRAW_GRIMOIRE') {
 const g=createGame();g.phase='ACTION';g.round=1;g.currentPlayerId='p1';
 g.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false,physicalAction:null};
 const source=g.board.rooms.find(r=>r.effect===effect)!;
 for(const p of g.players){p.wizard.position={...source.tiles[0]};seedPersonalDeck(g,2,p.id);}
 return g;
}
function preparationFixture(handSize=8) {
 const g=createGame();g.phase='PREPARATION';
 seedPersonalDeck(g,handSize);
 player(g).hand.push(...player(g).personalDeck.splice(0,handSize));return g;
}
function prepareAction(g:GameState,playerId='p1'):GameAction {
 const cards=player(g,playerId).hand;
 return {type:'PREPARE_CARDS',playerId,preparedCardIds:cards.slice(0,3).map(c=>c.id),rapidCardId:cards[3].id};
}
function blackRoseFixture(counts=[3,4]) {
 const g=createGame();g.phase='BLACK_ROSE';g.round=1;
 for(const p of g.players)seedPersonalDeck(g,2,p.id);
 for(const [i,count] of counts.entries()) {
  const quests=g.questDeck.splice(0,count);g.players[i].quest=quests.shift()??null;g.players[i].additionalQuests=quests;
 }
 return g;
}
const heldQuests=(p:Player)=>p.quest?[p.quest,...p.additionalQuests]:p.additionalQuests;
function cards(g:GameState) {
 return [...g.powerfulDeck,...g.removedCards,...g.library.flatMap(d=>[...d.cards,...d.discard]),...[...g.readiedSpells??[],...g.ongoingSpells??[]].map(a=>a.card),...g.players.flatMap(p=>[...p.hand,...p.discard,...p.personalDeck,...Object.values(p.prepared).filter(c=>c&&!c.used).map(c=>c!.card)])];
}
function conserved(g:GameState) {
 const all=cards(g);expect(all).toHaveLength(120);expect(new Set(all.map(c=>c.id)).size).toBe(120);
 expect(all.filter(c=>!c.powerful)).toHaveLength(108);expect(all.filter(c=>c.powerful)).toHaveLength(12);
 for(const p of g.players) {
  expect(p.cubes.available+p.cubes.onWizard+p.cubes.onBoard+p.cubes.onEvocations).toBe(25);
  expect(p.cubes.onWizard).toBe(g.players.reduce((sum,victim)=>sum+(victim.wizard.damageByPlayer[p.id]??0),0));
  expect(p.cubes.onEvocations).toBe(g.evocations.reduce((sum,victim)=>sum+(victim.damageByPlayer[p.id]??0),0));
 }
 const quests=[...g.questDeck,...g.questDiscard,...g.players.flatMap(heldQuests)];
 expect(new Set(quests.map(q=>q.id)).size).toBe(quests.length);
}

describe('agreed client interfaces and defaults',()=>{
 it('exposes exactly the agreed command payloads and required public stats',()=>{
  expectTypeOf<Extract<GameAction,{type:'BEGIN_PHYSICAL_ACTION'}>>().toEqualTypeOf<{type:'BEGIN_PHYSICAL_ACTION';playerId:string;kind:'EXPLORE'|'ATTACK'}>();
  expectTypeOf<Extract<GameAction,{type:'PERFORM_MOVEMENT'}>>().toEqualTypeOf<{type:'PERFORM_MOVEMENT';playerId:string}>();
  expectTypeOf<Extract<GameAction,{type:'ACTIVATE_ROOM'}>>().toEqualTypeOf<{type:'ACTIVATE_ROOM';playerId:string;roomTargetId?:string}>();
  expectTypeOf<Extract<GameAction,{type:'SKIP_PHYSICAL_EFFECTS'}>>().toEqualTypeOf<{type:'SKIP_PHYSICAL_EFFECTS';playerId:string}>();
  expectTypeOf<Extract<GameAction,{type:'INFLICT_ATTACK'}>>().toEqualTypeOf<{type:'INFLICT_ATTACK';playerId:string;targetId:string}>();
  expectTypeOf<Extract<GameAction,{type:'DISCARD_HAND_LIMIT'}>>().toEqualTypeOf<{type:'DISCARD_HAND_LIMIT';playerId:string;cardIds:string[]}>();
  expectTypeOf<Extract<GameAction,{type:'DISCARD_QUESTS'}>>().toEqualTypeOf<{type:'DISCARD_QUESTS';playerId:string;questIds:string[]}>();
  expectTypeOf<Activation['physicalAction']>().toEqualTypeOf<PhysicalAction|null|undefined>();
  expectTypeOf<Wizard['attack']>().toEqualTypeOf<number>();expectTypeOf<Wizard['movement']>().toEqualTypeOf<number>();
  expectTypeOf<Wizard['health']>().toEqualTypeOf<number>();
  expectTypeOf<Player['cardLimit']>().toEqualTypeOf<number>();expectTypeOf<Player['questLimit']>().toEqualTypeOf<number>();
  expectTypeOf<GameState['blackRoseResolved']>().toEqualTypeOf<boolean>();
  expectTypeOf<Extract<'maxHP',keyof Wizard>>().toBeNever();
  const g=createGame();expect(g.blackRoseResolved).toBe(false);
  for(const p of g.players) {
   expect(p.wizard).toMatchObject({attack:2,movement:2,health:10});
   expect(p).toMatchObject({cardLimit:7,questLimit:2});
  }
 });
});