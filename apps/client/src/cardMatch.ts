export const normalizeCardName = (name: string): string =>
 name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Card names whose scan is titled differently beyond a small typo.
const ALIASES: Record<string, string> = { thornofthorns: 'throneofthorns' };

function distance(a: string, b: string): number {
 let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
 for (let i = 1; i <= a.length; i++) {
  const row = [i];
  for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  previous = row;
 }
 return previous[b.length];
}

/** Exact normalized match, then a close typo, then the shortest file name containing the card name. */
export function matchCardImageKey(name: string, keys: readonly string[]): string | undefined {
 const wanted = ALIASES[normalizeCardName(name)] ?? normalizeCardName(name);
 if (!wanted) return undefined;
 if (keys.includes(wanted)) return wanted;
 const allowed = Math.max(1, Math.floor(wanted.length * 0.2));
 let best: string | undefined;
 let bestDistance = Infinity;
 for (const key of keys) {
  const d = distance(wanted, key);
  if (d <= allowed && d < bestDistance) { best = key; bestDistance = d; }
 }
 if (best) return best;
 return keys.filter(key => key.includes(wanted)).sort((a, b) => a.length - b.length)[0];
}
