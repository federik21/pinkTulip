import { describe, expect, it } from 'vitest';
import { createGame, summonEvocation } from '@brw/game-engine';
import type { GameAction, GameState } from '@brw/game-engine';
import { ActionHistory } from '../src/action-history';
import { publicState } from '../src/public-state';

function fixture(): GameState {
 const game = createGame(2);
 game.phase = 'EVOCATION'; game.round = 1; game.currentPlayerId = 'p1'; game.activation = null;
 for (const p of game.players) { p.connected = true; p.wizard.position = { q:0, r:0 }; p.actionTokens = 0; }
 summonEvocation(game, game.players[0], 'CADAVER', { q:0, r:0 })!.id = 'attacker';
 summonEvocation(game, game.players[1], 'SUCCUBUS', { q:9, r:9 })!.id = 'succ';
 return game;
}
const activate: GameAction = { type:'ACTIVATE_EVOCATION', playerId:'p1', evocationId:'attacker' };
const attack: GameAction = { type:'EVOCATION_ATTACK', playerId:'p1', targetId:'p2' };
const respond = (accept: boolean, playerId = 'p2'): GameAction => ({ type:'RESPOND_SOUL_TITHE', playerId, accept });
const apply = (history: ActionHistory, game: GameState, action: GameAction) => history.apply(game, action, action.playerId);

describe('Soul Tithe prompt and history', () => {
 it('clears undo history while paused and after the answer, in both directions', () => {
  const history = new ActionHistory();
  let game = apply(history, fixture(), activate);
  expect(history.status(game, 'p1').canUndo).toBe(true);
  game = apply(history, game, attack);
  expect(game.pendingDecision?.playerId).toBe('p2');
  for (const viewer of ['p1', 'p2']) expect(history.status(game, viewer)).toEqual({ canUndo:false, canRedo:false });
  expect(() => apply(history, game, { type:'UNDO_ACTION', playerId:'p1' })).toThrow(/Waiting for|No action available/);
  game = apply(history, game, respond(true));
  expect(game.pendingDecision).toBeUndefined();
  for (const viewer of ['p1', 'p2']) expect(history.status(game, viewer)).toEqual({ canUndo:false, canRedo:false });
 });

 it('rejects an answer from the wrong mage without changing the paused state', () => {
  const history = new ActionHistory();
  const paused = apply(history, apply(history, fixture(), activate), attack);
  const before = structuredClone(paused);
  expect(() => apply(history, paused, respond(true, 'p1'))).toThrow(/belongs to another mage/);
  expect(() => history.apply(paused, respond(true), 'p1')).toThrow(/another player/);
  expect(paused).toEqual(before);
 });

 it('shows the prompt to everyone but never exposes the paused action or its answers', () => {
  const history = new ActionHistory();
  const paused = apply(history, apply(history, fixture(), activate), attack);
  expect(paused.pendingDecision?.resume).toBeTruthy();
  for (const viewer of ['p1', 'p2', null]) {
   const visible = publicState(paused, viewer, history);
   expect(visible.pendingDecision).toMatchObject({ kind:'SOUL_TITHE', playerId:'p2', evocationId:'succ', amount:2 });
   expect(visible.pendingDecision).not.toHaveProperty('resume');
  }
  expect(paused.pendingDecision?.resume).toBeTruthy();
 });

 it('blocks the paused mage from other actions while pending and keeps the game paused for disconnects', () => {
  const history = new ActionHistory();
  const paused = apply(history, apply(history, fixture(), activate), attack);
  expect(() => apply(history, paused, { type:'END_EVOCATION', playerId:'p1' })).toThrow(/Waiting for/);
  paused.players[1].connected = false;
  expect(() => apply(history, paused, respond(true))).toThrow(/Join a room first/);
 });
});
