import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAction, createGame, GameRuleError, summonEvocation } from '@brw/game-engine';
import type { Card, GameAction, GameState } from '@brw/game-engine';
import * as policy from '../src/ai';
import { ActionHistory } from '../src/action-history';
import { BotRunner, canFitBotRoster, configureBot } from '../src/bot-room';
import { SessionStore } from '../src/session-store';

type BotCommand = Extract<GameAction, { type: 'ADD_BOT' | 'REMOVE_BOT' }>;
const add: BotCommand = { type: 'ADD_BOT', playerId: 'p1' };
const remove: BotCommand = { type: 'REMOVE_BOT', playerId: 'p1', botId: 'p2' };
function lobby(count = 1): GameState {
 const game = createGame(count);
 for (const p of game.players) p.connected = true;
 return game;
}
function battle(): GameState {
 const game = configureBot(lobby(), add);
 game.phase = 'ACTION'; game.round = 1; game.firstPlayerId = 'p1'; game.currentPlayerId = 'p2';
 game.activation = { playerId: 'p2', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false, spellsCast: 0, discardedExit: false, roomEffectUsed: false };
 game.players[0].wizard.position = { q: 1, r: 0 };
 game.players[1].wizard.position = { q: 0, r: 0 };
 return game;
}
function take(game: GameState, name: string): Card {
 const deck = game.library[0], index = deck.cards.findIndex(card => card.name === name);
 expect(index).toBeGreaterThanOrEqual(0);
 return deck.cards.splice(index, 1)[0];
}
function unchangedRejection(game: GameState, action: BotCommand, message: RegExp) {
 const before = structuredClone(game);
 expect(() => configureBot(game, action)).toThrow(GameRuleError);
 expect(() => configureBot(game, action)).toThrow(message);
 expect(game).toEqual(before);
}

describe('AI lobby roster configuration', () => {
 it('adds a connected server-controlled empty seat without mutating or dealing from the real Agony library', () => {
  const game = lobby(), before = structuredClone(game), next = configureBot(game, add);
  expect(game.library.map(deck => [deck.id, deck.cards.length])).toEqual([['agony', 36]]);
  expect(game.powerfulDeck).toHaveLength(12);
  expect(game).toEqual(before); expect(next).not.toBe(game);
  expect(next.players[1]).toMatchObject({ id: 'p2', name: 'AI Mage 2', isBot: true, connected: true, ready: false,
   startingSchoolId: null, hand: [], personalDeck: [], discard: [], prepared: { slot1: null, slot2: null, slot3: null, rapid: null } });
  expect(next.players[0].isBot).toBeUndefined();
  expect(next.library).toEqual(before.library); expect(next.board).toEqual(before.board);
  expect(next.log).toEqual([...before.log, 'AI Mage 2 joined as a basic AI opponent.']);
  next.players[0].name = 'Changed'; next.library[0].cards.pop();
  expect(game).toEqual(before);
 });

 it.each(['ADD_BOT', 'REMOVE_BOT'] as const)('%s resets all readiness but preserves school choices and never starts a previously ready lobby', type => {
  const game = configureBot(lobby(), add);
  for (const p of game.players) { p.startingSchoolId = 'agony'; p.ready = true; }
  const before = structuredClone(game), next = configureBot(game, { type, playerId: 'p1', botId: 'p2' });
  expect(game).toEqual(before); expect(next.phase).toBe('LOBBY'); expect(next.round).toBe(0);
  expect(next.players.every(p => !p.ready)).toBe(true);
  expect(next.players.filter(p => before.players.some(old => old.id === p.id)).every(p => p.startingSchoolId === 'agony')).toBe(true);
  expect(next.players.every(p => p.hand.length + p.personalDeck.length + p.discard.length === 0)).toBe(true);
  expect(next.library).toEqual(before.library);
 });

 it('removes only the requested bot, preserves the host, and reuses the lowest free seat with fresh defaults', () => {
  let game = configureBot(configureBot(lobby(), add), add);
  game.players[1].name = 'Old bot'; game.players[1].startingSchoolId = 'agony';
  const before = structuredClone(game), removed = configureBot(game, remove);
  expect(game).toEqual(before); expect(removed.players.map(p => p.id)).toEqual(['p1', 'p3']);
  expect(removed.hostId).toBe('p1'); expect(removed.log.at(-1)).toBe('Old bot left the lobby.');
  const reused = configureBot(removed, add), seat = reused.players.at(-1)!;
  expect(seat).toMatchObject({ id: 'p2', name: 'AI Mage 2', startingSchoolId: null, ready: false, connected: true, isBot: true });
  expect(seat.wizard.playerId).toBe('p2'); expect(seat.wizard.startingRoomId).toBe(before.players[1].wizard.startingRoomId);
  expect(new Set(reused.players.map(p => p.id)).size).toBe(3);
 });

 it.each(['ADD_BOT', 'REMOVE_BOT'] as const)('%s requires a connected human host, not a foreign, missing, disconnected, or bot actor', type => {
  for (const actor of ['p2', 'missing', 'disconnected', 'bot']) {
   const game = configureBot(lobby(), add);
   const playerId = actor === 'p2' || actor === 'missing' ? actor : 'p1';
   if (actor === 'disconnected') game.players[0].connected = false;
   if (actor === 'bot') game.players[0].isBot = true;
   unchangedRejection(game, { type, playerId, botId: 'p2' }, /Only the creator/);
  }
 });

 it.each(['BLACK_ROSE', 'STUDY', 'PREPARATION', 'ACTION', 'EVOCATION', 'CLEANUP', 'GAME_OVER'] as const)(
  'rejects both roster commands atomically in %s', phase => {
   const game = configureBot(lobby(), add); game.phase = phase;
   unchangedRejection(game, add, /only.*lobby/); unchangedRejection(game, remove, /only.*lobby/);
  });

 it.each(['p1', 'p3', '', 'missing'])('cannot remove the human or nonexistent seat %s', botId => {
  unchangedRejection(configureBot(lobby(), add), { ...remove, botId }, /AI opponent not found/);
 });

 it('rejects a fourth seat on finite Study supply, a physically full room, and exhausted library stock', () => {
  const three = configureBot(configureBot(lobby(), add), add);
  expect(three.players).toHaveLength(3); unchangedRejection(three, add, /Not enough library/);
  unchangedRejection(lobby(4), add, /Room full/);
  const empty = lobby(); empty.removedCards.push(...empty.library[0].cards.splice(0));
  unchangedRejection(empty, add, /Not enough library/);
 });

 it('counts only library draw/discard supply, includes the final four-card choice, and never mutates', () => {
  const game = lobby(), before = structuredClone(game);
  expect([2, 3, 4, 5].map(count => canFitBotRoster(game, count))).toEqual([true, true, false, false]);
  expect(canFitBotRoster(game)).toBe(true); expect(game).toEqual(before);
  game.players[0].hand.push(...game.library[0].cards.splice(19));
  expect(canFitBotRoster(game, 2)).toBe(false); // 2 * (7 + 2) + 2 = 20, not 18 or 19.
  game.library[0].discard.push(game.players[0].hand.pop()!);
  expect(canFitBotRoster(game, 2)).toBe(true);
  game.library[0].discard.push(...game.library[0].cards.splice(0));
  expect(canFitBotRoster(game, 2)).toBe(true);
 });

 it.each([2, 3])('the admitted %s-seat roster really completes first Study from the same physical supply', count => {
  let game = lobby(); while (game.players.length < count) game = configureBot(game, add);
  const history = new ActionHistory();
  for (const p of game.players) {
   game = history.apply(game, { type: 'SELECT_STARTING_SCHOOL', playerId: p.id, schoolId: 'agony' }, p.id);
   game = history.apply(game, { type: 'SET_READY', playerId: p.id, ready: true }, p.id);
  }
  expect(game.phase).toBe('BLACK_ROSE');
  game = history.apply(game, { type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: 'BLACK_ROSE', expectedRound: 1 }, 'p1');
  for (const p of game.players) {
   game = history.apply(game, { type: 'DRAW_STUDY', playerId: p.id, deckId: 'agony' }, p.id);
   game = history.apply(game, { type: 'DISCARD_STUDY', playerId: p.id, cardIds: game.players.find(other => other.id === p.id)!.studyCardIds!.slice(0, 2) }, p.id);
  }
  expect(game.phase).toBe('PREPARATION'); expect(game.players.every(p => p.studyDone && p.hand.length === 4)).toBe(true);
 });
});

describe('paced authoritative BotRunner', () => {
 beforeEach(() => vi.useFakeTimers());
 afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
 function harness(game = battle()) {
  const room = { game, history: new ActionHistory() }, active = vi.fn(() => true), changed = vi.fn();
  const choose = vi.spyOn(policy, 'chooseBotAction');
  const runner = new BotRunner(room, active, changed);
  return { room, active, changed, choose, runner };
 }
 const beat = () => vi.advanceTimersByTime(450);

 it('coalesces repeated broadcast wakes, waits 450ms, and commits only one visible command per beat', () => {
  const h = harness(configureBot(lobby(), add));
  h.changed.mockImplementation(() => h.runner.wake());
  h.runner.wake(); h.runner.wake(); h.runner.wake(); expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(449); expect(h.choose).not.toHaveBeenCalled(); expect(h.changed).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(h.choose).toHaveBeenCalledTimes(1); expect(h.changed).toHaveBeenCalledTimes(1);
  expect(h.room.game.players[1]).toMatchObject({ startingSchoolId: 'agony', ready: false });
  expect(vi.getTimerCount()).toBe(1); beat(); expect(h.room.game.players[1].ready).toBe(true);
  expect(h.changed).toHaveBeenCalledTimes(2); beat(); expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(9000); expect(h.choose).toHaveBeenCalledTimes(3);
 });

 it('auto-starts through history only after human consent, then waits for explicit Pink Tulip continuation', () => {
  const h = harness(configureBot(lobby(), add));
  h.room.game = h.room.history.apply(h.room.game, { type: 'SELECT_STARTING_SCHOOL', playerId: 'p1', schoolId: 'agony' }, 'p1');
  h.room.game = h.room.history.apply(h.room.game, { type: 'SET_READY', playerId: 'p1', ready: true }, 'p1');
  h.runner.wake(); beat(); expect(h.room.game.phase).toBe('LOBBY'); beat();
  expect(h.room.game).toMatchObject({ phase: 'BLACK_ROSE', round: 1 });
  expect(h.room.game.players.map(p => p.personalDeck.length)).toEqual([6, 6]);
  beat(); expect(vi.getTimerCount()).toBe(0); expect(h.changed).toHaveBeenCalledTimes(2);
 });

 it('draws/discards/prepares with real cards while the human controls phase completion and the first turn', () => {
  let game = configureBot(lobby(), add); game.phase = 'STUDY';
  const h = harness(game); h.runner.wake(); beat();
  expect(h.room.game.players[1]).toMatchObject({ studyDrawn: true, studyDone: false });
  beat(); expect(h.room.game.players[1].studyDone).toBe(true); expect(h.room.game.phase).toBe('STUDY');
  beat(); expect(vi.getTimerCount()).toBe(0);
  h.room.game = h.room.history.apply(h.room.game, { type: 'DRAW_STUDY', playerId: 'p1', deckId: 'agony' }, 'p1');
  h.room.game = h.room.history.apply(h.room.game, { type: 'DISCARD_STUDY', playerId: 'p1', cardIds: h.room.game.players[0].studyCardIds!.slice(0, 2) }, 'p1');
  expect(h.room.game.phase).toBe('PREPARATION'); h.runner.wake(); beat();
  expect(h.room.game.players[1].preparationDone).toBe(true); expect(h.room.game.phase).toBe('PREPARATION');
  const own = h.room.game.players[0];
  h.room.game = h.room.history.apply(h.room.game, { type: 'PREPARE_CARDS', playerId: 'p1', preparedCardIds: own.hand.map(c => c.id) }, 'p1');
  expect(h.room.game.phase).toBe('ACTION'); expect(h.room.game.currentPlayerId).toBe('p1');
  beat(); expect(vi.getTimerCount()).toBe(0);
 });

 it('progresses an active movement using fresh authoritative positions on every beat', () => {
  const h = harness(); h.runner.wake(); beat();
  expect(h.room.game.activation?.physicalAction?.kind).toBe('EXPLORE');
  beat(); expect(h.room.game.activation?.exploring).toBe(2);
  const prior = h.room.game; beat();
  expect(h.room.game.players[1].wizard.position).toEqual({ q: 1, r: 0 });
  expect(prior.players[1].wizard.position).toEqual({ q: 0, r: 0 });
  expect(h.choose).toHaveBeenNthCalledWith(3, prior); expect(h.changed).toHaveBeenCalledTimes(3);
 });

 it.each(['SOUL_TITHE', 'REACTIVE_SPELL'] as const)('answers a real out-of-turn %s decision and returns control to the human', kind => {
  const game = battle(); game.currentPlayerId = 'p1'; game.activation!.playerId = 'p1';
  game.players[0].prepared.slot1 = { card: take(game, 'Grim Torment'), used: false };
  if (kind === 'SOUL_TITHE') summonEvocation(game, game.players[1], 'SUCCUBUS', { q: 0, r: 0 });
  else {
   game.readiedSpells!.push({ id: 'bot-torment', playerId: 'p2', card: take(game, 'Torment') });
   game.activeSpellOrder!.push('bot-torment');
  }
  const paused = applyAction(game, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
  expect(paused.pendingDecision).toMatchObject({ kind, playerId: 'p2' });
  const h = harness(paused); h.runner.wake(); beat();
  expect(h.room.game.pendingDecision).toBeFalsy(); expect(h.room.game.currentPlayerId).toBe('p1');
  expect(h.changed).toHaveBeenCalledTimes(1); expect(h.room.history.status(h.room.game, 'p2')).toEqual({ canUndo: false, canRedo: false });
  beat(); expect(vi.getTimerCount()).toBe(0);
 });

 it.each(['BLACK_ROSE', 'CLEANUP', 'human-turn', 'human-decision'] as const)('does not busy-loop while waiting on %s, but a later broadcast can wake it', waiting => {
  const game = battle();
  if (waiting === 'human-turn') { game.currentPlayerId = 'p1'; game.activation!.playerId = 'p1'; }
  else if (waiting === 'human-decision') game.pendingDecision = { kind: 'WAITING', playerId: 'p1', key: 'human' };
  else game.phase = waiting;
  const h = harness(game); h.runner.wake(); beat(); vi.advanceTimersByTime(45000);
  expect(h.choose).toHaveBeenCalledTimes(1); expect(h.changed).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  h.room.game = battle(); h.runner.wake(); beat(); expect(h.changed).toHaveBeenCalledTimes(1);
 });

 it.each(['stopped', 'inactive', 'disconnected', 'game-over', 'no-bots'] as const)('does not commit a queued move after becoming %s', condition => {
  const h = harness(); h.runner.wake(); const before = structuredClone(h.room.game);
  if (condition === 'stopped') { h.runner.stop(); h.runner.stop(); }
  if (condition === 'inactive') h.active.mockReturnValue(false);
  if (condition === 'disconnected') h.room.game.players[0].connected = false;
  if (condition === 'game-over') h.room.game.phase = 'GAME_OVER';
  if (condition === 'no-bots') delete h.room.game.players[1].isBot;
  const latest = structuredClone(h.room.game); vi.advanceTimersByTime(9000);
  expect(h.changed).not.toHaveBeenCalled(); expect(h.room.game).toEqual(latest); expect(vi.getTimerCount()).toBe(0);
  if (condition === 'stopped') { expect(h.choose).not.toHaveBeenCalled(); expect(latest).toEqual(before); h.runner.wake(); beat(); expect(h.changed).toHaveBeenCalledOnce(); }
 });

 it.each(['inactive', 'disconnected', 'game-over', 'no-bots'] as const)('does not even schedule when already %s', condition => {
  const h = harness();
  if (condition === 'inactive') h.active.mockReturnValue(false);
  if (condition === 'disconnected') h.room.game.players[0].connected = false;
  if (condition === 'game-over') h.room.game.phase = 'GAME_OVER';
  if (condition === 'no-bots') delete h.room.game.players[1].isBot;
  h.runner.wake(); expect(vi.getTimerCount()).toBe(0); vi.advanceTimersByTime(9000); expect(h.choose).not.toHaveBeenCalled();
 });

 it('re-evaluates a replaced state at timer fire rather than applying the old bot move to a human turn', () => {
  const h = harness(), original = h.room.game; h.runner.wake();
  const latest = battle(); latest.currentPlayerId = 'p1'; latest.activation!.playerId = 'p1'; h.room.game = latest;
  beat(); expect(h.choose).toHaveBeenCalledTimes(1); expect(h.choose).toHaveBeenCalledWith(latest); expect(h.changed).not.toHaveBeenCalled();
  expect(h.room.game).toBe(latest); expect(original.activation?.actionsUsed).toBe(0); expect(vi.getTimerCount()).toBe(0);
 });

 it('clears human undo and the bot commit itself, so neither player can rewind AI actions', () => {
  const game = battle(); game.currentPlayerId = 'p1'; game.activation!.playerId = 'p1';
  const h = harness(game);
  for (const action of [
   { type: 'EXPLORE', playerId: 'p1' }, { type: 'END_EXPLORE', playerId: 'p1' }, { type: 'END_ACTIVATION', playerId: 'p1' },
  ] as GameAction[]) h.room.game = h.room.history.apply(h.room.game, action, 'p1');
  expect(h.room.game.currentPlayerId).toBe('p2'); expect(h.room.history.status(h.room.game, 'p1').canUndo).toBe(true);
  const clear = vi.spyOn(h.room.history, 'clear'); h.runner.wake(); beat();
  expect(h.changed).toHaveBeenCalledOnce(); expect(clear).toHaveBeenCalled();
  for (const playerId of ['p1', 'p2']) {
   expect(h.room.history.status(h.room.game, playerId)).toEqual({ canUndo: false, canRedo: false });
   for (const type of ['UNDO_ACTION', 'REDO_ACTION'] as const)
    expect(() => h.room.history.apply(h.room.game, { type, playerId }, playerId)).toThrow(/No action available/);
  }
 });

 it('paces a real attack, accounts for damage and tokens, and publishes only cleared history', () => {
  const game = battle(); game.players[0].wizard.position = { q: 0, r: 0 };
  const h = harness(game), before = structuredClone(game);
  h.changed.mockImplementation(() => {
   for (const playerId of ['p1', 'p2'])
    expect(h.room.history.status(h.room.game, playerId)).toEqual({ canUndo: false, canRedo: false });
  });
  h.runner.wake(); vi.advanceTimersByTime(449); expect(h.room.game).toEqual(before);
  vi.advanceTimersByTime(1);
  expect(h.choose.mock.results[0].value).toMatchObject({ type: 'PUNCH', playerId: 'p2', targetId: 'p1' });
  expect(h.room.game.players[0].wizard.damageByPlayer.p2).toBe(2);
  expect(h.room.game.players[1].actionTokens).toBe(1);
  expect(h.room.game.activation?.actionsUsed).toBe(1); expect(h.changed).toHaveBeenCalledTimes(1);
  expect(game).toEqual(before); expect(vi.getTimerCount()).toBe(1);
 });

 it('does not run in an all-bot room when the transport reports no human clients, then resumes on rejoin', () => {
  const game = battle(); game.players[0].isBot = true;
  const h = harness(game), before = structuredClone(game);
  h.active.mockReturnValue(false); h.runner.wake(); vi.advanceTimersByTime(9000);
  expect(vi.getTimerCount()).toBe(0); expect(h.choose).not.toHaveBeenCalled(); expect(h.room.game).toEqual(before);
  h.active.mockReturnValue(true); h.runner.wake(); beat(); expect(h.changed).toHaveBeenCalledTimes(1);
  h.active.mockReturnValue(false); const latest = structuredClone(h.room.game); beat();
  expect(h.changed).toHaveBeenCalledTimes(1); expect(h.room.game).toEqual(latest); expect(vi.getTimerCount()).toBe(0);
 });

 it('does not clear a human redo stack when no bot action is legal', () => {
  const game = battle(); game.currentPlayerId = 'p1'; game.activation!.playerId = 'p1'; const h = harness(game);
  h.room.game = h.room.history.apply(h.room.game, { type: 'EXPLORE', playerId: 'p1' }, 'p1');
  h.room.game = h.room.history.apply(h.room.game, { type: 'UNDO_ACTION', playerId: 'p1' }, 'p1');
  expect(h.room.history.status(h.room.game, 'p1').canRedo).toBe(true);
  h.runner.wake(); beat(); expect(h.changed).not.toHaveBeenCalled(); expect(h.room.history.status(h.room.game, 'p1').canRedo).toBe(true);
 });

 it('logs an invalid policy action once without mutation, broadcast, history loss, or unbounded retry', () => {
  const h = harness(), before = structuredClone(h.room.game), error = vi.spyOn(console, 'error').mockImplementation(() => {});
  h.choose.mockReturnValue({ type: 'SELECT_STARTING_SCHOOL', playerId: 'p2', schoolId: 'missing' });
  const clear = vi.spyOn(h.room.history, 'clear'); h.runner.wake(); vi.advanceTimersByTime(45000);
  expect(error).toHaveBeenCalledTimes(1); expect(h.choose).toHaveBeenCalledTimes(1); expect(h.changed).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled(); expect(h.room.game).toEqual(before); expect(vi.getTimerCount()).toBe(0);
 });
});

describe('saved bot seats', () => {
 it('round-trips real bot/card state, reconnects only humans, and retains the optional legacy human flag', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bot-room-'));
  try {
   const game = battle(); game.players[1].connected = false;
   game.players[1].prepared.slot1 = { card: take(game, 'Submission'), used: false };
   const before = structuredClone(game), store = new SessionStore(join(directory, 'sessions.json'), () => [{ id: 'bots', game }]);
   expect(store.flush()).toEqual(expect.any(String)); const [saved] = store.load();
   expect(game).toEqual(before); expect(saved.game.players.map(p => p.connected)).toEqual([false, true]);
   expect(saved.game.players[0]).not.toHaveProperty('isBot'); expect(saved.game.players[1].isBot).toBe(true);
   expect(saved.game.players[1].prepared.slot1!.card.range).toBe(Infinity);
   const expected = structuredClone(before); expected.players[0].connected = false; expected.players[1].connected = true;
   expect(saved.game).toEqual(expected);
  } finally { rmSync(directory, { recursive: true, force: true }); }
 });
});