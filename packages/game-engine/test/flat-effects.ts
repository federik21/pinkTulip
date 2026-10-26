import { Card, Moment } from '../src/types';
import { momentTotal } from '../src/cards';

// Test shorthand: write printed values as flat fields and get a moments array in
// the engine's legacy resolution order (instability, convert, heal, damage).
export type FlatEffects = { damage?: number; instability?: number; heal?: number; convert?: number };
const order = [['instability', 'INSTABILITY'], ['convert', 'CONVERT'], ['heal', 'HEAL'], ['damage', 'DAMAGE']] as const;

export const flatMoments = (effects: FlatEffects): Moment[] =>
 order.flatMap(([field, effect]) => (effects[field] ?? 0) > 0 ? [{ effect, amount: effects[field]! } as Moment] : []);

export function withMoments<T extends FlatEffects>(changes: T): Omit<T, keyof FlatEffects> & { moments?: Moment[] } {
 const { damage, instability, heal, convert, ...rest } = changes;
 const hasFlat = [damage, instability, heal, convert].some(value => value !== undefined);
 return (hasFlat ? { ...rest, moments: flatMoments({ damage, instability, heal, convert }) } : rest) as never;
}

// Replace selected printed values on an existing card, keeping the others.
export function setPrinted(card: Card, changes: FlatEffects): void {
 card.moments = flatMoments({
  damage: momentTotal(card, 'DAMAGE'), instability: momentTotal(card, 'INSTABILITY'),
  heal: momentTotal(card, 'HEAL'), convert: momentTotal(card, 'CONVERT'), ...changes,
 });
}
