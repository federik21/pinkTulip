import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAction, areAdjacent, createGame } from '@brw/game-engine';
import type { GameAction, GameState } from '@brw/game-engine';
import { ActionHistory } from '../src/action-history';

vi.mock('@brw/game-engine', async importOriginal => {
 const original = await importOriginal<typeof import('@brw/game-engine')>();
 return { ...original, applyAction:vi.fn(original.applyAction) };
});
const original = await vi.importActual<typeof import('@brw/game-engine')>('@brw/game-engine');
afterEach(() => vi.mocked(applyAction).mockImplementation(original.applyAction));

function fixture() {
 const game = createGame(); game.phase = 'ACTION'; game.round = 1; game.currentPlayerId = 'p1';
 game.activation = { playerId:'p1', actionsUsed:0, exploring:0, sequencedSpellUsed:false,
  spellsCast:0, discardedExit:false, roomEffectUsed:false };
 for (const p of game.players) {
  p.connected = true; p.wizard.position = { q:0, r:0 };
  // These tests need nonempty hidden sources, not an implicitly generated deck.
  p.personalDeck.push(...game.library[0].cards.splice(0, 3));
 }
 return game;
}

describe('fail-closed detection of future engine information effects', () => {
 it('keeps a non-draw destination summon undoable when the final movement step leaves a draw room', () => {
  const history = new ActionHistory(); let game = fixture();
  const grey = game.board.rooms.find(room => room.effect === 'SUMMON_CADAVER' &&
   game.board.rooms.some(other => other.effect === 'DRAW_QUEST' && areAdjacent(room.tiles[0], other.tiles[0])))!;
  const draw = game.board.rooms.find(room => room.effect === 'DRAW_QUEST' && areAdjacent(room.tiles[0], grey.tiles[0]))!;
  game.players[0].wizard.position = { ...draw.tiles[0] };
  game.activation!.exploring = 1;
  const initial = structuredClone(game);
  game = history.apply(game, { type:'EXPLORE_STEP', playerId:'p1', destination:{ ...grey.tiles[0] }, activateRoomAtEnd:true }, 'p1');
  const after = structuredClone(game);
  expect(game.evocations).toHaveLength(1); expect(history.status(game, 'p1').canUndo).toBe(true);
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(initial);
  game = history.apply(game, { type:'REDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(after);
 });

 const changes: [string, (game: GameState) => void][] = [
  ['personal draw', game => { game.players[0].hand.push(game.players[0].personalDeck.shift()!); }],
  ['quest draw', game => { game.players[0].additionalQuests.push(game.questDeck.shift()!); }],
  ['held card from a future source', game => { game.players[0].hand.push({ ...game.library[0].cards[0], id:'new-card' }); }],
  ['held quest from a future source', game => { game.players[0].additionalQuests.push({ ...game.questDeck[0], id:'new-quest' }); }],
    ['forgotten draw', game => { game.players[0].hand.push(game.powerfulDeck.shift()!); }],
  ['library draw', game => { game.players[0].hand.push(game.library[0].cards.shift()!); }],
  ['library shuffle', game => { game.library[0].cards.reverse(); }],
  ['personal shuffle', game => { game.players[0].personalDeck.reverse(); }],
  ['quest shuffle', game => { game.questDeck.reverse(); }],
  ['event draw', game => { game.usedEvent = game.eventDeck.shift()!; }],
  ['event discard retrieval', game => { game.eventDiscard.pop(); }],
  ['personal discard retrieval', game => { game.players[0].hand.push(game.players[0].discard.shift()!); }],
  ['library discard retrieval', game => { game.players[0].hand.push(game.library[0].discard.shift()!); }],
  ['quest discard retrieval', game => { game.players[0].additionalQuests.push(game.questDiscard.shift()!); }],
  ['hidden acquisition by another player', game => { game.players[1].hand.push({ ...game.library[0].cards[0], id:'opponent-new-card' }); }],
  ['new hidden preparation', game => { game.players[0].prepared.slot1 = { card:{ ...game.library[0].cards[0], id:'new-prepared' }, used:false }; }],
 ];
 it.each(changes)('clears undo AND redo after successful unlisted %s', (_name, change) => {
  const history = new ActionHistory(); let game = fixture();
  game.players[0].discard.push(game.players[0].personalDeck.shift()!);
  game.library[0].discard.push(game.library[0].cards.shift()!);
  game.questDiscard.push(game.questDeck.shift()!);
  game.eventDiscard.push(game.eventDeck.shift()!);
  const begin: GameAction = { type:'BEGIN_PHYSICAL_ACTION', playerId:'p1', kind:'EXPLORE' };
  game = history.apply(game, begin, 'p1');
  game = history.apply(game, { type:'PERFORM_MOVEMENT', playerId:'p1' }, 'p1');
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1');
  expect(history.status(game, 'p1')).toMatchObject({ canUndo:true, canRedo:true });
  vi.mocked(applyAction).mockImplementationOnce((state, action) => {
   const result = original.applyAction(state, action); change(result); return result;
  });
  game = history.apply(game, { type:'PERFORM_MOVEMENT', playerId:'p1' }, 'p1');
  expect(history.status(game, 'p1')).toEqual({ canUndo:false, canRedo:false });
  expect(() => history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1')).toThrow(/No action available/);
  expect(() => history.apply(game, { type:'REDO_ACTION', playerId:'p1' }, 'p1')).toThrow(/No action available/);
 });

 it('does not clear either stack when engine validation fails, even after partial work on its private clone', () => {
  const history = new ActionHistory(); let game = fixture();
  game = history.apply(game, { type:'BEGIN_PHYSICAL_ACTION', playerId:'p1', kind:'EXPLORE' }, 'p1');
  game = history.apply(game, { type:'PERFORM_MOVEMENT', playerId:'p1' }, 'p1');
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1');
  const before = structuredClone(game), status = history.status(game, 'p1');
  vi.mocked(applyAction).mockImplementationOnce(state => {
   state.players[0].hand.push(state.players[0].personalDeck.shift()!); throw new Error('Rejected after random work');
  });
  expect(() => history.apply(game, { type:'PERFORM_MOVEMENT', playerId:'p1' }, 'p1')).toThrow(/Rejected/);
  expect(game).toEqual(before); expect(history.status(game, 'p1')).toEqual(status);
 });
});