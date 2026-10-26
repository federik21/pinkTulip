import { describe, expect, it } from 'vitest';
import {
 applyAction, areAdjacent, canPlayerAct, createGame, getDiscardMoveCards,
 getReadyPreparedSlots, isInStartingRoom, mustLeaveCell, summonEvocation,
} from '../src';
import type { Activation, Card, GameAction, GameState, Hex, PreparedCards, Quest } from '../src';

type Slot = keyof PreparedCards;
const numbered = ['slot1', 'slot2', 'slot3'] as const;
const allSlots: Slot[] = [...numbered, 'rapid'];
const freshActivation = (playerId = 'p1'): Activation => ({
 playerId, actionsUsed: 0, exploring: 0, spellsCast: 0, sequencedSpellUsed: false,
 discardedExit: false, roomEffectUsed: false, physicalAction: null,
});
function fixture(): GameState {
 const s = createGame(2);
 s.phase = 'ACTION'; s.round = 1; s.firstPlayerId = 'p1'; s.currentPlayerId = 'p1';
 s.activation = freshActivation(); s.log = [];
 for (const p of s.players) { p.connected = true; p.wizard.position = { q: 0, r: 0 }; }
 return s;
}
function take(s: GameState, name = 'Visceral Fire'): Card {
 const deck = s.library.find(d => d.id === 'agony')!;
 const index = deck.cards.findIndex(c => c.name === name);
 expect(index, `available Agony copy: ${name}`).toBeGreaterThanOrEqual(0);
 return deck.cards.splice(index, 1)[0];
}
function prepare(s: GameState, slot: Slot, name = 'Visceral Fire', owner = 0): Card {
 const card = take(s, name); s.players[owner].prepared[slot] = { card, used: false }; return card;
}
function retire(s: GameState, slot: Slot): void {
 const prepared = s.players[0].prepared[slot]!;
 prepared.used = true; s.library[0].discard.push(prepared.card);
}
function cell(s: GameState): void {
 s.players[0].wizard.position = { ...s.board.rooms.find(r => r.startingFor === 'p1')!.tiles[0] };
}
function exit(s: GameState): Hex {
 const destination = s.board.tiles.find(h => areAdjacent(s.players[0].wizard.position, h)
  && !s.board.rooms.some(r => r.startingFor && r.tiles.some(t => t.q === h.q && t.r === h.r)));
 expect(destination).toBeDefined(); return { ...destination! };
}
const discard = (s: GameState, card: Card, destination = exit(s)) =>
 applyAction(s, { type: 'DISCARD_EXIT', playerId: 'p1', cardId: card.id, destination });
const dummy = (s: GameState, slot: Slot) => applyAction(s, {
 type: 'CAST_SPELL', playerId: 'p1', slot, dummy: true, roomId: 'room-0,0',
});
const end = (s: GameState, playerId = 'p1') => applyAction(s, { type: 'END_ACTIVATION', playerId });
function skipExplore(s: GameState, playerId = 'p1'): GameState {
 return applyAction(applyAction(s, { type: 'BEGIN_PHYSICAL_ACTION', playerId, kind: 'EXPLORE' }),
  { type: 'SKIP_PHYSICAL_EFFECTS', playerId });
}
function conserved(s: GameState): void {
 // Used preparations are references, not additional physical cards. Quest reward
 // actions are printed quest text, not members of the finite spell supply.
 const cards = [
  ...s.library.flatMap(d => [...d.cards, ...d.discard]), ...s.powerfulDeck, ...s.removedCards,
  ...s.players.flatMap(p => [...p.personalDeck, ...p.hand, ...p.discard,
   ...Object.values(p.prepared).flatMap(c => c && !c.used ? [c.card] : [])]),
  ...(s.readiedSpells ?? []).map(a => a.card), ...(s.ongoingSpells ?? []).map(a => a.card),
 ];
 expect(cards).toHaveLength(48); expect(new Set(cards.map(c => c.id)).size).toBe(48);
 expect(cards.filter(c => c.schoolId === 'agony')).toHaveLength(36);
 expect(cards.filter(c => c.powerful)).toHaveLength(12);
 for (const p of s.players) expect(Object.values(p.cubes).reduce((a, b) => a + b, 0)).toBe(25);
}
function rejected(s: GameState, action: GameAction): void {
 const before = structuredClone(s); expect(() => applyAction(s, action)).toThrow();
 expect(s).toEqual(before); conserved(s);
}
const startLine = (s: GameState, id = 'p1') => `${s.players.find(p => p.id === id)!.name} starts their turn: 2 actions total across physical actions, spell casts, and discard-to-move.`;
const endLine = (s: GameState, id = 'p1') => `${s.players.find(p => p.id === id)!.name} ends their turn.`;
const boundaries = (s: GameState) => s.log.filter(line => / starts their turn:| ends their turn\.$/.test(line));
function readyQuest(s: GameState): Quest {
 const index = s.questDeck.findIndex(q => q.kind === 'ROOM_ACTIVATE');
 const quest = s.questDeck.splice(index, 1)[0];
 Object.assign(quest, { completed: true, claimed: false, progress: quest.amount });
 s.players[0].quest = quest; return quest;
}
function arm(s: GameState, name: string, owner = 'p2') {
 const active = { id: `active-${name}`, playerId: owner, card: take(s, name) };
 s.readiedSpells!.push(active); s.activeSpellOrder!.push(active.id); return active;
}
function decline(s: GameState): GameState {
 const decision = s.pendingDecision;
 if (decision?.kind !== 'REACTIVE_SPELL') throw new Error('Expected a reactive decision');
 return applyAction(s, { type: 'RESPOND_REACTIVE_SPELL', playerId: decision.playerId, key: decision.key });
}

describe('cast readiness and independent unused-preparation discard helpers', () => {
 const masks = Array.from({ length: 8 }, (_, mask) => mask);
 it.each(masks)('honors numbered occupancy mask %i, including intentional gaps', mask => {
  const s = fixture(), p = s.players[0];
  numbered.forEach((slot, i) => { if (mask & (1 << i)) prepare(s, slot); });
  const quick = prepare(s, 'rapid', 'Submission');
  const next = numbered.find(slot => p.prepared[slot]);
  const expected: Slot[] = [...(next ? [next] : []), 'rapid'];
  const before = structuredClone(s);
  expect(getReadyPreparedSlots(p)).toEqual(expected);
  expect(getReadyPreparedSlots(p, null)).toEqual(expected);
  expect(getReadyPreparedSlots(p, s.activation)).toEqual(expected);
  const discardable = [...numbered.flatMap(slot => p.prepared[slot] ? [p.prepared[slot]!.card] : []), quick];
  expect(getDiscardMoveCards(p)).toEqual(discardable);
  expect(getDiscardMoveCards(p, null)).toEqual(discardable);
  expect(getDiscardMoveCards(p, s.activation)).toEqual(discardable);
  expect(s).toEqual(before); conserved(s);
 });
 it.each(masks)('skips used numbered cards for used mask %i without skipping the next unused one', mask => {
  const s = fixture(), p = s.players[0];
  numbered.forEach(slot => prepare(s, slot));
  numbered.forEach((slot, i) => { if (mask & (1 << i)) retire(s, slot); });
  const next = numbered.find(slot => !p.prepared[slot]!.used);
  expect(getReadyPreparedSlots(p)).toEqual(next ? [next] : []);
  expect(getDiscardMoveCards(p)).toEqual(numbered.filter(slot => !p.prepared[slot]!.used).map(slot => p.prepared[slot]!.card)); conserved(s);
 });
 it.each([false, true])('spent numbered quota restricts casting, not discarding (Quick used=%s)', quickUsed => {
  const s = fixture(), p = s.players[0]; prepare(s, 'slot2'); prepare(s, 'slot3'); prepare(s, 'rapid', 'Submission');
  if (quickUsed) retire(s, 'rapid');
  s.activation!.sequencedSpellUsed = true;
  const before = structuredClone(s);
  expect(getReadyPreparedSlots(p, s.activation)).toEqual(quickUsed ? [] : ['rapid']);
  const discardable = [p.prepared.slot2!.card, p.prepared.slot3!.card, ...(quickUsed ? [] : [p.prepared.rapid!.card])];
  expect(getDiscardMoveCards(p, s.activation)).toEqual(discardable);
  // Action-cap/once-per-turn gates are not card eligibility or cast readiness.
  expect(getDiscardMoveCards(p, { ...s.activation!, actionsUsed: 2, discardedExit: true })).toEqual(discardable);
  expect(getReadyPreparedSlots(p)).toEqual(quickUsed ? ['slot2'] : ['slot2', 'rapid']);
  expect(s).toEqual(before); conserved(s);
 });
 it.each(allSlots)('keeps a Ready Forgotten card in %s but never makes it discardable', slot => {
  const s = fixture(), p = s.players[0], card = s.powerfulDeck.shift()!;
  p.prepared[slot] = { card, used: false };
  expect(getReadyPreparedSlots(p)).toEqual([slot]); expect(getDiscardMoveCards(p)).toEqual([]); conserved(s);
 });
 it('keeps a Forgotten next numbered card cast-ready while offering later Agony cards for discard', () => {
  const s = fixture(), p = s.players[0]; p.prepared.slot1 = { card: s.powerfulDeck.shift()!, used: false };
  const later = prepare(s, 'slot3'), quick = prepare(s, 'rapid', 'Torment');
  expect(getReadyPreparedSlots(p)).toEqual(['slot1', 'rapid']); expect(getDiscardMoveCards(p)).toEqual([later, quick]); conserved(s);
 });
 it('filters a Forgotten Quick card without suppressing the next ordinary numbered card', () => {
  const s = fixture(), card = prepare(s, 'slot3'); s.players[0].prepared.rapid = { card: s.powerfulDeck.shift()!, used: false };
  expect(getReadyPreparedSlots(s.players[0])).toEqual(['slot3', 'rapid']);
  expect(getDiscardMoveCards(s.players[0])).toEqual([card]); conserved(s);
 });
 it.each(['Torment', 'Master of Pleasure', 'Liquefy the Pain', 'Pain Mark', 'Ineluctable Pain'])('offers uncommitted %s without checking printed cast/trigger targets', name => {
  const s = fixture(), card = prepare(s, 'slot3', name); cell(s);
  expect(getReadyPreparedSlots(s.players[0], s.activation)).toEqual(['slot3']);
  expect(getDiscardMoveCards(s.players[0], s.activation)).toEqual([card]); conserved(s);
 });
 it('ignores hand, personal deck, Memories, active and ongoing zones', () => {
  const s = fixture(), p = s.players[0]; p.hand.push(take(s)); p.personalDeck.push(take(s, 'Submission')); p.discard.push(take(s, 'Grim Torment'));
  arm(s, 'Torment', 'p1'); const card = take(s, 'Pain Mark');
  s.ongoingSpells!.push({ id: 'ongoing', playerId: 'p1', card, targetPlayerId: 'p2' }); s.activeSpellOrder!.push('ongoing');
  expect(getReadyPreparedSlots(p)).toEqual([]); expect(getDiscardMoveCards(p)).toEqual([]); conserved(s);
 });
});

describe('discard-to-move consumes any unused non-Forgotten preparation without casting', () => {
 it.each(allSlots)('discards %s for one turn action and no physical token', slot => {
  const s = fixture(), card = prepare(s, slot); const before = structuredClone(s), destination = exit(s);
  const after = discard(s, card, destination), p = after.players[0];
  expect(s).toEqual(before); expect(p.prepared[slot]).toEqual({ card, used: true });
  expect(p.wizard.position).toEqual(destination); expect(p.actionTokens).toBe(2); expect(p.hand).toEqual([]);
  expect(after.activation).toMatchObject({ playerId: 'p1', actionsUsed: 1, spellsCast: 0, sequencedSpellUsed: false, discardedExit: true });
  expect(after.library[0].discard).toEqual([card]); expect(p.discard).toEqual([]);
  expect(after.feedbackEvents).toEqual([]); expect(boundaries(after)).toEqual([]); conserved(after);
 });
 it('spends exactly one discard action after numbered quota is spent without casting or changing that quota', () => {
  const s = fixture(), first = prepare(s, 'slot1'), second = prepare(s, 'slot2', 'Grim Torment');
  const future = prepare(s, 'slot3', 'Torment'), quick = prepare(s, 'rapid', 'Submission');
  s.activation!.sequencedSpellUsed = true;
  const before = structuredClone(s), destination = exit(s), after = discard(s, future, destination);
  expect(s).toEqual(before); expect(after.currentPlayerId).toBe('p1');
  expect(after.activation).toEqual({ ...s.activation!, actionsUsed: 1, discardedExit: true });
  expect(after.players[0]).toEqual({ ...s.players[0], wizard: { ...s.players[0].wizard, position: destination },
   prepared: { ...s.players[0].prepared, slot3: { card: future, used: true } } });
  expect(getReadyPreparedSlots(after.players[0], after.activation)).toEqual(['rapid']);
  expect(getDiscardMoveCards(after.players[0], after.activation)).toEqual([first, second, quick]);
  expect(after.library[0].discard).toEqual([future]); expect(after.readiedSpells).toEqual([]); expect(after.ongoingSpells).toEqual([]);
  expect(after.evocations).toEqual([]); expect(after.feedbackEvents).toEqual([]); expect(boundaries(after)).toEqual([]);
  expect(after.log.some(line => /casts |Moment |activates a hidden/.test(line))).toBe(false);
  rejected(after, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', dummy: true, roomId: 'room-0,0' });
  conserved(after);
 });
 it.each(['Visceral Fire', 'Torment', 'Liquefy the Pain', 'Pain Mark', 'Ineluctable Pain'])('exits a protected cell with %s without casting, activation, bindings or printed moments', name => {
  const s = fixture(), card = prepare(s, 'slot2', name); cell(s); s.players[0].actionTokens = 0;
  rejected(s, { type: name === 'Torment' || name === 'Liquefy the Pain' ? 'ACTIVATE_SPELL' : 'CAST_SPELL', playerId: 'p1', slot: 'slot2' });
  const after = discard(s, card);
  expect(isInStartingRoom(after, after.players[0])).toBe(false); expect(after.players[0].actionTokens).toBe(0);
  expect(after.readiedSpells).toEqual([]); expect(after.ongoingSpells).toEqual([]); expect(after.evocations).toEqual([]);
  expect(after.players.map(p => p.wizard.damageCubes)).toEqual([0, 0]); expect(after.feedbackEvents).toEqual([]);
  expect(after.log.some(line => /casts |Moment |activates a hidden/.test(line))).toBe(false); conserved(after);
 });
 it('chooses slot3 while slots1 and2 are unused without bypassing their casting order', () => {
  const s = fixture(), first = prepare(s, 'slot1'), second = prepare(s, 'slot2', 'Grim Torment');
  const future = prepare(s, 'slot3', 'Pain Mark'), quick = prepare(s, 'rapid', 'Torment');
  s.players[0].actionTokens = 0; s.players[0].hand.push(take(s, 'Submission'));
  const before = structuredClone(s), destination = { q: 1, r: 0 };
  expect(getReadyPreparedSlots(s.players[0], s.activation)).toEqual(['slot1', 'rapid']);
  expect(getDiscardMoveCards(s.players[0], s.activation)).toEqual([first, second, future, quick]);
  const moved = discard(s, future, destination);
  expect(s).toEqual(before); expect(moved.currentPlayerId).toBe('p1');
  expect(moved.activation).toMatchObject({ actionsUsed: 1, spellsCast: 0, sequencedSpellUsed: false, discardedExit: true });
  expect(moved.players[0]).toMatchObject({ actionTokens: 0, hand: s.players[0].hand, wizard: { position: destination, damageCubes: 0 } });
  expect(moved.players[0].prepared).toEqual({ ...s.players[0].prepared, slot3: { card: future, used: true } });
  expect(moved.library[0].discard).toEqual([future]); expect(moved.players[0].discard).toEqual([]);
  expect(moved.readiedSpells).toEqual([]); expect(moved.ongoingSpells).toEqual([]); expect(moved.evocations).toEqual([]);
  expect(moved.feedbackEvents).toEqual([]); expect(boundaries(moved)).toEqual([]);
  expect(getReadyPreparedSlots(moved.players[0], moved.activation)).toEqual(['slot1', 'rapid']);
  expect(getDiscardMoveCards(moved.players[0], moved.activation)).toEqual([first, second, quick]);
  rejected(moved, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot2', dummy: true, roomId: 'room-0,0' });
  rejected(moved, { type: 'DISCARD_EXIT', playerId: 'p1', cardId: second.id, destination: exit(moved) });
  const cast = dummy(moved, 'slot1');
  expect(cast.currentPlayerId).toBe('p2'); expect(cast.players[0].prepared.slot1!.used).toBe(true);
  expect(cast.players[0].prepared.slot2!.used).toBe(false); expect(cast.players[0].prepared.rapid!.used).toBe(false);
  expect(cast.players[0].actionTokens).toBe(0); expect(cast.library[0].discard).toEqual([future, first]);
  conserved(moved); conserved(cast);
 });
 it('advances the next unused numbered slot without consuming its cast quota', () => {
  const s = fixture(), first = prepare(s, 'slot1'); prepare(s, 'slot3'); prepare(s, 'rapid', 'Torment');
  const moved = discard(s, first, { q: 1, r: 0 });
  expect(getReadyPreparedSlots(moved.players[0], moved.activation)).toEqual(['slot3', 'rapid']);
  expect(moved.activation!.sequencedSpellUsed).toBe(false);
  const cast = dummy(moved, 'slot3');
  expect(cast.currentPlayerId).toBe('p2'); expect(cast.players[0].prepared.slot3!.used).toBe(true);
  expect(cast.players[0].prepared.rapid!.used).toBe(false); expect(cast.players[0].actionTokens).toBe(2);
  expect(cast.library[0].discard.map(c => c.id)).toEqual([first.id, s.players[0].prepared.slot3!.card.id]); conserved(cast);
 });
 it('preserves numbered readiness after a Quick discard', () => {
  const s = fixture(); prepare(s, 'slot2'); const quick = prepare(s, 'rapid', 'Submission');
  const moved = discard(s, quick, { q: 1, r: 0 });
  expect(getReadyPreparedSlots(moved.players[0], moved.activation)).toEqual(['slot2']);
  expect(dummy(moved, 'slot2').currentPlayerId).toBe('p2'); conserved(moved);
 });
 it.each(['slot3', 'rapid'] as const)('permits %s discard after a numbered cast without permitting another numbered cast', slot => {
  const s = fixture(); prepare(s, 'slot1'); const next = prepare(s, 'slot3'); const quick = prepare(s, 'rapid', 'Submission');
  const cast = dummy(s, 'slot1');
  expect(getReadyPreparedSlots(cast.players[0], cast.activation)).toEqual(['rapid']);
  expect(getDiscardMoveCards(cast.players[0], cast.activation)).toEqual([next, quick]);
  rejected(cast, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot3', dummy: true, roomId: 'room-0,0' });
  const card = slot === 'slot3' ? next : quick, destination = exit(cast), after = discard(cast, card, destination);
  expect(after.currentPlayerId).toBe('p2'); expect(after.players[0].prepared[slot]!.used).toBe(true);
  expect(after.players[0].prepared[slot === 'slot3' ? 'rapid' : 'slot3']!.used).toBe(false);
  expect(after.players[0].wizard.position).toEqual(destination); expect(after.players[0].actionTokens).toBe(2);
  expect(after.library[0].discard).toEqual([s.players[0].prepared.slot1!.card, card]);
  expect(boundaries(after)).toEqual([endLine(s), startLine(s, 'p2')]); conserved(cast); conserved(after);
 });
 it('allows only one discard per turn, then refreshes eligibility on a real handoff back', () => {
  const s = fixture(), first = prepare(s, 'slot1'), next = prepare(s, 'slot3'); s.players[0].actionTokens = 0;
  const moved = discard(s, first), before = structuredClone(moved);
  rejected(moved, { type: 'DISCARD_EXIT', playerId: 'p1', cardId: next.id, destination: exit(moved) }); expect(moved).toEqual(before);
  const other = end(moved), back = end(skipExplore(other, 'p2'), 'p2');
  expect(back.activation).toMatchObject({ playerId: 'p1', actionsUsed: 0, discardedExit: false, sequencedSpellUsed: false });
  const again = discard(back, next); expect(again.players[0].prepared.slot3!.used).toBe(true); conserved(again);
 });
 it('activating slot1 spends casting quota but leaves later preparations discardable, never the Active card', () => {
  const s = fixture(), trap = prepare(s, 'slot1', 'Torment'), future = prepare(s, 'slot3'), quick = prepare(s, 'rapid', 'Submission');
  const active = applyAction(s, { type: 'ACTIVATE_SPELL', playerId: 'p1', slot: 'slot1' });
  expect(active.activation).toMatchObject({ actionsUsed: 1, sequencedSpellUsed: true });
  expect(getReadyPreparedSlots(active.players[0], active.activation)).toEqual(['rapid']);
  expect(getDiscardMoveCards(active.players[0], active.activation)).toEqual([future, quick]);
  rejected(active, { type: 'DISCARD_EXIT', playerId: 'p1', cardId: trap.id, destination: exit(active) });
  rejected(active, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot3', dummy: true, roomId: 'room-0,0' });
  const destination = exit(active), after = discard(active, future, destination);
  expect(after.readiedSpells).toEqual(active.readiedSpells); expect(after.readiedSpells![0].card.id).toBe(trap.id);
  expect(after.currentPlayerId).toBe('p2'); expect(after.players[0].prepared.slot3!.used).toBe(true);
  expect(after.players[0].prepared.rapid).toEqual({ card: quick, used: false }); expect(after.players[0].actionTokens).toBe(2);
  expect(after.players[0].wizard.position).toEqual(destination); expect(after.library[0].discard).toEqual([future]);
  expect(after.ongoingSpells).toEqual([]); expect(after.feedbackEvents).toEqual([]); conserved(after);
 });
 it('activating Quick leaves the next numbered card discardable', () => {
  const s = fixture(), next = prepare(s, 'slot2'); prepare(s, 'rapid', 'Torment');
  const active = applyAction(s, { type: 'ACTIVATE_SPELL', playerId: 'p1', slot: 'rapid' });
  expect(active.activation).toMatchObject({ actionsUsed: 1, sequencedSpellUsed: false });
  expect(getDiscardMoveCards(active.players[0], active.activation)).toEqual([next]);
  const after = discard(active, next); expect(after.currentPlayerId).toBe('p2'); expect(after.readiedSpells).toHaveLength(1); conserved(after);
 });
 it.each(['held', 'used', 'active', 'ongoing', 'foreign', 'unknown', 'forgotten-held', 'forgotten-prepared'] as const)('rejects %s cards atomically', kind => {
  const s = fixture(), p = s.players[0]; let card: Card;
  switch (kind) {
   case 'held': card = take(s); p.hand.push(card); break;
   case 'used': card = prepare(s, 'rapid'); retire(s, 'rapid'); break;
   case 'active': card = arm(s, 'Torment', 'p1').card; break;
   case 'ongoing': card = take(s, 'Pain Mark'); s.ongoingSpells!.push({ id: 'mark', playerId: 'p1', card, targetPlayerId: 'p2' }); s.activeSpellOrder!.push('mark'); break;
   case 'foreign': card = prepare(s, 'rapid', 'Visceral Fire', 1); break;
   case 'unknown': card = { ...s.library[0].cards[0], id: 'not-a-physical-card' }; break;
   case 'forgotten-held': card = s.powerfulDeck.shift()!; p.hand.push(card); break;
   case 'forgotten-prepared': card = s.powerfulDeck.shift()!; p.prepared.slot3 = { card, used: false }; break;
  }
  rejected(s, { type: 'DISCARD_EXIT', playerId: 'p1', cardId: card.id, destination: exit(s) });
 });
 it.each(['exploring', 'physical', 'evocation', 'decision', 'cap', 'wrong-turn', 'wrong-phase', 'no-activation', 'already-discarded'] as const)('rejects discard during %s without costs, movement or logs', condition => {
  const s = fixture(), card = prepare(s, 'rapid');
  if (condition === 'exploring') s.activation!.exploring = 1;
  if (condition === 'physical') s.activation!.physicalAction = { kind: 'ATTACK', mainEffectUsed: false, movementStarted: false };
  if (condition === 'evocation') { const e = summonEvocation(s, s.players[0], 'CADAVER', { q: 0, r: 0 })!; s.evocationActivation = { playerId: 'p1', evocationId: e.id, movesRemaining: 2, returnToAction: true }; }
  if (condition === 'decision') s.pendingDecision = { kind: 'WAITING', playerId: 'p2', key: 'waiting' };
  if (condition === 'cap') s.activation!.actionsUsed = 2;
  if (condition === 'wrong-turn') { s.currentPlayerId = 'p2'; s.activation!.playerId = 'p2'; }
  if (condition === 'wrong-phase') s.phase = 'EVOCATION';
  if (condition === 'no-activation') s.activation = null;
  if (condition === 'already-discarded') s.activation!.discardedExit = true;
  rejected(s, { type: 'DISCARD_EXIT', playerId: 'p1', cardId: card.id, destination: exit(s) });
 });
 it.each(['same-space', 'two-steps', 'outside', 'own-cell', 'other-cell'] as const)('rejects invalid %s destinations before committing the card', kind => {
  const s = fixture(), card = prepare(s, 'slot3'); let destination: Hex;
  if (kind === 'same-space') destination = { q: 0, r: 0 };
  else if (kind === 'two-steps') destination = { q: 2, r: 0 };
  else if (kind === 'outside') { s.players[0].wizard.position = { q: 3, r: 0 }; destination = { q: 4, r: 0 }; }
  else { destination = { ...s.board.rooms.find(r => r.startingFor === (kind === 'own-cell' ? 'p1' : 'p2'))!.tiles[0] }; s.players[0].wizard.position = { ...s.board.tiles.find(t => areAdjacent(t, destination) && !s.board.rooms.some(r => r.startingFor && r.tiles.some(h => h.q === t.q && h.r === t.r)))! }; }
  rejected(s, { type: 'DISCARD_EXIT', playerId: 'p1', cardId: card.id, destination });
 });
});

describe('turn readiness and mandatory cell exits use the same discard eligibility', () => {
 it.each(['held', 'held-forgotten', 'used', 'forgotten-only', 'active-only'] as const)('does not trap a tokenless mage with only %s', kind => {
  const s = fixture(), p = s.players[0]; cell(s); p.actionTokens = 0; s.activation!.actionsUsed = 1;
  if (kind === 'held') p.hand.push(take(s));
  if (kind === 'held-forgotten') p.hand.push(s.powerfulDeck.shift()!);
  if (kind === 'used') { prepare(s, 'slot2'); retire(s, 'slot2'); }
  if (kind === 'forgotten-only') p.prepared.slot1 = { card: s.powerfulDeck.shift()!, used: false };
  if (kind === 'active-only') arm(s, 'Torment', 'p1');
  expect(getDiscardMoveCards(p, s.activation)).toEqual([]); expect(mustLeaveCell(s, p)).toBe(false); expect(canPlayerAct(s, p)).toBe(false);
  const after = end(s); expect(after.currentPlayerId).toBe('p2'); expect(boundaries(after)).toEqual([endLine(s), startLine(s, 'p2')]); conserved(after);
 });
 it.each(['slot2', 'slot3', 'rapid'] as const)('requires a last-action cell exit with Ready %s and no physical tokens', slot => {
  const s = fixture(), card = prepare(s, slot, 'Pain Mark'), p = s.players[0]; cell(s); p.actionTokens = 0; s.activation!.actionsUsed = 1;
  expect(canPlayerAct(s, p)).toBe(true); expect(mustLeaveCell(s, p)).toBe(true);
  rejected(s, { type: 'END_ACTIVATION', playerId: 'p1' }); rejected(s, { type: 'PASS_ROUND', playerId: 'p1' });
  const after = discard(s, card); expect(after.currentPlayerId).toBe('p2'); expect(isInStartingRoom(after, after.players[0])).toBe(false); conserved(after);
 });
 it.each(['future', 'spent-quota', 'forgotten-before-future'] as const)('requires a tokenless last-action cell exit with %s preparation', kind => {
  const s = fixture(), p = s.players[0];
  if (kind === 'future') { prepare(s, 'slot1'); prepare(s, 'slot2', 'Grim Torment'); }
  if (kind === 'forgotten-before-future') p.prepared.slot1 = { card: s.powerfulDeck.shift()!, used: false };
  const later = prepare(s, 'slot3', 'Pain Mark'); cell(s); p.actionTokens = 0; s.activation!.actionsUsed = 1;
  s.activation!.sequencedSpellUsed = kind === 'spent-quota';
  expect(getReadyPreparedSlots(p, s.activation)).toEqual(kind === 'spent-quota' ? [] : ['slot1']);
  expect(getDiscardMoveCards(p, s.activation)).toContainEqual(later);
  expect(mustLeaveCell(s, p)).toBe(true); expect(canPlayerAct(s, p)).toBe(true);
  rejected(s, { type: 'END_ACTIVATION', playerId: 'p1' }); rejected(s, { type: 'PASS_ROUND', playerId: 'p1' });
  const after = discard(s, later); expect(after.currentPlayerId).toBe('p2');
  expect(isInStartingRoom(after, after.players[0])).toBe(false); expect(after.players[0].actionTokens).toBe(0);
  expect(after.players[0].prepared.slot3!.used).toBe(true); expect(after.library[0].discard).toEqual([later]); conserved(after);
 });
 it('keeps both later numbered and Quick exit choices after the numbered quota is spent', () => {
  const s = fixture(), later = prepare(s, 'slot3'), quick = prepare(s, 'rapid', 'Torment'); cell(s); s.players[0].actionTokens = 0;
  Object.assign(s.activation!, { actionsUsed: 1, sequencedSpellUsed: true });
  expect(getReadyPreparedSlots(s.players[0], s.activation)).toEqual(['rapid']);
  expect(getDiscardMoveCards(s.players[0], s.activation)).toEqual([later, quick]); expect(mustLeaveCell(s, s.players[0])).toBe(true);
  expect(discard(s, quick).currentPlayerId).toBe('p2'); conserved(s);
 });
 it.each(['cast', 'activate'] as const)('does not auto-handoff after slot1 %s when only a future, quota-blocked discard remains', kind => {
  const s = fixture(), first = prepare(s, 'slot1', kind === 'cast' ? 'Visceral Fire' : 'Torment');
  const later = prepare(s, 'slot3', 'Pain Mark'); s.players[0].actionTokens = 0;
  const spent = kind === 'cast' ? dummy(s, 'slot1') : applyAction(s, { type: 'ACTIVATE_SPELL', playerId: 'p1', slot: 'slot1' });
  expect(spent.currentPlayerId).toBe('p1'); expect(spent.phase).toBe('ACTION');
  // The legacy spellsCast counter includes activations; discard must not add to it.
  expect(spent.activation).toMatchObject({ playerId: 'p1', actionsUsed: 1, sequencedSpellUsed: true, spellsCast: 1, discardedExit: false });
  expect(getReadyPreparedSlots(spent.players[0], spent.activation)).toEqual([]);
  expect(getDiscardMoveCards(spent.players[0], spent.activation)).toEqual([later]);
  expect(canPlayerAct(spent, spent.players[0])).toBe(true); expect(boundaries(spent)).toEqual([]);
  const destination = exit(spent), after = discard(spent, later, destination);
  expect(after.currentPlayerId).toBe('p2'); expect(after.players[0].actionTokens).toBe(0);
  expect(after.players[0].wizard.position).toEqual(destination); expect(after.players[0].prepared.slot3!.used).toBe(true);
  expect(after.library[0].discard).toEqual(kind === 'cast' ? [first, later] : [later]);
  expect(after.readiedSpells).toEqual(spent.readiedSpells); expect(after.ongoingSpells).toEqual([]); expect(after.feedbackEvents).toEqual(spent.feedbackEvents);
  expect(boundaries(after)).toEqual([endLine(s), startLine(s, 'p2')]); conserved(spent); conserved(after);
 });
 it('still permits a mandatory discard exit when the mage has zero printed movement', () => {
  const s = fixture(), card = prepare(s, 'slot3'); cell(s); s.players[0].wizard.movement = 0; s.players[0].actionTokens = 0; s.activation!.actionsUsed = 1;
  expect(mustLeaveCell(s, s.players[0])).toBe(true); expect(canPlayerAct(s, s.players[0])).toBe(true);
  const after = discard(s, card); expect(after.currentPlayerId).toBe('p2'); expect(isInStartingRoom(after, after.players[0])).toBe(false); conserved(after);
 });
 it('does not impose an impossible second discard exit in the same turn', () => {
  const s = fixture(); prepare(s, 'slot3'); cell(s); s.players[0].actionTokens = 0;
  Object.assign(s.activation!, { actionsUsed: 1, discardedExit: true });
  expect(mustLeaveCell(s, s.players[0])).toBe(false); expect(canPlayerAct(s, s.players[0])).toBe(false);
  expect(end(s).currentPlayerId).toBe('p2'); conserved(s);
 });
 it.each([false, true])('held-only cards outside a cell never create a paid action (Forgotten=%s)', powerful => {
  const s = fixture(); s.players[0].actionTokens = 0; s.players[0].hand.push(powerful ? s.powerfulDeck.shift()! : take(s));
  expect(canPlayerAct(s, s.players[0])).toBe(false); expect(getDiscardMoveCards(s.players[0], s.activation)).toEqual([]); conserved(s);
 });
 it('does not require an impossible exit when every adjacent board tile is absent', () => {
  const s = fixture(); cell(s); prepare(s, 'rapid'); s.players[0].actionTokens = 0; s.activation!.actionsUsed = 1;
  s.board.tiles = s.board.tiles.filter(h => !areAdjacent(s.players[0].wizard.position, h));
  expect(mustLeaveCell(s, s.players[0])).toBe(false); expect(end(s).currentPlayerId).toBe('p2'); conserved(s);
 });
 it('does not require leaving before the final action, outside the cell, or without an active mage turn', () => {
  const s = fixture(); prepare(s, 'rapid'); cell(s);
  expect(mustLeaveCell(s, s.players[0])).toBe(false); s.activation!.actionsUsed = 1;
  expect(mustLeaveCell(s, s.players[0])).toBe(true); s.players[0].wizard.position = { q: 0, r: 0 };
  expect(mustLeaveCell(s, s.players[0])).toBe(false); cell(s); s.phase = 'EVOCATION';
  expect(mustLeaveCell(s, s.players[0])).toBe(false); conserved(s);
 });
 it('does not schedule a held-only mage when the preceding mage ends', () => {
  const s = fixture(); s.currentPlayerId = 'p2'; s.activation = { ...freshActivation('p2'), actionsUsed: 1 };
  cell(s); s.players[0].actionTokens = 0; s.players[0].hand.push(take(s));
  const after = end(s, 'p2'); expect(after.currentPlayerId).toBe('p2');
  expect(boundaries(after)).toEqual([endLine(s, 'p2'), startLine(s, 'p2')]); conserved(after);
 });
 it('schedules a tokenless mage outside cells when discarding is their only legal action', () => {
  const s = fixture(); s.currentPlayerId = 'p2'; s.activation = { ...freshActivation('p2'), actionsUsed: 1 };
  const card = prepare(s, 'slot3'); s.players[0].actionTokens = 0;
  // No room exists at any cast target, but board movement still has legal tiles.
  // Discard is not casting and must not depend on the existence of a cast target.
  s.board.rooms = s.board.rooms.filter(r => r.startingFor);
  expect(canPlayerAct(s, s.players[0])).toBe(true);
  const after = end(s, 'p2'); expect(after.currentPlayerId).toBe('p1');
  const moved = discard(after, card); expect(moved.players[0].prepared.slot3!.used).toBe(true); conserved(moved);
 });
 it('keeps pending physical resolution actionable at the cap but not a third paid action', () => {
  const s = fixture(); prepare(s, 'rapid'); s.activation!.actionsUsed = 2;
  expect(canPlayerAct(s, s.players[0])).toBe(false); s.activation!.exploring = 1;
  expect(canPlayerAct(s, s.players[0])).toBe(true); s.activation!.exploring = 0;
  s.activation!.physicalAction = { kind: 'ATTACK', mainEffectUsed: false, movementStarted: false };
  expect(canPlayerAct(s, s.players[0])).toBe(true); conserved(s);
 });
});

describe('Chronicle brackets actual Action mage turns exactly once', () => {
 it('logs the first start only after the final Preparation submission', () => {
  let s = fixture(); s.phase = 'PREPARATION'; s.activation = null; s.currentPlayerId = null;
  for (const p of s.players) { p.preparationDone = false; p.hand.push(take(s), take(s, 'Torment')); }
  s = applyAction(s, { type: 'PREPARE_CARDS', playerId: 'p1', preparedCardIds: [null, s.players[0].hand[0].id], rapidCardId: s.players[0].hand[1].id });
  expect(boundaries(s)).toEqual([]);
  s = applyAction(s, { type: 'PREPARE_CARDS', playerId: 'p2', preparedCardIds: [null, null, s.players[1].hand[0].id], rapidCardId: s.players[1].hand[1].id });
  expect(s.phase).toBe('ACTION'); expect(s.activation!.actionsUsed).toBe(0);
  expect(boundaries(s)).toEqual([startLine(s)]); expect(s.log[s.log.length - 1]).toBe(startLine(s));
  expect(s.log.join(' ')).not.toContain('takes a turn:'); conserved(s);
 });
 it('logs manual end before the next start, without changing the previous state', () => {
  const s = skipExplore(fixture()), before = structuredClone(s), after = end(s);
  expect(s).toEqual(before); expect(after.log.slice(-2)).toEqual([endLine(s), startLine(s, 'p2')]); conserved(after);
 });
 it('logs automatic two-action handoff only when the second physical action is finished', () => {
  let s = skipExplore(fixture());
  s = applyAction(s, { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'ATTACK' });
  expect(s.activation!.actionsUsed).toBe(2); expect(boundaries(s)).toEqual([]);
  s = applyAction(s, { type: 'INFLICT_ATTACK', playerId: 'p1', targetId: 'p2' });
  expect(boundaries(s)).toEqual([]); expect(s.currentPlayerId).toBe('p1');
  s = applyAction(s, { type: 'SKIP_PHYSICAL_EFFECTS', playerId: 'p1' });
  expect(s.log.slice(-2)).toEqual([endLine(s), startLine(s, 'p2')]); conserved(s);
 });
 it('does not log end while the final Explore still has movement or room effects', () => {
  let s = skipExplore(fixture()); s = applyAction(s, { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
  s = applyAction(s, { type: 'PERFORM_MOVEMENT', playerId: 'p1' });
  s = applyAction(s, { type: 'EXPLORE_STEP', playerId: 'p1', destination: { q: 1, r: 0 } });
  expect(boundaries(s)).toEqual([]); s = applyAction(s, { type: 'END_EXPLORE', playerId: 'p1' });
  expect(boundaries(s)).toEqual([]); s = applyAction(s, { type: 'SKIP_PHYSICAL_EFFECTS', playerId: 'p1' });
  expect(boundaries(s)).toEqual([endLine(s), startLine(s, 'p2')]); conserved(s);
 });
 it.each(['EVOCATION', 'CLEANUP'] as const)('logs the final mage end before %s without inventing another mage turn', phase => {
  const s = fixture(); s.activation!.actionsUsed = 1; for (const p of s.players) p.actionTokens = 0;
  if (phase === 'EVOCATION') summonEvocation(s, s.players[1], 'CADAVER', { q: 0, r: 0 });
  const after = end(s); expect(after.phase).toBe(phase); expect(boundaries(after)).toEqual([endLine(s)]);
  expect(after.log.indexOf(endLine(s))).toBeLessThan(after.log.findIndex(line => line.startsWith('EVOCATION —')));
  if (phase === 'CLEANUP') expect(after.log.indexOf(endLine(s))).toBeLessThan(after.log.findIndex(line => line.startsWith('CLEANUP —')));
  conserved(after);
 });
 it('logs an exhausted PASS end before the next mage start', () => {
  const s = fixture(); s.players[0].actionTokens = 0;
  const after = applyAction(s, { type: 'PASS_ROUND', playerId: 'p1' });
  expect(after.players[0].passed).toBe(true); expect(boundaries(after)).toEqual([endLine(s), startLine(s, 'p2')]); conserved(after);
 });
 it('logs end then start even when all other mages are exhausted and the same owner restarts', () => {
  const s = fixture(); s.activation!.actionsUsed = 1; s.players[1].actionTokens = 0;
  const after = end(s); expect(after.currentPlayerId).toBe('p1'); expect(after.activation!.actionsUsed).toBe(0);
  expect(after.log.slice(-2)).toEqual([endLine(s), startLine(s)]); conserved(after);
 });
 it.each(['solve', 'defer'] as const)('keeps the last-action free reward window open until %s', mode => {
  let s = fixture(); const quest = readyQuest(s); prepare(s, 'rapid'); s.activation!.actionsUsed = 1;
  s = dummy(s, 'rapid'); expect(s.currentPlayerId).toBe('p1'); expect(s.activation!.actionsUsed).toBe(2); expect(boundaries(s)).toEqual([]);
  const after = mode === 'solve' ? applyAction(s, { type: 'USE_QUEST_REWARD', playerId: 'p1', questId: quest.id }) : end(s);
  expect(after.currentPlayerId).toBe('p2'); expect(after.log.slice(-2)).toEqual([endLine(s), startLine(s, 'p2')]);
  expect(after.players[0].quest?.id).toBe(mode === 'solve' ? undefined : quest.id); conserved(after);
 });
 it('defers the end when the last physical room effect newly completes a quest', () => {
  let s = fixture(); const quest = readyQuest(s); Object.assign(quest, { completed: false, progress: quest.amount - 1 });
  s = skipExplore(s); s = applyAction(s, { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'ATTACK' });
  s = applyAction(s, { type: 'INFLICT_ATTACK', playerId: 'p1', targetId: 'p2' });
  expect(boundaries(s)).toEqual([]); s = applyAction(s, { type: 'ACTIVATE_ROOM', playerId: 'p1' });
  expect(s.activation).toMatchObject({ playerId: 'p1', actionsUsed: 2, physicalAction: null });
  expect(s.players[0].quest).toMatchObject({ id: quest.id, completed: true, claimed: false }); expect(boundaries(s)).toEqual([]);
  const after = applyAction(s, { type: 'USE_QUEST_REWARD', playerId: 'p1', questId: quest.id });
  expect(after.log.slice(-2)).toEqual([endLine(s), startLine(s, 'p2')]); conserved(after);
 });
 it('does not log end before a last-action free quest reward reaction has resolved', () => {
  const s = fixture(), quest = readyQuest(s); s.activation!.actionsUsed = 2; arm(s, 'Master of Pleasure');
  const paused = applyAction(s, { type: 'USE_QUEST_REWARD', playerId: 'p1', questId: quest.id });
  expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL'); expect(boundaries(paused)).toEqual([]);
  expect(paused.players[0].quest).toMatchObject({ id: quest.id, claimed: false });
  const after = decline(paused); expect(after.log.slice(-2)).toEqual([endLine(s), startLine(s, 'p2')]); conserved(after);
 });
 it('finishes the last reward before logging an end and same-owner restart', () => {
  let s = fixture(); const quest = readyQuest(s); prepare(s, 'rapid'); s.activation!.actionsUsed = 1; s.players[1].actionTokens = 0;
  s = dummy(s, 'rapid'); expect(boundaries(s)).toEqual([]);
  const after = applyAction(s, { type: 'USE_QUEST_REWARD', playerId: 'p1', questId: quest.id });
  expect(after.currentPlayerId).toBe('p1'); expect(after.activation!.actionsUsed).toBe(0);
  expect(after.log.slice(-2)).toEqual([endLine(s), startLine(s)]); conserved(after);
 });
 it('does not log end during a last-action reaction prompt or rejected response', () => {
  const s = fixture(); prepare(s, 'rapid'); arm(s, 'Torment'); s.activation!.actionsUsed = 1;
  const paused = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p2' });
  expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL'); expect(boundaries(paused)).toEqual([]);
  rejected(paused, { type: 'RESPOND_REACTIVE_SPELL', playerId: 'p2', key: 'stale' });
  const after = decline(paused); expect(after.currentPlayerId).toBe('p2');
  expect(after.log.slice(-2)).toEqual([endLine(s), startLine(s, 'p2')]); conserved(after);
 });
 it('does not log end while a last-action Soul Tithe prompt is outstanding', () => {
  const s = fixture(); prepare(s, 'rapid', 'Submission'); summonEvocation(s, s.players[0], 'SUCCUBUS', { q: 0, r: 0 }); s.activation!.actionsUsed = 1;
  const paused = dummy(s, 'rapid'); expect(paused.pendingDecision?.kind).toBe('SOUL_TITHE'); expect(boundaries(paused)).toEqual([]);
  const after = applyAction(paused, { type: 'RESPOND_SOUL_TITHE', playerId: 'p1', accept: false });
  expect(after.log.slice(-2)).toEqual([endLine(s), startLine(s, 'p2')]); conserved(after);
 });
 it('defers the mage end until the final paid evocation activation is finished', () => {
  const s = fixture(), e = summonEvocation(s, s.players[0], 'CADAVER', { q: 0, r: 0 })!; s.activation!.actionsUsed = 1;
  let active = applyAction(s, { type: 'ACTIVATE_EVOCATION', playerId: 'p1', evocationId: e.id });
  expect(boundaries(active)).toEqual([]); active = applyAction(active, { type: 'END_EVOCATION_MOVEMENT', playerId: 'p1' });
  expect(boundaries(active)).toEqual([]); const after = applyAction(active, { type: 'END_EVOCATION', playerId: 'p1' });
  expect(after.log.slice(-2)).toEqual([endLine(s), startLine(s, 'p2')]); conserved(after);
 });
 it.each([0, 1])('does not mistake out-of-turn Liquefy control for a mage turn (%i prior actions)', actionsUsed => {
  const s = fixture(); s.activation!.actionsUsed = actionsUsed; s.players[1].wizard.health = 1; arm(s, 'Liquefy the Pain'); prepare(s, 'rapid');
  const paused = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p2' });
  expect(boundaries(paused)).toEqual([]);
  const active = applyAction(paused, { type: 'RESPOND_REACTIVE_SPELL', playerId: 'p2', key: paused.pendingDecision!.key, activeSpellId: 'active-Liquefy the Pain' });
  expect(active.currentPlayerId).toBe('p2'); expect(active.activation!.playerId).toBe('p1'); expect(boundaries(active)).toEqual([]);
  const after = applyAction(active, { type: 'END_EVOCATION', playerId: 'p2' });
  expect(boundaries(after)).toEqual(actionsUsed === 1 ? [endLine(s), startLine(s, 'p2')] : []);
  expect(after.currentPlayerId).toBe(actionsUsed === 1 ? 'p2' : 'p1'); conserved(after);
 });
 it('adds no mage turn boundaries during the free Evocation phase, including Cleanup', () => {
  let s = fixture(); s.phase = 'EVOCATION'; s.activation = null;
  const e = summonEvocation(s, s.players[0], 'CADAVER', { q: 0, r: 0 })!;
  s = applyAction(s, { type: 'ACTIVATE_EVOCATION', playerId: 'p1', evocationId: e.id });
  s = applyAction(s, { type: 'EVOCATION_STEP', playerId: 'p1', destination: { q: 1, r: 0 } });
  s = applyAction(s, { type: 'END_EVOCATION', playerId: 'p1' });
  expect(s.phase).toBe('CLEANUP'); expect(boundaries(s)).toEqual([]); conserved(s);
 });
});