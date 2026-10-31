import { describe, expect, it } from 'vitest';
import { applyAction, createEvents, createGame, EVENT_BOARD_SIZE, EventCard, GameState, MAGE_DRAFT_POOL } from '../src';

const ongoing = (id: string, entryPoints: number, exitPoints: number): EventCard =>
 ({ id, name: id, description: id, kind: 'ONGOING', amount: 0, rooms: 0, ongoing: { entryPoints, exitPoints } });
const quiet = (id: string): EventCard => ({ id, name: id, description: id, kind: 'BLACK_DAMAGE', amount: 0, rooms: 0 });

function started(deck: EventCard[]) {
 let g = createGame(2);
 for (const p of g.players) p.connected = true;
 for (const p of g.players)g=applyAction(g,{type:'SET_READY',playerId:p.id,ready:true});
 g.eventDeck = deck;
 g=applyAction(g,{type:'START_GAME',playerId:'p1'});
 for(const [index,id] of g.setupOrder!.entries())g=applyAction(g,{type:'DRAFT_SCHOOL',playerId:id,schoolId:g.library[index].id});
 for(const [index,id] of [...g.setupOrder!].reverse().entries())g=applyAction(g,{type:'DRAFT_MAGE',playerId:id,mageId:MAGE_DRAFT_POOL[index].id});
 return g;
}
// Fixture: jump to Cleanup of an early round, then begin the next BR for real.
function nextRound(g: GameState, deck?: EventCard[]) {
 g = structuredClone(g);
 g.phase = 'CLEANUP'; g.round = 1; g.currentPlayerId = null; g.activation = null; g.evocationActivation = null;
 if (deck) g.eventDeck = deck;
 return applyAction(g, { type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: 'CLEANUP', expectedRound: 1 });
}
const ids = (g: GameState) => g.eventBoard!.map(e => e?.id ?? null);

describe('ongoing events', () => {
 it('start with an empty board of three places', () => {
  const g = createGame(2);
  expect(EVENT_BOARD_SIZE).toBe(3);
  expect(g.eventBoard).toEqual([null, null, null]);
 });

 it('deck contains ongoing events that never use instant fields', () => {
  const cards = createEvents().filter(e => e.kind === 'ONGOING');
  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) expect(card.ongoing).toBeDefined();
 });

 it('enter slot 1, pay BR on entry, and skip the discard', () => {
  const g = started([ongoing('a', 2, 3), quiet('q')]);
  expect(ids(g)).toEqual(['a', null, null]);
  expect(g.blackRose.victoryPoints).toBe(2);
  expect(g.usedEvent?.id).toBe('a');
  expect(g.eventDiscard).toEqual([]);
 });

 it('shift all before each draw and pay BR when the last one leaves', () => {
  let g = started([ongoing('a', 1, 4)]);
  g = nextRound(g, [ongoing('b', 0, 0)]);
  expect(ids(g)).toEqual(['b', 'a', null]);
  g = nextRound(g, [ongoing('c', 0, 0)]);
  expect(ids(g)).toEqual(['c', 'b', 'a']);
  expect(g.blackRose.victoryPoints).toBe(1);
  g = nextRound(g, [ongoing('d', 0, 0)]);
  expect(ids(g)).toEqual(['d', 'c', 'b']);
  expect(g.blackRose.victoryPoints).toBe(5);
  expect(g.eventDiscard.map(e => e.id)).toEqual(['a']);
 });

 it('instant event drawn on a shifted board leaves slot 1 empty', () => {
  let g = started([ongoing('a', 0, 0)]);
  g = nextRound(g, [quiet('q')]);
  expect(ids(g)).toEqual([null, 'a', null]);
  expect(g.eventDiscard.map(e => e.id)).toEqual(['q']);
 });
});
