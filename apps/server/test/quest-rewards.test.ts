import { describe, expect, it } from 'vitest';
import { createGame } from '../../../packages/game-engine/src';
import type { GameAction } from '../../../packages/game-engine/src';
import { ActionHistory } from '../src/action-history';
import { publicState } from '../src/public-state';

function fixture() {
 const s=createGame(2);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,spellsCast:0,sequencedSpellUsed:false,exploring:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 const index=s.questDeck.findIndex(q=>q.kind==='ROOM_ACTIVATE'),quest=s.questDeck.splice(index,1)[0];
 Object.assign(quest,{progress:quest.amount,completed:true,claimed:false});s.players[0].quest=quest;
 return s;
}

describe('quest reward transport, privacy and discard recycling',()=>{
 it('only the owner sees the completed-but-unsolved objective and its free reward',()=>{
  const s=fixture(),history=new ActionHistory(),owner=publicState(s,'p1',history);
  expect(owner.players[0].quest).toMatchObject({id:s.players[0].quest!.id,completed:true,claimed:false});
  for(const viewer of ['p2',null]){
   const peer=publicState(s,viewer,history);expect(peer.players[0].quest).toBeNull();expect(peer.players[0].additionalQuests).toEqual([]);
  }
 });
 it('solving exposes the normal public quest discard, clears history and leaves action/token costs unchanged',()=>{
  const history=new ActionHistory(),initial=fixture(),id=initial.players[0].quest!.id;
  let s=history.apply(initial,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'},'p1');
  s=history.apply(s,{type:'SKIP_PHYSICAL_EFFECTS',playerId:'p1'},'p1');expect(history.status(s,'p1').canUndo).toBe(true);
  const activation=structuredClone(s.activation),tokens=s.players[0].actionTokens;
  s=history.apply(s,{type:'USE_QUEST_REWARD',playerId:'p1',questId:id},'p1');
  expect(s.activation).toEqual(activation);expect(s.players[0].actionTokens).toBe(tokens);
  expect(history.status(s,'p1')).toEqual({canUndo:false,canRedo:false});
  expect(publicState(s,'p2',history).questDiscard).toMatchObject([{id,claimed:true}]);
 });
 it('authenticates free rewards just like counted actions and rejects duplicate claims',()=>{
  const initial=fixture(),history=new ActionHistory(),action:GameAction={type:'USE_QUEST_REWARD',playerId:'p1',questId:initial.players[0].quest!.id};
  const before=structuredClone(initial);expect(()=>history.apply(initial,action,'p2')).toThrow(/another player/);expect(initial).toEqual(before);
  const solved=history.apply(initial,action,'p1');expect(()=>history.apply(solved,action,'p1')).toThrow(/unavailable/);
 });
 it('recycled personal draws remain a history barrier and every viewer sees only hidden future cards',()=>{
  const history=new ActionHistory(),initial=fixture();initial.players[0].discard=initial.library[0].cards.splice(0,4);
  const room=initial.board.rooms.find(r=>r.id==='room-0,0')!;room.effect='DRAW_GRIMOIRE';room.reconstructed=true;
  let s=history.apply(initial,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'},'p1');
  expect(history.status(s,'p1').canUndo).toBe(true);s=history.apply(s,{type:'ACTIVATE_ROOM',playerId:'p1'},'p1');
  expect(s.players[0].hand).toHaveLength(2);expect(s.players[0].discard).toEqual([]);expect(s.players[0].personalDeck).toHaveLength(2);
  expect(history.status(s,'p1')).toEqual({canUndo:false,canRedo:false});
  for(const viewer of ['p1','p2',null]){
   const projected=publicState(s,viewer,history);expect(projected.players[0].personalDeck.every(c=>c.name==='Hidden spell')).toBe(true);
   if(viewer!=='p1')expect(projected.players[0].hand.every(c=>c.name==='Hidden spell')).toBe(true);
  }
 });
});