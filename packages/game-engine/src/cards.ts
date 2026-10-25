import { Card, EventCard, LibraryDeck, Quest, SpellType } from './types';

export function getSpellType(card:Card):SpellType {
 return card.spellType ?? (card.damage>0 || card.instability>0 || (card.convert??0)>0 ? 'COMBAT' : 'CONTINGENCY');
}

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

export function createTransmutationDeck(): Card[] {
 const patterns: Omit<Card, 'id' | 'kind' | 'schoolId'>[] = [
  { name: 'Mending Light', target: 'SELF', heal: 3, damage: 0, instability: 0, range: 0 },
  { name: 'Vital Thread', target: 'MODEL', heal: 2, damage: 0, instability: 0, range: 2 },
  { name: "Summoner's Balm", target: 'EVOCATION', heal: 2, damage: 0, instability: 0, range: 3 },
  { name: 'Renewing Word', target: 'MAGE', heal: 3, damage: 0, instability: 0, range: 2 },
  { name: 'Sanctuary', target: 'ROOM', heal: 2, damage: 0, instability: 0, range: 1 },
  { name: 'Restorative Tide', target: 'ROOM', heal: 1, damage: 0, instability: 1, range: 2 },
  { name: 'Stolen Sigil', target: 'MODEL', convert: 2, damage: 0, instability: 0, range: 2 },
  { name: "Mage's Due", target: 'MAGE', convert: 3, damage: 0, instability: 0, range: 2 },
  { name: 'Reclaimed Servant', target: 'EVOCATION', convert: 2, damage: 0, instability: 0, range: 3 },
  { name: 'Rewrite the Lodge', target: 'ROOM', convert: 3, damage: 0, instability: 0, range: 2 },
  { name: "Alchemist's Refuge", target: 'SELF', heal: 2, convert: 1, damage: 0, instability: 0, range: 0 },
  { name: 'Transmuting Surge', target: 'MODEL', damage: 1, convert: 1, instability: 0, range: 2 },
 ];
 return Array.from({ length: 36 }, (_, i) => ({ ...patterns[i % patterns.length], id: `transmutation-${i + 1}`, kind: 'SPELL', schoolId: 'transmutation' }));
}

export function createEnchantmentDeck(): Card[] {
 const patterns: Omit<Card, 'id' | 'kind' | 'schoolId'>[] = [
  { name:'Threshold Snare', spellType:'TRAP', target:'ROOM', damage:0, instability:0, range:2,
  rulesText:'Activate secretly in a room within range 2. When an enemy enters it, reveal and deal 2 damage to that model.',
   trigger:{event:'ENTER_ROOM',relation:'ENEMY',scope:'BOUND_ROOM'}, triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_MODEL'}] },
  { name:'Spell Leech', spellType:'TRAP', target:'ROOM', damage:0, instability:0, range:2,
  rulesText:'Activate secretly in a room within range 2. When an enemy casts there, reveal and deal 2 damage to the caster before its printed effects.',
   trigger:{event:'SPELL_CAST',relation:'ENEMY',scope:'BOUND_ROOM'}, triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_ACTOR'}] },
  { name:'Thorn Retort', spellType:'PROTECTION', target:'SELF', damage:0, instability:0, range:0,
  rulesText:'Activate secretly on yourself. After enemy damage, reveal, heal 1 wound, then deal 1 damage to the attacking model.',
   trigger:{event:'DAMAGE_TAKEN',relation:'ENEMY',scope:'BOUND_MODEL'}, triggerEffects:[{effect:'HEAL',amount:1,target:'BOUND_MODEL'},{effect:'DAMAGE',amount:1,target:'EVENT_ACTOR'}] },
  { name:'Mending Ward', spellType:'PROTECTION', target:'MAGE', damage:0, instability:0, range:2,
  rulesText:'Activate secretly on any mage within range 2. After it takes damage, reveal and heal 2 wounds. Defeated models cannot be healed.',
   trigger:{event:'DAMAGE_TAKEN',relation:'ANY',scope:'BOUND_MODEL'}, triggerEffects:[{effect:'HEAL',amount:2,target:'BOUND_MODEL'}] },
  { name:"Servant's Safeguard", spellType:'PROTECTION', target:'EVOCATION', damage:0, instability:0, range:3,
  rulesText:'Activate secretly on any evocation within range 3. After it takes damage, reveal and heal 2 wounds. Destroyed models cannot be healed.',
   trigger:{event:'DAMAGE_TAKEN',relation:'ANY',scope:'BOUND_MODEL'}, triggerEffects:[{effect:'HEAL',amount:2,target:'BOUND_MODEL'}] },
  { name:'Hearth Ward', spellType:'PROTECTION', target:'ROOM', damage:0, instability:0, range:2,
  rulesText:'Activate secretly in a room within range 2. When an enemy activates it, reveal and heal your mage 2 wounds before the room reward.',
   trigger:{event:'ROOM_ACTIVATED',relation:'ENEMY',scope:'BOUND_ROOM'}, triggerEffects:[{effect:'HEAL',amount:2,target:'OWNER'}] },
  { name:'Tripwire', spellType:'TRAP', target:'ROOM', damage:0, instability:0, range:2,
  rulesText:'Activate secretly in a room within range 2. When an enemy evocation activates in that room or any other room of its color, reveal and deal 1 damage to it.',
   trigger:{event:'EVOCATION_ACTIVATED',relation:'ENEMY',scope:'BOUND_COLOR'}, triggerEffects:[{effect:'DAMAGE',amount:1,target:'EVENT_MODEL'}] },
  { name:'Cinder Seal', spellType:'TRAP', target:'ROOM', damage:0, instability:0, range:2,
  rulesText:'Activate secretly in a room within range 2. When an enemy activates that room or any other room of its color, reveal and place 2 instability in the activated room before its reward.',
   trigger:{event:'ROOM_ACTIVATED',relation:'ENEMY',scope:'BOUND_COLOR'}, triggerEffects:[{effect:'INSTABILITY',amount:2,target:'EVENT_ROOM'}] },
  { name:"Pilgrim's Mark", spellType:'CONTINGENCY', target:'SELF', damage:0, instability:0, range:0,
   rulesText:'Bind to yourself. Whenever you enter a different room, convert 1 of its live instability cubes to your color.',
   ongoing:{trigger:{event:'ENTER_ROOM',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'CONVERT',amount:1,target:'EVENT_ROOM'}]} },
  { name:'Thorned Path', spellType:'COMBAT', target:'MAGE', damage:0, instability:0, convert:1, range:2,
   rulesText:'Convert 1 damage cube on any mage within range 2, then remain bound. Whenever it enters a different room, place 1 instability there in your color.',
   ongoing:{trigger:{event:'ENTER_ROOM',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'INSTABILITY',amount:1,target:'EVENT_ROOM'}]} },
  { name:'Runic Remedy', spellType:'CONTINGENCY', target:'MAGE', damage:0, instability:0, heal:1, range:2,
   rulesText:'Heal any mage within range 2 by 1, then remain bound. Whenever that mage activates a room, heal it by 1 before the reward.',
   ongoing:{trigger:{event:'ROOM_ACTIVATED',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'HEAL',amount:1,target:'BOUND_MODEL'}]} },
  { name:'Arcane Feedback', spellType:'COMBAT', target:'MAGE', damage:1, instability:0, range:2,
   rulesText:'Deal 1 damage to an enemy mage within range 2, then remain bound. Whenever it casts, deal 1 damage to it before the printed effects.',
   ongoing:{trigger:{event:'SPELL_CAST',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'DAMAGE',amount:1,target:'EVENT_ACTOR'}]} },
 ];
 return Array.from({length:36},(_,i)=>({...patterns[i%patterns.length],id:`enchantment-${i+1}`,kind:'SPELL',schoolId:'enchantment'}));
}

export function createLibrary(): LibraryDeck[] {
 return [
  { id: 'cantrip', name: 'Cantrip', cards: shuffle(createSpellDeck('cantrip', 'cantrip')), discard: [] },
  { id: 'transmutation', name: 'Transmutation', cards: shuffle(createTransmutationDeck()), discard: [] },
  { id: 'enchantment', name: 'Enchantment', cards: shuffle(createEnchantmentDeck()), discard: [] },
 ];
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
  ? { id: `event-${i}`, name: 'The Lodge Trembles', description: 'Place 1–2 (not) Black Rose instability in two random unfinished rooms.', kind: 'INSTABILITY' as const, amount: 1 + (i % 3 === 0 ? 1 : 0), rooms: 2 }
  : { id: `event-${i}`, name: 'Thorns of the (not) Black Rose', description: 'Every mage suffers black damage. No player receives kill credit.', kind: 'BLACK_DAMAGE' as const, amount: i % 3 === 0 ? 2 : 1, rooms: 0 }));
}

export function createQuests(): Quest[] {
 const patterns: Omit<Quest, 'id'>[] = [
  { name: 'Duelist', description: 'Defeat another mage.', kind: 'KILL', amount: 1, reward: 3 },
  { name: 'Architect of Ruin', description: 'Place the final instability cube in a room.', kind: 'REBUILD', amount: 1, reward: 3 },
  { name: 'Fracture the Lodge', description: 'Place at least 2 instability in one room with a single spell.', kind: 'INSTABILITY', amount: 2, reward: 2 },
 ];
 return shuffle(Array.from({ length: 24 }, (_, i) => ({ ...patterns[i % 3], id: `quest-${i}` })));
}