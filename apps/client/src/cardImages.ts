import type { Card } from '@brw/game-engine';
import { matchCardImageKey, normalizeCardName } from './cardMatch';

// Card scans live in src/assets/cards. `thumb` is sized for in-page display, `large` for the hover preview.
const thumbs = import.meta.glob('./assets/cards/thumb/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const larges = import.meta.glob('./assets/cards/large/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const fileKey = (path: string): string => normalizeCardName(path.replace(/^.*\//, '').replace(/\.jpg$/i, ''));

type CardImage = { thumb: string; large: string };
const index = new Map<string, CardImage>();
for (const [path, url] of Object.entries(thumbs)) index.set(fileKey(path), { thumb: url, large: url });
for (const [path, url] of Object.entries(larges)) {
 const entry = index.get(fileKey(path));
 if (entry) entry.large = url;
}
const keys = [...index.keys()];
const cache = new Map<string, CardImage | null>();

/** Mage personal spells and Forgotten (forbidden) spells keep their text rendering for now. */
export function cardUsesImage(card: Card): boolean {
 return !card.powerful && !card.schoolId?.startsWith('mage-');
}

export function getCardImage(card: Card): CardImage | undefined {
 if (!cardUsesImage(card)) return undefined;
 let found = cache.get(card.name);
 if (found === undefined) {
  const key = matchCardImageKey(card.name, keys);
  found = key ? index.get(key) ?? null : null;
  cache.set(card.name, found);
 }
 return found ?? undefined;
}
