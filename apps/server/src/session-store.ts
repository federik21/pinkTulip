import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { upgradeLegacyCards, type GameState } from '@brw/game-engine';

export type SavedRoom = { id: string; savedAt: string; game: GameState };
type SaveFile = { version: 1; rooms: SavedRoom[] };

// Only a started, unfinished battle is worth resuming; lobbies and finished games are not saved.
export const isSavable = (game: GameState) => game.phase !== 'LOBBY' && game.phase !== 'GAME_OVER';

function isSavedRoom(value: unknown): value is SavedRoom {
 if (!value || typeof value !== 'object') return false;
 const { id, game } = value as { id?: unknown; game?: Partial<GameState> | null };
 return typeof id === 'string' && id.length > 0 && id.length <= 48 && !!game && typeof game === 'object'
  && typeof game.phase === 'string' && Array.isArray(game.players) && game.players.length > 0
  && Array.isArray(game.log) && !!game.board && Array.isArray(game.board.rooms);
}

/** Resolves the SAVE_FILE environment value: unset, empty or "off" disables saving. */
export function saveFileFromEnv(value: string | undefined) {
 const trimmed = value?.trim();
 return !trimmed || trimmed.toLowerCase() === 'off' ? null : trimmed;
}

/**
 * Persists running battles to one JSON file so they survive every mage leaving or a server restart.
 * Writes are atomic (temp file then rename) so a crash never leaves a half-written save.
 */
export class SessionStore {
 private timer: ReturnType<typeof setTimeout> | null = null;

 constructor(readonly file: string, private readonly snapshot: () => Omit<SavedRoom, 'savedAt'>[], private readonly delayMs = 250) {}

 /** Human seats reconnect after a restart; AI seats remain server-controlled. */
 load(): SavedRoom[] {
  let raw: string;
  try { raw = readFileSync(this.file, 'utf8'); } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Session store: cannot read ${this.file}: ${(error as Error).message}`);
   return [];
  }
  try {
   const parsed = JSON.parse(raw) as Partial<SaveFile>;
   if (parsed.version !== 1 || !Array.isArray(parsed.rooms)) throw new Error('Unsupported save file format');
   const rooms = parsed.rooms.filter(isSavedRoom).filter(room => isSavable(room.game));
   if (rooms.length !== parsed.rooms.length) console.error(`Session store: skipped ${parsed.rooms.length - rooms.length} invalid saved room(s).`);
   for (const room of rooms) {
    upgradeLegacyCards(room.game);
    for (const player of room.game.players) player.connected = player.isBot === true;
   }
   return rooms;
  } catch (error) {
   // Keep the unreadable file for inspection instead of overwriting it on the next save.
   const backup = `${this.file}.corrupt-${Date.now()}`;
   try { renameSync(this.file, backup); } catch { /* best effort */ }
   console.error(`Session store: ${this.file} is unreadable (${(error as Error).message}); moved to ${backup}.`);
   return [];
  }
 }

 /** Coalesces bursts of changes into one write. */
 schedule() {
  if (this.timer) return;
  this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.delayMs);
 }

 /** Writes immediately and returns the save time, or null when the write failed. */
 flush(): string | null {
  if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  const savedAt = new Date().toISOString();
  const data: SaveFile = { version: 1, rooms: this.snapshot().map(room => ({ ...room, savedAt })) };
  const temp = `${this.file}.tmp`;
  try {
   mkdirSync(dirname(this.file), { recursive: true });
   writeFileSync(temp, JSON.stringify(data));
   renameSync(temp, this.file);
   return savedAt;
  } catch (error) {
   console.error(`Session store: cannot write ${this.file}: ${(error as Error).message}`);
   return null;
  }
 }
}
