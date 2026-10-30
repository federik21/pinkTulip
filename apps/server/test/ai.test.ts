import { afterEach, describe, expect, it, vi } from 'vitest';
import {
 applyAction, areAdjacent, areInSameRoom, createGame, GameRuleError,
 hexKey, summonEvocation,
} from '@brw/game-engine';
import * as engine from '@brw/game-engine';
import type { Card, GameAction, GameState, Player } from '@brw/game-engine';
import { chooseBotAction } from '../src/ai';
import { ActionHistory } from '../src/action-history';

const setBot = (p: Player, value = true) => Object.assign(p, { isBot: value });
function lobby(count = 2, bots = ['p1', 'p2', 'p3', 'p4']): GameState {
 const s = createGame(count);
 for (const p of s.players) { p.connected = true; setBot(p, bots.includes(p.id)); }
 return s;
}
function fixture(bots = ['p1']): GameState {
 const s = lobby(2, bots);
 s.phase = 'ACTION'; s.round = 1; s.firstPlayerId = 'p1'; s.currentPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false, spellsCast: 0, discardedExit: false, roomEffectUsed: false };
 s.players[0].wizard.position = { q: 0, r: 0 };
 s.players[1].wizard.position = { q: 1, r: 0 };
 return s;
}
function take(s: GameState, name: string): Card {
 for (const deck of s.library) for (const pile of [deck.cards, deck.discard]) {
  const i = pile.findIndex(c => c.name === name);
  if (i >= 0) return pile.splice(i, 1)[0];
 }
 throw new Error(`No physical ${name} remaining`);
}
function prepare(s: GameState, name: string, slot: keyof Player['prepared'] = 'slot1', owner = 0): Card {
 const card = take(s, name); s.players[owner].prepared[slot] = { card, used: false }; return card;
}
function arm(s: GameState, name: string, owner = 1): string {
 const active = { id: `armed-${owner}-${name}`, playerId: s.players[owner].id, card: take(s, name) };
 s.readiedSpells!.push(active); s.activeSpellOrder!.push(active.id); return active.id;
}
function next(s: GameState): GameAction {
 const before = structuredClone(s), action = chooseBotAction(s);
 expect(s).toEqual(before); expect(action, `No progress in ${s.phase}, round ${s.round}, current ${s.currentPlayerId}, pending ${s.pendingDecision?.kind}`).not.toBeNull();
 expect(() => applyAction(s, action!)).not.toThrow();
 return action!;
}
function step(s: GameState): GameState { return applyAction(s, next(s)); }
function expectCardsConserved(s: GameState) {
 const cards = [
  ...s.library.flatMap(d => [...d.cards, ...d.discard]), ...s.powerfulDeck, ...s.removedCards,
  ...s.players.flatMap(p => [...p.personalDeck, ...p.hand, ...p.discard, ...Object.values(p.prepared).flatMap(c => c && !c.used ? [c.card] : [])]),
  ...(s.readiedSpells ?? []).map(a => a.card), ...(s.ongoingSpells ?? []).map(a => a.card),
 ];
 expect(cards).toHaveLength(48); expect(new Set(cards.map(c => c.id)).size).toBe(48);
}
function expectCubesConserved(s: GameState) {
 for (const p of s.players) {
  expect(Object.values(p.cubes).reduce((a, b) => a + b, 0)).toBe(25);
  expect(p.cubes.onWizard).toBe(s.players.reduce((n, victim) => n + (victim.wizard.damageByPlayer[p.id] ?? 0), 0));
  expect(p.cubes.onEvocations).toBe(s.evocations.reduce((n, e) => n + (e.damageByPlayer[p.id] ?? 0), 0));
 }
}
function finishModel(s: GameState, owner: string): GameState {
 for (let i = 0; i < 12 && s.evocationActivation?.playerId === owner; i++) s = step(s);
 expect(s.evocationActivation?.playerId).not.toBe(owner); return s;
}
function publicOnlyMutation(s: GameState): GameState {
 const copy = structuredClone(s);
 // Preserve stocks/ownership/public facts while replacing EVERY hidden identity.
 const hidden = (c: Card, i: number): Card => ({ ...c, id: `unknown-${i}`, name: 'Unknown', moments: [], target: 'SELF', range: 0, trigger: undefined, ongoing: undefined });
 for (const d of copy.library) d.cards = [...d.cards].reverse().map(hidden);
 copy.eventDeck.reverse(); copy.questDeck.reverse(); copy.powerfulDeck = [...copy.powerfulDeck].reverse().map(hidden);
 for (const p of copy.players) {
  p.personalDeck = [...p.personalDeck].reverse().map(hidden);
  if (p.id === 'p1') continue;
  p.hand = p.hand.map(hidden);
  for (const slot of Object.keys(p.prepared) as Array<keyof Player['prepared']>) {
   const c = p.prepared[slot]; if (c) c.card = hidden(c.card, 100);
  }
  if (p.quest) Object.assign(p.quest, { name: 'Hidden quest', kind: 'KILL', amount: 100, reward: 999, completed: true });
  p.additionalQuests = [];
 }
 for (const active of copy.readiedSpells ?? []) if (active.playerId !== 'p1') active.card = hidden(active.card, 200);
 return copy;
}

afterEach(() => vi.restoreAllMocks());

describe('bot ownership and phase policy', () => {
 it('returns null for a human turn, pending human decision, finished game, or disconnected game', () => {
  const s = fixture([]); expect(chooseBotAction(s)).toBeNull();
  setBot(s.players[0]); s.pendingDecision = { kind: 'WAITING', playerId: 'p2', key: 'private' };
  expect(chooseBotAction(s)).toBeNull();
  s.pendingDecision = null; s.phase = 'GAME_OVER'; expect(chooseBotAction(s)).toBeNull();
  s.phase = 'ACTION'; s.players[1].connected = false; expect(chooseBotAction(s)).toBeNull();
 });
 it.each(['BLACK_ROSE', 'CLEANUP'] as const)('never advances %s even with a bot host and an all-bot roster', phase => {
  const s = fixture(['p1', 'p2']); s.phase = phase; s.activation = null; s.currentPlayerId = null;
  expect(chooseBotAction(s)).toBeNull();
 });
 it('documents actual auto-transition gating rather than returning an invalid phase command', () => {
  for (const phase of ['STUDY', 'PREPARATION'] as const) {
   const s = lobby(); s.phase = phase;
   for (const p of s.players) { p.studyDrawn = true; p.studyDone = true; p.preparationDone = true; }
   expect(() => applyAction(s, { type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: phase, expectedRound: s.round })).toThrow(GameRuleError);
   expect(chooseBotAction(s)).toBeNull();
  }
 });
 it('does not change roster, connections, input or private replay when choosing repeatedly', () => {
  const s = fixture(), before = structuredClone(s), a = next(s);
  expect(chooseBotAction(s)).toEqual(a); expect(chooseBotAction(structuredClone(s))).toEqual(a);
  expect(s).toEqual(before);
 });
});

describe('blind setup and preparation', () => {
 it('supports direct engine startup only for an all-ready bot host', () => {
  let s = lobby();
  for (let i = 0; i < 4; i++) s = step(s);
  expect(next(s)).toEqual({ type: 'START_GAME', playerId: 'p1' });
  setBot(s.players[0], false); expect(chooseBotAction(s)).toBeNull();
 });
 it('picks a random valid starting school when the bot must choose', () => {
  const s = lobby(2, ['p2']);
  const validSchools = [...s.library].map(deck => deck.id).sort();
  const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);

  const action = chooseBotAction(s);

  expect(action).toMatchObject({
   type: 'SELECT_STARTING_SCHOOL',
   playerId: 'p2',
  });
  expect(validSchools).toContain(action!.schoolId);
  expect(randomSpy).toHaveBeenCalled();
 });
 it('last bot discard/preparation automatically synchronizes a human who already finished', () => {
  let s = lobby(2, ['p2']); s.phase = 'STUDY'; s.players[0].studyDone = true;
  s = step(s); s = step(s); expect(s.phase).toBe('PREPARATION');
  s.players[0].preparationDone = true; s = step(s); expect(s.phase).toBe('ACTION');
  expect(s.currentPlayerId).toBe('p1'); expect(chooseBotAction(s)).toBeNull();
 });
 it('handles bot quest overflow after the explicit Black Rose continuation', () => {
  const s = lobby(2, ['p2']); s.phase = 'BLACK_ROSE'; s.blackRoseResolved = true;
  const p = s.players[1]; p.quest = s.questDeck.shift()!; p.additionalQuests = s.questDeck.splice(0, 2);
  const keep = p.additionalQuests[0]; keep.completed = true;
  const action = next(s); expect(action.type).toBe('DISCARD_QUESTS');
  const done = applyAction(s, action); expect(done.phase).toBe('STUDY'); expect(done.players[1].additionalQuests.some(q => q.id === keep.id) || done.players[1].quest?.id === keep.id).toBe(true);
 });
});

describe('normal action priorities, movement, and budgets', () => {
 it('targets a real enemy with an ongoing Agony spell rather than its own mage', () => {
  const s = fixture(); prepare(s, 'Pain Mark');
  expect(next(s)).toEqual({ type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
  expect(step(s).ongoingSpells![0]).toMatchObject({ playerId: 'p1', targetPlayerId: 'p2' });
 });
 it('never treats a missing board tile as a path or enters a cell', () => {
  let s = fixture(); s.players[0].wizard.position = { q: 0, r: 0 }; s.players[1].wizard.position = { q: 2, r: 0 };
  s.board.tiles = s.board.tiles.filter(h => hexKey(h) !== '1,0');
  s = step(step(s)); const action = next(s);
  expect(action.type).toBe('EXPLORE_STEP');
  if (action.type !== 'EXPLORE_STEP') throw new Error('Expected movement');
  expect(hexKey(action.destination)).not.toBe('1,0');
 });
 it('finishes active physical attacks before any quest/spell and skips unavailable room effects', () => {
  let s = fixture(); s.players[1].wizard.position = { q: 0, r: 0 };
  s = applyAction(s, { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'ATTACK' });
  prepare(s, 'Submission'); const room = s.board.rooms.find(r => r.tiles.some(t => hexKey(t) === '0,0'))!;
  room.reconstructed = true; room.specialUsed = true;
  expect(next(s)).toEqual({ type: 'INFLICT_ATTACK', playerId: 'p1', targetId: 'p2' });
  s = step(s); expect(next(s).type).toBe('SKIP_PHYSICAL_EFFECTS'); s = step(s);
  expect(s.activation?.physicalAction).toBeNull(); expect(next(s).type).toBe('CAST_SPELL');
 });
});

describe('out-of-turn decisions and spell-granted continuations', () => {
 it('declines a nonlethal tithe that would destroy the last-wound servant, but sacrifices it to save its mage', () => {
  const s = fixture(['p2']); prepare(s, 'Grim Torment');
  const e = summonEvocation(s, s.players[1], 'SUCCUBUS', { q: 1, r: 0 })!; e.damageCubes = 2;
  const root: GameAction = { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' };
  expect(next(applyAction(s, root))).toMatchObject({ type: 'RESPOND_SOUL_TITHE', accept: false });
  s.players[1].wizard.health = 3;
  expect(next(applyAction(s, root))).toMatchObject({ type: 'RESPOND_SOUL_TITHE', accept: true });
 });
 it('declines an unhelpful optional reveal when finite Succubus supply is exhausted', () => {
  const s = fixture(['p2']); prepare(s, 'Grim Torment'); arm(s, 'Liquefy the Pain');
  for (let i = 0; i < 3; i++) summonEvocation(s, s.players[0], 'SUCCUBUS', { q: -1, r: 0 });
  s.players[1].wizard.health = 1;
  const paused = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
  expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL');
  expect(next(paused)).toMatchObject({ type: 'RESPOND_REACTIVE_SPELL', playerId: 'p2' });
  expect(next(paused)).not.toHaveProperty('activeSpellId');
 });
 it('chooses among legal non-forced reveal targets sensibly and can decline with an empty option list', () => {
  const s = fixture(['p2']); prepare(s, 'Grim Torment'); arm(s, 'Torment');
  const active = s.readiedSpells![0]; delete active.card.triggerTarget;
  const paused = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
  expect(next(paused)).toHaveProperty('targetId', 'p1');
  // Empty options can occur in sanitized/stale decision snapshots; declining is legal.
  if (paused.pendingDecision?.kind !== 'REACTIVE_SPELL') throw new Error('Expected reactive');
  paused.pendingDecision.options = [];
  expect(next(paused)).not.toHaveProperty('activeSpellId');
 });
});

describe('free and paid evocation control', () => {
 it('finishes movement-only activations with no enemies outside cells', () => {
  let s = fixture(); s.phase = 'EVOCATION'; s.activation = null;
  s.players[1].wizard.position = { ...s.board.rooms.find(r => r.startingFor === 'p2')!.tiles[0] };
  summonEvocation(s, s.players[0], 'CADAVER', { q: 0, r: 0 });
  s = step(s); expect(next(s).type).toBe('END_EVOCATION'); s = step(s); expect(s.phase).toBe('CLEANUP');
 });
 it('handles same multi-tile room targets and keeps movement after the single attack', () => {
  let s = fixture(); s.phase = 'EVOCATION'; s.activation = null;
  const room = s.board.rooms.find(r => r.id === 'room-0,0')!;
  s.board.rooms = s.board.rooms.filter(r => r.id !== 'room-1,0'); room.tiles.push({ q: 1, r: 0 });
  const e = summonEvocation(s, s.players[0], 'CADAVER', { q: 0, r: 0 })!;
  s = step(s); expect(areInSameRoom(s, e.position, s.players[1].wizard.position)).toBe(true);
  expect(next(s).type).toBe('EVOCATION_ATTACK'); s = step(s); expect(s.evocationActivation?.movesRemaining).toBe(2);
  expect(next(s).type).toBe('END_EVOCATION');
 });
 it('spends one shared action and token for a useful paid activation before a distant mage Explore', () => {
  const s = fixture(); s.players[0].wizard.position = { q: -2, r: 0 };
  const e = summonEvocation(s, s.players[0], 'CADAVER', { q: 1, r: 0 })!;
  expect(next(s)).toEqual({ type: 'ACTIVATE_EVOCATION', playerId: 'p1', evocationId: e.id });
  const active = step(s); expect(active.activation?.actionsUsed).toBe(1); expect(active.players[0].actionTokens).toBe(1);
 });
});

describe('privacy, legal-oracle failures, and bounded play', () => {
 it('makes the same combat decision under all opponent hidden-card/quest and future-deck mutations', () => {
  const s = fixture(); prepare(s, 'Grim Torment'); prepare(s, 'Torment', 'rapid', 1);
  s.players[1].hand.push(take(s, 'Cross and Delight')); s.players[1].personalDeck.push(take(s, 'Peak of Agony'));
  s.players[0].personalDeck.push(take(s, 'Submission'));
  s.players[1].quest = s.questDeck.shift()!; arm(s, 'Master of Pleasure');
  expect(next(s)).toEqual(next(publicOnlyMutation(s)));
 });
 it('never directly reads future card definitions or opponent private decision-scoring fields', () => {
  const s = fixture(); prepare(s, 'Submission'); s.players[0].personalDeck.push(take(s, 'Grim Torment'));
  // structuredClone/the oracle may copy them, but the policy may not read them.
  // Non-enumerable getters are deliberately absent from the engine clone.
  for (const deck of [s.library[0].cards, s.players[0].personalDeck]) for (const c of deck) {
   Object.defineProperty(c, 'name', { enumerable: false, get() { throw new Error('Hidden deck identity inspected'); } });
  }
  Object.defineProperty(s.players[1], 'hand', { enumerable: false, get() { throw new Error('Foreign hand inspected'); } });
  // The engine does not need a foreign hand while resolving this immediate spell.
  expect(next(s)).toMatchObject({ type: 'CAST_SPELL', targetPlayerId: 'p2' });
 });
 it('propagates unexpected failures instead of treating engine bugs as illegal moves', () => {
    const s = fixture(); vi.spyOn(engine, 'applyAction').mockImplementation(() => { throw new Error('Unexpected engine failure'); });
  expect(() => chooseBotAction(s)).toThrow('Unexpected engine failure');
 });
 it('does not use Math.random for policy tie breaks or inspect simulated random rewards', () => {
  const s = fixture(); prepare(s, 'Grim Torment');
  const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Policy RNG'); });
  expect(next(s)).toMatchObject({ type: 'CAST_SPELL' }); expect(random).not.toHaveBeenCalled();
 });
 it('treats only GameRuleError as a rejected candidate and validates independent clones', () => {
  const s = fixture(); prepare(s, 'Grim Torment'); const before = structuredClone(s);
  const oracle = vi.spyOn(engine, 'applyAction').mockImplementation((copy, action) => {
   expect(copy).not.toBe(s); copy.log.push('Oracle-only mutation'); action.playerId = 'clone-only';
   throw new GameRuleError('Reject candidate');
  });
  expect(chooseBotAction(s)).toBeNull(); expect(oracle.mock.calls.length).toBeGreaterThan(1); expect(oracle.mock.calls.length).toBeLessThanOrEqual(1024);
  expect(s).toEqual(before);
 });
});