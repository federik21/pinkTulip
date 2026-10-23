import { Card, EventCard, LibraryDeck, Quest } from './types';

export const shuffle = <T>(items: T[]): T[] => {
 const result = [...items];
 for (let i = result.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [result[i], result[j]] = [result[j], result[i]];
 }
 return result;
};

// The 36-card spell set, with unique physical IDs and optional shared-school origin.
export function createSpellDeck(prefix: string, schoolId?: string): Card[] {
 const patterns: Omit<Card, 'id' | 'kind'>[] = [
  { name: 'Ember Lance', damage: 4, instability: 0, range: 1, target: 'MODEL' },
  { name: 'Arcane Bolt', damage: 3, instability: 0, range: 3, target: 'MODEL' },
  { name: 'Splinter Hex', damage: 2, instability: 1, range: 2, target: 'MODEL' },
  { name: 'Fracture', damage: 0, instability: 2, range: 2, target: 'ROOM' },
  { name: 'Firestorm', damage: 2, instability: 1, range: 1, target: 'ROOM' },
  { name: 'Ruin Pulse', damage: 1, instability: 2, range: 0, target: 'ROOM' },
  { name: 'Distant Tremor', damage: 0, instability: 1, range: 4, target: 'ROOM' },
  { name: 'Soul Needle', damage: 2, instability: 0, range: 4, target: 'MODEL' },
  { name: 'Shatter', damage: 3, instability: 1, range: 1, target: 'MODEL' },
  { name: 'Nova', damage: 3, instability: 0, range: 0, target: 'ROOM' },
  { name: 'Withering Mist', damage: 1, instability: 1, range: 3, target: 'ROOM' },
  { name: 'Cataclysm', damage: 4, instability: 2, range: 0, target: 'ROOM' },
 ];
 return Array.from({ length: 36 }, (_, i) => ({ ...patterns[i % patterns.length], id: `${prefix}-${i + 1}`, kind: 'SPELL', ...(schoolId ? {schoolId} : {}) }));
}

export function createLibrary(): LibraryDeck[] {
 return [{ id: 'cantrip', name: 'Cantrip', cards: shuffle(createSpellDeck('cantrip', 'cantrip')), discard: [] }];
}

// A finite, separate supply. These original spells never recycle into a discard.
export function createPowerfulDeck(): Card[] {
 const patterns: Omit<Card,'id'|'kind'>[] = [
  {name:'Rosefall',damage:6,instability:3,range:3,target:'ROOM'},
  {name:'Sovereign Wrath',damage:8,instability:1,range:4,target:'MODEL'},
  {name:'Worldbreaker',damage:4,instability:4,range:2,target:'ROOM'},
 ];
 return shuffle(Array.from({length:12},(_,i)=>({...patterns[i%patterns.length],id:`powerful-${i+1}`,kind:'SPELL' as const,powerful:true})));
}

export function createEvents(): EventCard[] {
 return shuffle(Array.from({ length: 12 }, (_, i) => i % 2 === 0
  ? { id: `event-${i}`, name: 'The Lodge Trembles', description: 'Place 1–2 Black Rose instability in two random unfinished rooms.', kind: 'INSTABILITY' as const, amount: 1 + (i % 3 === 0 ? 1 : 0), rooms: 2 }
  : { id: `event-${i}`, name: 'Thorns of the Black Rose', description: 'Every mage suffers black damage. No player receives kill credit.', kind: 'BLACK_DAMAGE' as const, amount: i % 3 === 0 ? 2 : 1, rooms: 0 }));
}

export function createQuests(): Quest[] {
 const patterns: Omit<Quest, 'id'>[] = [
  { name: 'Duelist', description: 'Defeat another mage.', kind: 'KILL', amount: 1, reward: 3 },
  { name: 'Architect of Ruin', description: 'Place the final instability cube in a room.', kind: 'REBUILD', amount: 1, reward: 3 },
  { name: 'Fracture the Lodge', description: 'Place at least 2 instability in one room with a single spell.', kind: 'INSTABILITY', amount: 2, reward: 2 },
 ];
 return shuffle(Array.from({ length: 24 }, (_, i) => ({ ...patterns[i % 3], id: `quest-${i}` })));
}