import { describe, expect, it } from 'vitest';
import { createAgonyDeck, getSpellDescription, getSpellType } from '../src';
import { createEnchantmentFixtures } from './enchantment-fixtures';
import type { Card, TriggerCondition, TriggerEvent } from '../src';

const catalog=()=>[...createEnchantmentFixtures(),...createAgonyDeck('agony','agony')];
const isReactive=(card:Card)=>['TRAP','PROTECTION'].includes(getSpellType(card));
const fixture=(overrides:Partial<Card>={}):Card=>({
 id:'description-fixture',name:'Description fixture',kind:'SPELL',spellType:'TRAP',moments:[],range:2,target:'MODEL',...overrides,
});

// These are the full pre-metadata rules: display changes must not rewrite them.
const reactiveDefinitions:Array<{name:string;spellType:'TRAP'|'PROTECTION';triggerText:string;rulesText?:string}>=[
 {name:'Threshold Snare',spellType:'TRAP',triggerText:'When an enemy enters a room within range 2',
  rulesText:'When an enemy enters a room within range 2, reveal and deal 2 damage to that model.'},
 {name:'Spell Leech',spellType:'TRAP',triggerText:'When an enemy casts in a room within range 2',
  rulesText:'When an enemy casts in a room within range 2, reveal and deal 2 damage to that caster before its printed effects resolve.'},
 {name:'Thorn Retort',spellType:'PROTECTION',triggerText:'When damage is dealt to you',
  rulesText:'When damage is dealt to you, reveal and heal 1 wound before dealing 1 damage back to the attacker.'},
 {name:'Mending Ward',spellType:'PROTECTION',triggerText:'When a mage within range 2 takes damage',
  rulesText:'When a mage within range 2 takes damage, reveal and heal that mage 2 wounds. Defeated models cannot be healed.'},
 {name:"Servant's Safeguard",spellType:'PROTECTION',triggerText:'When an evocation within range 3 takes damage',
  rulesText:'When an evocation within range 3 takes damage, reveal and heal it 2 wounds. Destroyed models cannot be healed.'},
 {name:'Hearth Ward',spellType:'PROTECTION',triggerText:'When an enemy activates a room within range 2',
  rulesText:'When an enemy activates a room within range 2, reveal and heal your mage 2 wounds before the room reward.'},
 {name:'Tripwire',spellType:'TRAP',triggerText:'When an enemy evocation activates in a room within range 2 or in a room of the same color',
  rulesText:'When an enemy evocation activates in a room within range 2 or in a room of the same color, reveal and deal 1 damage to it.'},
 {name:'Cinder Seal',spellType:'TRAP',triggerText:'When an enemy activates a room within range 2 or in the same color',
  rulesText:'When an enemy activates a room within range 2 or in the same color, reveal and place 2 instability in that activated room before its reward.'},
 {name:'Torment',spellType:'TRAP',triggerText:'When an enemy model deals damage'},
 {name:'Master of Pleasure',spellType:'TRAP',triggerText:'When another mage solves a quest'},
 {name:'Liquefy the Pain',spellType:'TRAP',triggerText:'When you are defeated'},
];

describe('reactive constructor display metadata',()=>{
 it('covers all 11 unique reactive spells and every physical Protection/Trap copy',()=>{
  const cards=catalog(),reactives=cards.filter(isReactive);
  expect(cards).toHaveLength(72);
  expect(new Set(cards.map(card=>card.id)).size).toBe(72);
  expect(reactives).toHaveLength(33);
  expect(reactives.filter(card=>card.spellType==='PROTECTION')).toHaveLength(12);
  expect(new Set(reactives.map(card=>card.name))).toEqual(new Set(reactiveDefinitions.map(definition=>definition.name)));
  expect(reactives.every(card=>!!card.triggerText)).toBe(true);
  expect(cards.filter(card=>!isReactive(card)).every(card=>card.triggerText===undefined)).toBe(true);
 });

 it.each(reactiveDefinitions)('$name keeps its complete rules and supplies trigger-first, nonduplicated display data',definition=>{
  const copies=catalog().filter(card=>card.name===definition.name);
  expect(copies).toHaveLength(3);
  for(const card of copies) {
   const before=structuredClone(card),condition=card.trigger,effects=card.triggerEffects,moments=card.moments;
   Object.freeze(card);
   expect(card).toMatchObject(definition);
   const description=getSpellDescription(card);
   expect(description).toStrictEqual({triggerText:definition.triggerText,rulesText:definition.rulesText?.slice(definition.rulesText.indexOf(',')+1).trim()});
   expect(Object.keys(description)).toEqual(['triggerText','rulesText']);
   expect(description.rulesText ?? '').not.toMatch(/^When(?:ever)?\b/i);
   expect(card).toStrictEqual(before);
   expect(card.trigger).toBe(condition);expect(card.triggerEffects).toBe(effects);expect(card.moments).toBe(moments);
  }
 });

 it('supports legacy JSON without adding metadata or migrating conditions/effects',()=>{
  for(const card of catalog().filter(c=>isReactive(c)&&c.rulesText)) {
   const legacy=structuredClone(card);delete legacy.triggerText;
   const restored:Card=JSON.parse(JSON.stringify(legacy)),before=structuredClone(restored);
   const separator=card.rulesText!.indexOf(',');
   expect(getSpellDescription(restored)).toStrictEqual({triggerText:card.rulesText!.slice(0,separator),rulesText:card.rulesText!.slice(separator+1).trim()});
   expect(restored).not.toHaveProperty('triggerText');
   expect(restored).toStrictEqual(before);
  }
 });

 it('serializes optional metadata with the full rules, conditions, effects and moments',()=>{
  const cards=catalog(),serialized=JSON.stringify(cards),restored:Card[]=JSON.parse(serialized);
  for(let i=0;i<cards.length;i++) {
   expect(restored[i].triggerText).toBe(cards[i].triggerText);
   expect(restored[i].rulesText).toBe(cards[i].rulesText);
   expect(restored[i].trigger).toStrictEqual(cards[i].trigger);
   expect(restored[i].triggerEffects).toStrictEqual(cards[i].triggerEffects);
   expect(restored[i].moments).toStrictEqual(cards[i].moments);
   expect(getSpellDescription(restored[i])).toStrictEqual(getSpellDescription(cards[i]));
  }
  expect(JSON.stringify(cards)).toBe(serialized);
 });

 it('leaves Agony physical IDs, optional school and printed reactive instructions unchanged',()=>{
  const cards=createAgonyDeck('custom');
  expect(cards.map(card=>card.id)).toEqual(Array.from({length:36},(_,i)=>`custom-${i+1}`));
  expect(cards.every(card=>card.schoolId===undefined)).toBe(true);
  expect(cards.find(card=>card.name==='Torment')).toMatchObject({
   trigger:{event:'DAMAGE_DEALT',relation:'ENEMY',scope:'ANY'},triggerTarget:'EVENT_ACTOR',
   moments:[{effect:'DAMAGE',amount:2},{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET'}],
   triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_ACTOR'},{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_ACTOR'}],
  });
  expect(cards.find(card=>card.name==='Master of Pleasure')).toMatchObject({
   trigger:{event:'QUEST_SOLVED',relation:'ENEMY',scope:'ANY'},triggerTarget:'EVENT_MODEL',moments:[],
   triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_MODEL'},{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_MODEL'}],
  });
  expect(cards.find(card=>card.name==='Liquefy the Pain')).toMatchObject({
   trigger:{event:'MAGE_DEFEATED',relation:'SELF',relationTo:'EVENT_MODEL',scope:'ANY'},triggerTarget:'EVENT_ROOM',moments:[],
   triggerEffects:[{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'EVENT_ROOM'},{effect:'ACTIVATE_EVOCATION',kind:'SUCCUBUS',target:'EVENT_ROOM'}],
  });
 });
});

describe('reactive description splitting',()=>{
 it('prefers explicit metadata even when the legacy leading clause says something else',()=>{
  const card=fixture({triggerText:'When your chosen signal occurs!',rulesText:'When an enemy enters a room, deal 2 damage, then heal 1 wound.',
   trigger:{event:'QUEST_SOLVED',relation:'SELF',scope:'ANY'}}),before=structuredClone(card);
  expect(getSpellDescription(card)).toStrictEqual({triggerText:'When your chosen signal occurs!',rulesText:'deal 2 damage, then heal 1 wound.'});
  expect(card).toStrictEqual(before);
 });

 it.each([
  {rulesText:'When an enemy attacks, heal 2 wounds.',triggerText:'When an enemy attacks',body:'heal 2 wounds.'},
  {rulesText:'Whenever a mage casts, deal 1 damage, then heal 1 wound.',triggerText:'Whenever a mage casts',body:'deal 1 damage, then heal 1 wound.'},
  {rulesText:' \n\tWHENEVER a mage casts  , \n Deal 1 damage!\nThen heal 1 wound. \t',triggerText:'WHENEVER a mage casts',body:'Deal 1 damage!\nThen heal 1 wound.'},
  {rulesText:'when an enemy attacks, “Reveal!” Then choose a model; heal it.',triggerText:'when an enemy attacks',body:'“Reveal!” Then choose a model; heal it.'},
  {rulesText:'When you are defeated,',triggerText:'When you are defeated',body:undefined},
  {rulesText:'Whenever you cast, \t\n ',triggerText:'Whenever you cast',body:undefined},
 ])('splits only the first separator in $rulesText',({rulesText,triggerText,body})=>{
  for(const spellType of ['TRAP','PROTECTION'] as const) {
   const card=fixture({spellType,rulesText}),before=structuredClone(card);
   expect(getSpellDescription(card)).toStrictEqual({triggerText,rulesText:body});
   expect(card).toStrictEqual(before);
  }
 });

 it.each([
  'Deal 2 damage, then heal 1 wound.',
  'Heal 2 wounds. When an enemy attacks, deal 1 damage.',
  'Keep this custom preface; whenever a mage casts, heal 1 wound.',
  'Ongoing: When an enemy casts, deal 1 damage.',
  'When an enemy attacks: heal 2 wounds.',
  'When an enemy attacks.',
  'Whenever an enemy attacks',
  'Whenabouts matter, not a trigger clause.',
  'When , keep this incomplete custom sentence.',
  'Whenever \t, keep this incomplete custom sentence.',
  '  Custom effect only, with its original spacing.  ',
  '',
  ' \t\n ',
 ])('preserves effect-only or nonleading custom prose: %s',rulesText=>{
  const card=fixture({triggerText:'When the custom signal occurs',rulesText});
  expect(getSpellDescription(card)).toStrictEqual({triggerText:'When the custom signal occurs',rulesText});
  expect(card.rulesText).toBe(rulesText);
 });

 it('handles explicit metadata without rules, including punctuation and surrounding whitespace',()=>{
  const card=fixture({triggerText:' \tWhen you are defeated!\n '});
  expect(getSpellDescription(card)).toStrictEqual({triggerText:'When you are defeated!',rulesText:undefined});
  expect(card.triggerText).toBe(' \tWhen you are defeated!\n ');
 });

 it('keeps explicit metadata when a recognizable clause has no effect body',()=>{
  const card=fixture({triggerText:'When the chosen signal occurs.',rulesText:'Whenever an enemy attacks, \n\t'});
  expect(getSpellDescription(card)).toStrictEqual({triggerText:'When the chosen signal occurs.',rulesText:undefined});
  expect(card.rulesText).toBe('Whenever an enemy attacks, \n\t');
 });

 it('ignores blank metadata before trying legacy copy or an actual condition',()=>{
  expect(getSpellDescription(fixture({triggerText:' \n ',rulesText:'Whenever a mage attacks, heal 1 wound.'})))
   .toStrictEqual({triggerText:'Whenever a mage attacks',rulesText:'heal 1 wound.'});
  expect(getSpellDescription(fixture({triggerText:'',trigger:{event:'QUEST_SOLVED',relation:'ENEMY',scope:'ANY'}})))
   .toStrictEqual({triggerText:'When another mage solves a quest',rulesText:undefined});
 });

 it.each(['TRAP','PROTECTION'] as const)('does not fabricate a condition for a public hidden %s card',spellType=>{
  const hidden=fixture({id:'hidden',name:'Hidden spell',spellType}),before=structuredClone(hidden);
  expect(getSpellDescription(hidden)).toStrictEqual({triggerText:undefined,rulesText:undefined});
  expect(hidden).toStrictEqual(before);
  expect(getSpellDescription({...hidden,rulesText:'Custom information only.'})).toStrictEqual({triggerText:undefined,rulesText:'Custom information only.'});
  expect(getSpellDescription({...hidden,triggerText:' \t\n '})).toStrictEqual({triggerText:undefined,rulesText:undefined});
 });

 it('does not use ongoing conditions to invent a missing reactive trigger',()=>{
  const card=fixture({ongoing:{trigger:{event:'ENTER_ROOM',relation:'ENEMY',scope:'ANY'},effects:[]}});
  expect(getSpellDescription(card).triggerText).toBeUndefined();
 });
});

type RelationDescriptions=Record<TriggerCondition['relation'],string>;
const fallbackCases:Record<TriggerEvent,RelationDescriptions>={
 ENTER_ROOM:{SELF:'When one of your models enters a room',ENEMY:'When an enemy model enters a room',ANY:'When a model enters a room'},
 DAMAGE_TAKEN:{SELF:'When a model takes damage from one of your models',ENEMY:'When a model takes damage from an enemy model',ANY:'When a model takes damage'},
 DAMAGE_DEALT:{SELF:'When one of your models deals damage',ENEMY:'When an enemy model deals damage',ANY:'When a model deals damage'},
 SPELL_CAST:{SELF:'When your mage casts a spell',ENEMY:'When another mage casts a spell',ANY:'When a mage casts a spell'},
 ROOM_ACTIVATED:{SELF:'When your mage activates a room',ENEMY:'When another mage activates a room',ANY:'When a mage activates a room'},
 EVOCATION_ACTIVATED:{SELF:'When one of your evocations activates',ENEMY:'When an enemy evocation activates',ANY:'When an evocation activates'},
 MAGE_ATTACK:{SELF:'When your mage attacks',ENEMY:'When another mage attacks',ANY:'When a mage attacks'},
 EVOCATION_ATTACK:{SELF:'When one of your evocations attacks',ENEMY:'When an enemy evocation attacks',ANY:'When an evocation attacks'},
 QUEST_SOLVED:{SELF:'When your mage solves a quest',ENEMY:'When another mage solves a quest',ANY:'When a mage solves a quest'},
 MAGE_DEFEATED:{SELF:'When your mage defeats a mage',ENEMY:'When another mage defeats a mage',ANY:'When a mage is defeated'},
 VP_CHANGED:{SELF:'When one of your models gains or loses victory points',ENEMY:'When an enemy model gains or loses victory points',ANY:'When a model gains or loses victory points'},
};
const modelRelationCases:Partial<Record<TriggerEvent,RelationDescriptions>>={
 DAMAGE_TAKEN:{SELF:'When one of your models takes damage',ENEMY:'When an enemy model takes damage',ANY:'When a model takes damage'},
 MAGE_ATTACK:{SELF:'When a mage attacks one of your models',ENEMY:'When a mage attacks an enemy model',ANY:'When a mage attacks'},
 EVOCATION_ATTACK:{SELF:'When an evocation attacks one of your models',ENEMY:'When an evocation attacks an enemy model',ANY:'When an evocation attacks'},
 MAGE_DEFEATED:{SELF:'When you are defeated',ENEMY:'When another mage is defeated',ANY:'When a mage is defeated'},
};

describe('condition-only generic trigger descriptions',()=>{
 for(const event of Object.keys(fallbackCases) as TriggerEvent[]) {
  for(const relationTo of [undefined,'EVENT_ACTOR','EVENT_MODEL'] as const) {
   it.each(['SELF','ENEMY','ANY'] as const)(`${event}, ${relationTo??'default actor'}, %s`,relation=>{
    const trigger:TriggerCondition={event,relation,scope:'ANY',...(relationTo?{relationTo}:{})};
    const card=fixture({trigger,rulesText:'Resolve the printed effect.'}),before=structuredClone(card);
    const expected=(relationTo==='EVENT_MODEL'?modelRelationCases[event]??fallbackCases[event]:fallbackCases[event])[relation];
    expect(getSpellDescription(card)).toStrictEqual({triggerText:expected,rulesText:'Resolve the printed effect.'});
    expect(getSpellDescription({...card,rulesText:undefined})).toStrictEqual({triggerText:expected,rulesText:undefined});
    expect(card).toStrictEqual(before);
   });
  }
 }

 it.each(['BOUND_MODEL','BOUND_ROOM','BOUND_COLOR','ANY'] as const)('does not invent bindings, range or effects from scope %s',scope=>{
  const card=fixture({trigger:{event:'DAMAGE_DEALT',relation:'ENEMY',scope,damageOrigins:['SPELL']}});
  expect(getSpellDescription(card)).toStrictEqual({triggerText:'When an enemy model deals damage',rulesText:undefined});
 });

 it('does not consult display copy when describing a separate card with the same event condition',()=>{
  const trigger:TriggerCondition={event:'MAGE_DEFEATED',relation:'SELF',relationTo:'EVENT_ACTOR',scope:'ANY'};
  const card=fixture({trigger,triggerText:'An intentionally different display label'}),before=structuredClone(trigger);
  expect(getSpellDescription(card).triggerText).toBe('An intentionally different display label');
  expect(getSpellDescription({...card,triggerText:undefined}).triggerText).toBe('When your mage defeats a mage');
  expect(trigger).toStrictEqual(before);
 });
});

describe('nonreactive descriptions remain untouched',()=>{
 it('preserves all actual ongoing and nonreactive catalog rules without creating a trigger heading',()=>{
  const cards=catalog().filter(card=>!isReactive(card));
  expect(cards.some(card=>card.ongoing&&/^When(?:ever)?\b/.test(card.rulesText??''))).toBe(true);
  for(const card of cards) {
   const before=structuredClone(card);
   expect(getSpellDescription(card)).toStrictEqual({rulesText:card.rulesText});
   expect(card).toStrictEqual(before);
  }
 });

 it.each(['COMBAT','CONTINGENCY',undefined] as const)('does not split or surface trigger metadata for type %s',spellType=>{
  for(const rulesText of [undefined,'',' \tWhen a mage casts, heal 1 wound.\n','Whenever a model gains victory points, deal 2 damage.']) {
   const card=fixture({spellType,triggerText:'Not a reactive header',rulesText,
    trigger:{event:'SPELL_CAST',relation:'ANY',scope:'ANY'},
    ongoing:{trigger:{event:'SPELL_CAST',relation:'ANY',scope:'BOUND_MODEL'},effects:[]}});
   expect(getSpellDescription(card)).toStrictEqual({rulesText});
   expect(getSpellDescription(card)).not.toHaveProperty('triggerText');
  }
 });
});