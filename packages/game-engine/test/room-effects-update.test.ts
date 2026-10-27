import { describe, expect, it } from 'vitest';
import { applyAction, createGame, summonEvocation } from '../src';
import type { Card, GameState } from '../src';

function fixture():GameState {
 const s=createGame(2);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p2';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players)p.connected=true;
 return s;
}
const stand=(s:GameState,roomId:string)=>{s.players[0].wizard.position={...s.board.rooms.find(r=>r.id===roomId)!.tiles[0]};};
const activate=(s:GameState)=>applyAction(applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'ATTACK'}),{type:'ACTIVATE_ROOM',playerId:'p1'});
const give=(s:GameState,n:number):Card[]=>{const cards=s.library[0].cards.splice(0,n);s.players[0].hand.push(...cards);return cards;};

describe('Violet room: first-player token',()=>{
 it('places 1 cube and takes the first-player token',()=>{
  const s=fixture(),violet=s.board.rooms.find(r=>r.color==='violet')!;
  expect(violet.effect).toBe('FIRST_PLAYER');
  stand(s,violet.id);
  const after=activate(s),room=after.board.rooms.find(r=>r.id===violet.id)!;
  expect(room.instability).toBe(violet.instability+1);
  expect(room.cubesByPlayer.p1).toBe(1);
  expect(after.players[0].cubes.available).toBe(s.players[0].cubes.available-1);
  expect(after.firstPlayerId).toBe('p1');
 });
 it('starts the next phase with the new first player, not the current turn order',()=>{
  const s=fixture(),violet=s.board.rooms.find(r=>r.color==='violet')!;
  stand(s,violet.id);
  s.players[0].actionTokens=1;s.players[1].actionTokens=0;
  summonEvocation(s,s.players[0],'CADAVER',{q:0,r:0});summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0});
  const after=applyAction(activate(s),{type:'SKIP_PHYSICAL_EFFECTS',playerId:'p1'});
  expect(after.phase).toBe('EVOCATION');
  expect(after.currentPlayerId).toBe('p1');
  // Without the token the second seat would lead the Evocation phase.
  const other=fixture();stand(other,violet.id);other.players[0].actionTokens=1;other.players[1].actionTokens=0;
  summonEvocation(other,other.players[0],'CADAVER',{q:0,r:0});summonEvocation(other,other.players[1],'CADAVER',{q:0,r:0});
  other.firstPlayerId='p2';
  const begun=applyAction(other,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'ATTACK'});
  const ended=applyAction(begun,{type:'SKIP_PHYSICAL_EFFECTS',playerId:'p1'});
  expect(ended.currentPlayerId).toBe('p2');
 });
});

describe('Central room: discard cost',()=>{
 it('requires two non-forgotten hand cards',()=>{
  const s=fixture();stand(s,'room-0,0');give(s,1);
  expect(()=>activate(s)).toThrow(/Discard 2 cards/);
 });
 it('discards the two chosen cards, then gains the forgotten spell',()=>{
  const s=fixture();stand(s,'room-0,0');
  const [a,b,c]=give(s,3);
  const paused=activate(s);
  expect(paused.pendingDecision).toMatchObject({kind:'CHOICE',playerId:'p1'});
  const d1=paused.pendingDecision as Extract<NonNullable<GameState['pendingDecision']>,{kind:'CHOICE'}>;
  expect(d1.options.map(o=>o.id)).toEqual([a.id,b.id,c.id]);
  const second=applyAction(paused,{type:'RESPOND_CHOICE',playerId:'p1',key:d1.key,choiceId:b.id});
  const d2=second.pendingDecision as Extract<NonNullable<GameState['pendingDecision']>,{kind:'CHOICE'}>;
  expect(d2.options.map(o=>o.id)).toEqual([a.id,c.id]);
  const done=applyAction(second,{type:'RESPOND_CHOICE',playerId:'p1',key:d2.key,choiceId:a.id});
  expect(done.pendingDecision).toBeUndefined();
  const hand=done.players[0].hand;
  expect(hand.some(x=>x.id===c.id)).toBe(true);
  expect(hand.some(x=>x.id===a.id||x.id===b.id)).toBe(false);
  expect(hand.filter(x=>x.powerful)).toHaveLength(1);
  expect(hand).toHaveLength(2);
  expect(done.powerfulDeck).toHaveLength(s.powerfulDeck.length-1);
 });
 it('does not count a held forgotten spell toward the cost',()=>{
  const s=fixture();stand(s,'room-0,0');
  const forgotten=s.powerfulDeck.shift()!;s.players[0].hand.push(forgotten);give(s,1);
  expect(()=>activate(s)).toThrow(/Discard 2 cards/);
 });
});
