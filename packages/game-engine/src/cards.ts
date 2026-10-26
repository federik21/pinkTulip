import { Card, EventCard, LibraryDeck, Moment, MomentEffect, Quest, SpellType, TriggerCondition } from './types';

const peakOfAgonyMoments=():Moment[]=>[
 {effect:'DAMAGE',amount:2},
 {effect:'BLACK_ROSE_CONVERT',amount:2,scope:'CASTER'},
 {effect:'PAIN',amount:2},
];
const peakOfAgonyRules='';
const painMarkRules='Ongoing: inflict 2 damage on the bound model whenever it deals damage with its own mage physical attack or spell. Evocation attacks, room effects and quest rewards do not trigger Pain Mark.';
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
 summon: (kind: 'SUCCUBUS', position: 'CASTER' | 'TARGET' = 'CASTER'): Moment => ({ effect: 'SUMMON', kind, position }),
 activateEvocation: (kind: 'SUCCUBUS'): Moment => ({ effect: 'ACTIVATE_EVOCATION', kind }),
 // Modifiers: wrap any moment, e.g. `moment.ifTargetDefeated(moment.nearTarget(moment.damage(1), 1))`.
 ifTargetDefeated: (step: Moment): Moment => ({ ...step, when: 'TARGET_DEFEATED' }),
 nearTarget: (step: Moment, range: number): Moment => ({ ...step, area: { range } }),
};

export const momentTotal = (card: Pick<Card, 'moments'>, effect: MomentEffect): number =>
 card.moments.reduce((total, m) => (m.effect === effect && 'amount' in m) ? total + m.amount : total, 0);
export const hasMoment = (card: Pick<Card, 'moments'>, effect: MomentEffect): boolean => momentTotal(card, effect) > 0;

export function getSpellType(card:Card):SpellType {
 return card.spellType ?? (card.moments.some(m => m.effect !== 'HEAL' && 'amount' in m && m.amount > 0) ? 'COMBAT' : 'CONTINGENCY');
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
   const amount = Number(node[field]);
   if (amount > 0) moments.push({ effect, amount });
   delete node[field];
  }
  node.moments = moments;
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

export function createAgonyDeck(prefix: string, schoolId?: string): Card[] {
 const patterns: Omit<Card, 'id' | 'kind'>[] = [
  { name: 'Shared Torture', moments: [moment.damage(4), moment.convert(1), moment.pain(3)], range: 1, target: 'MODEL' },
  { name: 'Grim Torment', moments: [moment.damage(3), moment.pain(1)], range: 2, target: 'MODEL' },
  { name: 'Cross and Delight', moments: [moment.summon('SUCCUBUS'), moment.pain(1), moment.activateEvocation('SUCCUBUS')], range: 1, target: 'ROOM' },
  { name: 'Torment', spellType: 'TRAP', moments: [moment.damage(2), moment.summon('SUCCUBUS', 'TARGET')], range: Number.POSITIVE_INFINITY, target: 'MODEL',
    triggerText: 'When an enemy model deals damage',
   trigger:{event:'DAMAGE_DEALT',relation:'ENEMY',scope:'ANY'}, triggerTarget:'EVENT_ACTOR',
   triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_ACTOR'},{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_ACTOR'}] },
  { name: 'Visceral Fire', moments: [moment.damage(2), moment.ifTargetDefeated(moment.nearTarget(moment.damage(1), 1))], range: 2, target: 'MAGE',
   rulesText: 'Target a mage within range 2 and deal 2 damage. If that mage is defeated, each other mage within range 1 of where it stood suffers 1 damage.' },
  { name: 'Peak of Agony', moments: peakOfAgonyMoments(), range: 2, target: 'ROOM' },
  { name: 'Pain Mark', moments: [], range: 1, target: 'MODEL',
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
  { name: 'Architect of Ruin', description: 'Place the final instability cube in a room.', kind: 'REBUILD', amount: 1, reward: 3, rewardAction: smallReward('Ruin Sigil', [moment.instability(1)], 2, 'ROOM') },
  { name: 'Fracture the Lodge', description: 'Place at least 2 instability in one room with a single spell.', kind: 'INSTABILITY', amount: 2, reward: 2, rewardAction: smallReward('Crack the Wall', [moment.damage(1)], 2, 'MODEL') },
  { name: 'Warden of the Rooms', description: 'Activate 3 rooms.', kind: 'ROOM_ACTIVATE', amount: 3, reward: 2, progress: 0, completed: false, rewardAction: smallReward('Lodge Blessing', [moment.heal(2)], 0, 'SELF') },
 ];
 return shuffle(Array.from({ length: 24 }, (_, i) => ({ ...patterns[i % patterns.length], id: `quest-${i}`, progress: 0, completed: false, claimed: false })));
}