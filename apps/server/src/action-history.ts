import { applyAction, canStartGame, GameRuleError } from '@brw/game-engine';
import type { GameAction, GameState, Hex, PlayerId, RoomEffect } from '@brw/game-engine';

export const HISTORY_LIMIT = 32;
type HistoryStatus = NonNullable<GameState['history']>;
type Entry = { before: GameState; after: GameState; label: string };

// An explicit allowlist makes new engine/phase commands barriers by default.
const labels: Partial<Record<GameAction['type'], string>> = {
 END_ACTIVATION: 'End turn', PASS_ROUND: 'Pass round',
 ACTIVATE_EVOCATION: 'Activate evocation', EVOCATION_STEP: 'Move evocation',
 EVOCATION_ATTACK: 'Evocation attack', END_EVOCATION: 'End evocation',
 BEGIN_PHYSICAL_ACTION: 'Begin physical action', PERFORM_MOVEMENT: 'Begin movement',
 ACTIVATE_ROOM: 'Activate room', SKIP_PHYSICAL_EFFECTS: 'Skip physical effects',
 INFLICT_ATTACK: 'Attack', EXPLORE: 'Explore', EXPLORE_STEP: 'Move mage',
 END_EXPLORE: 'End movement', DISCARD_EXIT: 'Discard to leave', PUNCH: 'Attack',
 CAST_SPELL: 'Cast spell', CAST_POWERFUL_SPELL: 'Cast forgotten spell',
};
const drawEffects = new Set<RoomEffect>(['DRAW_POWERFUL', 'DRAW_GRIMOIRE', 'DRAW_DISCARD', 'DRAW_QUEST']);
const actionPhase = (game: GameState) => game.phase === 'ACTION' || game.phase === 'EVOCATION';

function snapshot(game: GameState): GameState {
 const copy = structuredClone(game);
 // Availability is a projection, never part of authoritative snapshots.
 delete copy.history;
 return copy;
}

function activatesDrawRoom(before: GameState, after: GameState, action: GameAction): boolean {
 let activates = false;
 switch (action.type) {
  case 'ACTIVATE_ROOM': activates = true; break;
  case 'EXPLORE': activates = !!action.activateRoomAtStart; break;
  case 'END_EXPLORE': activates = !!action.activateRoomAtEnd; break;
  case 'EXPLORE_STEP':
   activates = !!action.activateRoomAtEnd && before.activation?.exploring === 1;
   break;
  case 'PUNCH': activates = action.roomEffect === 'START' || action.roomEffect === 'END'; break;
 }
 if (!activates) return false;
 const positions: Hex[] = action.type === 'EXPLORE_STEP' ? [action.destination] : [before, after].flatMap(game => {
  const player = game.players.find(p => p.id === action.playerId);
  return player ? [player.wizard.position] : [];
 });
 // A final step activates its destination, not the room it leaves. For other
 // effects check both sides in case the actor moves/respawns during resolution.
 // Empty sources are still hard barriers.
 return [before, after].some(game => game.board.rooms.some(room =>
  room.effect && drawEffects.has(room.effect) && positions.some(position =>
   room.tiles.some(tile => tile.q === position.q && tile.r === position.r))));
}

type Identified = { id: string };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Ordinary casts and completed quests append to public discards. Removal,
// replacement or rearrangement can be retrieval/recycling, so fail closed.
const onlyAppended = (before: Identified[], after: Identified[]) =>
 before.length <= after.length && before.every((card, index) => same(card, after[index]));

function acquiredHiddenInformation(before: GameState, after: GameState): boolean {
 // Reveals and bound-model expiry expose formerly hidden cards. Check instance
 // UUIDs, not discard changes: a reveal must never be undone for either owner.
 const stillReadied = new Set((after.readiedSpells ?? []).map(active => active.id));
 if ((before.readiedSpells ?? []).some(active => !stillReadied.has(active.id))) return true;
 if (!same(before.eventDeck, after.eventDeck) || !same(before.questDeck, after.questDeck) ||
     !same(before.powerfulDeck, after.powerfulDeck) ||
     !onlyAppended(before.eventDiscard, after.eventDiscard) ||
     !onlyAppended(before.questDiscard, after.questDiscard)) return true;
 if (before.library.length !== after.library.length || before.players.length !== after.players.length) return true;
 for (const deck of before.library) {
  const next = after.library.find(d => d.id === deck.id);
  if (!next || !same(deck.cards, next.cards) || !onlyAppended(deck.discard, next.discard)) return true;
 }
 for (const player of before.players) {
  const next = after.players.find(p => p.id === player.id);
  if (!next || !same(player.personalDeck, next.personalDeck) || !onlyAppended(player.discard, next.discard)) return true;
  const heldCards = (p: typeof player) => [...p.hand, ...Object.values(p.prepared).flatMap(slot => slot ? [slot.card] : [])];
  const heldQuests = (p: typeof player) => [...(p.quest ? [p.quest] : []), ...p.additionalQuests];
  for (const held of [heldCards, heldQuests]) {
   const previous = new Set(held(player).map(card => card.id));
   if (held(next).some(card => !previous.has(card.id))) return true;
  }
 }
 return false;
}

/** Server-only, bounded and deliberately not serializable. Never attach to GameState. */
export class ActionHistory {
 #undo: Entry[] = [];
 #redo: Entry[] = [];
 #owner: PlayerId | null = null;
 #limit: number;

 constructor(limit = HISTORY_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_LIMIT) throw new RangeError('Invalid history limit');
  this.#limit = limit;
 }

 clear(): void {
  this.#undo = [];
  this.#redo = [];
  this.#owner = null;
 }

 status(game: GameState, viewer: PlayerId | null): HistoryStatus {
  const disabled = { canUndo: false, canRedo: false };
  if (!viewer || viewer !== this.#owner || !actionPhase(game) ||
      !game.players.some(p => p.id === viewer && p.connected) || !game.players.every(p => p.connected)) return disabled;
  const undo = this.#undo.at(-1), redo = this.#redo.at(-1);
  const current = undo?.after ?? redo?.before;
  if (!current || current.gameId !== game.gameId || current.round !== game.round || current.phase !== game.phase) return disabled;
  return {
   canUndo: !!undo, canRedo: !!redo,
   ...(undo ? { undoLabel: undo.label } : {}),
   ...(redo ? { redoLabel: redo.label } : {}),
  };
 }

 apply(game: GameState, action: GameAction, authenticatedPlayer: PlayerId): GameState {
  // Also guard this boundary so callers cannot bypass transport ownership/pause checks.
  if (action.playerId !== authenticatedPlayer) throw new GameRuleError('You cannot act for another player');
  if (!game.players.some(p => p.id === authenticatedPlayer && p.connected)) throw new GameRuleError('Join a room first');
  if (game.phase !== 'LOBBY' && !game.players.every(p => p.connected)) {
   throw new GameRuleError('Game paused: waiting for the other mages to reconnect');
  }
  if (action.type === 'UNDO_ACTION' || action.type === 'REDO_ACTION') {
   const undo = action.type === 'UNDO_ACTION';
   const status = this.status(game, authenticatedPlayer);
   if (!(undo ? status.canUndo : status.canRedo)) throw new GameRuleError(`No action available to ${undo ? 'undo' : 'redo'}`);
   const from = undo ? this.#undo : this.#redo, to = undo ? this.#redo : this.#undo;
   const entry = from.at(-1)!;
   const restored = snapshot(undo ? entry.before : entry.after);
   from.pop(); to.push(entry);
   return restored;
  }

    // SELECT_STARTING_SCHOOL and SET_ROOM_COUNT deliberately have no label:
    // lobby configuration and the private initial deal cannot be replayed.
    // Resolve everything before changing history: failed commands are inert,
  // including failed opponent commands and failed/stale phase commands.
  const before = snapshot(game);
  let after = applyAction(before, action);
  if (action.type === 'SET_READY' && canStartGame(after)) {
   after = applyAction(after, { type: 'START_GAME', playerId: after.hostId });
  }
  const label = labels[action.type];
  if (!label || !actionPhase(before) || before.phase !== after.phase || before.round !== after.round ||
      activatesDrawRoom(before, after, action) || acquiredHiddenInformation(before, after)) {
   this.clear();
  } else {
   if (this.#owner !== authenticatedPlayer) this.clear();
   this.#owner = authenticatedPlayer;
   this.#redo = [];
   this.#undo.push({ before, after: snapshot(after), label });
   if (this.#undo.length > this.#limit) this.#undo.shift();
  }
  return after;
 }
}