import { describe, expect, it } from 'vitest';
import { areAdjacent, createGame, getDiscardMoveCards, getReadyPreparedSlots, summonEvocation } from '../../../packages/game-engine/src';
import type { Card, GameAction, GameState, Hex, PreparedCards } from '../../../packages/game-engine/src';
import { ActionHistory } from '../src/action-history';
import { publicState } from '../src/public-state';

type Slot = keyof PreparedCards;
function fixture(): GameState {
 const s = createGame(2); s.phase = 'ACTION'; s.round = 1; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1'; s.log = [];
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, spellsCast: 0, sequencedSpellUsed: false, discardedExit: false, roomEffectUsed: false, physicalAction: null };
 for (const p of s.players) { p.connected = true; p.wizard.position = { q: 0, r: 0 }; }
 return s;
}
function take(s: GameState, name = 'Visceral Fire'): Card {
 const index = s.library[0].cards.findIndex(c => c.name === name);
 expect(index, `available Agony copy: ${name}`).toBeGreaterThanOrEqual(0);
 return s.library[0].cards.splice(index, 1)[0];
}
function prepare(s: GameState, slot: Slot, name = 'Visceral Fire'): Card {
 const card = take(s, name); s.players[0].prepared[slot] = { card, used: false }; return card;
}
function exit(s: GameState): Hex {
 return { ...s.board.tiles.find(h => areAdjacent(s.players[0].wizard.position, h)
  && !s.board.rooms.some(r => r.startingFor && r.tiles.some(t => t.q === h.q && t.r === h.r)))! };
}
const discard = (s: GameState, card: Card): Extract<GameAction, { type: 'DISCARD_EXIT' }> => ({ type: 'DISCARD_EXIT', playerId: 'p1', cardId: card.id, destination: exit(s) });
const undo = (history: ActionHistory, s: GameState, playerId = 'p1') => history.apply(s, { type: 'UNDO_ACTION', playerId }, playerId);
const redo = (history: ActionHistory, s: GameState, playerId = 'p1') => history.apply(s, { type: 'REDO_ACTION', playerId }, playerId);
const startLine = (s: GameState, id = 'p1') => `${s.players.find(p => p.id === id)!.name} starts their turn: 2 actions total across physical actions, spell casts, and discard-to-move.`;
const endLine = (s: GameState, id = 'p1') => `${s.players.find(p => p.id === id)!.name} ends their turn.`;
const boundaries = (s: GameState) => s.log.filter(line => / starts their turn:| ends their turn\.$/.test(line));
function conserved(s: GameState): void {
 const cards = [...s.library.flatMap(d => [...d.cards, ...d.discard]), ...s.powerfulDeck, ...s.removedCards,
  ...s.players.flatMap(p => [...p.hand, ...p.personalDeck, ...p.discard, ...Object.values(p.prepared).flatMap(c => c && !c.used ? [c.card] : [])]),
  ...(s.readiedSpells ?? []).map(a => a.card), ...(s.ongoingSpells ?? []).map(a => a.card)];
 expect(cards).toHaveLength(48); expect(new Set(cards.map(c => c.id)).size).toBe(48);
 expect(cards.filter(c => c.schoolId === 'agony')).toHaveLength(36); expect(cards.filter(c => c.powerful)).toHaveLength(12);
 for (const p of s.players) expect(Object.values(p.cubes).reduce((n, value) => n + value, 0)).toBe(25);
}
function projection(s: GameState, viewer: string | null, history: ActionHistory): GameState {
 const copy = publicState(s, viewer, history); delete copy.history; return copy;
}
function views(s: GameState, history: ActionHistory) {
 return ['p1', 'p2', null].map(viewer => projection(s, viewer, history));
}
function assertPrivateHistory(s: GameState, history: ActionHistory): void {
 const before = structuredClone(s);
 for (const viewer of ['p1', 'p2', null]) {
  const wire = publicState(s, viewer, history);
  expect(wire.log).toEqual(s.log); expect(wire.activation).toEqual(s.activation);
  expect(Object.keys(wire.history!).sort()).toEqual(Object.keys(history.status(s, viewer)).sort());
  expect(wire.history).toEqual(history.status(s, viewer));
  expect(JSON.stringify(wire.history)).not.toMatch(/before|after|snapshot|gameId|players/);
  expect(wire.eventDeck).toEqual([]); expect(wire.questDeck).toEqual([]);
  expect(wire.library.flatMap(d => d.cards).every(c => c.name === 'Hidden spell')).toBe(true);
  expect(wire.powerfulDeck.every(c => c.name === 'Hidden spell')).toBe(true);
  for (const p of wire.players.filter(p => p.id !== viewer)) {
   expect(p.hand.every(c => c.name === 'Hidden spell')).toBe(true);
   for (const prepared of Object.values(p.prepared)) if (prepared) expect(prepared.card.name).toBe('Hidden spell');
  }
  for (const active of wire.readiedSpells ?? []) {
   const original = s.readiedSpells!.find(a => a.id === active.id)!;
   if (active.playerId === viewer) expect(active).toEqual(original);
   else {
    expect(Object.keys(active).sort()).toEqual(['card', 'id', 'playerId']);
    expect(active.card.name).toBe('Hidden spell'); expect(active.card.id).not.toBe(original.card.id);
    expect(active.card.moments).toEqual([]); expect(active.card.trigger).toBeUndefined();
   }
  }
  expect(wire.ongoingSpells).toEqual(s.ongoingSpells);
  if (viewer !== 'p1') expect(wire.history).toEqual({ canUndo: false, canRedo: false });
 }
 expect(s).toEqual(before); conserved(s);
}

describe('unused-preparation discard authoritative history and wire projection', () => {
 it.each(['slot1', 'slot2', 'slot3', 'rapid'] as const)('restores every counter, zone, location and public view for %s discard', slot => {
  const s = fixture(), card = prepare(s, slot), history = new ActionHistory();
  s.players[0].hand.push(take(s, 'Submission')); // Private hand survives all snapshots unchanged.
  const before = structuredClone(s), beforeViews = views(s, history);
  const after = history.apply(s, discard(s, card), 'p1'), afterViews = views(after, history);
  expect(s).toEqual(before); expect(after.activation).toMatchObject({ actionsUsed: 1, spellsCast: 0, sequencedSpellUsed: false, discardedExit: true });
  expect(after.players[0].actionTokens).toBe(2); expect(after.library[0].discard).toEqual([card]);
  expect(after.players[0].prepared[slot]!.used).toBe(true); expect(boundaries(after)).toEqual([]);
  expect(history.status(after, 'p1')).toMatchObject({ canUndo: true, canRedo: false }); assertPrivateHistory(after, history);
  const restored = undo(history, after); expect(restored).toEqual(before); expect(views(restored, history)).toEqual(beforeViews);
  expect(getReadyPreparedSlots(restored.players[0], restored.activation)).toContain(slot);
  expect(getDiscardMoveCards(restored.players[0], restored.activation)).toEqual([card]);
  expect(history.status(restored, 'p1')).toMatchObject({ canUndo: false, canRedo: true }); assertPrivateHistory(restored, history);
  const replayed = redo(history, restored); expect(replayed).toEqual(after); expect(views(replayed, history)).toEqual(afterViews);
  assertPrivateHistory(replayed, history);
 });
 it('undoes and redoes slot3 discard while slots1 and2 stay unused, private and cast-ordered', () => {
  const s = fixture(), first = prepare(s, 'slot1'), second = prepare(s, 'slot2', 'Grim Torment');
  const later = prepare(s, 'slot3', 'Pain Mark'), quick = prepare(s, 'rapid', 'Torment'), history = new ActionHistory();
  s.players[0].actionTokens = 0; s.players[0].hand.push(take(s, 'Submission'));
  s.players[1].hand.push(take(s, 'Master of Pleasure'));
  const before = structuredClone(s), beforeViews = views(s, history), action = discard(s, later);
  expect(getReadyPreparedSlots(s.players[0], s.activation)).toEqual(['slot1', 'rapid']);
  expect(getDiscardMoveCards(s.players[0], s.activation)).toEqual([first, second, later, quick]);
  const after = history.apply(s, action, 'p1'), afterViews = views(after, history);
  expect(s).toEqual(before); expect(after.currentPlayerId).toBe('p1'); expect(boundaries(after)).toEqual([]);
  expect(after.activation).toMatchObject({ actionsUsed: 1, spellsCast: 0, sequencedSpellUsed: false, discardedExit: true });
  expect(after.players[0].wizard.position).toEqual(action.destination); expect(after.players[0].actionTokens).toBe(0);
  expect(after.players[0].hand).toEqual(s.players[0].hand);
  expect(after.players[0].prepared).toEqual({ ...s.players[0].prepared, slot3: { card: later, used: true } });
  expect(after.library[0].discard).toEqual([later]); expect(after.players[0].discard).toEqual([]);
  expect(after.readiedSpells).toEqual([]); expect(after.ongoingSpells).toEqual([]); expect(after.evocations).toEqual([]);
  expect(after.feedbackEvents).toEqual([]);
  expect(getReadyPreparedSlots(after.players[0], after.activation)).toEqual(['slot1', 'rapid']);
  expect(getDiscardMoveCards(after.players[0], after.activation)).toEqual([first, second, quick]);
  assertPrivateHistory(after, history);
  for (const viewer of ['p1', 'p2', null]) expect(publicState(after, viewer, history).library[0].discard).toEqual([later]);
  const flags = history.status(after, 'p1');
  expect(() => history.apply(after, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot2', dummy: true, roomId: 'room-0,0' }, 'p1')).toThrow();
  expect(() => history.apply(after, discard(after, second), 'p1')).toThrow();
  expect(history.status(after, 'p1')).toEqual(flags); expect(views(after, history)).toEqual(afterViews);
  const restored = undo(history, after); expect(restored).toEqual(before); expect(views(restored, history)).toEqual(beforeViews);
  expect(getDiscardMoveCards(restored.players[0], restored.activation)).toEqual([first, second, later, quick]); assertPrivateHistory(restored, history);
  const replayed = redo(history, restored); expect(replayed).toEqual(after); expect(views(replayed, history)).toEqual(afterViews); assertPrivateHistory(replayed, history);
  const cast = history.apply(replayed, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', dummy: true, roomId: 'room-0,0' }, 'p1');
  expect(cast.currentPlayerId).toBe('p2'); expect(cast.players[0].prepared.slot2!.used).toBe(false);
  expect(cast.library[0].discard).toEqual([later, first]); expect(cast.players[0].actionTokens).toBe(0);
  expect(boundaries(cast)).toEqual([endLine(s), startLine(s, 'p2')]); assertPrivateHistory(cast, history);
  expect(undo(history, cast)).toEqual(after); expect(redo(history, after)).toEqual(cast);
 });
 it.each(['future', 'spent-quota', 'forgotten-before-future'] as const)('undoes a mandatory tokenless cell exit with %s back to exact eligibility', kind => {
  const s = fixture(), card = prepare(s, 'slot3', 'Pain Mark'), history = new ActionHistory();
  if (kind === 'future') { prepare(s, 'slot1'); prepare(s, 'slot2', 'Grim Torment'); }
  if (kind === 'forgotten-before-future') s.players[0].prepared.slot1 = { card: s.powerfulDeck.shift()!, used: false };
  s.players[0].wizard.position = { ...s.board.rooms.find(r => r.startingFor === 'p1')!.tiles[0] };
  s.players[0].actionTokens = 0; s.activation!.actionsUsed = 1; s.activation!.sequencedSpellUsed = kind === 'spent-quota';
  const beforeViews = views(s, history), eligible = getDiscardMoveCards(s.players[0], s.activation), action = discard(s, card);
  expect(eligible).toContainEqual(card); expect(getReadyPreparedSlots(s.players[0], s.activation)).toEqual(kind === 'spent-quota' ? [] : ['slot1']);
  expect(() => history.apply(s, { type: 'END_ACTIVATION', playerId: 'p1' }, 'p1')).toThrow();
  const after = history.apply(s, action, 'p1'), afterViews = views(after, history); expect(after.currentPlayerId).toBe('p2');
  expect(after.players[0].wizard.position).toEqual(action.destination); expect(after.players[0].actionTokens).toBe(0);
  expect(after.players[0].prepared.slot3).toEqual({ card, used: true }); expect(after.library[0].discard).toEqual([card]);
  expect(after.readiedSpells).toEqual([]); expect(after.ongoingSpells).toEqual([]); expect(after.feedbackEvents).toEqual([]);
  expect(after.log.slice(-2)).toEqual([endLine(s), startLine(s, 'p2')]);
  const restored = undo(history, after); expect(restored).toEqual(s); expect(views(restored, history)).toEqual(beforeViews);
  expect(getDiscardMoveCards(restored.players[0], restored.activation)).toEqual(eligible); assertPrivateHistory(restored, history);
  const replayed = redo(history, restored); expect(replayed).toEqual(after); expect(views(replayed, history)).toEqual(afterViews); assertPrivateHistory(replayed, history);
 });
 it.each([
  { kind: 'cast', slot: 'slot3' }, { kind: 'activate', slot: 'slot3' },
  { kind: 'cast', slot: 'rapid' }, { kind: 'activate', slot: 'rapid' },
 ] as const)('restores spent quota and exact privacy after slot1 $kind then $slot discard', ({ kind, slot }) => {
  const s = fixture(), first = prepare(s, 'slot1', kind === 'cast' ? 'Visceral Fire' : 'Torment');
  const future = prepare(s, 'slot3', 'Pain Mark'), quick = slot === 'rapid' ? prepare(s, 'rapid', 'Submission') : null;
  s.players[0].actionTokens = 0; s.players[0].hand.push(take(s, 'Grim Torment'));
  const history = new ActionHistory();
  const beforeViews = views(s, history);
  const spent = history.apply(s, kind === 'cast'
   ? { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', dummy: true, roomId: 'room-0,0' }
   : { type: 'ACTIVATE_SPELL', playerId: 'p1', slot: 'slot1' }, 'p1');
  const spentViews = views(spent, history), card = slot === 'slot3' ? future : quick!, action = discard(spent, card);
  // Without Quick or tokens, the future discard alone must keep this turn open.
  expect(spent.currentPlayerId).toBe('p1'); expect(boundaries(spent)).toEqual([]);
  expect(spent.activation).toMatchObject({ actionsUsed: 1, spellsCast: 1, sequencedSpellUsed: true, discardedExit: false });
  expect(getReadyPreparedSlots(spent.players[0], spent.activation)).toEqual(quick ? ['rapid'] : []);
  expect(getDiscardMoveCards(spent.players[0], spent.activation)).toEqual([future, ...(quick ? [quick] : [])]); assertPrivateHistory(spent, history);
  const after = history.apply(spent, action, 'p1'), afterViews = views(after, history);
  expect(after.currentPlayerId).toBe('p2'); expect(after.players[0].prepared[slot]!.used).toBe(true);
  expect(after.players[0].prepared.slot3!.used).toBe(slot === 'slot3');
  expect(after.players[0].actionTokens).toBe(0); expect(after.players[0].wizard.position).toEqual(action.destination);
  expect(after.players[0].hand).toEqual(s.players[0].hand);
  expect(after.library[0].discard).toEqual(kind === 'cast' ? [first, card] : [card]); expect(after.players[0].discard).toEqual([]);
  expect(after.readiedSpells).toEqual(spent.readiedSpells); expect(after.ongoingSpells).toEqual([]); expect(after.feedbackEvents).toEqual(spent.feedbackEvents);
  expect(after.log.slice(-2)).toEqual([endLine(s), startLine(s, 'p2')]);
  assertPrivateHistory(after, history);
  let restored = undo(history, after); expect(restored).toEqual(spent); expect(views(restored, history)).toEqual(spentViews);
  expect(restored.activation).toMatchObject({ actionsUsed: 1, spellsCast: 1, sequencedSpellUsed: true, discardedExit: false });
  expect(getDiscardMoveCards(restored.players[0], restored.activation)).toEqual([future, ...(quick ? [quick] : [])]);
  const flags = history.status(restored, 'p1'), before = structuredClone(restored);
  expect(() => history.apply(restored, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot3', dummy: true, roomId: 'room-0,0' }, 'p1')).toThrow();
  expect(() => history.apply(restored, discard(restored, first), 'p1')).toThrow();
  expect(restored).toEqual(before); expect(history.status(restored, 'p1')).toEqual(flags);
  assertPrivateHistory(restored, history);
  const original = undo(history, restored); expect(original).toEqual(s); expect(views(original, history)).toEqual(beforeViews); assertPrivateHistory(original, history);
  restored = redo(history, original); expect(restored).toEqual(spent); expect(views(restored, history)).toEqual(spentViews);
  restored = redo(history, restored); expect(restored).toEqual(after); expect(views(restored, history)).toEqual(afterViews);
  expect(() => undo(history, restored, 'p2')).toThrow(); assertPrivateHistory(restored, history);
 });
 it('undoes both actions in sequence and redoes without duplicating turn boundaries or discards', () => {
  const s = fixture(), numbered = prepare(s, 'slot2'), quick = prepare(s, 'rapid', 'Submission'), history = new ActionHistory();
  const first = history.apply(s, discard(s, numbered), 'p1');
  const second = history.apply(first, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', dummy: true, roomId: 'room-0,0' }, 'p1');
  const oneBack = undo(history, second), original = undo(history, oneBack);
  expect(original).toEqual(s); expect(redo(history, original)).toEqual(first);
  const replayed = redo(history, first); expect(replayed).toEqual(second);
  expect(replayed.library[0].discard.map(c => c.id)).toEqual([numbered.id, quick.id]);
  expect(boundaries(replayed)).toEqual([endLine(s), startLine(s, 'p2')]); assertPrivateHistory(replayed, history);
 });
 it.each(['held', 'used', 'active', 'ongoing', 'foreign', 'forgotten', 'forgotten-held', 'invalid-destination'] as const)('a rejected %s discard preserves the redo branch exactly', condition => {
  const s = fixture(), history = new ActionHistory(); let card: Card;
  if (condition === 'held') { card = take(s); s.players[0].hand.push(card); }
  else if (condition === 'used') { card = prepare(s, 'rapid'); s.players[0].prepared.rapid!.used = true; s.library[0].discard.push(card); }
  else if (condition === 'active') { card = take(s, 'Torment'); s.readiedSpells!.push({ id: 'hidden-trap', playerId: 'p1', card }); s.activeSpellOrder!.push('hidden-trap'); }
  else if (condition === 'ongoing') { card = take(s, 'Pain Mark'); s.ongoingSpells!.push({ id: 'ongoing-mark', playerId: 'p1', card, targetPlayerId: 'p2' }); s.activeSpellOrder!.push('ongoing-mark'); }
  else if (condition === 'foreign') { card = take(s); s.players[1].prepared.rapid = { card, used: false }; }
  else if (condition === 'forgotten') { card = s.powerfulDeck.shift()!; s.players[0].prepared.slot3 = { card, used: false }; }
  else if (condition === 'forgotten-held') { card = s.powerfulDeck.shift()!; s.players[0].hand.push(card); }
  else card = prepare(s, 'slot3');
  const explored = history.apply(s, { type: 'EXPLORE', playerId: 'p1' }, 'p1');
  const restored = undo(history, explored), before = structuredClone(restored), flags = history.status(restored, 'p1'), wire = views(restored, history);
  const action: GameAction = { ...discard(restored, card), ...(condition === 'invalid-destination' ? { destination: { q: 0, r: 0 } } : {}) };
  expect(() => history.apply(restored, action, 'p1')).toThrow(); expect(restored).toEqual(before);
  expect(history.status(restored, 'p1')).toEqual(flags); expect(views(restored, history)).toEqual(wire);
  expect(redo(history, restored)).toEqual(explored); assertPrivateHistory(explored, history);
 });
 it('rejects transport impersonation and unsuccessful opponent actions without losing the owner history', () => {
  const s = fixture(), card = prepare(s, 'slot3'), history = new ActionHistory();
  const moved = history.apply(s, discard(s, card), 'p1'), before = structuredClone(moved), flags = history.status(moved, 'p1');
  expect(() => history.apply(moved, { type: 'END_ACTIVATION', playerId: 'p1' }, 'p2')).toThrow(/another player/);
  expect(() => history.apply(moved, { type: 'EXPLORE', playerId: 'p2' }, 'p2')).toThrow();
  expect(moved).toEqual(before); expect(history.status(moved, 'p1')).toEqual(flags);
  expect(undo(history, moved)).toEqual(s); assertPrivateHistory(s, history);
 });
});

describe('Chronicle turn boundary snapshots', () => {
 it.each([false, true])('manual end undo/redo restores exact log ordering (same-owner restart=%s)', sameOwner => {
  const s = fixture(); s.activation!.actionsUsed = 1; if (sameOwner) s.players[1].actionTokens = 0;
  const history = new ActionHistory(), beforeViews = views(s, history);
  const after = history.apply(s, { type: 'END_ACTIVATION', playerId: 'p1' }, 'p1');
  expect(after.log).toEqual([endLine(s), startLine(s, sameOwner ? 'p1' : 'p2')]);
  const afterViews = views(after, history), restored = undo(history, after);
  expect(restored).toEqual(s); expect(views(restored, history)).toEqual(beforeViews);
  const replayed = redo(history, restored); expect(replayed).toEqual(after); expect(views(replayed, history)).toEqual(afterViews);
  assertPrivateHistory(replayed, history);
 });
 it('undoing an end and taking another action removes the old boundary branch', () => {
  const s = fixture(); s.activation!.actionsUsed = 1; const card = prepare(s, 'rapid'), history = new ActionHistory();
  const ended = history.apply(s, { type: 'END_ACTIVATION', playerId: 'p1' }, 'p1'), restored = undo(history, ended);
  const branched = history.apply(restored, discard(restored, card), 'p1');
  expect(branched.log.filter(line => line === endLine(s))).toHaveLength(1);
  expect(branched.log.filter(line => line === startLine(s, 'p2'))).toHaveLength(1);
  expect(history.status(branched, 'p1')).toMatchObject({ canUndo: true, canRedo: false });
  expect(() => redo(history, branched)).toThrow(); expect(undo(history, branched)).toEqual(s); conserved(branched);
 });
 it('successful opponent commitment closes the previous mage boundary history', () => {
  const s = fixture(); s.activation!.actionsUsed = 1; const history = new ActionHistory();
  const ended = history.apply(s, { type: 'END_ACTIVATION', playerId: 'p1' }, 'p1');
  const committed = history.apply(ended, { type: 'EXPLORE', playerId: 'p2' }, 'p2');
  expect(history.status(committed, 'p1')).toEqual({ canUndo: false, canRedo: false });
  expect(history.status(committed, 'p2').canUndo).toBe(true); expect(() => undo(history, committed)).toThrow();
  expect(undo(history, committed, 'p2')).toEqual(ended); conserved(committed);
 });
 it('phase-ending end logs are public but remain an undo barrier', () => {
  const s = fixture(); s.activation!.actionsUsed = 1; for (const p of s.players) p.actionTokens = 0;
  const history = new ActionHistory(), after = history.apply(s, { type: 'END_ACTIVATION', playerId: 'p1' }, 'p1');
  expect(after.phase).toBe('CLEANUP'); expect(boundaries(after)).toEqual([endLine(s)]);
  for (const viewer of ['p1', 'p2', null]) {
   expect(publicState(after, viewer, history).log).toEqual(after.log);
   expect(history.status(after, viewer)).toEqual({ canUndo: false, canRedo: false });
  }
  expect(() => undo(history, after)).toThrow(); conserved(after);
 });
 it('does not log an early end for a last-action quest window; solving is a safety barrier', () => {
  const s = fixture(), history = new ActionHistory(); s.activation!.actionsUsed = 1; prepare(s, 'rapid');
  const index = s.questDeck.findIndex(q => q.kind === 'ROOM_ACTIVATE'), quest = s.questDeck.splice(index, 1)[0];
  Object.assign(quest, { completed: true, claimed: false, progress: quest.amount }); s.players[0].quest = quest;
  const ready = history.apply(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', dummy: true, roomId: 'room-0,0' }, 'p1');
  expect(ready.activation!.actionsUsed).toBe(2); expect(boundaries(ready)).toEqual([]); assertPrivateHistory(ready, history);
  const restored = undo(history, ready); expect(restored).toEqual(s); expect(redo(history, restored)).toEqual(ready);
  const solved = history.apply(ready, { type: 'USE_QUEST_REWARD', playerId: 'p1', questId: quest.id }, 'p1');
  expect(solved.log.slice(-2)).toEqual([endLine(s), startLine(s, 'p2')]);
  expect(history.status(solved, 'p1')).toEqual({ canUndo: false, canRedo: false });
  expect(() => undo(history, solved)).toThrow(); assertPrivateHistory(solved, history);
 });
 it('last-action paid model control delays end logs and its finishing snapshot restores exactly', () => {
  const s = fixture(), history = new ActionHistory(); s.activation!.actionsUsed = 1;
  const e = summonEvocation(s, s.players[0], 'CADAVER', { q: 0, r: 0 })!;
  const active = history.apply(s, { type: 'ACTIVATE_EVOCATION', playerId: 'p1', evocationId: e.id }, 'p1');
  expect(boundaries(active)).toEqual([]);
  const ended = history.apply(active, { type: 'END_EVOCATION', playerId: 'p1' }, 'p1');
  expect(ended.log.slice(-2)).toEqual([endLine(s), startLine(s, 'p2')]);
  const restored = undo(history, ended); expect(restored).toEqual(active); expect(boundaries(restored)).toEqual([]);
  expect(redo(history, restored)).toEqual(ended); assertPrivateHistory(ended, history);
 });
 it('out-of-turn Liquefy finishing snapshots restore suspended mage ownership without fake p2 boundaries', () => {
  const s = fixture(), history = new ActionHistory(); s.activation!.actionsUsed = 1; s.players[1].wizard.health = 1; prepare(s, 'rapid');
  const card = take(s, 'Liquefy the Pain'); s.readiedSpells!.push({ id: 'liquefy', playerId: 'p2', card }); s.activeSpellOrder!.push('liquefy');
  const paused = history.apply(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p2' }, 'p1');
  expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL'); expect(boundaries(paused)).toEqual([]);
  for (const viewer of ['p1', 'p2', null]) {
   const wire = publicState(paused, viewer, history); expect(wire.pendingDecision?.resume).toBeUndefined();
   expect(wire.pendingDecision?.kind).toBe(viewer === 'p2' ? 'REACTIVE_SPELL' : 'WAITING');
   expect(wire.history).toEqual({ canUndo: false, canRedo: false });
  }
  const active = history.apply(paused, { type: 'RESPOND_REACTIVE_SPELL', playerId: 'p2', key: paused.pendingDecision!.key, activeSpellId: 'liquefy' }, 'p2');
  expect(active.currentPlayerId).toBe('p2'); expect(active.activation!.playerId).toBe('p1'); expect(boundaries(active)).toEqual([]);
  const ended = history.apply(active, { type: 'END_EVOCATION', playerId: 'p2' }, 'p2');
  expect(ended.log.slice(-2)).toEqual([endLine(s), startLine(s, 'p2')]);
  expect(ended.log).not.toContain(endLine(s, 'p2'));
  const restored = undo(history, ended, 'p2'); expect(restored).toEqual(active); expect(boundaries(restored)).toEqual([]);
  expect(redo(history, restored, 'p2')).toEqual(ended); conserved(ended);
 });
});