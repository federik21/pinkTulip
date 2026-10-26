import { describe, expect, it } from 'vitest';
import { applyAction, createAgonyDeck, createGame } from '../src';
import type { GameState, Hex } from '../src';

const offAxis:Hex={q:1,r:1};

// p2's ongoing Ineluctable Pain is bound to p1: whenever p1's VP changes, p1 suffers 2 damage from p2.
function fixture(position:'START'|'ROOM'):GameState {
 const s=createGame(2);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players)p.connected=true;
 s.players[0].wizard.position=position==='ROOM'?{...offAxis}:{...s.players[0].wizard.position};
 s.players[1].wizard.position={q:0,r:0};
 const deck=s.library.find(d=>d.id==='agony')!;
 const card=createAgonyDeck('agony','agony').find(c=>c.name==='Ineluctable Pain'&&deck.cards.some(stock=>stock.id===c.id))!;
 deck.cards.splice(deck.cards.findIndex(c=>c.id===card.id),1);
 s.ongoingSpells!.push({id:'pain',playerId:'p2',targetPlayerId:'p1',card});s.activeSpellOrder!.push('pain');
 s.players[0].quest={id:'vp-quest',name:'Rewarding quest',description:'Already complete.',kind:'ROOM_ACTIVATE',
  amount:1,progress:1,completed:true,claimed:false,reward:1};
 return s;
}
const solve=(s:GameState)=>applyAction(s,{type:'USE_QUEST_REWARD',playerId:'p1',questId:'vp-quest'});

describe('mages in a starting cell only suffer Pink Tulip damage',()=>{
 it('takes damage from another player’s ongoing effect outside the cell (control)',()=>{
  const after=solve(fixture('ROOM'));
  expect(after.players[0].victoryPoints).toBe(1);
  expect(after.players[0].wizard.damageByPlayer).toEqual({p2:2});
 });

 it('ignores another player’s ongoing damage while inside the cell',()=>{
  const s=fixture('START');
  expect(s.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>h.q===s.players[0].wizard.position.q&&h.r===s.players[0].wizard.position.r))).toBe(true);
  const after=solve(s);
  expect(after.players[0].victoryPoints).toBe(1);
  expect(after.players[0].wizard.damageCubes).toBe(0);
  expect(after.players[0].wizard.damageByPlayer).toEqual({});
  expect(after.players[1].cubes.onWizard).toBe(0);
  expect(after.log.some(l=>/protected from .* damage in the starting cell/.test(l))).toBe(true);
 });
});
