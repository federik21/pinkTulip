import { Card, EventCard, LibraryDeck, Moment, MomentEffect, Quest, SpellType } from './types';

// Constructors for each Moment variant, e.g. `moments: [moment.damage(1), moment.damage(1)]`.
export const moment = {
 damage: (amount: number, splash?: { amount?: number; range: number; when: 'AFTER_DEFEAT' }): Moment => ({ effect: 'DAMAGE', amount, ...(splash ? { splash } : {}) }),
 heal: (amount: number): Moment => ({ effect: 'HEAL', amount }),
 convert: (amount: number): Moment => ({ effect: 'CONVERT', amount }),
 blackRoseConvert: (amount: number): Moment => ({ effect: 'BLACK_ROSE_CONVERT', amount }),
 instability: (amount: number): Moment => ({ effect: 'INSTABILITY', amount }),
 pain: (amount: number): Moment => ({ effect: 'PAIN', amount }),
 summon: (kind: 'SUCCUBUS', position: 'CASTER' | 'TARGET' = 'CASTER'): Moment => ({ effect: 'SUMMON', kind, position }),
 activateEvocation: (kind: 'SUCCUBUS'): Moment => ({ effect: 'ACTIVATE_EVOCATION', kind }),
};

export const momentTotal = (card: Pick<Card, 'moments'>, effect: MomentEffect): number =>
 card.moments.reduce((total, m) => (m.effect === effect && 'amount' in m) ? total + m.amount : total, 0);
export const hasMoment = (card: Pick<Card, 'moments'>, effect: MomentEffect): boolean => momentTotal(card, effect) > 0;

export function getSpellType(card:Card):SpellType {
 return card.spellType ?? (card.moments.some(m => m.effect !== 'HEAL' && 'amount' in m && m.amount > 0) ? 'COMBAT' : 'CONTINGENCY');
}

// Saved games written before moments existed carry flat damage/instability/heal/convert
// fields. Rewrite those cards in place, keeping the old fixed resolution order.
export function upgradeLegacyCards(value: unknown): void {
 if (!value || typeof value !== 'object') return;
 if (Array.isArray(value)) { value.forEach(upgradeLegacyCards); return; }
 const node = value as Record<string, unknown>;
 if (node.kind === 'SPELL' && !Array.isArray(node.moments)) {
  const moments: Moment[] = [];
  for (const [field, effect] of [['instability', 'INSTABILITY'], ['convert', 'CONVERT'], ['heal', 'HEAL'], ['damage', 'DAMAGE']] as const) {
   const amount = Number(node[field]);
   if (amount > 0) moments.push({ effect, amount });
   delete node[field];
  }
  node.moments = moments;
 }
 Object.values(node).forEach(upgradeLegacyCards);
}

export const shuffle = <T>(items: T[], random:()=>number = Math.random): T[] => {
 const result = [...items];
 for (let i = result.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [result[i], result[j]] = [result[j], result[i]];
 }
 return result;
};

// The 36-card spell set, with unique physical IDs and optional shared-school origin.
export function createSpellDeck(prefix: string, schoolId?: string): Card[] {
 const patterns: Omit<Card, 'id' | 'kind'>[] = [
  { name: 'Ember Lance', moments: [moment.damage(4)], range: 1, target: 'MODEL' },
  { name: 'Arcane Bolt', moments: [moment.damage(3)], range: 3, target: 'MODEL' },
  { name: 'Splinter Hex', moments: [moment.instability(1), moment.damage(2)], range: 2, target: 'MODEL' },
  { name: 'Fracture', moments: [moment.instability(2)], range: 2, target: 'ROOM' },
  { name: 'Firestorm', moments: [moment.instability(1), moment.damage(2)], range: 1, target: 'ROOM' },
  { name: 'Ruin Pulse', moments: [moment.instability(2), moment.damage(1)], range: 0, target: 'ROOM' },
  { name: 'Distant Tremor', moments: [moment.instability(1)], range: 4, target: 'ROOM' },
  { name: 'Soul Needle', moments: [moment.damage(2)], range: 4, target: 'MODEL' },
  { name: 'Shatter', moments: [moment.instability(1), moment.damage(3)], range: 1, target: 'MODEL' },
  { name: 'Nova', moments: [moment.damage(3)], range: 0, target: 'ROOM' },
  { name: 'Withering Mist', moments: [moment.instability(1), moment.damage(1)], range: 3, target: 'ROOM' },
  { name: 'Cataclysm', moments: [moment.instability(2), moment.damage(4)], range: 0, target: 'ROOM' },
 ];
 return Array.from({ length: 36 }, (_, i) => ({ ...patterns[i % patterns.length], id: `${prefix}-${i + 1}`, kind: 'SPELL', ...(schoolId ? {schoolId} : {}) }));
}

export function createTransmutationDeck(): Card[] {
 const patterns: Omit<Card, 'id' | 'kind' | 'schoolId'>[] = [
  { name: 'Mending Light', target: 'SELF', moments: [moment.heal(3)], range: 0 },
  { name: 'Vital Thread', target: 'MODEL', moments: [moment.heal(2)], range: 2 },
  { name: "Summoner's Balm", target: 'EVOCATION', moments: [moment.heal(2)], range: 3 },
  { name: 'Renewing Word', target: 'MAGE', moments: [moment.heal(3)], range: 2 },
  { name: 'Sanctuary', target: 'ROOM', moments: [moment.heal(2)], range: 1 },
  { name: 'Restorative Tide', target: 'ROOM', moments: [moment.instability(1), moment.heal(1)], range: 2 },
  { name: 'Stolen Sigil', target: 'MODEL', moments: [moment.convert(2)], range: 2 },
  { name: "Mage's Due", target: 'MAGE', moments: [moment.convert(3)], range: 2 },
  { name: 'Reclaimed Servant', target: 'EVOCATION', moments: [moment.convert(2)], range: 3 },
  { name: 'Rewrite the Lodge', target: 'ROOM', moments: [moment.convert(3)], range: 2 },
  { name: "Alchemist's Refuge", target: 'SELF', moments: [moment.convert(1), moment.heal(2)], range: 0 },
  { name: 'Transmuting Surge', target: 'MODEL', moments: [moment.convert(1), moment.damage(1)], range: 2 },
 ];
 return Array.from({ length: 36 }, (_, i) => ({ ...patterns[i % patterns.length], id: `transmutation-${i + 1}`, kind: 'SPELL', schoolId: 'transmutation' }));
}

export function createEnchantmentDeck(): Card[] {
 const patterns: Omit<Card, 'id' | 'kind' | 'schoolId'>[] = [
  { name:'Threshold Snare', spellType:'TRAP', target:'ROOM', moments: [], range:2,
  rulesText:'When an enemy enters a room within range 2, reveal and deal 2 damage to that model.',
   trigger:{event:'ENTER_ROOM',relation:'ENEMY',scope:'BOUND_ROOM'}, triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_MODEL'}] },
  { name:'Spell Leech', spellType:'TRAP', target:'ROOM', moments: [], range:2,
  rulesText:'When an enemy casts in a room within range 2, reveal and deal 2 damage to that caster before its printed effects resolve.',
   trigger:{event:'SPELL_CAST',relation:'ENEMY',scope:'BOUND_ROOM'}, triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_ACTOR'}] },
  { name:'Thorn Retort', spellType:'PROTECTION', target:'SELF', moments: [], range:0,
  rulesText:'When damage is dealt to you, reveal and heal 1 wound before dealing 1 damage back to the attacker.',
   trigger:{event:'DAMAGE_TAKEN',relation:'ENEMY',scope:'BOUND_MODEL'}, triggerEffects:[{effect:'HEAL',amount:1,target:'BOUND_MODEL'},{effect:'DAMAGE',amount:1,target:'EVENT_ACTOR'}] },
  { name:'Mending Ward', spellType:'PROTECTION', target:'MAGE', moments: [], range:2,
  rulesText:'When a mage within range 2 takes damage, reveal and heal that mage 2 wounds. Defeated models cannot be healed.',
   trigger:{event:'DAMAGE_TAKEN',relation:'ANY',scope:'BOUND_MODEL'}, triggerEffects:[{effect:'HEAL',amount:2,target:'BOUND_MODEL'}] },
  { name:"Servant's Safeguard", spellType:'PROTECTION', target:'EVOCATION', moments: [], range:3,
  rulesText:'When an evocation within range 3 takes damage, reveal and heal it 2 wounds. Destroyed models cannot be healed.',
   trigger:{event:'DAMAGE_TAKEN',relation:'ANY',scope:'BOUND_MODEL'}, triggerEffects:[{effect:'HEAL',amount:2,target:'BOUND_MODEL'}] },
  { name:'Hearth Ward', spellType:'PROTECTION', target:'ROOM', moments: [], range:2,
  rulesText:'When an enemy activates a room within range 2, reveal and heal your mage 2 wounds before the room reward.',
   trigger:{event:'ROOM_ACTIVATED',relation:'ENEMY',scope:'BOUND_ROOM'}, triggerEffects:[{effect:'HEAL',amount:2,target:'OWNER'}] },
  { name:'Tripwire', spellType:'TRAP', target:'ROOM', moments: [], range:2,
  rulesText:'When an enemy evocation activates in a room within range 2 or in a room of the same color, reveal and deal 1 damage to it.',
   trigger:{event:'EVOCATION_ACTIVATED',relation:'ENEMY',scope:'BOUND_COLOR'}, triggerEffects:[{effect:'DAMAGE',amount:1,target:'EVENT_MODEL'}] },
  { name:'Cinder Seal', spellType:'TRAP', target:'ROOM', moments: [], range:2,
  rulesText:'When an enemy activates a room within range 2 or in the same color, reveal and place 2 instability in that activated room before its reward.',
   trigger:{event:'ROOM_ACTIVATED',relation:'ENEMY',scope:'BOUND_COLOR'}, triggerEffects:[{effect:'INSTABILITY',amount:2,target:'EVENT_ROOM'}] },
  { name:"Pilgrim's Mark", spellType:'CONTINGENCY', target:'SELF', moments: [], range:0,
   rulesText:'When you enter a different room, convert the live instability there to your color.',
   ongoing:{trigger:{event:'ENTER_ROOM',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'CONVERT',amount:1,target:'EVENT_ROOM'}]} },
  { name:'Thorned Path', spellType:'COMBAT', target:'MAGE', moments: [moment.convert(1)], range:2,
   rulesText:'When a mage within range 2 enters a different room, place 1 instability there in your color.',
   ongoing:{trigger:{event:'ENTER_ROOM',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'INSTABILITY',amount:1,target:'EVENT_ROOM'}]} },
  { name:'Runic Remedy', spellType:'CONTINGENCY', target:'MAGE', moments: [moment.heal(1)], range:2,
   rulesText:'When a mage within range 2 activates a room, heal it before the reward.',
   ongoing:{trigger:{event:'ROOM_ACTIVATED',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'HEAL',amount:1,target:'BOUND_MODEL'}]} },
  { name:'Arcane Feedback', spellType:'COMBAT', target:'MAGE', moments: [moment.damage(1)], range:2,
   rulesText:'Target an enemy mage within range 2, then remain bound. Whenever it casts, it suffers further harm before the printed effects.',
   ongoing:{trigger:{event:'SPELL_CAST',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'DAMAGE',amount:1,target:'EVENT_ACTOR'}]} },
 ];
 return Array.from({length:36},(_,i)=>({...patterns[i%patterns.length],id:`enchantment-${i+1}`,kind:'SPELL',schoolId:'enchantment'}));
}

export function createAgonyDeck(prefix: string, schoolId?: string): Card[] {
 const patterns: Omit<Card, 'id' | 'kind'>[] = [
  { name: 'Shared Torture', moments: [moment.damage(4), moment.convert(1), moment.pain(3)], range: 1, target: 'MODEL' },
  { name: 'Grim Torment', moments: [moment.damage(3), moment.pain(1)], range: 2, target: 'MODEL' },
  { name: 'Cross and Delight', moments: [moment.summon('SUCCUBUS'), moment.pain(1), moment.activateEvocation('SUCCUBUS')], range: 1, target: 'ROOM' },
  { name: 'Torment', spellType: 'TRAP', moments: [moment.damage(2), moment.summon('SUCCUBUS', 'TARGET')], range: Number.POSITIVE_INFINITY, target: 'MAGE',
    rulesText: 'When an enemy mage activates a room, you may reveal this trap at the end of the current moment and choose its target.',
   trigger:{event:'ROOM_ACTIVATED',relation:'ENEMY',scope:'ANY'}, triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_MODEL'},{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_MODEL'}] },
  { name: 'Visceral Fire', moments: [moment.damage(2, { range: 1, when: 'AFTER_DEFEAT' })], range: 2, target: 'MAGE',
   rulesText: 'Target a mage within range 2. If that mage is defeated, each other mage within range 1 of it suffers 2 damage.' },
  { name: 'Peak of Agony', moments: [moment.damage(2), moment.blackRoseConvert(2)], range: 0, target: 'SELF' },
  { name: 'Pain Mark', moments: [], range: 1, target: 'MODEL',
   rulesText: 'When this model takes damage, the acting model suffers 2 damage.',
   ongoing: { trigger: { event: 'DAMAGE_DEALT', relation: 'ANY', scope: 'BOUND_MODEL' }, effects: [{ effect: 'DAMAGE', amount: 2, target: 'EVENT_ACTOR' }] } },
  { name: 'Master of Pleasure', spellType: 'TRAP', moments: [], range: Number.POSITIVE_INFINITY, target: 'MAGE',
   rulesText: 'When a mage solves a quest, reveal and deal 2 damage to them, then summon a Succubus in that room at 0.',
   trigger:{event:'QUEST_SOLVED',relation:'SELF',scope:'BOUND_MODEL'},
   triggerEffects:[{effect:'DAMAGE',amount:2,target:'BOUND_MODEL'},{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'BOUND_MODEL'}] },
  { name: 'Liquefy the Pain', spellType: 'TRAP', moments: [], range: Number.POSITIVE_INFINITY, target: 'ROOM',
   rulesText: 'When a mage is defeated, reveal and summon a Succubus in the target room at 0.',
    trigger:{event:'MAGE_DEFEATED',relation:'SELF',scope:'ANY'}, triggerEffects:[{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'BOUND_ROOM'}] },
  { name: 'Submission', moments: [moment.damage(1), moment.convert(1), moment.pain(1)], range: Number.POSITIVE_INFINITY, target: 'MODEL' },
  { name: 'Ineluctable Pain', spellType: 'CONTINGENCY', moments: [], range: 2, target: 'MODEL',
   rulesText: 'Whenever a model gains or loses victory points, it suffers 2 damage.',
   ongoing:{trigger:{event:'VP_CHANGED',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'DAMAGE',amount:2,target:'EVENT_MODEL'}]} },
  { name: 'Hearth of Ice', moments: [moment.damage(3), moment.convert(2), moment.pain(2)], range: 2, target: 'MODEL' },
 ];
 return Array.from({ length: 36 }, (_, i) => ({ ...patterns[i % patterns.length], id: `${prefix}-${i + 1}`, kind: 'SPELL', ...(schoolId ? {schoolId} : {}) }));
}


export function createLibrary(): LibraryDeck[] {
 return [
  { id: 'agony', name: 'Agony', cards: shuffle(createAgonyDeck('agony', 'agony')), discard: [] },
 ];
}

// A finite, separate supply. These original spells never recycle into a discard.
export function createPowerfulDeck(): Card[] {
 const patterns: Omit<Card,'id'|'kind'>[] = [
  {name:'Rosefall',moments: [moment.instability(3), moment.damage(6)], range:3,target:'ROOM'},
  {name:'Sovereign Wrath',moments: [moment.instability(1), moment.damage(8)], range:4,target:'MODEL'},
  {name:'Worldbreaker',moments: [moment.instability(4), moment.damage(4)], range:2,target:'ROOM'},
 ];
 return shuffle(Array.from({length:12},(_,i)=>({...patterns[i%patterns.length],id:`powerful-${i+1}`,kind:'SPELL' as const,powerful:true})));
}

export function createEvents(): EventCard[] {
 return shuffle(Array.from({ length: 12 }, (_, i) => i % 2 === 0
  ? { id: `event-${i}`, name: 'The Lodge Trembles', description: 'Place 1–2 Pink Tulip instability in two random unfinished rooms.', kind: 'INSTABILITY' as const, amount: 1 + (i % 3 === 0 ? 1 : 0), rooms: 2 }
  : { id: `event-${i}`, name: 'Thorns of the Pink Tulip', description: 'Every mage suffers black damage. No player receives kill credit.', kind: 'BLACK_DAMAGE' as const, amount: i % 3 === 0 ? 2 : 1, rooms: 0 }));
}

export function createQuests(): Quest[] {
 const smallReward = (name: string, moments: Moment[], range = 0, target: Card['target'] = 'SELF'): Card => ({ id: `${name.toLowerCase().replace(/[^a-z]+/g, '-')}-reward`, name, kind: 'SPELL', moments, range, target });
 const patterns: Omit<Quest, 'id'>[] = [
  { name: 'Duelist', description: 'Defeat another mage.', kind: 'KILL', amount: 1, reward: 3, rewardAction: smallReward('Final Flourish', [moment.damage(2)], 1, 'MODEL') },
  { name: 'Architect of Ruin', description: 'Place the final instability cube in a room.', kind: 'REBUILD', amount: 1, reward: 3, rewardAction: smallReward('Ruin Sigil', [moment.instability(1)], 2, 'ROOM') },
  { name: 'Fracture the Lodge', description: 'Place at least 2 instability in one room with a single spell.', kind: 'INSTABILITY', amount: 2, reward: 2, rewardAction: smallReward('Crack the Wall', [moment.damage(1)], 2, 'MODEL') },
  { name: 'Warden of the Rooms', description: 'Activate 3 rooms.', kind: 'ROOM_ACTIVATE', amount: 3, reward: 2, progress: 0, completed: false, rewardAction: smallReward('Lodge Blessing', [moment.heal(2)], 0, 'SELF') },
 ];
 return shuffle(Array.from({ length: 24 }, (_, i) => ({ ...patterns[i % patterns.length], id: `quest-${i}`, progress: 0, completed: false, claimed: false })));
}