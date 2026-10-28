import { addPlayerToLobby, GameRuleError, MAX_MAGES, STARTING_SCHOOL_CARDS } from '@brw/game-engine';
import type { GameAction, GameState } from '@brw/game-engine';
import { chooseBotAction } from './ai';
import { ActionHistory } from './action-history';

// Each Study keeps two library cards, but the last mage still needs four to
// choose from. Do not offer AI rosters the current finite library cannot serve.
export function canFitBotRoster(game: GameState, count = game.players.length + 1): boolean {
 const stock = game.library.reduce((n, deck) => n + deck.cards.length + deck.discard.length, 0);
 return count <= MAX_MAGES && stock >= count * (STARTING_SCHOOL_CARDS + 2) + 2;
}

export function configureBot(game: GameState, action: Extract<GameAction, { type: 'ADD_BOT' | 'REMOVE_BOT' }>): GameState {
 if (game.phase !== 'LOBBY') throw new GameRuleError('AI opponents can only be changed in the lobby');
 if (action.playerId !== game.hostId || !game.players.some(p => p.id === action.playerId && p.connected && !p.isBot))
  throw new GameRuleError('Only the creator can change AI opponents');
 let next: GameState;
 if (action.type === 'ADD_BOT') {
  if (game.players.length >= MAX_MAGES) throw new GameRuleError('Room full (4 mages)');
  if (!canFitBotRoster(game)) throw new GameRuleError('Not enough library spells for another mage with AI in this room');
  next = addPlayerToLobby(game);
  const added = next.players[next.players.length - 1];
  added.isBot = true;
  added.connected = true;
  added.name = `AI Mage ${added.id.slice(1)}`;
  next.log.push(`${added.name} joined as a basic AI opponent.`);
 } else {
  const removed = game.players.find(p => p.id === action.botId && p.isBot);
  if (!removed) throw new GameRuleError('AI opponent not found');
  next = structuredClone(game);
  next.players = next.players.filter(p => p.id !== removed.id);
  next.log.push(`${removed.name} left the lobby.`);
 }
 // Adding/removing an opponent must not start a previously ready human's game.
 for (const player of next.players) player.ready = false;
 return next;
}

export const SLOW_AI_BASE_MS = 600;
export const SLOW_AI_STEP_MS = 1500; // matches client MOMENT_MS

type BotRoom = { game: GameState; history: ActionHistory };

/** One visible command per beat; always re-evaluate the latest authoritative state. */
export class BotRunner {
 private timer: ReturnType<typeof setTimeout> | null = null;
 private nextDelay: number | null = null;
 /** When true, wait long enough after each command for clients to toast every new log line. */
 slow = false;
 constructor(private room: BotRoom, private active: () => boolean, private changed: () => void, private delay = 450) {}

 stop() {
  if (this.timer) clearTimeout(this.timer);
  this.timer = null;
 }

 wake() {
  if (this.timer || !this.active() || !this.room.game.players.some(p => p.isBot) ||
      this.room.game.players.some(p => !p.connected) || this.room.game.phase === 'GAME_OVER') return;
  this.timer = setTimeout(() => {
   this.timer = null;
   if (!this.active() || this.room.game.players.some(p => !p.connected)) return;
   try {
    const action = chooseBotAction(this.room.game);
    if (!action) return; // A human turn, decision or explicit phase continuation.
    const before = this.room.game.log.length;
    this.room.game = this.room.history.apply(this.room.game, action, action.playerId);
    // AI moves are opponent commitments, never a human-accessible undo stack.
    this.room.history.clear();
    this.nextDelay = this.slow ? SLOW_AI_BASE_MS + SLOW_AI_STEP_MS * Math.max(1, this.room.game.log.length - before) : null;
    this.changed();
    this.wake();
   } catch (error) {
    // A faulty policy must not crash the room or enter an unbounded retry loop.
    console.error('AI opponent could not act:', error);
   }
  }, this.slow ? (this.nextDelay ?? SLOW_AI_BASE_MS) : this.delay);
 }
}