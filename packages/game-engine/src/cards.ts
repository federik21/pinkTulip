import { Card, DarkSide, Effect, PhysicalEffect, PhysicalMoment, Element, EvocationKind, EventCard, GameState, JinxName, LibraryDeck, Moment, MomentEffect, Player, Quest, SpellSide, SpellType, TriggerCondition, UpgradeName } from './types';

export const ELEMENTS: readonly Element[] = ['air', 'fire', 'water', 'earth', 'evil', 'good', 'stars', 'wild'];
export const ELEMENT_GLYPHS: Readonly<Record<Element, string>> = { air: '🜁', fire: '🜂', water: '🜄', earth: '🜃', evil: '☠', good: '✚', stars: '★', wild: '✦' };

// Side symbols shown by the caster's OTHER revealed spells: prepared spells already resolved this round,
// except hidden Trap/Protection cards that are still face down.
export function getRevealedElements(s: Pick<GameState, 'readiedSpells'>, p: Pick<Player, 'id' | 'prepared'>, current: Card): Element[] {
 const hidden = new Set((s.readiedSpells ?? []).filter(a => a.playerId === p.id).map(a => a.card.id));
 return Object.values(p.prepared)
  .filter(x => !!x && x.used && x.card.id !== current.id && !hidden.has(x.card.id))
  .flatMap(x => {
   const element=x!.side==='DARK'?x!.card.darkSide?.element:x!.card.element;
   return element?[element]:[];
  });
}

// Wild symbols stand in for any single missing symbol.
export function meetsEnhancement(requires: Element[], shown: Element[]): boolean {
 const have = (e: Element) => shown.filter(x => x === e).length;
 const wilds = have('wild');
 let missing = 0;
 for (const e of new Set(requires)) missing += Math.max(0, requires.filter(r => r === e).length - (e === 'wild' ? 0 : have(e)));
 return missing <= wilds;
}

export function isEnhanced(s: Pick<GameState, 'readiedSpells'>, p: Pick<Player, 'id' | 'prepared'>, card: Card): boolean {
 return !!card.enhancement && meetsEnhancement(card.enhancement.requires, getRevealedElements(s, p, card));
}

// The card as it resolves: with the enhancement merged in when its condition is met.
export function getEffectiveSpell(s: Pick<GameState, 'readiedSpells'>, p: Pick<Player, 'id' | 'prepared'>, card: Card): Card {
 if (!card.enhancement || !isEnhanced(s, p, card)) return card;
 const { enhancement, ...rest } = card;
 const extra = enhancement.moments ?? [];
 // The enhancement adds Moments to the MAIN Effect; the PLACE Effect is untouched.
 const main = getMainMoments(card);
 const moments = enhancement.position === 'AFTER' ? [...main, ...extra] : [...extra, ...main];
 return {
  ...rest,
  effects: [...card.effects.filter(effect => effect.kind === 'PLACE'), ...(moments.length ? [{ kind: 'MAIN' as const, moments }] : [])],
  target: enhancement.target ?? card.target,
  range: enhancement.range ?? card.range,
  ...(enhancement.suppressReactions ? { suppressReactions: true } : {}),
 };
}

// Every spell card has two sides: the light side (the printed card data) and the dark side. They share only the
// card's name and its PLACE (instability) Effect. Dark sides are placeholders for now: they target the caster,
// have no moments and so resolve nothing beyond the shared instability.
export const DARK_SIDE_PLACEHOLDER: DarkSide = { moments: [], range: 0, target: 'SELF', rulesText: 'No effect yet.' };
export const getDarkSide = (card: Pick<Card, 'darkSide'>): DarkSide => card.darkSide ?? DARK_SIDE_PLACEHOLDER;

// The card as it resolves when its dark side is cast. The shared PLACE Effect is kept; every light-side
// property (reactive trigger, ongoing, enhancement, filters, type) is dropped.
export function getDarkSideSpell(card: Card): Card {
 const { enhancement, trigger, triggerTarget, triggerSight, triggerText, triggerEffects, targetFrom, targetFilter, suppressReactions, ongoing, spellType, rulesText, darkSide, element: lightElement, ...shared } = card;
 void lightElement;
 const dark = getDarkSide(card);
 return {
  ...shared,
  effects: [...card.effects.filter(effect => effect.kind === 'PLACE'), ...mainEffects(dark.moments)],
  range: dark.range,
  target: dark.target,
  spellType: dark.spellType ?? 'CONTINGENCY',
  ...(dark.targetFilter ? { targetFilter: dark.targetFilter } : {}),
  ...(dark.trigger ? { trigger: dark.trigger } : {}),
  ...(dark.triggerTarget ? { triggerTarget: dark.triggerTarget } : {}),
  ...(dark.triggerText ? { triggerText: dark.triggerText } : {}),
  ...(dark.triggerEffects ? { triggerEffects: dark.triggerEffects } : {}),
  ...(dark.ongoing ? { ongoing: dark.ongoing } : {}),
  ...(dark.enhancement ? { enhancement: dark.enhancement } : {}),
  ...(dark.element?{element:dark.element}:{}),
  ...(dark.rulesText ? { rulesText: dark.rulesText } : {}),
 };
}

// The card as it resolves for the chosen side. Reactive cards resolve as printed; others merge their enhancement
// (each side has its own) when the other revealed spells show the required symbols.
export function getSpellForSide(s: Pick<GameState, 'readiedSpells'>, p: Pick<Player, 'id' | 'prepared'>, card: Card, side: SpellSide = 'LIGHT'): Card {
 const face = side === 'DARK' ? getDarkSideSpell(card) : card;
 return ['TRAP', 'PROTECTION'].includes(getSpellType(face)) ? face : getEffectiveSpell(s, p, face);
}

const peakOfAgonyMoments=():Moment[]=>[
 {effect:'DAMAGE',amount:2},
 {effect:'BLACK_ROSE_CONVERT',amount:2,scope:'CASTER'},
 {effect:'PAIN',amount:2},
];
const peakOfAgonyRules='';
const painMarkRules='Ongoing: inflict 2 damage on the target model whenever it deals damage with its own mage physical attack or spell. Evocation attacks, room effects and quest rewards do not trigger Pain Mark.';
const liquefyThePainEffects=():NonNullable<Card['triggerEffects']>=>[
 {effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_ROOM'},
 {effect:'ACTIVATE_EVOCATION',kind:'SUCCUBUS',target:'EVENT_ROOM'},
];

// Constructors for each Moment variant, e.g. `effects: mainEffects([moment.damage(1), moment.damage(1)]`.
export const moment = {
 damage: (amount: number): Moment => ({ effect: 'DAMAGE', amount }),
 heal: (amount: number): Moment => ({ effect: 'HEAL', amount }),
 convert: (amount: number): Moment => ({ effect: 'CONVERT', amount }),
 blackRoseConvert: (amount: number): Moment => ({ effect: 'BLACK_ROSE_CONVERT', amount }),
 instability: (amount: number): Moment => ({ effect: 'INSTABILITY', amount }),
 pain: (amount: number): Moment => ({ effect: 'PAIN', amount }),
 summon: (kind: EvocationKind, position: 'CASTER' | 'TARGET' = 'CASTER'): Moment => ({ effect: 'SUMMON', kind, position }),
 activateEvocation: (kind: EvocationKind): Moment => ({ effect: 'ACTIVATE_EVOCATION', kind }),
 assignUpgrade: (upgrade: UpgradeName | 'RANDOM' | 'CHOICE', to?: 'SUMMONED'): Moment => ({ effect: 'ASSIGN_UPGRADE', upgrade, ...(to ? { to } : {}) }),
 activateTarget: (): Moment => ({ effect: 'ACTIVATE_TARGET' }),
 // Modifiers: wrap any moment, e.g. `moment.ifTargetDefeated(moment.nearTarget(moment.damage(1), 1))`.
 ifTargetDefeated: (step: Moment): Moment => ({ ...step, when: 'TARGET_DEFEATED' }),
 ifUpgraded: (step: Moment): Moment => ({ ...step, when: 'UPGRADE_ASSIGNED' }),
 ifRemoved: (step: Moment): Moment => ({ ...step, when: 'EVOCATION_REMOVED' }),
 inTargetRoom: (step: Moment): Moment => ({ ...step, scope: 'TARGET_ROOM' }),
 inCasterRoom: (step: Moment): Moment => ({ ...step, scope: 'CASTER_ROOM' }),
 nearTarget: (step: Moment, range: number): Moment => ({ ...step, area: { range } }),
};

// Builders for `Card.effects`. An unstable card has a PLACE 1 Effect that resolves before its MAIN Effect.
export const PLACE_ONE_INSTABILITY: Moment = { effect: 'INSTABILITY', amount: 1, scope: 'CASTER_ROOM' };
export const placeEffect = (): Effect => ({ kind: 'PLACE', moments: [PLACE_ONE_INSTABILITY] });
export const mainEffects = (moments: Moment[]): Effect[] => moments.length ? [{ kind: 'MAIN', moments }] : [];
export const unstableEffects = (moments: Moment[]): Effect[] => [placeEffect(), ...mainEffects(moments)];
export const getSpellEffects = (card: Pick<Card, 'effects'>): Effect[] => card.effects;
export const getMainMoments = (card: Pick<Card, 'effects'>): Moment[] => card.effects.filter(effect => effect.kind === 'MAIN').flatMap(effect => effect.moments);
export const isUnstable = (card: Pick<Card, 'effects'>): boolean => card.effects.some(effect => effect.kind === 'PLACE');
export const getAllMoments = (card: Pick<Card, 'effects'>): Moment[] => card.effects.flatMap(effect => effect.moments);
// Physical actions are Effects too. A defeat interrupts and cancels Explore and Attack (they never resume).
export const getPhysicalEffect = (kind: 'EXPLORE' | 'ATTACK', movement: number): PhysicalEffect => ({
 kind,
 moments: kind === 'EXPLORE'
  ? [...Array.from({ length: Math.max(0, movement) }, (): PhysicalMoment => ({ moment: 'MOVE', distance: 1 })), { moment: 'ACTIVATE_ROOM' }]
  : [{ moment: 'ATTACK' }, { moment: 'ACTIVATE_ROOM' }],
 resumeAfterDefeat: false,
});

// Printed totals cover every Effect of the card, the PLACE Effect included.
export const momentTotal = (card: Pick<Card, 'effects'>, effect: MomentEffect): number =>
 getAllMoments(card).reduce((total, m) => (m.effect === effect && 'amount' in m) ? total + (m.amount ?? 0) : total, 0);
export const hasMoment = (card: Pick<Card, 'effects'>, effect: MomentEffect): boolean => momentTotal(card, effect) > 0;
// The Summon keyword: either face of the card summons an evocation.
const summonsEvocation = (moments?: readonly { effect: string }[]): boolean => !!moments?.some(step => step.effect === 'SUMMON');
export function hasSummonKeyword(card: Card): boolean {
 const dark = getDarkSide(card);
 return [getAllMoments(card), card.triggerEffects, card.ongoing?.effects, card.enhancement?.moments, dark.moments, dark.triggerEffects, dark.ongoing?.effects, dark.enhancement?.moments].some(summonsEvocation);
}

export function getSpellType(card:Card):SpellType {
 return card.spellType ?? (getAllMoments(card).some(m => m.effect !== 'HEAL' && 'amount' in m && (m.amount ?? 0) > 0) ? 'COMBAT' : 'CONTINGENCY');
}

// Generic fallback copy deliberately avoids inventing a binding, range or effect.
function describeTrigger(condition:TriggerCondition):string {
 const subject=(kind:'model'|'mage'|'evocation')=>condition.relation==='SELF'
  ? kind==='mage'?'your mage':`one of your ${kind}s`
  : condition.relation==='ENEMY'
   ? kind==='mage'?'another mage':`an enemy ${kind}`
   : `${kind==='evocation'?'an':'a'} ${kind}`;
 switch(condition.event) {
  case 'ENTER_ROOM':return `When ${subject('model')} enters a room`;
  case 'DAMAGE_TAKEN':return condition.relationTo==='EVENT_MODEL'
   ? `When ${subject('model')} takes damage`
   : condition.relation==='ANY'?'When a model takes damage':`When a model takes damage from ${subject('model')}`;
  case 'DAMAGE_DEALT':return `When ${subject('model')} deals damage`;
  case 'SPELL_CAST':return `When ${subject('mage')} casts a spell`;
  case 'SPELL_TARGETED':return `When a combat spell targets ${subject('model')}`;
  case 'ROOM_ACTIVATED':return `When ${subject('mage')} activates a room`;
  case 'EVOCATION_ACTIVATED':return `When ${subject('evocation')} activates`;
  case 'MAGE_ATTACK':return condition.relationTo==='EVENT_MODEL'&&condition.relation!=='ANY'
   ? `When a mage attacks ${subject('model')}`:`When ${subject('mage')} attacks`;
  case 'EVOCATION_ATTACK':return condition.relationTo==='EVENT_MODEL'&&condition.relation!=='ANY'
   ? `When an evocation attacks ${subject('model')}`:`When ${subject('evocation')} attacks`;
  case 'QUEST_SOLVED':return `When ${subject('mage')} solves a quest`;
  case 'MAGE_DEFEATED':return condition.relationTo==='EVENT_MODEL'||condition.relation==='ANY'
   ? condition.relation==='SELF'?'When you are defeated':`When ${subject('mage')} is defeated`
   : `When ${subject('mage')} defeats a mage`;
  case 'VP_CHANGED':return `When ${subject('model')} gains or loses victory points`;
  case 'EVOCATION_LOST':return `When ${subject('evocation')} is defeated or removed`;
  case 'CUBE_PLACED':return `When ${subject('mage')} places a cube in a room`;
 }
}

// Keep legacy rules intact on the card; only the returned reactive body omits
// its leading trigger clause. Ongoing and other nonreactive prose is untouched.
export function getSpellDescription(card:Card):{triggerText?:string;rulesText?:string} {
 const type=getSpellType(card);
 if(type!=='TRAP'&&type!=='PROTECTION')return {rulesText:card.rulesText};
 const clause=card.rulesText?.match(/^\s*((?:When|Whenever)\s+[^,\s][^,]*),\s*([\s\S]*)$/i);
 const triggerText=card.triggerText?.trim()||clause?.[1].trim()||(card.trigger?describeTrigger(card.trigger):undefined);
 const rulesText=clause?clause[2].trim()||undefined:card.rulesText;
 return {triggerText,rulesText};
}

// JSON also writes Infinity as null; restore spell ranges on both load and receipt.
export function upgradeLegacyCards(value: unknown): void {
 if (!value || typeof value !== 'object') return;
 if (Array.isArray(value)) { value.forEach(upgradeLegacyCards); return; }
 const node = value as Record<string, unknown>;
 if (node.kind === 'SPELL' && node.range === null) node.range = Number.POSITIVE_INFINITY;
 const dark = node.kind === 'SPELL' ? node.darkSide as { range: number | null } | undefined : undefined;
 if (dark && dark.range === null) dark.range = Number.POSITIVE_INFINITY;
 // Saved Agony cards predate their dark sides.
 // Saved Agony and Alchemy cards predate their dark sides.
 if (node.kind === 'SPELL' && !node.darkSide && typeof node.name === 'string') {
  const isSchool = (id: string) => node.schoolId === id || String(node.id).startsWith(`${id}-`);
  if (AGONY_DARK_SIDES[node.name] && isSchool('agony')) node.darkSide = structuredClone(AGONY_DARK_SIDES[node.name]);
  else if (ALCHEMY_DARK_SIDES[node.name] && isSchool('alchemy')) node.darkSide = structuredClone(ALCHEMY_DARK_SIDES[node.name]);
  else if (TECHNOMANCY_DARK_SIDES[node.name] && isSchool('technomancy')) node.darkSide = structuredClone(TECHNOMANCY_DARK_SIDES[node.name]);
  else if (isSchool('nightmare')) {
   if (NIGHTMARE_DARK_SIDES[node.name]) node.darkSide = structuredClone(NIGHTMARE_DARK_SIDES[node.name]);
   else if (['Shifting Nightmare', 'Mental Chasm', 'Shadow Blast'].includes(node.name)) node.lightOnly = true;
  }
 }
 if(node.kind==='SPELL'&&node.name==='Pain Mark'&&(node.schoolId==='agony'||String(node.id).startsWith('agony-'))) {
  const ongoing=node.ongoing as Card['ongoing'];
  if(ongoing?.trigger.event==='DAMAGE_DEALT'&&!ongoing.trigger.damageOrigins) {
   ongoing.trigger.damageOrigins=['MAGE_PHYSICAL','SPELL'];node.rulesText=painMarkRules;
  }
 }
 if(node.kind==='SPELL'&&node.name==='Liquefy the Pain'&&(node.schoolId==='agony'||String(node.id).startsWith('agony-'))&&Array.isArray(node.effects)&&node.effects.length===0) {
  const effects=node.triggerEffects as Card['triggerEffects'];
  if(effects?.length===1&&effects[0].effect==='SUMMON'&&effects[0].kind==='SUCCUBUS'&&effects[0].position==='TARGET'&&effects[0].target==='EVENT_ROOM') {
   node.triggerEffects=liquefyThePainEffects();
  }
 }
 // Old saved/custom instructions cannot restore the removed friendly-fire opt-in.
 if(node.effect==='DAMAGE')delete node.includeFriendly;
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

// TODO: those are placeholders
const AGONY_ELEMENTS: Element[] = ['evil', 'evil', 'water', 'air', 'fire', 'air', 'evil', 'fire', 'water', 'evil', 'wild', 'water'];
const TECHNOMANCY_ELEMENTS: Element[] = ['earth', 'stars', 'fire', 'stars', 'fire', 'evil', 'earth', 'fire', 'evil', 'earth', 'wild', 'stars'];
const SHAMANIC_ELEMENTS: Element[] = ['good', 'wild', 'earth', 'air', 'fire', 'water', 'good', 'water', 'wild', 'water', 'earth', 'fire'];

// Dark sides of the Agony school, keyed by card name. Amounts that depend on wounds use `scale`.
const AGONY_DARK_SIDES: Record<string, DarkSide> = {
 'Shared Torture': { moments: [{ effect: 'DAMAGE', amount: 0, scale: { from: 'CASTER_BLACK_DAMAGE', per: 2, each: 1 } }], range: 1, target: 'MODEL', element: 'evil', spellType: 'COMBAT',
  rulesText: 'Inflict 1 damage for each 2 BR damage on your mage.' },
 'Grim Torment': { moments: [{ effect: 'PAIN', amount: 1 }, { effect: 'DAMAGE', amount: 0, scale: { from: 'CASTER_DAMAGE', per: 2, each: 1 } }], range: 2, target: 'ROOM', element: 'evil', spellType: 'COMBAT',
  rulesText: 'BR inflicts 1 damage on you. Then inflict 1 damage for each 2 damage on your mage.' },
 'Cross and Delight': { moments: [{ effect: 'DAMAGE', amount: 2, scale: { from: 'TARGET_DAMAGE', per: 1, each: 1 }, scope: 'TARGET_ROOM' }, { effect: 'REMOVE_EVOCATION', chosen: true }],
  range: Number.POSITIVE_INFINITY, target: 'EVOCATION', targetFilter: { own: true, archetype: 'DEMON' }, element: 'water', spellType: 'COMBAT',
  rulesText: 'Choose one of your demons. Inflict 2 damage, plus 1 for each damage on it, on every model in its room. Then remove it.' },
 'Torment': { moments: [], range: Number.POSITIVE_INFINITY, target: 'MODEL', element: 'air', spellType: 'TRAP',
  trigger: { event: 'DAMAGE_TAKEN', relation: 'ENEMY', scope: 'ANY', modelRelation: 'SELF', modelKind: 'MAGE', actorKind: 'MAGE' }, triggerTarget: 'EVENT_ACTOR',
  triggerText: 'When another mage inflicts damage on you',
  triggerEffects: [{ effect: 'DAMAGE', amount: 1, scale: { from: 'EVENT_AMOUNT', per: 1, each: 1 }, target: 'EVENT_ACTOR' }],
  rulesText: 'Inflict the damage you suffered +1 on that mage.' },
 'Visceral Fire': { moments: [{ effect: 'DAMAGE', amount: 0, scale: { from: 'CASTER_BLACK_DAMAGE', per: 1, each: 1, max: 5 } }], range: 1, target: 'ROOM', element: 'fire', spellType: 'COMBAT',
  rulesText: 'Inflict 1 damage (max 5) for each BR damage on your mage.' },
 'Peak of Agony': { moments: [{ effect: 'DAMAGE', amount: 3 }, { effect: 'DAMAGE', amount: 0, scale: { from: 'CASTER_DAMAGE', per: 2, each: 1, max: 3 }, area: { range: 1, choose: true } }],
  range: 1, target: 'MODEL', element: 'air', spellType: 'COMBAT',
  rulesText: 'Inflict 3 damage. Then inflict 1 damage (max 3) for each 2 damage on your mage on a different model within range 1 of the target.' },
 'Pain Mark': { moments: [], range: 0, target: 'SELF', element: 'evil', spellType: 'COMBAT',
  ongoing: { trigger: { event: 'DAMAGE_TAKEN', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'BOUND_MODEL', modelKind: 'MAGE' }, effects: [{ effect: 'REDIRECT_DAMAGE', target: 'EVENT_MODEL' }] },
  rulesText: 'Ongoing: when you suffer damage, one of your evocations can suffer it instead.' },
 'Master of Pleasure': { moments: [], range: Number.POSITIVE_INFINITY, target: 'SELF', element: 'fire', spellType: 'TRAP',
  trigger: { event: 'DAMAGE_TAKEN', relation: 'ENEMY', relationTo: 'EVENT_MODEL', scope: 'ANY', modelKind: 'MAGE' },
  triggerText: 'When another mage suffers damage',
  triggerEffects: [{ effect: 'PAIN', amount: 0, scale: { from: 'EVENT_AMOUNT', per: 1, each: 1 }, target: 'OWNER' }, { effect: 'GAIN_VP', amount: 0, scale: { from: 'CASTER_BLACK_DAMAGE', per: 2, each: 1, max: 4 }, target: 'OWNER' }],
  rulesText: 'BR inflicts that much damage on you. Gain 1 VP (max 4) for each 2 BR damage on your mage.' },
 'Liquefy the Pain': { moments: [], range: Number.POSITIVE_INFINITY, target: 'ROOM', element: 'water', spellType: 'TRAP',
  trigger: { event: 'MAGE_DEFEATED', relation: 'ENEMY', relationTo: 'EVENT_MODEL', scope: 'ANY' }, triggerTarget: 'EVENT_ROOM',
  triggerText: 'When another mage is defeated',
  triggerEffects: [{ effect: 'INSTABILITY', amount: 0, scale: { from: 'CASTER_DAMAGE', per: 2, each: 1 }, target: 'EVENT_ROOM' }],
  rulesText: 'Place 1 instability in the room where it was for each 2 damage on your mage.' },
 'Submission': { moments: [{ effect: 'DAMAGE', amount: 2 }, { effect: 'INSTABILITY', amount: 0, scale: { from: 'DAMAGED_BLACK_DAMAGE', per: 1, each: 1 }, scope: 'CASTER_ROOM' }],
  range: 1, target: 'ROOM', element: 'evil', spellType: 'COMBAT',
  rulesText: 'Inflict 2 damage. Place 1 instability in your room for each BR damage on the models that suffered damage from this effect.' },
 'Ineluctable Pain': { moments: [], range: 0, target: 'SELF', element: 'wild', spellType: 'CONTINGENCY',
  ongoing: { trigger: { event: 'DAMAGE_TAKEN', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'BOUND_MODEL', modelKind: 'MAGE', damageOrigins: ['NEUTRAL'] }, effects: [{ effect: 'GAIN_VP', amount: 1, target: 'OWNER' }] },
  rulesText: 'Ongoing: when you suffer damage from BR, gain 1 VP.' },
 'Hearth of Ice': { moments: [{ effect: 'INSTABILITY', amount: 0, scale: { from: 'CASTER_BLACK_DAMAGE', per: 1, each: 1, max: 4 } }], range: 2, target: 'ROOM', element: 'water', spellType: 'COMBAT',
  rulesText: 'Place 1 instability (max 4) in the target room for each BR damage on your mage.' },
};

export function createAgonyDeck(prefix: string, schoolId?: string): Card[] {
 const patterns: Omit<Card, 'id' | 'kind'>[] = [
  { name: 'Shared Torture', effects: mainEffects([moment.damage(4), moment.convert(1), moment.pain(3)]), range: 1, target: 'MODEL' },
  { name: 'Grim Torment', effects: unstableEffects([moment.damage(3), moment.pain(1)]), range: 2, target: 'MODEL' },
  { name: 'Cross and Delight', effects: unstableEffects([moment.summon('SUCCUBUS'), moment.pain(1), moment.activateEvocation('SUCCUBUS')]), range: 1, target: 'ROOM' },
  { name: 'Torment', spellType: 'TRAP', effects: mainEffects([moment.damage(2), moment.summon('SUCCUBUS', 'TARGET')]), range: Number.POSITIVE_INFINITY, target: 'MODEL',
    triggerText: 'When an enemy model deals damage',
   trigger:{event:'DAMAGE_DEALT',relation:'ENEMY',scope:'ANY'}, triggerTarget:'EVENT_ACTOR',
   triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_ACTOR'},{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_ACTOR'}] },
  { name: 'Visceral Fire', effects: unstableEffects([moment.damage(2), moment.ifTargetDefeated(moment.nearTarget(moment.damage(1), 1))]), range: 2, target: 'MAGE',
   rulesText: 'Target a mage within range 2 and deal 2 damage. If that mage is defeated, each other mage within range 1 of where it stood suffers 1 damage.' },
  { name: 'Peak of Agony', effects: mainEffects(peakOfAgonyMoments()), range: 2, target: 'ROOM' },
  { name: 'Pain Mark', spellType: 'CONTINGENCY', effects: unstableEffects([]), range: 1, target: 'MODEL',
    rulesText: painMarkRules,
    ongoing: { trigger: { event: 'DAMAGE_DEALT', relation: 'ANY', scope: 'BOUND_MODEL', damageOrigins:['MAGE_PHYSICAL','SPELL'] }, effects: [{ effect: 'DAMAGE', amount: 2, target: 'EVENT_ACTOR' }] } },
  { name: 'Master of Pleasure', spellType: 'TRAP', effects: mainEffects([]), range: Number.POSITIVE_INFINITY, target: 'MAGE',
    triggerText: 'When another mage solves a quest',

    trigger:{event:'QUEST_SOLVED',relation:'ENEMY',scope:'ANY'}, triggerTarget:'EVENT_MODEL',
    triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_MODEL'},{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_MODEL'}] },
  { name: 'Liquefy the Pain', spellType: 'TRAP', effects: mainEffects([]), range: Number.POSITIVE_INFINITY, target: 'ROOM',
    triggerText: 'When you are defeated',
    trigger:{event:'MAGE_DEFEATED',relation:'SELF',relationTo:'EVENT_MODEL',scope:'ANY'}, triggerTarget:'EVENT_ROOM',
    triggerEffects:liquefyThePainEffects() },
  { name: 'Submission', effects: mainEffects([moment.damage(1), moment.convert(1), moment.pain(1)]), range: Number.POSITIVE_INFINITY, target: 'MODEL' },
  { name: 'Ineluctable Pain', spellType: 'CONTINGENCY', effects: unstableEffects([]), range: 2, target: 'MODEL',
   rulesText: 'Whenever a model gains or loses victory points, it suffers 2 damage.',
   ongoing:{trigger:{event:'VP_CHANGED',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'DAMAGE',amount:2,target:'EVENT_MODEL'}]} },
  { name: 'Hearth of Ice', effects: mainEffects([moment.damage(3), moment.convert(2), moment.pain(2)]), range: 2, target: 'MODEL' },
 ];
 return Array.from({ length: 36 }, (_, i) => { const pattern = patterns[i % patterns.length]; return { ...pattern, darkSide: structuredClone(AGONY_DARK_SIDES[pattern.name]), element: AGONY_ELEMENTS[i % patterns.length], id: `${prefix}-${i + 1}`, kind: 'SPELL' as const, ...(schoolId ? {schoolId} : {}) }; });
}


export function createTechnomancyDeck(prefix: string, schoolId?: string): Card[] {
 const m = moment;
 const patterns: Omit<Card, 'id' | 'kind'>[] = [
  { name: 'Protean Genesis', spellType: 'CONTINGENCY', range: 2, target: 'ROOM', effects: mainEffects([m.instability(1), m.summon('CADAVER', 'TARGET'), m.activateEvocation('CADAVER')]),
   rulesText: 'Place 1 instability in the target room, summon a Cadaver there and activate it.' },
  { name: 'Living Liquid', spellType: 'COMBAT', range: 2, target: 'EVOCATION', effects: mainEffects([m.assignUpgrade('REGENERATING_ICHOR'), { ...m.ifUpgraded(m.heal(2)), scope: 'CASTER' }]),
   rulesText: 'Assign Regenerating ichor to the target evocation (even an enemy). If you do, heal 2 on your mage.' },
  { name: 'Acid Blood', spellType: 'COMBAT', range: 2, target: 'EVOCATION', effects: mainEffects([m.assignUpgrade('CORROSIVE_PLASMA'), m.ifUpgraded(m.inTargetRoom(m.damage(1)))]),
   rulesText: 'Assign Corrosive plasma to the target evocation. If you do, inflict 1 damage on every model in the target\u2019s room.' },
  { name: 'Kinetic Infusion', spellType: 'CONTINGENCY', range: 2, target: 'EVOCATION', effects: mainEffects([m.assignUpgrade('TENDON_IMPLANT'), m.ifUpgraded(m.instability(1))]),
   rulesText: 'Assign Tendon implant to the target evocation. If you do, place 1 instability cube in the target\u2019s room.' },
  { name: 'Vigorous Infusion', spellType: 'CONTINGENCY', range: 2, target: 'EVOCATION', effects: unstableEffects([m.assignUpgrade('MUSCULAR_IMPLANT'), m.activateTarget()]),
   rulesText: 'Assign Muscular implant to the target evocation. It activates under your control.' },
  { name: 'Indoctrination', spellType: 'CONTINGENCY', range: 2, target: 'EVOCATION', effects: unstableEffects([m.assignUpgrade('CEREBRAL_IMPLANT'), m.activateTarget()]),
   rulesText: 'Assign Cerebral implant to the target evocation. It activates under your control.' },
  { name: 'Nefarious Evolution', spellType: 'CONTINGENCY', range: 2, target: 'EVOCATION', effects: mainEffects([{ effect: 'REMOVE_EVOCATION', archetype: 'UNDEAD' }, { effect: 'SUMMON', kind: 'COLOSSUS', position: 'REMOVED', when: 'EVOCATION_REMOVED' }]),
   rulesText: 'You may remove one of your undead evocations in the target\u2019s room. If you do, summon a Colossus in that room.' },
  { name: 'Mutant Energies', spellType: 'CONTINGENCY', range: 2, target: 'EVOCATION', effects: unstableEffects([{ effect: 'REMOVE_EVOCATION' }, m.ifRemoved({ effect: 'REMOVED_BLAST' })]),
   rulesText: 'You may remove one of your evocations in the target\u2019s room. If you do, inflict damage equal to its attack on every mage in that room and up to 1 room away.' },
  { name: 'Craft', spellType: 'CONTINGENCY', range: 1, target: 'ROOM', effects: mainEffects([m.summon('CADAVER', 'TARGET'), m.assignUpgrade('RANDOM', 'SUMMONED')]),
   rulesText: 'Summon a Cadaver in the target room, then assign it a random upgrade.' },
  { name: 'Mechanical Archive', spellType: 'CONTINGENCY', range: 0, target: 'SELF', effects: unstableEffects([{ effect: 'LOOK_LIBRARY', cards: 4 }]),
   rulesText: 'Look at 4 cards from a single library school. Draw 1 and discard the rest to that school\u2019s discard pile.' },
  { name: 'Draco\u2019s Skin', spellType: 'TRAP', range: Number.POSITIVE_INFINITY, target: 'SELF', effects: mainEffects([]),
   rulesText: 'When one of your evocations is defeated or removed, summon that model again where it stood and assign Reinforced dermis to it.',
   trigger: { event: 'EVOCATION_LOST', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'ANY' },
   triggerEffects: [{ effect: 'SUMMON', kind: 'EVENT_MODEL', position: 'EVENT', target: 'OWNER' }, { effect: 'ASSIGN_UPGRADE', upgrade: 'REINFORCED_DERMIS', to: 'SUMMONED', target: 'OWNER' }] },
  { name: 'Necrotic Pheromones', spellType: 'TRAP', range: 2, target: 'EVOCATION', effects: unstableEffects([m.activateTarget()]), triggerSight: 2, targetFrom: 'EVENT_MODEL',
   rulesText: 'When another mage enters a room at range 2 and in line of sight, choose an evocation at range 2 from that mage. It activates under your control.',
   trigger: { event: 'ENTER_ROOM', relation: 'ENEMY', scope: 'ANY' } },
 ];
 return Array.from({ length: 36 }, (_, i) => { const pattern = patterns[i % patterns.length]; return { ...pattern, darkSide: structuredClone(TECHNOMANCY_DARK_SIDES[pattern.name]), element: TECHNOMANCY_ELEMENTS[i % patterns.length], id: `${prefix}-${i + 1}`, kind: 'SPELL' as const, ...(schoolId ? {schoolId} : {}) }; });
}

// Dark sides of the Technomancy school, keyed by card name. Health limits use full health, upgrades included.
const TECHNOMANCY_DARK_SIDES: Record<string, DarkSide> = {
 'Protean Genesis': { moments: [{ effect: 'LOSE_VP', amount: 1, scope: 'CASTER' }, { effect: 'SUMMON', kind: 'COLOSSUS', position: 'TARGET', when: 'VP_LOST' }], range: 2, target: 'ROOM', element: 'earth', spellType: 'CONTINGENCY',
  rulesText: 'Lose 1 VP. If you do, summon a Colossus in the target room.' },
 'Living Liquid': { moments: [{ effect: 'DISCARD_UPGRADE' }, { effect: 'INSTABILITY', amount: 3, when: 'UPGRADE_DISCARDED' }], range: 2, target: 'EVOCATION', element: 'stars', spellType: 'CONTINGENCY',
  rulesText: 'Discard an upgrade from the target evocation. If you do, place 3 instability in the target\u2019s room.' },
 'Acid Blood': { moments: [{ effect: 'DAMAGE', amount: 3 }, { effect: 'INSTABILITY', amount: 1 }], range: 1, target: 'ROOM', element: 'fire', spellType: 'COMBAT',
  rulesText: 'Inflict 3 damage on every enemy model in the target room, then place 1 instability there.' },
 'Kinetic Infusion': { moments: [{ effect: 'MOVE_TARGET', distance: 1 }, { effect: 'MOVE_TARGET', distance: 1 }, { effect: 'MOVE_TARGET', distance: 1 }, { effect: 'ACTIVATE_ROOM' }], range: 0, target: 'SELF', element: 'fire', spellType: 'CONTINGENCY',
  rulesText: 'Move yourself up to 1, three times, then activate the room effect where you stand.' },
 'Vigorous Infusion': { moments: [{ effect: 'DAMAGE', amount: 1 }, { effect: 'MOVE_TARGET', distance: 1, models: true }, { effect: 'MOVE_TARGET', distance: 1, models: true }], range: 2, target: 'MODEL', element: 'stars', spellType: 'COMBAT',
  rulesText: 'Inflict 1 damage on the target, then move it up to 1, then again up to 1.' },
 'Indoctrination': { moments: [{ effect: 'HEAL', amount: 2 }, { effect: 'INSTABILITY', amount: 0, scope: 'CASTER_ROOM', scale: { from: 'HEALED', per: 1, each: 1 } }], range: 0, target: 'SELF', element: 'evil', spellType: 'CONTINGENCY',
  rulesText: 'Heal up to 2 damage on your mage, then place 1 instability in your room for each damage healed.' },
 'Nefarious Evolution': { moments: [{ effect: 'INSTABILITY', amount: 1 }, { effect: 'ACTIVATE_TARGET', when: 'TARGET_UPGRADED' }], range: Number.POSITIVE_INFINITY, target: 'EVOCATION', element: 'earth', spellType: 'CONTINGENCY',
  rulesText: 'Place 1 instability in the target\u2019s room. If the target has an upgrade, it activates under your control.' },
 'Mutant Energies': { moments: [{ effect: 'REMOVE_EVOCATION', chosen: true }, { effect: 'SUMMON', kind: 'CADAVER', position: 'REMOVED', when: 'EVOCATION_REMOVED' }], range: 2, target: 'EVOCATION', element: 'fire', spellType: 'CONTINGENCY', targetFilter: { maxHealth: 3 },
  rulesText: 'Remove the target evocation (health 3 or less, upgrades included). If you do, summon a Cadaver in the same room.' },
 'Craft': { moments: [{ effect: 'ASSIGN_UPGRADE', upgrade: 'CHOICE' }], range: Number.POSITIVE_INFINITY, target: 'EVOCATION', element: 'evil', spellType: 'CONTINGENCY',
  rulesText: 'Assign an upgrade of your choice to the target evocation.' },
 'Mechanical Archive': { moments: [{ effect: 'GAIN_VP', amount: 1 }, { effect: 'SEARCH_GRIMOIRE', keyword: 'SUMMON' }], range: 0, target: 'SELF', element: 'earth', spellType: 'CONTINGENCY',
  rulesText: 'Gain 1 VP, then choose and draw 1 card with the Summon keyword from your grimoire.' },
 'Draco\u2019s Skin': { moments: [], range: 0, target: 'MODEL', element: 'wild', spellType: 'TRAP', targetFilter: { sameRoom: true },
  trigger: { event: 'ENTER_ROOM', relation: 'ENEMY', scope: 'ANY' }, triggerTarget: 'EVENT_MODEL',
  triggerText: 'When an enemy model enters your room',
  triggerEffects: [{ effect: 'DAMAGE', amount: 3, target: 'BOUND_MODEL' }, { effect: 'MOVE_TARGET', distance: 1, models: true, target: 'BOUND_MODEL' }],
  rulesText: 'Target that model: inflict 3 damage, then move it up to 1.' },
 'Necrotic Pheromones': { moments: [], range: 2, target: 'MAGE', element: 'stars', spellType: 'TRAP',
  trigger: { event: 'ROOM_ACTIVATED', relation: 'ENEMY', scope: 'ANY' }, triggerTarget: 'EVENT_ACTOR',
  triggerText: 'After another mage within range 2 resolves the effect of a room',
  triggerEffects: [{ effect: 'ACTIVATE_CHOICE', near: { range: 2 }, target: 'BOUND_MODEL' }, { effect: 'ACTIVATE_CHOICE', near: { range: 2 }, target: 'BOUND_MODEL' }],
  rulesText: 'One of your evocations within range 2 of that mage activates, then one of your evocations within range 2 of that mage activates again.' },
};

// Dark sides of the Alchemy school, keyed by card name. Each side has its own element, enhancement and rules.
const revealed = (element: Element): NonNullable<Moment['scale']> => ({ from: 'REVEALED_ELEMENT', per: 1, each: 1, element });
const ALCHEMY_DARK_SIDES: Record<string, DarkSide> = {
 'Azoth Bomb': { moments: [{ effect: 'DAMAGE', amount: 2 }], range: 1, target: 'ROOM', element: 'air', spellType: 'COMBAT',
  enhancement: { requires: ['earth'], moments: [{ effect: 'DAMAGE', amount: 0, scale: revealed('earth') }], position: 'BEFORE', text: 'Enhancement (earth): first inflict 1 damage for each earth or wild symbol on your other revealed spells.' },
  rulesText: 'Inflict 2 damage on every enemy model in the target room.' },
 'Viatorium Spagyricum': { moments: [{ effect: 'DAMAGE', amount: 2 }], range: 2, target: 'MODEL', element: 'air', spellType: 'COMBAT',
  enhancement: { requires: ['water'], moments: [{ effect: 'DAMAGE', amount: 2 }], position: 'BEFORE', text: 'Enhancement (water): first inflict 2 damage.' },
  rulesText: 'Inflict 2 damage.' },
 'Deflagrate': { moments: [{ effect: 'DAMAGE', amount: 1 }, { effect: 'INSTABILITY', amount: 2 }], range: 1, target: 'ROOM', element: 'water', spellType: 'COMBAT',
  enhancement: { requires: ['fire'], moments: [{ effect: 'DAMAGE', amount: 1 }], position: 'BEFORE', text: 'Enhancement (fire): first inflict 1 damage.' },
  rulesText: 'Inflict 1 damage on every enemy model in the target room, then place 2 instability there.' },
 'Athanor Eruption': { moments: [{ effect: 'DAMAGE', amount: 2 }], range: 2, target: 'MODEL', element: 'fire', spellType: 'COMBAT',
  enhancement: { requires: ['air'], moments: [{ effect: 'INSTABILITY', amount: 0, scale: revealed('air') }], position: 'BEFORE', text: 'Enhancement (air): first place 1 instability in the target\u2019s room for each air or wild symbol on your other revealed spells.' },
  rulesText: 'Inflict 2 damage.' },
 'Marbling': { moments: [{ effect: 'DAMAGE', amount: 1 }], range: 2, target: 'ROOM', element: 'earth', spellType: 'COMBAT',
  enhancement: { requires: ['water'], moments: [{ effect: 'INSTABILITY', amount: 2 }], position: 'BEFORE', text: 'Enhancement (water): first place 2 instability in the target room.' },
  rulesText: 'Inflict 1 damage on every enemy model in the target room.' },
 'Stone Phoenix': { moments: [], range: Number.POSITIVE_INFINITY, target: 'ROOM', element: 'fire', spellType: 'TRAP',
  trigger: { event: 'EVOCATION_LOST', relation: 'ANY', relationTo: 'EVENT_MODEL', scope: 'ANY' }, triggerTarget: 'EVENT_ROOM',
  triggerText: 'When any evocation is defeated or removed',
  triggerEffects: [{ effect: 'SUMMON', kind: 'EVENT_MODEL', position: 'EVENT', target: 'OWNER' }, { effect: 'ACTIVATE_EVOCATION', kind: 'EVENT_MODEL', target: 'OWNER' }],
  rulesText: 'Summon an evocation of the same kind as the lost one in the room where it was lost, under your control, and activate it.' },
 'Soul Transfer': { moments: [{ effect: 'REMOVE_EVOCATION', archetype: 'CONSTRUCT' }, { effect: 'SUMMON', kind: 'CHOICE', maxHealth: 3, position: 'REMOVED', when: 'EVOCATION_REMOVED' }], range: 1, target: 'ROOM', element: 'wild', spellType: 'CONTINGENCY',
  rulesText: 'You may remove one of your constructs in the target room. If you do, choose and summon an evocation with at most 3 health in that room.' },
 'Liquid Fire': { moments: [{ effect: 'DAMAGE', amount: 1 }, { effect: 'SUMMON', kind: 'NIGREDO', position: 'CASTER' }], range: 0, target: 'ROOM', element: 'fire', spellType: 'COMBAT',
  enhancement: { requires: ['water'], moments: [{ effect: 'ACTIVATE_CHOICE', archetype: 'CONSTRUCT', movementBonus: 1 }], position: 'AFTER', text: 'Enhancement (water): then one of your constructs activates with +1 movement.' },
  rulesText: 'Inflict 1 damage on every enemy model in your room, then summon a Nigredo there.' },
 'Fountain of the Three': { moments: [], range: Number.POSITIVE_INFINITY, target: 'ROOM', element: 'water', spellType: 'TRAP',
  rulesText: 'No effect yet.' },
 'Purifying Aludel': { moments: [{ effect: 'ACTIVATE_TARGET' }], range: Number.POSITIVE_INFINITY, target: 'EVOCATION', element: 'air', spellType: 'CONTINGENCY',
  rulesText: 'The target evocation activates under your control.' },
 'Albify': { moments: [{ effect: 'CONVERT', amount: 3, scope: 'TARGET_ROOM' }], range: 2, target: 'ROOM', element: 'water', spellType: 'COMBAT',
  enhancement: { requires: ['fire'], moments: [{ effect: 'DAMAGE', amount: 1 }], position: 'BEFORE', text: 'Enhancement (fire): first inflict 1 damage on every enemy model in the target room.' },
  rulesText: 'Convert 3 damage on every model in the target room.' },
 'Silver of the Sages': { moments: [], range: Number.POSITIVE_INFINITY, target: 'ROOM', element: 'wild', spellType: 'PROTECTION',
  trigger: { event: 'MAGE_DEFEATED', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'ANY' }, triggerTarget: 'EVENT_ROOM',
  triggerText: 'When you are defeated',
  triggerEffects: [
   { effect: 'ACTIVATE_CHOICE', archetype: 'CONSTRUCT', target: 'OWNER', choose: { group: 'silver', option: 'activate', label: 'Activate a construct' } },
   { effect: 'GAIN_VP', amount: 1, target: 'OWNER', choose: { group: 'silver', option: 'summon', label: 'Gain 1 VP and summon a Nigredo' } },
   { effect: 'SUMMON', kind: 'NIGREDO', position: 'TARGET', target: 'EVENT_ROOM', choose: { group: 'silver', option: 'summon', label: 'Gain 1 VP and summon a Nigredo' } },
  ],
  rulesText: 'Choose one: one of your constructs activates; or gain 1 VP and summon a Nigredo in the room where you were defeated.' },
};

export function createAlchemyDeck(prefix: string, schoolId?: string): Card[] {
 const m = moment;
 const patterns: Omit<Card, 'id' | 'kind'>[] = [
  { name: 'Azoth Bomb', element: 'air', spellType: 'COMBAT', range: 3, target: 'ROOM', effects: mainEffects([m.damage(2)]),
   enhancement: { requires: ['water', 'water'], moments: [m.damage(2)], position: 'BEFORE', text: 'Enhancement (2 water symbols): first inflict 2 damage.' },
   rulesText: 'Inflict 2 damage on every enemy model in the target room.' },
  { name: 'Viatorium Spagyricum', element: 'water', spellType: 'COMBAT', range: 0, target: 'MODEL', targetFilter: { sameRoom: true }, effects: unstableEffects([m.damage(2)]),
   enhancement: { requires: ['fire', 'water'], moments: [m.damage(3)], position: 'BEFORE', text: 'Enhancement (fire and water): first inflict 3 damage.' },
   rulesText: 'Target a model in your room and inflict 2 damage.' },
  { name: 'Deflagrate', element: 'water', spellType: 'COMBAT', range: 2, target: 'MODEL', effects: mainEffects([m.damage(2), { effect: 'MOVE_DAMAGED', distance: 1 }]),
   enhancement: { requires: ['earth', 'earth'], target: 'ROOM', range: 2, text: 'Enhancement (2 earth symbols): the target becomes a room at range 2.' },
   rulesText: 'Inflict 2 damage, then move one model that suffered damage from this effect up to 1.' },
  { name: 'Athanor Eruption', element: 'fire', spellType: 'COMBAT', range: 1, target: 'MODEL', effects: mainEffects([m.damage(3)]),
   enhancement: { requires: ['air', 'earth'], moments: [m.damage(1)], position: 'BEFORE', suppressReactions: true, text: 'Enhancement (air and earth): first inflict 1 damage; Traps and Protections will not trigger during this spell.' },
   rulesText: 'Inflict 3 damage.' },
  { name: 'Marbling', element: 'earth', spellType: 'COMBAT', range: 0, target: 'SELF', effects: mainEffects([{ effect: 'DAMAGE', amount: 1, scope: 'ALL_MAGES' }]),
   enhancement: { requires: ['fire', 'fire'], moments: [{ effect: 'DAMAGE', amount: 1, scope: 'ALL_MAGES' }], position: 'BEFORE', text: 'Enhancement (2 fire symbols): first inflict 1 damage to each mage.' },
   rulesText: 'Inflict 1 damage to each mage.' },
  { name: 'Stone Phoenix', element: 'earth', spellType: 'TRAP', range: Number.POSITIVE_INFINITY, target: 'ROOM', effects: mainEffects([]),
   triggerText: 'When one of your evocations is defeated or removed',
   rulesText: 'Summon a Nigredo in the room where it was lost.',
   trigger: { event: 'EVOCATION_LOST', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'ANY' }, triggerTarget: 'EVENT_ROOM',
   triggerEffects: [{ effect: 'SUMMON', kind: 'NIGREDO', position: 'TARGET', target: 'EVENT_ROOM' }] },
  { name: 'Soul Transfer', element: 'wild', spellType: 'CONTINGENCY', range: Number.POSITIVE_INFINITY, target: 'EVOCATION', targetFilter: { own: true, archetype: 'CONSTRUCT' }, effects: mainEffects([{ effect: 'ACTIVATE_ROOM' }]),
   rulesText: 'Choose one of your constructs. Activate the room it stands in, even if the room was already used this round. Not the central chamber.' },
  { name: 'Liquid Fire', element: 'fire', spellType: 'COMBAT', range: Number.POSITIVE_INFINITY, target: 'EVOCATION', targetFilter: { own: true }, effects: unstableEffects([{ effect: 'REMOVE_EVOCATION', chosen: true }, m.ifRemoved({ effect: 'REMOVED_BLAST', amount: 2, models: true })]),
   enhancement: { requires: ['air', 'water'], moments: [m.ifRemoved({ effect: 'DAMAGE', amount: 1, scope: 'DAMAGED' })], position: 'AFTER', text: 'Enhancement (air and water): then inflict 1 damage to each model that suffered damage from this effect.' },
   rulesText: 'Remove the target evocation (yours). If you do, inflict 2 damage to every model in its room and up to 1 room away.' },
  { name: 'Fountain of the Three', element: 'earth', spellType: 'CONTINGENCY', range: 1, target: 'EVOCATION', targetFilter: { maxHealth: 2 }, effects: mainEffects([{ effect: 'REMOVE_EVOCATION', chosen: true }, m.ifRemoved({ effect: 'SUMMON', kind: 'NIGREDO', position: 'CHOICE' })]),
   enhancement: { requires: ['water', 'fire'], moments: [{ effect: 'ACTIVATE_CHOICE', archetype: 'CONSTRUCT', attackBonus: 1 }], position: 'AFTER', text: 'Enhancement (water and fire): then choose one of your constructs; it activates with +1 attack.' },
   rulesText: 'Target an evocation with less than 3 health. Remove it. If you do, summon a Nigredo in a room of your choice.' },
  { name: 'Purifying Aludel', element: 'air', spellType: 'CONTINGENCY', range: Number.POSITIVE_INFINITY, target: 'EVOCATION', effects: unstableEffects([m.heal(3), m.activateTarget()]),
   enhancement: { requires: ['water', 'earth'], moments: [{ effect: 'ATTACK_BONUS', amount: 2 }], position: 'BEFORE', text: 'Enhancement (water and earth): the next time the target activates it has +2 attack.' },
   rulesText: 'Heal 3 on the target evocation, then activate it.' },
  { name: 'Albify', element: 'water', spellType: 'COMBAT', range: 1, target: 'MAGE', effects: unstableEffects([m.convert(4)]),
   enhancement: { requires: ['air', 'air'], moments: [{ effect: 'LOSE_VP', amount: 2 }], position: 'BEFORE', text: 'Enhancement (2 air symbols): the target loses 2 victory points.' },
   rulesText: 'Convert 4 damage on the target mage.' },
  { name: 'Silver of the Sages', element: 'wild', spellType: 'PROTECTION', range: Number.POSITIVE_INFINITY, target: 'SELF', effects: unstableEffects([]),
   triggerText: 'When you suffer damage',
   rulesText: 'Ignore up to 2 of that damage. Then activate one of your evocations; when the activation ends the Black Rose inflicts 1 damage on it.',
   trigger: { event: 'DAMAGE_TAKEN', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'BOUND_MODEL' },
    triggerEffects: [{ effect: 'HEAL', amount: 2, target: 'EVENT_MODEL' }, { effect: 'ACTIVATE_CHOICE', endDamage: 1, target: 'OWNER' }] },
 ];
 return Array.from({ length: 36 }, (_, i) => { const pattern = patterns[i % patterns.length]; return { ...pattern, darkSide: structuredClone(ALCHEMY_DARK_SIDES[pattern.name]), id: `${prefix}-${i + 1}`, kind: 'SPELL' as const, ...(schoolId ? {schoolId} : {}) }; });
}

export function createNightmareDeck(prefix: string, schoolId?: string): Card[] {
 const m = moment;
 const assign = (count = 1): Moment => ({ effect: 'ASSIGN_NIGHTMARE', count });
 const activate = (of: 'ASSIGNED' | 'TARGET' | 'ALL', attackBonus?: number): Moment => ({ effect: 'ACTIVATE_NIGHTMARES', of, ...(attackBonus ? { attackBonus } : {}) });
 const patterns: Omit<Card, 'id' | 'kind'>[] = [
  { name: 'Hysterical Escape', element: 'air', spellType: 'CONTINGENCY', range: 2, target: 'MAGE', effects: unstableEffects([{ effect: 'MOVE_TARGET', distance: 1 }, { effect: 'MOVE_TARGET', distance: 1 }, assign(), activate('ASSIGNED')]),
   rulesText: 'Move the target 1, then again 1. Assign an Umbra to the target and activate it under your control.' },
  { name: 'Thorn of Thorns', element: 'stars', spellType: 'CONTINGENCY', range: 2, target: 'MAGE', effects: mainEffects([{ effect: 'STEAL_VP', amount: 1 }, assign(), activate('ASSIGNED'), { effect: 'FIRST_PLAYER' }]),
   rulesText: 'Steal 1 victory point from the target. Assign an Umbra to it and activate it under your control. The target gets the first player token.' },
  { name: 'Persecution', element: 'evil', spellType: 'PROTECTION', range: Number.POSITIVE_INFINITY, target: 'SELF', effects: mainEffects([]),
   triggerText: 'After a spell inflicts damage to you',
   rulesText: 'Ignore up to 3 of that damage. For each ignored damage, inflict 1 damage to the caster of that spell.',
   trigger: { event: 'DAMAGE_TAKEN', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'BOUND_MODEL', damageOrigins: ['SPELL'] },
   triggerEffects: [{ effect: 'IGNORE_DAMAGE', amount: 3, target: 'EVENT_MODEL' }] },
  { name: 'Shifting Nightmare', element: 'evil', spellType: 'TRAP', range: Number.POSITIVE_INFINITY, target: 'MAGE', effects: mainEffects([m.damage(3), activate('TARGET')]), triggerTarget: 'EVENT_MODEL',
   triggerText: 'When another mage enters a purple or grey room',
   rulesText: 'Inflict 3 damage to that mage, then activate each Nightmare assigned to it under your control.',
   trigger: { event: 'ENTER_ROOM', relation: 'ENEMY', scope: 'ANY', modelKind: 'MAGE', roomColors: ['violet', 'grey'] } },
  { name: 'Mental Chasm', element: 'evil', spellType: 'TRAP', range: Number.POSITIVE_INFINITY, target: 'MAGE', effects: mainEffects([m.convert(3), { effect: 'DISCARD_CARDS', amount: 2, stealVp: true }]), triggerTarget: 'EVENT_MODEL',
   triggerText: 'When another mage enters a blue or yellow room',
   rulesText: 'Convert 3 damage on that mage. It discards 2 cards; for each card it cannot discard, steal 1 victory point from it.',
   trigger: { event: 'ENTER_ROOM', relation: 'ENEMY', scope: 'ANY', modelKind: 'MAGE', roomColors: ['azure', 'amber'] } },
  { name: 'Shadow Blast', element: 'evil', spellType: 'TRAP', range: Number.POSITIVE_INFINITY, target: 'ROOM',
   effects: mainEffects([{ effect: 'DAMAGE', amount: 2, scope: 'TARGET_ROOM', magesOnly: true }, { effect: 'ASSIGN_NIGHTMARE', count: 1, others: true, scope: 'TARGET_ROOM', magesOnly: true }, { effect: 'INSTABILITY_PER_NIGHTMARE' }]), triggerTarget: 'EVENT_ROOM',
   triggerText: 'When another mage enters a red or green room',
   rulesText: 'Inflict 2 damage to every other mage in that room and assign an Umbra to each. For each Nightmare in that room, place 1 instability there.',
   trigger: { event: 'ENTER_ROOM', relation: 'ENEMY', scope: 'ANY', modelKind: 'MAGE', roomColors: ['crimson', 'emerald'] } },
  { name: 'Humiliation', element: 'wild', spellType: 'COMBAT', range: 2, target: 'MAGE', effects: unstableEffects([m.damage(2), activate('TARGET')]),
   rulesText: 'Inflict 2 damage. Each Nightmare assigned to the target activates under your control.' },
  { name: 'Traitor Nightmare', element: 'wild', spellType: 'CONTINGENCY', range: Number.POSITIVE_INFINITY, target: 'ROOM', effects: unstableEffects([{ effect: 'ACTIVATE_ROOM_IF_NIGHTMARE' }]),
   rulesText: 'If there is a Nightmare in the target room, activate that room even if it was already used.' },
  { name: 'Painful Loss', element: 'stars', spellType: 'COMBAT', range: 2, target: 'ROOM', effects: mainEffects([m.damage(1), { effect: 'ASSIGN_NIGHTMARE', count: 1, scope: 'TARGET_ROOM', magesOnly: true }]),
   rulesText: 'Inflict 1 damage. Assign an Umbra to each mage in the target room.' },
  { name: 'Anguish', element: 'stars', spellType: 'CONTINGENCY', range: 2, target: 'MAGE', effects: unstableEffects([assign(2), activate('ALL'), { effect: 'DRAW_EVENT' }]),
   rulesText: 'Assign 2 Umbras to the target. Each Nightmare in the game activates under your control. Draw a new event.' },
  { name: 'Recurring Nightmare', element: 'air', spellType: 'CONTINGENCY', range: 1, target: 'MAGE', effects: mainEffects([assign(), { effect: 'REASSIGN_NIGHTMARES' }, activate('TARGET', 1)]),
   rulesText: 'Assign an Umbra to the target and reassign every other Umbra to it. All Umbras assigned to the target activate under your control with +1 attack.' },
  { name: 'Ephialtes', element: 'evil', spellType: 'CONTINGENCY', range: 0, target: 'SELF', effects: unstableEffects([{ effect: 'DRAW_EVENT' }, { effect: 'ASSIGN_PER_EVENT' }, { effect: 'GAIN_VP_PER_NIGHTMARE', max: 5 }]),
   rulesText: 'Draw an event. For each event on the event board, assign an Umbra to a mage. Gain 1 victory point for each Nightmare in the game, up to 5.' },
 ];
 return Array.from({ length: 36 }, (_, i) => {
  const pattern = patterns[i % patterns.length];
  const dark = NIGHTMARE_DARK_SIDES[pattern.name];
  return { ...pattern, ...(dark ? { darkSide: structuredClone(dark) } : { lightOnly: true }), id: `${prefix}-${i + 1}`, kind: 'SPELL' as const, ...(schoolId ? {schoolId} : {}) };
 });
}

// Dark sides of the Nightmare school, keyed by card name. Shifting Nightmare, Mental Chasm and Shadow Blast
// have no dark side (`lightOnly`). "Mage N" targets use N as the range.
const NIGHTMARE_DARK_SIDES: Record<string, DarkSide> = {
 'Hysterical Escape': { moments: [{ effect: 'MOVE_ROOM_MAGE', distance: 1 }, { effect: 'MOVE_ROOM_MAGE', distance: 1 }, { effect: 'GAIN_VP_PER_TRAP' }], range: 2, target: 'ROOM', element: 'air', spellType: 'CONTINGENCY',
  rulesText: 'Move a mage in the target room up to 1, then again up to 1. Gain 1 VP for each Trap triggered during this effect.' },
 'Thorn of Thorns': { moments: [{ effect: 'DRAW_SPELLS', amount: 1 }, { effect: 'GAIN_VP', amount: 1 }, { effect: 'FIRST_PLAYER', scope: 'CASTER' }, { effect: 'PAIN', amount: 2 }], range: 0, target: 'SELF', element: 'stars', spellType: 'CONTINGENCY',
  rulesText: 'Draw 1 spell, gain 1 VP and take the first player token. BR inflicts 2 damage on you.' },
 'Persecution': { moments: [], range: 0, target: 'SELF', element: 'evil', spellType: 'PROTECTION',
  trigger: { event: 'SPELL_TARGETED', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'ANY', modelKind: 'MAGE', spellTypes: ['TRAP'] },
  triggerText: 'When a Trap targets you or you are about to suffer its effect',
  triggerEffects: [{ effect: 'PREVENT_SPELL', target: 'EVENT_ACTOR' }, { effect: 'STEAL_CROWN_OR_VP', amount: 1, target: 'EVENT_ACTOR' }],
  rulesText: 'Ignore that Trap\u2019s effect. Steal the first player token from its owner; if it does not hold it, steal 1 VP instead.' },
 'Humiliation': { moments: [{ effect: 'ASSIGN_NIGHTMARE', count: 1 }, { effect: 'DAMAGE', amount: 2, scale: { from: 'TARGET_NIGHTMARES', per: 1, each: 1 } }], range: 1, target: 'MAGE', element: 'wild', spellType: 'COMBAT',
  rulesText: 'Assign an Umbra to the target. Inflict 2 damage, plus 1 for each Nightmare assigned to it.' },
 'Traitor Nightmare': { moments: [{ effect: 'ASSIGN_NIGHTMARE', count: 1 }, { effect: 'GAIN_VP', amount: 1, when: 'TARGET_HAS_3_NIGHTMARES' }, { effect: 'ACTIVATE_NIGHTMARES', of: 'TARGET' }], range: Number.POSITIVE_INFINITY, target: 'MAGE', element: 'wild', spellType: 'CONTINGENCY',
  rulesText: 'Assign an Umbra to the target. If it has 3 Nightmares assigned, gain 1 VP. Each Nightmare assigned to it activates under your control.' },
 'Painful Loss': { moments: [{ effect: 'PAIN', amount: 2, optional: true }, { effect: 'DAMAGE', amount: 1, scope: 'ALL_MAGES', when: 'PAIN_RESOLVED' }, { effect: 'ACTIVATE_NIGHTMARES', of: 'ALL' }], range: 0, target: 'SELF', element: 'stars', spellType: 'COMBAT',
  rulesText: 'You may suffer 2 Pain. If you do, inflict 1 damage on each other mage. Each Nightmare in the game activates under your control.' },
 'Anguish': { moments: [{ effect: 'DEFEAT_TARGET', when: 'TARGET_HAS_3_NIGHTMARES' }], range: 1, target: 'MAGE', element: 'stars', spellType: 'CONTINGENCY',
  rulesText: 'If the target has 3 Nightmares assigned, defeat it.' },
 'Recurring Nightmare': { moments: [], range: 2, target: 'MAGE', element: 'air', spellType: 'CONTINGENCY',
  ongoing: { trigger: { event: 'SPELL_CAST', relation: 'ANY', scope: 'BOUND_MODEL' }, effects: [{ effect: 'ACTIVATE_NIGHTMARES', of: 'TARGET', target: 'BOUND_MODEL' }] },
  rulesText: 'Ongoing: each time the target reveals a spell, each Nightmare assigned to it activates under your control.' },
 'Ephialtes': { moments: [{ effect: 'DRAW_QUESTS_PER_NIGHTMARE' }], range: 0, target: 'SELF', element: 'evil', spellType: 'CONTINGENCY',
  rulesText: 'Draw 1 quest for each Nightmare in the game, then discard one of those quests.' },
};

export function createShamanicDeck(prefix: string, schoolId?: string): Card[] {
 const m = moment;
 const patterns: Omit<Card, 'id' | 'kind'>[] = [
  { name: 'Binding Totem', spellType: 'CONTINGENCY', range: 1, target: 'ROOM', effects: mainEffects([m.summon('TOTEM', 'TARGET'), { effect: 'GAIN_VP', amount: 1 }]),
   rulesText: 'Summon a Totem in the target room, then gain 1 VP.' },
  { name: 'Astral Path', spellType: 'CONTINGENCY', range: 0, target: 'SELF', effects: unstableEffects([{ effect: 'COMPLETE_QUEST' }]),
   rulesText: 'Choose one of your active quests. Lose VP equal to the moon level to complete it.' },
  { name: 'Earth Totem', spellType: 'PROTECTION', range: 0, target: 'SELF', effects: mainEffects([]),
   triggerText: 'When a combat spell targets you or you are about to suffer the effect of an ongoing combat spell',
   trigger: { event: 'SPELL_TARGETED', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'ANY', spellTypes: ['COMBAT'] },
   triggerEffects: [{ effect: 'PREVENT_SPELL', target: 'EVENT_ACTOR' }, { effect: 'SUMMON', kind: 'TOTEM', position: 'CASTER', target: 'OWNER' }],
   rulesText: 'Ignore that spell effect. Summon a Totem in your room.' },
  { name: 'Wind Spirit', spellType: 'CONTINGENCY', range: 0, target: 'SELF', effects: unstableEffects([{ effect: 'RESHUFFLE_DRAW', amount: 2 }]),
   rulesText: 'Shuffle your personal discard into your grimoire, choose 2 cards from it, then shuffle your grimoire. Reveal the cards in the log.' },
  { name: 'Valor Totem', spellType: 'CONTINGENCY', range: 1, target: 'ROOM', element: 'fire', effects: mainEffects([m.summon('TOTEM', 'TARGET'), { effect: 'GAIN_VP_PER_ALTAR', max: 5 }]),
   rulesText: 'Summon a Totem in the target room, then gain 1 VP for each Altar in play (maximum 5).' },
  { name: 'River Spirit', spellType: 'CONTINGENCY', range: 3, target: 'ROOM', element: 'water', effects: mainEffects([{ effect: 'DRAW_QUEST' }, { effect: 'ACTIVATE_TARGET_ROOM' }]),
   rulesText: 'Draw 1 quest, then activate the target room.' },
  { name: 'Dominion Token', spellType: 'CONTINGENCY', range: 2, target: 'ROOM', element: 'good', effects: mainEffects([m.summon('TOTEM', 'TARGET'), m.instability(2)]),
   rulesText: 'Summon a Totem in the target room, then place 2 cubes in that room.' },
  { name: 'Channeling Energy', spellType: 'CONTINGENCY', range: 0, target: 'SELF', element: 'wild', effects: mainEffects([]),
   rulesText: 'Ongoing: Each time a mage reveals a combat spell, choose whether BR may inflict 1 damage on one of your Altars to gain 1 VP.',
   ongoing: { trigger: { event: 'SPELL_CAST', relation: 'ANY', scope: 'ANY', spellTypes: ['COMBAT'] }, effects: [{ effect: 'BLACK_ROSE_ALTAR_TITHE', target: 'OWNER' }] } },
  { name: 'Rain Totem', spellType: 'CONTINGENCY', range: 2, target: 'ROOM', element: 'water', effects: mainEffects([m.summon('TOTEM', 'TARGET'), { effect: 'PLACE_ALTAR_CUBES' }]),
   rulesText: 'Summon a Totem in the target room, then place cubes there equal to the number of Altars in play.' },
  { name: 'Steppe Spirit', spellType: 'CONTINGENCY', range: 2, target: 'ROOM', element: 'earth', effects: mainEffects([m.convert(3)]),
   rulesText: 'Convert up to 3 cubes in the target room.' },
  { name: 'Pyre Spirit', spellType: 'CONTINGENCY', range: 2, target: 'EVOCATION', element: 'fire',
   targetFilter: { maxHealth: 3 }, effects: unstableEffects([{ effect: 'REMOVE_EVOCATION', chosen: true }, { effect: 'GAIN_VP', amount: 1, when: 'EVOCATION_REMOVED' }]),
   rulesText: 'Remove a target evocation with health 3 or less. If removed, gain 1 VP.' },
  { name: 'Source of Life', spellType: 'CONTINGENCY', range: 2, target: 'ROOM', element: 'water',
   effects: mainEffects([{ effect: 'MOVE_MODEL', distance: 1 }, { effect: 'HEAL', amount: 2, scope: 'TARGET_ROOM' }, { effect: 'GAIN_VP', amount: 1 }]),
   rulesText: 'Move any model from anywhere on the board to a room within range 1 of the target room, heal 2 on every model in the target room, then gain 1 VP.' },
 ];
 return Array.from({ length: 36 }, (_, i) => ({ ...patterns[i % patterns.length], element: patterns[i % patterns.length].element ?? SHAMANIC_ELEMENTS[i % patterns.length], id: `${prefix}-${i + 1}`, kind: 'SPELL', ...(schoolId ? { schoolId } : {}) }));
}

export function createHexDeck(prefix: string, schoolId?: string): Card[] {
 const m = moment;
 const assign = (jinx: JinxName | 'CHOICE'): Moment => ({ effect: 'ASSIGN_JINX', jinx });
 const moveSelf: Moment = { effect: 'MOVE_TARGET', distance: 1, scope: 'CASTER' };
 const moveTarget: Moment = { effect: 'MOVE_TARGET', distance: 1 };
 const steal: Moment = { effect: 'STEAL_VP', amount: 1 };
 const anyDistance = Number.POSITIVE_INFINITY;
 const patterns: Omit<Card, 'id' | 'kind'>[] = [
  { name: 'Litany', element: 'air', spellType: 'CONTINGENCY', range: 0, target: 'SELF', effects: mainEffects([moveTarget, { effect: 'DISCARD_QUEST_OR_JINX' }, { effect: 'DRAW_SPELLS', amount: 2 }]),
   rulesText: 'Move up to 1. Discard one active quest or jinx assigned to you. Draw 2 spells.' },
  { name: 'Crypt fever', element: 'earth', spellType: 'CONTINGENCY', range: 2, target: 'MAGE', effects: mainEffects([m.damage(2), assign('VULNERABILITY'), moveTarget, moveTarget, moveSelf]),
   rulesText: 'Inflict 2 damage and assign Vulnerability to the target. Move the target up to 1, then again up to 1. Move yourself up to 1.' },
  { name: 'Black feather', element: 'air', spellType: 'CONTINGENCY', range: 2, target: 'MAGE', effects: unstableEffects([steal, assign('WEAKNESS'), moveSelf]),
   rulesText: 'Steal 1 VP from the target and assign Weakness to it. Move yourself up to 1.' },
  { name: 'Baleful curse', element: 'earth', spellType: 'PROTECTION', range: anyDistance, target: 'MAGE', effects: unstableEffects([m.damage(2), assign('SLOWNESS')]), triggerTarget: 'EVENT_ACTOR',
   triggerText: 'When a mage inflicts damage to you',
   rulesText: 'Target that mage: inflict 2 damage and assign Slowness.',
   trigger: { event: 'DAMAGE_TAKEN', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'ANY', modelKind: 'MAGE', damageOrigins: ['MAGE_PHYSICAL', 'SPELL'] } },
  { name: 'ca\u2019Dario\u2019s amulet', element: 'stars', spellType: 'TRAP', range: anyDistance, target: 'MAGE',
   effects: mainEffects([m.convert(2), { effect: 'INSTABILITY_PER_UNCONVERTED' }, { effect: 'STEAL_VP', amount: 1, when: 'TARGET_JINXED' }, m.damage(2)]), triggerTarget: 'EVENT_MODEL',
   triggerText: 'When another mage enters a blue or purple room',
   rulesText: 'Target that mage: convert 2 damage. For each unconverted damage, place 1 cube in its room. If it has at least 1 jinx assigned, steal 1 VP from it. Inflict 2 damage.',
   trigger: { event: 'ENTER_ROOM', relation: 'ENEMY', scope: 'ANY', modelKind: 'MAGE', roomColors: ['azure', 'violet'] } },
  { name: 'Cerebral worm', element: 'earth', spellType: 'TRAP', range: anyDistance, target: 'MAGE',
   effects: mainEffects([m.damage(2), assign('VULNERABILITY'), { effect: 'INSTABILITY_PER_JINX' }]), triggerTarget: 'EVENT_MODEL',
   triggerText: 'When another mage enters a red or yellow room',
   rulesText: 'Target that mage: inflict 2 damage and assign Vulnerability. For each jinx assigned to it, place 1 cube in its room.',
   trigger: { event: 'ENTER_ROOM', relation: 'ENEMY', scope: 'ANY', modelKind: 'MAGE', roomColors: ['crimson', 'amber'] } },
  { name: 'Feverish dream', element: 'stars', spellType: 'COMBAT', range: 2, target: 'MAGE', effects: unstableEffects([m.damage(2), assign('WEAKNESS'), moveSelf]),
   rulesText: 'Inflict 2 damage and assign Weakness to the target. Move yourself up to 1.' },
  { name: 'An eye for an eye', element: 'air', spellType: 'PROTECTION', range: anyDistance, target: 'MAGE', effects: unstableEffects([{ effect: 'LOSE_VP_OR_PREVENT', amount: 1 }, assign('OBLIVION')]), triggerTarget: 'EVENT_ACTOR',
   triggerText: 'When another mage targets you with a combat spell',
   rulesText: 'Target that mage: it chooses to lose 1 VP or you ignore the effect. Assign Oblivion to it.',
   trigger: { event: 'SPELL_TARGETED', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'ANY', spellTypes: ['COMBAT'] } },
  { name: 'Suffocation', element: 'stars', spellType: 'TRAP', range: anyDistance, target: 'MAGE', effects: unstableEffects([{ effect: 'ACTIVATE_TARGET_ROOM', used: true }, assign('OBLIVION')]), triggerTarget: 'EVENT_MODEL',
   triggerText: 'When another mage resolves a room effect',
   rulesText: 'Target that mage: activate that room, even if it was already used. Assign Oblivion to it.',
   trigger: { event: 'ROOM_ACTIVATED', relation: 'ENEMY', scope: 'ANY', modelKind: 'MAGE' } },
  { name: 'Curse', element: 'stars', spellType: 'COMBAT', range: 2, target: 'MAGE', effects: mainEffects([m.damage(1), m.convert(2), assign('CHOICE'), moveSelf]),
   rulesText: 'Inflict 1 damage and convert 2 damage on the target. Assign a jinx of your choice to it. Move yourself up to 1.' },
  { name: 'Bad luck', element: 'good', spellType: 'TRAP', range: anyDistance, target: 'ROOM', effects: mainEffects([m.convert(2)]), triggerTarget: 'EVENT_ROOM',
   triggerText: 'When another mage places a cube in a room',
   rulesText: 'Target that room: convert 2 cubes there.',
   trigger: { event: 'CUBE_PLACED', relation: 'ENEMY', scope: 'ANY' } },
  { name: 'Cursed oracle', element: 'good', spellType: 'TRAP', range: anyDistance, target: 'MAGE', effects: unstableEffects([steal, assign('SLOWNESS')]), triggerTarget: 'EVENT_MODEL',
   triggerText: 'When another mage solves a quest',
   rulesText: 'Target that mage: steal 1 VP from it and assign Slowness to it.',
   trigger: { event: 'QUEST_SOLVED', relation: 'ENEMY', scope: 'ANY' } },
 ];
 return Array.from({ length: 36 }, (_, i) => ({ ...patterns[i % patterns.length], id: `${prefix}-${i + 1}`, kind: 'SPELL', ...(schoolId ? { schoolId } : {}) }));
}

export function createLibrary(): LibraryDeck[] {
 return [
  { id: 'agony', name: 'Agony', cards: shuffle(createAgonyDeck('agony', 'agony')), discard: [] },
  { id: 'technomancy', name: 'Technomancy', cards: shuffle(createTechnomancyDeck('technomancy', 'technomancy')), discard: [] },
  { id: 'alchemy', name: 'Alchemy', cards: shuffle(createAlchemyDeck('alchemy', 'alchemy')), discard: [] },
  { id: 'nightmare', name: 'Nightmare', cards: shuffle(createNightmareDeck('nightmare', 'nightmare')), discard: [] },
  { id: 'shamanic', name: 'Shamanic', cards: shuffle(createShamanicDeck('shamanic', 'shamanic')), discard: [] },
  { id: 'hex', name: 'Hex', cards: shuffle(createHexDeck('hex', 'hex')), discard: [] },
 ];
}

// A finite, separate supply. These original spells never recycle into a discard.
export function createPowerfulDeck(): Card[] {
 const patterns: Omit<Card,'id'|'kind'>[] = [
  {name:'Rosefall',effects: mainEffects([moment.instability(3), moment.damage(6)]), range:3,target:'ROOM'},
  {name:'Sovereign Wrath',effects: mainEffects([moment.instability(1), moment.damage(8)]), range:4,target:'MODEL'},
  {name:'Worldbreaker',effects: mainEffects([moment.instability(4), moment.damage(4)]), range:2,target:'ROOM'},
 ];
 return shuffle(Array.from({length:12},(_,i)=>({...patterns[i%patterns.length],id:`powerful-${i+1}`,kind:'SPELL' as const,powerful:true})));
}

export function createEvents(): EventCard[] {
 const ongoing = (id: string, name: string, description: string, effect: EventCard['effect'], boardSlot: 0 | 1 | 2, entryPoints: number, exitPoints: number, crown = false): EventCard => ({
  id, name, description, kind: 'ONGOING', effect, boardSlot, amount: 0, rooms: 0, crown, entryPoints, exitPoints, ongoing: { entryPoints, exitPoints },
 });
 const instant = (id: string, name: string, description: string, effect: EventCard['effect'], entryPoints: number, crown = false): EventCard => ({
  id, name, description, kind: 'INSTANT', effect, amount: 0, rooms: 0, entryPoints, crown,
 });
 return shuffle([
  ongoing('event-gift-to-fools', 'Gift to Fools', 'Each Black Rose phase, every mage draws 1 card from a shared library.', 'GIFT_TO_FOOLS', 0, 2, 2),
  instant('event-awakening', 'Awakening', 'The Black Rose places 5 instability in its chamber.', 'AWAKENING', 1),
  instant('event-dislocation', 'Dislocation', 'In player order, each mage chooses any room and is placed there.', 'DISLOCATION', 2),
  instant('event-a-hard-lesson', 'A Hard Lesson', 'Each mage loses 1 VP, then chooses a room within 1 space of their starting cell.', 'A_HARD_LESSON', 1),
  ongoing('event-rebirth-at-noon', 'Rebirth at Noon', 'Each Black Rose phase, the Black Rose places 1 instability in every Azure and Violet room.', 'REBIRTH_AT_NOON', 1, 2, 0),
  { id: 'event-black-thorns', name: 'Black Thorns', description: 'The Black Rose inflicts 2 damage on every mage.', kind: 'BLACK_DAMAGE', effect: 'BLACK_THORNS', amount: 2, rooms: 0, entryPoints: 2, crown: true },
  ongoing('event-rebirth-at-dawn', 'Rebirth at Dawn', 'Each Black Rose phase, the Black Rose places 1 instability in every Crimson and Amber room.', 'REBIRTH_AT_DAWN', 1, 2, 0),
  ongoing('event-rebirth-at-sunset', 'Rebirth at Sunset', 'Each Black Rose phase, the Black Rose places 1 instability in every Emerald and Grey room.', 'REBIRTH_AT_SUNSET', 1, 2, 0),
  ongoing('event-puppeteer', 'Puppeteer', 'During the Action phase, whenever an evocation is defeated or removed, the Black Rose places 1 instability in its room.', 'PUPPETEER', 2, 1, 1, true),
  ongoing('event-midnight-rebirth', 'Midnight Rebirth', 'On each Black Rose phase, the Black Rose places 2 instability in its chamber.', 'MIDNIGHT_REBIRTH', 1, 3, 0),
  ongoing('event-black-overload', 'Black Overload', 'Whenever a mage places instability in a room, the Black Rose places 1 there too.', 'BLACK_OVERLOAD', 0, 1, 1, true),
  ongoing('event-hidden-resources', 'Hidden Resources', 'Whenever a mage is placed in their starting cell, they gain 1 VP.', 'HIDDEN_RESOURCES', 0, 2, 0, true),
  ongoing('event-undead-army', 'Undead Army', 'Each Black Rose phase, each mage may summon a Cadaver in their room.', 'UNDEAD_ARMY', 2, 2, 2),
 ]);
}

// Kept as a compatibility export; the event deck now contains the complete revised event set.
export function createOngoingEvents(): EventCard[] {
 return createEvents().filter(event => event.kind === 'ONGOING');
}

export function createQuests(): Quest[] {
 const reward = (name: string, moments: Moment[], range = 0, target: Card['target'] = 'SELF', targetFilter?: Card['targetFilter']): Card => ({
  id: `${name.toLowerCase().replace(/[^a-z]+/g, '-')}-reward`, name, kind: 'SPELL', effects: mainEffects(moments), range, target, ...(targetFilter?{targetFilter}:{})
 });
 const spell = (spellType: SpellType) => ({event:'SPELL_EFFECT' as const,spellType});
 const patterns: Omit<Quest, 'id'|'progress'|'completed'|'claimed'>[] = [
  {name:'Conspirator Mage',description:'After you resolve a Trap spell effect.',kind:'SPELL_EFFECT',amount:1,reward:1,trigger:spell('TRAP'),rewardAction:reward('Conspirator Mage',[moment.damage(2),moment.instability(1)],Infinity,'MAGE')},
  {name:'Channeling Instability',description:'Reveal. After you resolve an effect that places at least 1 cube in a room.',kind:'INSTABILITY_EFFECT',amount:4,reward:1,trigger:{event:'INSTABILITY_EFFECT'},rewardAction:reward('Channeling Instability',[moment.convert(2),moment.instability(1)],2,'ROOM')},
  {name:'Contingent Mage',description:'Reveal. After you resolve a Contingency spell effect.',kind:'SPELL_EFFECT',amount:3,reward:1,trigger:spell('CONTINGENCY'),rewardAction:reward('Contingent Mage',[{effect:'SEARCH_GRIMOIRE'},moment.instability(1)])},
  {name:'Warrior Wizard',description:'Reveal. After you resolve a Combat spell effect.',kind:'SPELL_EFFECT',amount:3,reward:1,trigger:spell('COMBAT'),rewardAction:reward('Warrior Wizard',[{effect:'REMOVE_EVOCATION',chosen:true},moment.instability(1)],Infinity,'EVOCATION',{maxHealth:3})},
  {name:'Summoner Wizard',description:'Reveal. After you resolve an effect with a summon (not assign).',kind:'SPELL_EFFECT',amount:3,reward:2,trigger:{event:'SPELL_EFFECT',summon:true},rewardAction:reward('Summoner Wizard',[{effect:'ACTIVATE_CHOICE'},moment.instability(1)])},
  {name:'Dominate Fear',description:'After you resolve the effect of a Grey room.',kind:'ROOM_EFFECT',amount:2,reward:2,trigger:{event:'ROOM_EFFECT',roomColor:'grey'},rewardAction:reward('Dominate Fear',[{effect:'ACTIVATE_CHOICE',archetype:'UNDEAD'},moment.instability(1)])},
  {name:'Shattered Illusion',description:'After you resolve the effect of a Blue room.',kind:'ROOM_EFFECT',amount:2,reward:1,trigger:{event:'ROOM_EFFECT',roomColor:'azure'},rewardAction:reward('Shattered Illusion',[moment.instability(1),moment.instability(1)],1,'ROOM')},
  {name:'Guarding Wisdom',description:'After you resolve the effect of an Amber room.',kind:'ROOM_EFFECT',amount:2,reward:1,trigger:{event:'ROOM_EFFECT',roomColor:'amber'},rewardAction:reward('Guarding Wisdom',[{effect:'IF_UNWOUNDED',draw:2,otherwiseHeal:3},moment.instability(1)])},
  {name:'Acquire Wealth',description:'After you resolve the effect of an Emerald room.',kind:'ROOM_EFFECT',amount:2,reward:2,trigger:{event:'ROOM_EFFECT',roomColor:'emerald'},rewardAction:reward('Acquire Wealth',[moment.instability(1)],0,'ROOM')},
  {name:'Field Test',description:'After you resolve the effect of a Crimson room.',kind:'ROOM_EFFECT',amount:2,reward:1,trigger:{event:'ROOM_EFFECT',roomColor:'crimson'},rewardAction:reward('Field Test',[moment.damage(2),moment.instability(1)],2,'MODEL')},
  {name:'Rest the Limbs',description:'After you resolve the effect of a Violet room.',kind:'ROOM_EFFECT',amount:1,reward:1,trigger:{event:'ROOM_EFFECT',roomColor:'violet'},rewardAction:reward('Rest the Limbs',[{effect:'FIRST_PLAYER'},moment.instability(1)])},
  {name:'Guardian Mage',description:'After you resolve a Protection spell effect.',kind:'SPELL_EFFECT',amount:1,reward:1,trigger:spell('PROTECTION'),rewardAction:reward('Guardian Mage',[{effect:'DRAW_SCHOOL',amount:1},moment.instability(1)])},
  {name:'Magic Stream',description:'Reveal. After you resolve a spell effect while you have 3 Fire or Water elements on your revealed cards.',kind:'SPELL_EFFECT',amount:1,reward:2,trigger:{event:'SPELL_EFFECT',elementGroup:['fire','water'],minimumElements:3},rewardAction:reward('Magic Stream',[{effect:'RETURN_REVEALED',elements:['fire','water']},moment.convert(1)],Infinity,'ROOM')},
  {name:'Earth Tempest',description:'Reveal. After you resolve a spell effect while you have 3 Earth or Air elements on your revealed cards.',kind:'SPELL_EFFECT',amount:1,reward:2,trigger:{event:'SPELL_EFFECT',elementGroup:['earth','air'],minimumElements:3},rewardAction:reward('Earth Tempest',[{effect:'RETURN_REVEALED',elements:['earth','air']},moment.damage(2)],2,'ROOM')},
  {name:'Holy Corruption',description:'Reveal. After you resolve a spell effect while you have 3 Good or Evil elements on your revealed cards.',kind:'SPELL_EFFECT',amount:1,reward:2,trigger:{event:'SPELL_EFFECT',elementGroup:['good','evil'],minimumElements:3},rewardAction:reward('Holy Corruption',[{effect:'RETURN_REVEALED',elements:['earth','good','evil']},moment.convert(2)],2,'ROOM')},
 ];
 return shuffle(Array.from({ length: 24 }, (_, i) => ({ ...patterns[i % patterns.length], id: `quest-${i}`, progress: 0, completed: false, claimed: false })));
}