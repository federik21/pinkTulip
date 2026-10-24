import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '@brw/game-engine';
import type { Card, GameState } from '@brw/game-engine';
import { ActionHistory } from '../src/action-history';
import { publicState } from '../src/public-state';

const hidden = (index: number): Card => ({ id:`hidden-${index}`, name:'Hidden spell', kind:'SPELL',
 damage:0, instability:0, range:0, target:'MODEL' });
const physicalCards = (game: GameState) => [
 ...game.library.flatMap(deck => [...deck.cards, ...deck.discard]), ...game.powerfulDeck, ...game.removedCards,
 ...[...game.readiedSpells ?? [], ...game.ongoingSpells ?? []].map(active => active.card),
 ...game.players.flatMap(p => [...p.personalDeck, ...p.discard, ...p.hand,
  ...Object.values(p.prepared).flatMap(slot => slot && !slot.used ? [slot.card] : [])]),
];

describe('starting personal-deck public projection', () => {
 it.each(['cantrip', 'transmutation', 'enchantment'])('keeps exact %s identities hidden from every viewer until drawn', schoolId => {
  const history = new ActionHistory(); let game = createGame(4);
  const original = physicalCards(game).map(card => card.id).sort();
  expect(original).toHaveLength(120);
  for (const p of game.players) {
   p.connected = true;
   expect([p.personalDeck, p.hand, p.discard]).toEqual([[], [], []]);
   expect(Object.values(p.prepared)).toEqual([null, null, null, null]);
  }
  const chosen = game.library.find(deck => deck.id === schoolId)!;
  const sevenEach = Array.from({ length:4 }, (_, i) => structuredClone(chosen.cards.slice(i * 7, (i + 1) * 7)));
  for (const p of game.players) game = applyAction(game, { type:'SELECT_STARTING_SCHOOL', playerId:p.id, schoolId });
  expect(physicalCards(game).map(card => card.id).sort()).toEqual(original);
  expect(game.players.every(p => !p.personalDeck.length && !p.hand.length && !p.discard.length)).toBe(true);
  for (const p of game.players) game = applyAction(game, { type:'SET_READY', playerId:p.id, ready:true });
  game = applyAction(game, { type:'START_GAME', playerId:'p1' });
  expect(game.library.find(deck => deck.id === schoolId)!.cards).toHaveLength(8);
  for (const [i, p] of game.players.entries()) {
   expect(p.personalDeck).toEqual(sevenEach[i].slice(0, 6));
   expect(p.discard).toEqual(sevenEach[i].slice(6));
   expect(p.hand).toEqual([]);
  }
  const started = structuredClone(game);
  for (const viewer of ['p1', 'p2', 'p3', 'p4', null]) {
   const view = publicState(game, viewer, history), wire = JSON.stringify(view);
   for (const [i, p] of view.players.entries()) {
    expect(p.startingSchoolId).toBe(schoolId);
    expect(p.personalDeck).toEqual(Array.from({ length:6 }, (_, k) => hidden(k)));
    expect(p.discard).toEqual(sevenEach[i].slice(6));
    expect(p.hand).toEqual([]);
    for (const card of sevenEach[i].slice(0, 6)) expect(wire).not.toContain(`"${card.id}"`);
   }
  }
  expect(game).toEqual(started);
  game = applyAction(game, { type:'ADVANCE_PHASE', playerId:'p1', expectedPhase:'BLACK_ROSE', expectedRound:1 });
  expect(game.phase).toBe('STUDY');
  for (const [i, p] of game.players.entries()) {
   expect(p.hand).toEqual(sevenEach[i].slice(0, 2));
   expect(p.personalDeck).toEqual(sevenEach[i].slice(2, 6));
   expect(p.discard).toEqual(sevenEach[i].slice(6));
  }
  for (const viewer of ['p1', 'p2', 'p3', 'p4', null]) {
   const view = publicState(game, viewer, history), wire = JSON.stringify(view);
   for (const [i, p] of view.players.entries()) {
    expect(p.hand).toEqual(p.id === viewer ? sevenEach[i].slice(0, 2) : [hidden(0), hidden(1)]);
    expect(p.personalDeck).toEqual(Array.from({ length:4 }, (_, k) => hidden(k)));
    expect(p.discard).toEqual(sevenEach[i].slice(6));
    for (const card of sevenEach[i].slice(2, 6)) expect(wire).not.toContain(`"${card.id}"`);
    if (p.id !== viewer) for (const card of sevenEach[i].slice(0, 2)) expect(wire).not.toContain(`"${card.id}"`);
   }
  }
  expect(physicalCards(game).map(card => card.id).sort()).toEqual(original);
 });

 it('tests a deliberately constructed real-card overflow, not an initial-hand overflow', () => {
  const history = new ActionHistory(), game = createGame();
  game.phase = 'PREPARATION'; game.round = 2;
  for (const p of game.players) p.connected = true;
  const p = game.players[0];
  p.hand.push(...game.library[0].cards.splice(0, 6), ...game.library[1].cards.splice(0, 2), game.powerfulDeck.shift()!);
  const original = physicalCards(game).map(card => card.id).sort();
  expect(original).toHaveLength(120);
  const selected = p.hand.slice(-2), library = structuredClone(game.library);
  expect(() => history.apply(game, { type:'PREPARE_CARDS', playerId:p.id,
   preparedCardIds:p.hand.slice(0, 3).map(card => card.id), rapidCardId:p.hand[3].id }, p.id)).toThrow(/hand limit/);
  expect(() => history.apply(game, { type:'DISCARD_HAND_LIMIT', playerId:p.id, cardIds:[] }, p.id)).toThrow(/exactly 2/);
  expect(() => history.apply(game, { type:'DISCARD_HAND_LIMIT', playerId:p.id, cardIds:[selected[0].id, selected[0].id] }, p.id)).toThrow(/different spells/);
  expect(() => history.apply(game, { type:'DISCARD_HAND_LIMIT', playerId:p.id, cardIds:[selected[0].id, 'not-owned'] }, p.id)).toThrow(/not in hand/);
  const after = history.apply(game, { type:'DISCARD_HAND_LIMIT', playerId:p.id, cardIds:selected.map(card => card.id) }, p.id);
  expect(after.players[0].hand).toHaveLength(7);
  expect(after.players[0].discard).toEqual(selected);
  expect(after.library).toEqual(library);
  expect(after.removedCards).toEqual([]);
  expect(physicalCards(after).map(card => card.id).sort()).toEqual(original);
  for (const viewer of ['p1', 'p2', null]) {
   const view = publicState(after, viewer, history);
   expect(view.players[0].discard).toEqual(selected);
   expect(view.players[0].hand).toEqual(viewer === 'p1' ? after.players[0].hand : Array.from({ length:7 }, (_, k) => hidden(k)));
   expect(view.history).toEqual({ canUndo:false, canRedo:false });
  }
 });
});