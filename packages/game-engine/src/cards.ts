import { Card, Element, EvocationKind, EventCard, GameState, LibraryDeck, Moment, MomentEffect, Player, Quest, SpellType, TriggerCondition, UpgradeName } from './types';

export const ELEMENTS: readonly Element[] = ['air', 'fire', 'water', 'earth', 'evil', 'good', 'stars', 'wild'];
export const ELEMENT_GLYPHS: Readonly<Record<Element, string>> = { air: '🜁', fire: '🜂', water: '🜄', earth: '🜃', evil: '☠', good: '✚', stars: '★', wild: '✦' };

// Symbols shown by the caster's OTHER revealed spells: prepared spells already resolved this round,
// except hidden Trap/Protection cards that are still face down.
export function getRevealedElements(s: Pick<GameState, 'readiedSpells'>, p: Pick<Player, 'id' | 'prepared'>, current: Card): Element[] {
 const hidden = new Set((s.readiedSpells ?? []).filter(a => a.playerId === p.id).map(a => a.card.id));
 return Object.values(p.prepared)
  .filter(x => !!x && x.used && x.card.id !== current.id && !hidden.has(x.card.id))
  .flatMap(x => x!.card.element ? [x!.card.element] : []);
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
 const instabilityPrelude=card.moments[0]?.effect==='INSTABILITY'?[card.moments[0]]:[];
 const printed=instabilityPrelude.length?card.moments.slice(1):card.moments;
 const moments=enhancement.position==='AFTER'?[...instabilityPrelude,...printed,...extra]:[...instabilityPrelude,...extra,...printed];
 return {
  ...rest,
  moments,
  target: enhancement.target ?? card.target,
  range: enhancement.range ?? card.range,
  ...(enhancement.suppressReactions ? { suppressReactions: true } : {}),
 };
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

// Constructors for each Moment variant, e.g. `moments: [moment.damage(1), moment.damage(1)]`.
export const moment = {
 damage: (amount: number): Moment => ({ effect: 'DAMAGE', amount }),
 heal: (amount: number): Moment => ({ effect: 'HEAL', amount }),
 convert: (amount: number): Moment => ({ effect: 'CONVERT', amount }),
 blackRoseConvert: (amount: number): Moment => ({ effect: 'BLACK_ROSE_CONVERT', amount }),
 instability: (amount: number): Moment => ({ effect: 'INSTABILITY', amount }),
 pain: (amount: number): Moment => ({ effect: 'PAIN', amount }),
 summon: (kind: EvocationKind, position: 'CASTER' | 'TARGET' = 'CASTER'): Moment => ({ effect: 'SUMMON', kind, position }),
 activateEvocation: (kind: EvocationKind): Moment => ({ effect: 'ACTIVATE_EVOCATION', kind }),
 assignUpgrade: (upgrade: UpgradeName | 'RANDOM', to?: 'SUMMONED'): Moment => ({ effect: 'ASSIGN_UPGRADE', upgrade, ...(to ? { to } : {}) }),
 activateTarget: (): Moment => ({ effect: 'ACTIVATE_TARGET' }),
 // Modifiers: wrap any moment, e.g. `moment.ifTargetDefeated(moment.nearTarget(moment.damage(1), 1))`.
 ifTargetDefeated: (step: Moment): Moment => ({ ...step, when: 'TARGET_DEFEATED' }),
 ifUpgraded: (step: Moment): Moment => ({ ...step, when: 'UPGRADE_ASSIGNED' }),
 ifRemoved: (step: Moment): Moment => ({ ...step, when: 'EVOCATION_REMOVED' }),
 inTargetRoom: (step: Moment): Moment => ({ ...step, scope: 'TARGET_ROOM' }),
 inCasterRoom: (step: Moment): Moment => ({ ...step, scope: 'CASTER_ROOM' }),
 nearTarget: (step: Moment, range: number): Moment => ({ ...step, area: { range } }),
};

export const momentTotal = (card: Pick<Card, 'moments'>, effect: MomentEffect): number =>
 card.moments.reduce((total, m) => (m.effect === effect && 'amount' in m) ? total + (m.amount ?? 0) : total, 0);
export const hasMoment = (card: Pick<Card, 'moments'>, effect: MomentEffect): boolean => momentTotal(card, effect) > 0;

export function getSpellType(card:Card):SpellType {
 return card.spellType ?? (card.moments.some(m => m.effect !== 'HEAL' && 'amount' in m && (m.amount ?? 0) > 0) ? 'COMBAT' : 'CONTINGENCY');
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

// Saved games written before moments existed carry flat damage/instability/heal/convert
// fields. Rewrite those cards in place, keeping the old fixed resolution order.
// JSON also writes Infinity as null; restore spell ranges on both load and receipt.
export function upgradeLegacyCards(value: unknown): void {
 if (!value || typeof value !== 'object') return;
 if (Array.isArray(value)) { value.forEach(upgradeLegacyCards); return; }
 const node = value as Record<string, unknown>;
 if (node.kind === 'SPELL' && node.range === null) node.range = Number.POSITIVE_INFINITY;
 if (node.kind === 'SPELL' && !Array.isArray(node.moments)) {
  const moments: Moment[] = [];
  for (const [field, effect] of [['instability', 'INSTABILITY'], ['convert', 'CONVERT'], ['heal', 'HEAL'], ['damage', 'DAMAGE']] as const) {
    if(field==='instability'&&node[field]===true) {
     moments.push({effect,amount:1,scope:'CASTER_ROOM'});
     delete node[field];
     continue;
    }
   const amount = Number(node[field]);
   if (amount > 0) moments.push({ effect, amount });
   delete node[field];
  }
  node.moments = moments;
 }
 if(node.kind==='SPELL'&&Array.isArray(node.moments)&&Number(node.instability)>0) {
  const amount=Number(node.instability);
  delete node.instability;
  const instability:Moment={effect:'INSTABILITY',amount,scope:'CASTER_ROOM'};
  if(node.trigger&&Array.isArray(node.triggerEffects)&&node.moments.length===0) {
   node.triggerEffects.unshift({...instability,target:'OWNER'});
  } else (node.moments as Moment[]).unshift(instability);
 }
 // The removed `splash` field on a damage moment becomes a conditional follow-up moment.
 if(node.kind==='SPELL'&&Array.isArray(node.moments)&&node.moments.some((m:any)=>m?.splash)) {
  node.moments=(node.moments as any[]).flatMap(m=>{
   if(!m?.splash)return [m];
   const {splash,...base}=m;
   return [base,{effect:'DAMAGE',amount:splash.amount??base.amount,when:'TARGET_DEFEATED',area:{range:splash.range}}];
  });
 }
 if(node.kind==='SPELL'&&node.name==='Peak of Agony'&&(node.schoolId==='agony'||String(node.id).startsWith('agony-'))&&Array.isArray(node.moments)) {
  const steps=node.moments as Moment[];
  if(steps.length===2&&steps[0].effect==='DAMAGE'&&steps[0].amount===2&&(!steps[0].scope||steps[0].scope==='CASTER_ROOM')&&steps[1].effect==='BLACK_ROSE_CONVERT'&&steps[1].amount===2&&(!steps[1].scope||steps[1].scope==='CASTER')) {
   node.moments=peakOfAgonyMoments();node.target='ROOM';node.range=2;
  }
 }
 if(node.kind==='SPELL'&&node.name==='Pain Mark'&&(node.schoolId==='agony'||String(node.id).startsWith('agony-'))) {
  const ongoing=node.ongoing as Card['ongoing'];
  if(ongoing?.trigger.event==='DAMAGE_DEALT'&&!ongoing.trigger.damageOrigins) {
   ongoing.trigger.damageOrigins=['MAGE_PHYSICAL','SPELL'];node.rulesText=painMarkRules;
  }
 }
 if(node.kind==='SPELL'&&node.name==='Liquefy the Pain'&&(node.schoolId==='agony'||String(node.id).startsWith('agony-'))&&Array.isArray(node.moments)&&node.moments.length===0) {
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
const AGONY_ELEMENTS: Element[] = ['evil', 'fire', 'stars', 'water', 'fire', 'evil', 'wild', 'earth', 'good', 'evil', 'air', 'water'];
const TECHNOMANCY_ELEMENTS: Element[] = ['earth', 'water', 'air', 'stars', 'fire', 'evil', 'earth', 'wild', 'good', 'stars', 'air', 'fire'];

export function createAgonyDeck(prefix: string, schoolId?: string): Card[] {
 const patterns: Omit<Card, 'id' | 'kind'>[] = [
  { name: 'Shared Torture', moments: [moment.damage(4), moment.convert(1), moment.pain(3)], range: 1, target: 'MODEL' },
  { name: 'Grim Torment', moments: [moment.inCasterRoom(moment.instability(1)), moment.damage(3), moment.pain(1)], range: 2, target: 'MODEL' },
  { name: 'Cross and Delight', moments: [moment.inCasterRoom(moment.instability(1)), moment.summon('SUCCUBUS'), moment.pain(1), moment.activateEvocation('SUCCUBUS')], range: 1, target: 'ROOM' },
  { name: 'Torment', spellType: 'TRAP', moments: [moment.damage(2), moment.summon('SUCCUBUS', 'TARGET')], range: Number.POSITIVE_INFINITY, target: 'MODEL',
    triggerText: 'When an enemy model deals damage',
   trigger:{event:'DAMAGE_DEALT',relation:'ENEMY',scope:'ANY'}, triggerTarget:'EVENT_ACTOR',
   triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_ACTOR'},{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_ACTOR'}] },
  { name: 'Visceral Fire', moments: [moment.inCasterRoom(moment.instability(1)), moment.damage(2), moment.ifTargetDefeated(moment.nearTarget(moment.damage(1), 1))], range: 2, target: 'MAGE',
   rulesText: 'Target a mage within range 2 and deal 2 damage. If that mage is defeated, each other mage within range 1 of where it stood suffers 1 damage.' },
  { name: 'Peak of Agony', moments: peakOfAgonyMoments(), range: 2, target: 'ROOM' },
  { name: 'Pain Mark', spellType: 'CONTINGENCY', moments: [moment.inCasterRoom(moment.instability(1))], range: 1, target: 'MODEL',
    rulesText: painMarkRules,
    ongoing: { trigger: { event: 'DAMAGE_DEALT', relation: 'ANY', scope: 'BOUND_MODEL', damageOrigins:['MAGE_PHYSICAL','SPELL'] }, effects: [{ effect: 'DAMAGE', amount: 2, target: 'EVENT_ACTOR' }] } },
  { name: 'Master of Pleasure', spellType: 'TRAP', moments: [], range: Number.POSITIVE_INFINITY, target: 'MAGE',
    triggerText: 'When another mage solves a quest',

    trigger:{event:'QUEST_SOLVED',relation:'ENEMY',scope:'ANY'}, triggerTarget:'EVENT_MODEL',
    triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_MODEL'},{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_MODEL'}] },
  { name: 'Liquefy the Pain', spellType: 'TRAP', moments: [], range: Number.POSITIVE_INFINITY, target: 'ROOM',
    triggerText: 'When you are defeated',
    trigger:{event:'MAGE_DEFEATED',relation:'SELF',relationTo:'EVENT_MODEL',scope:'ANY'}, triggerTarget:'EVENT_ROOM',
    triggerEffects:liquefyThePainEffects() },
  { name: 'Submission', moments: [moment.damage(1), moment.convert(1), moment.pain(1)], range: Number.POSITIVE_INFINITY, target: 'MODEL' },
  { name: 'Ineluctable Pain', spellType: 'CONTINGENCY', moments: [moment.inCasterRoom(moment.instability(1))], range: 2, target: 'MODEL',
   rulesText: 'Whenever a model gains or loses victory points, it suffers 2 damage.',
   ongoing:{trigger:{event:'VP_CHANGED',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'DAMAGE',amount:2,target:'EVENT_MODEL'}]} },
  { name: 'Hearth of Ice', moments: [moment.damage(3), moment.convert(2), moment.pain(2)], range: 2, target: 'MODEL' },
 ];
 return Array.from({ length: 36 }, (_, i) => ({ ...patterns[i % patterns.length], element: AGONY_ELEMENTS[i % patterns.length], id: `${prefix}-${i + 1}`, kind: 'SPELL', ...(schoolId ? {schoolId} : {}) }));
}


export function createTechnomancyDeck(prefix: string, schoolId?: string): Card[] {
 const m = moment;
 const patterns: Omit<Card, 'id' | 'kind'>[] = [
  { name: 'Protean Genesis', spellType: 'CONTINGENCY', range: 2, target: 'ROOM', moments: [m.instability(1), m.summon('CADAVER', 'TARGET'), m.activateEvocation('CADAVER')],
   rulesText: 'Place 1 instability in the target room, summon a Cadaver there and activate it.' },
  { name: 'Living Liquid', spellType: 'COMBAT', range: 2, target: 'EVOCATION', moments: [m.assignUpgrade('REGENERATING_ICHOR'), { ...m.ifUpgraded(m.heal(2)), scope: 'CASTER' }],
   rulesText: 'Assign Regenerating ichor to the target evocation (even an enemy). If you do, heal 2 on your mage.' },
  { name: 'Acid Blood', spellType: 'COMBAT', range: 2, target: 'EVOCATION', moments: [m.assignUpgrade('CORROSIVE_PLASMA'), m.ifUpgraded(m.inTargetRoom(m.damage(1)))],
   rulesText: 'Assign Corrosive plasma to the target evocation. If you do, inflict 1 damage on every model in the target\u2019s room.' },
  { name: 'Kinetic Infusion', spellType: 'CONTINGENCY', range: 2, target: 'EVOCATION', moments: [m.assignUpgrade('TENDON_IMPLANT'), m.ifUpgraded(m.instability(1))],
   rulesText: 'Assign Tendon implant to the target evocation. If you do, place 1 instability cube in the target\u2019s room.' },
  { name: 'Vigorous Infusion', spellType: 'CONTINGENCY', range: 2, target: 'EVOCATION', moments: [m.inCasterRoom(m.instability(1)), m.assignUpgrade('MUSCULAR_IMPLANT'), m.activateTarget()],
   rulesText: 'Assign Muscular implant to the target evocation. It activates under your control.' },
  { name: 'Indoctrination', spellType: 'CONTINGENCY', range: 2, target: 'EVOCATION', moments: [m.inCasterRoom(m.instability(1)), m.assignUpgrade('CEREBRAL_IMPLANT'), m.activateTarget()],
   rulesText: 'Assign Cerebral implant to the target evocation. It activates under your control.' },
  { name: 'Nefarious Evolution', spellType: 'CONTINGENCY', range: 2, target: 'EVOCATION', moments: [{ effect: 'REMOVE_EVOCATION', archetype: 'UNDEAD' }, { effect: 'SUMMON', kind: 'COLOSSUS', position: 'REMOVED', when: 'EVOCATION_REMOVED' }],
   rulesText: 'You may remove one of your undead evocations in the target\u2019s room. If you do, summon a Colossus in that room.' },
  { name: 'Mutant Energies', spellType: 'CONTINGENCY', range: 2, target: 'EVOCATION', moments: [m.inCasterRoom(m.instability(1)), { effect: 'REMOVE_EVOCATION' }, m.ifRemoved({ effect: 'REMOVED_BLAST' })],
   rulesText: 'You may remove one of your evocations in the target\u2019s room. If you do, inflict damage equal to its attack on every mage in that room and up to 1 room away.' },
  { name: 'Craft', spellType: 'CONTINGENCY', range: 1, target: 'ROOM', moments: [m.summon('CADAVER', 'TARGET'), m.assignUpgrade('RANDOM', 'SUMMONED')],
   rulesText: 'Summon a Cadaver in the target room, then assign it a random upgrade.' },
  { name: 'Mechanical Archive', spellType: 'CONTINGENCY', range: 0, target: 'SELF', moments: [m.inCasterRoom(m.instability(1)), { effect: 'LOOK_LIBRARY', cards: 4 }],
   rulesText: 'Look at 4 cards from a single library school. Draw 1 and discard the rest to that school\u2019s discard pile.' },
  { name: 'Draco\u2019s Skin', spellType: 'TRAP', range: Number.POSITIVE_INFINITY, target: 'SELF', moments: [],
   rulesText: 'When one of your evocations is defeated or removed, summon that model again where it stood and assign Reinforced dermis to it.',
   trigger: { event: 'EVOCATION_LOST', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'ANY' },
   triggerEffects: [{ effect: 'SUMMON', kind: 'EVENT_MODEL', position: 'EVENT', target: 'OWNER' }, { effect: 'ASSIGN_UPGRADE', upgrade: 'REINFORCED_DERMIS', to: 'SUMMONED', target: 'OWNER' }] },
  { name: 'Necrotic Pheromones', spellType: 'TRAP', range: 2, target: 'EVOCATION', moments: [m.inCasterRoom(m.instability(1)), m.activateTarget()], triggerSight: 2, targetFrom: 'EVENT_MODEL',
   rulesText: 'When another mage enters a room at range 2 and in line of sight, choose an evocation at range 2 from that mage. It activates under your control.',
   trigger: { event: 'ENTER_ROOM', relation: 'ENEMY', scope: 'ANY' } },
 ];
 return Array.from({ length: 36 }, (_, i) => ({ ...patterns[i % patterns.length], element: TECHNOMANCY_ELEMENTS[i % patterns.length], id: `${prefix}-${i + 1}`, kind: 'SPELL', ...(schoolId ? {schoolId} : {}) }));
}

export function createAlchemyDeck(prefix: string, schoolId?: string): Card[] {
 const m = moment;
 const patterns: Omit<Card, 'id' | 'kind'>[] = [
  { name: 'Azoth Bomb', element: 'air', spellType: 'COMBAT', range: 3, target: 'ROOM', moments: [m.damage(2)],
   enhancement: { requires: ['water', 'water'], moments: [m.damage(2)], position: 'BEFORE', text: 'Enhancement (2 water symbols): first inflict 2 damage.' },
   rulesText: 'Inflict 2 damage on every enemy model in the target room.' },
  { name: 'Viatorium Spagyricum', element: 'water', spellType: 'COMBAT', range: 0, target: 'MODEL', targetFilter: { sameRoom: true }, moments: [m.inCasterRoom(m.instability(1)), m.damage(2)],
   enhancement: { requires: ['fire', 'water'], moments: [m.damage(3)], position: 'BEFORE', text: 'Enhancement (fire and water): first inflict 3 damage.' },
   rulesText: 'Target a model in your room and inflict 2 damage.' },
  { name: 'Deflagrate', element: 'water', spellType: 'COMBAT', range: 2, target: 'MODEL', moments: [m.damage(2), { effect: 'MOVE_DAMAGED', distance: 1 }],
   enhancement: { requires: ['earth', 'earth'], target: 'ROOM', range: 2, text: 'Enhancement (2 earth symbols): the target becomes a room at range 2.' },
   rulesText: 'Inflict 2 damage, then move one model that suffered damage from this effect up to 1.' },
  { name: 'Athanor Eruption', element: 'fire', spellType: 'COMBAT', range: 1, target: 'MODEL', moments: [m.damage(3)],
   enhancement: { requires: ['air', 'earth'], moments: [m.damage(1)], position: 'BEFORE', suppressReactions: true, text: 'Enhancement (air and earth): first inflict 1 damage; Traps and Protections will not trigger during this spell.' },
   rulesText: 'Inflict 3 damage.' },
  { name: 'Marbling', element: 'earth', spellType: 'COMBAT', range: 0, target: 'SELF', moments: [{ effect: 'DAMAGE', amount: 1, scope: 'ALL_MAGES' }],
   enhancement: { requires: ['fire', 'fire'], moments: [{ effect: 'DAMAGE', amount: 1, scope: 'ALL_MAGES' }], position: 'BEFORE', text: 'Enhancement (2 fire symbols): first inflict 1 damage to each mage.' },
   rulesText: 'Inflict 1 damage to each mage.' },
  { name: 'Stone Phoenix', element: 'earth', spellType: 'TRAP', range: Number.POSITIVE_INFINITY, target: 'ROOM', moments: [],
   triggerText: 'When one of your evocations is defeated or removed',
   rulesText: 'Summon a Nigredo in the room where it was lost.',
   trigger: { event: 'EVOCATION_LOST', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'ANY' }, triggerTarget: 'EVENT_ROOM',
   triggerEffects: [{ effect: 'SUMMON', kind: 'NIGREDO', position: 'TARGET', target: 'EVENT_ROOM' }] },
  { name: 'Soul Transfer', element: 'wild', spellType: 'CONTINGENCY', range: Number.POSITIVE_INFINITY, target: 'EVOCATION', targetFilter: { own: true, archetype: 'CONSTRUCT' }, moments: [{ effect: 'ACTIVATE_ROOM' }],
   rulesText: 'Choose one of your constructs. Activate the room it stands in, even if the room was already used this round. Not the central chamber.' },
  { name: 'Liquid Fire', element: 'fire', spellType: 'COMBAT', range: Number.POSITIVE_INFINITY, target: 'EVOCATION', targetFilter: { own: true }, moments: [m.inCasterRoom(m.instability(1)), { effect: 'REMOVE_EVOCATION', chosen: true }, m.ifRemoved({ effect: 'REMOVED_BLAST', amount: 2, models: true })],
   enhancement: { requires: ['air', 'water'], moments: [m.ifRemoved({ effect: 'DAMAGE', amount: 1, scope: 'DAMAGED' })], position: 'AFTER', text: 'Enhancement (air and water): then inflict 1 damage to each model that suffered damage from this effect.' },
   rulesText: 'Remove the target evocation (yours). If you do, inflict 2 damage to every model in its room and up to 1 room away.' },
  { name: 'Fountain of the Three', element: 'earth', spellType: 'CONTINGENCY', range: 1, target: 'EVOCATION', targetFilter: { maxHealth: 2 }, moments: [{ effect: 'REMOVE_EVOCATION', chosen: true }, m.ifRemoved({ effect: 'SUMMON', kind: 'NIGREDO', position: 'CHOICE' })],
   enhancement: { requires: ['water', 'fire'], moments: [{ effect: 'ACTIVATE_CHOICE', archetype: 'CONSTRUCT', attackBonus: 1 }], position: 'AFTER', text: 'Enhancement (water and fire): then choose one of your constructs; it activates with +1 attack.' },
   rulesText: 'Target an evocation with less than 3 health. Remove it. If you do, summon a Nigredo in a room of your choice.' },
  { name: 'Purifying Aludel', element: 'air', spellType: 'CONTINGENCY', range: Number.POSITIVE_INFINITY, target: 'EVOCATION', moments: [m.inCasterRoom(m.instability(1)), m.heal(3), m.activateTarget()],
   enhancement: { requires: ['water', 'earth'], moments: [{ effect: 'ATTACK_BONUS', amount: 2 }], position: 'BEFORE', text: 'Enhancement (water and earth): the next time the target activates it has +2 attack.' },
   rulesText: 'Heal 3 on the target evocation, then activate it.' },
  { name: 'Albify', element: 'water', spellType: 'COMBAT', range: 1, target: 'MAGE', moments: [m.inCasterRoom(m.instability(1)), m.convert(4)],
   enhancement: { requires: ['air', 'air'], moments: [{ effect: 'LOSE_VP', amount: 2 }], position: 'BEFORE', text: 'Enhancement (2 air symbols): the target loses 2 victory points.' },
   rulesText: 'Convert 4 damage on the target mage.' },
  { name: 'Silver of the Sages', element: 'wild', spellType: 'PROTECTION', range: Number.POSITIVE_INFINITY, target: 'SELF', moments: [],
   triggerText: 'When you suffer damage',
   rulesText: 'Ignore up to 2 of that damage. Then activate one of your evocations; when the activation ends the Black Rose inflicts 1 damage on it.',
   trigger: { event: 'DAMAGE_TAKEN', relation: 'SELF', relationTo: 'EVENT_MODEL', scope: 'BOUND_MODEL' },
    triggerEffects: [{ effect: 'INSTABILITY', amount: 1, scope: 'CASTER_ROOM', target: 'OWNER' }, { effect: 'HEAL', amount: 2, target: 'EVENT_MODEL' }, { effect: 'ACTIVATE_CHOICE', endDamage: 1, target: 'OWNER' }] },
 ];
 return Array.from({ length: 36 }, (_, i) => ({ ...patterns[i % patterns.length], id: `${prefix}-${i + 1}`, kind: 'SPELL', ...(schoolId ? {schoolId} : {}) }));
}

export function createLibrary(): LibraryDeck[] {
 return [
  { id: 'agony', name: 'Agony', cards: shuffle(createAgonyDeck('agony', 'agony')), discard: [] },
  { id: 'technomancy', name: 'Technomancy', cards: shuffle(createTechnomancyDeck('technomancy', 'technomancy')), discard: [] },
  { id: 'alchemy', name: 'Alchemy', cards: shuffle(createAlchemyDeck('alchemy', 'alchemy')), discard: [] },
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
 const instant: EventCard[] = Array.from({ length: 12 }, (_, i) => i % 2 === 0
  ? { id: `event-${i}`, name: 'The Lodge Trembles', description: 'Place 1–2 BR instability in two random unfinished rooms.', kind: 'INSTABILITY' as const, amount: 1 + (i % 3 === 0 ? 1 : 0), rooms: 2 }
  : { id: `event-${i}`, name: 'Thorns of BR', description: 'Every mage suffers black damage. No player receives kill credit.', kind: 'BLACK_DAMAGE' as const, amount: i % 3 === 0 ? 2 : 1, rooms: 0 });
 return shuffle([...instant, ...createOngoingEvents()]);
}

// Ongoing events sit on the 3-place event board and score for BR on entry/exit.
export function createOngoingEvents(): EventCard[] {
 const patterns: { name: string; entryPoints: number; exitPoints: number }[] = [
  { name: 'Gathering Dread', entryPoints: 2, exitPoints: 0 },
  { name: 'Slow Harvest', entryPoints: 0, exitPoints: 3 },
  { name: 'Rose Tithe', entryPoints: 1, exitPoints: 1 },
  { name: 'Fading Echo', entryPoints: 1, exitPoints: 2 },
 ];
 return Array.from({ length: patterns.length * 2 }, (_, i) => {
  const { name, entryPoints, exitPoints } = patterns[i % patterns.length];
  const parts = [entryPoints ? `BR gains ${entryPoints} VP when it enters.` : '', exitPoints ? `BR gains ${exitPoints} VP when it shifts out.` : ''].filter(Boolean);
  return { id: `ongoing-event-${i}`, name, description: `Ongoing. ${parts.join(' ')}`, kind: 'ONGOING' as const, amount: 0, rooms: 0, ongoing: { entryPoints, exitPoints } };
 });
}

export function createQuests(): Quest[] {
 const smallReward = (name: string, moments: Moment[], range = 0, target: Card['target'] = 'SELF'): Card => ({ id: `${name.toLowerCase().replace(/[^a-z]+/g, '-')}-reward`, name, kind: 'SPELL', moments, range, target });
 const patterns: Omit<Quest, 'id'>[] = [
  { name: 'Architect of Ruin', description: 'Place the final instability cube in a room.', kind: 'REBUILD', amount: 1, reward: 3, rewardAction: smallReward('Ruin Sigil', [moment.instability(1)], 2, 'ROOM') },
  { name: 'Fracture the Lodge', description: 'Place at least 2 instability in one room with a single spell.', kind: 'INSTABILITY', amount: 2, reward: 2, rewardAction: smallReward('Crack the Wall', [moment.damage(1)], 2, 'MODEL') },
  { name: 'Warden of the Rooms', description: 'Activate 3 rooms.', kind: 'ROOM_ACTIVATE', amount: 3, reward: 2, progress: 0, completed: false, rewardAction: smallReward('Lodge Blessing', [moment.heal(2)], 0, 'SELF') },
 ];
 return shuffle(Array.from({ length: 24 }, (_, i) => ({ ...patterns[i % patterns.length], id: `quest-${i}`, progress: 0, completed: false, claimed: false })));
}