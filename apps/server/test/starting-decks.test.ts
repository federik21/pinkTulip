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
 it('keeps all four mixed-school Study eligibility IDs owner-only before and after discarding', () => {
  const history = new ActionHistory(); let game = createGame();
  for (const p of game.players) p.connected = true;
  for (const p of game.players) {
   game = history.apply(game, { type:'SELECT_STARTING_SCHOOL', playerId:p.id, schoolId:'cantrip' }, p.id);
  }
  for (const p of game.players) game = history.apply(game, { type:'SET_READY', playerId:p.id, ready:true }, p.id);
  game = history.apply(game, { type:'ADVANCE_PHASE', playerId:'p1', expectedPhase:'BLACK_ROSE', expectedRound:1 }, 'p1');
  const oldHand = structuredClone(game.players[0].hand);
  game = history.apply(game, { type:'DRAW_STUDY', playerId:'p1', deckIds:['cantrip', 'transmutation', 'enchantment', 'transmutation'] }, 'p1');
  const ids = [...game.players[0].studyCardIds!], authoritative = structuredClone(game);
  expect(ids).toHaveLength(4); expect(new Set(ids).size).toBe(4);
  expect(ids.map(id => game.players[0].hand.find(card => card.id === id)!.schoolId))
   .toEqual(['cantrip', 'transmutation', 'enchantment', 'transmutation']);
  expect(oldHand.every(card => !ids.includes(card.id))).toBe(true);
  const check = (state: GameState, beforeDiscard: boolean) => {
   for (const viewer of ['p1', 'p2', null]) {
    const projected = publicState(state, viewer, history);
    const wire = JSON.parse(JSON.stringify(projected)) as GameState;
    for (const p of wire.players) {
     if (p.id === viewer) expect(p.studyCardIds).toEqual(state.players.find(actual => actual.id === viewer)!.studyCardIds);
     else expect(p).not.toHaveProperty('studyCardIds');
    }
    if (viewer === 'p1') expect(wire.players[0].studyCardIds).toEqual(ids);
    else if (beforeDiscard) for (const id of ids) expect(JSON.stringify(wire)).not.toContain(`"${id}"`);
    for (const p of wire.players) expect(p.personalDeck).toEqual(p.personalDeck.map((_, i) => hidden(i)));
    for (const deck of wire.library) expect(deck.cards).toEqual(deck.cards.map((_, i) => hidden(i)));
    expect(wire.history).toEqual({ canUndo:false, canRedo:false });
    if (projected.players[0].studyCardIds) projected.players[0].studyCardIds!.push('viewer-mutation');
   }
  };
  check(game, true); expect(game).toEqual(authoritative);
  const discardedIds = [ids[1], ids[2]];
  game = history.apply(game, { type:'DISCARD_STUDY', playerId:'p1', cardIds:discardedIds }, 'p1');
  check(game, false);
  expect(game.players[0].studyCardIds).toEqual(ids); // Record all four, not just the two retained cards.
  expect(game.players[0].hand.slice(0, 2)).toEqual(oldHand);
  for (const id of discardedIds) expect(game.library.flatMap(deck => deck.discard).some(card => card.id === id)).toBe(true);
 });

 it.each([2, 3, 4])('reveals only occupancy and used flags, never types or metadata of %i uncast preparations', count => {
  const history = new ActionHistory(), game = createGame(); game.phase = 'PREPARATION';
  for (const p of game.players) p.connected = true;
  const cards = game.library.find(deck => deck.id === 'enchantment')!.cards.splice(0, 4);
  game.players[0].hand.push(...cards);
  const after = history.apply(game, { type:'PREPARE_CARDS', playerId:'p1',
   preparedCardIds:cards.slice(0, Math.min(count, 3)).map(card => card.id),
   ...(count === 4 ? { rapidCardId:cards[3].id } : {}) }, 'p1');
  for (const viewer of ['p1', 'p2', null]) {
   const projected = publicState(after, viewer, history), own = projected.players[0];
   expect(Object.values(own.prepared).filter(slot => slot && !slot.used)).toHaveLength(count);
   expect(own.hand).toHaveLength(4 - count);
   if (viewer === 'p1') expect(own.prepared).toEqual(after.players[0].prepared);
   else {
    for (const slot of Object.values(own.prepared)) if (slot) expect(slot).toEqual({ card:hidden(0), used:false });
    expect(JSON.stringify(own.prepared)).not.toMatch(/spellType|rulesText|schoolId|trigger|ongoing/);
    for (const card of cards) expect(JSON.stringify(projected)).not.toContain(`"${card.id}"`);
   }
  }
  after.players[0].prepared.slot1!.used = true;
  Object.assign(after.players[0].prepared.slot1!, { privateMetadata:cards[0] });
  const foreign = publicState(after, 'p2', history).players[0];
  expect(foreign.prepared.slot1).toEqual({ card:hidden(0), used:true });
  expect(Object.values(foreign.prepared).filter(slot => slot && !slot.used)).toHaveLength(count - 1);
 });

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