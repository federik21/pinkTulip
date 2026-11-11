import React from 'react';
import { AmountScale, Card, Moment, ELEMENT_GLYPHS, getDarkSide, getMainMoments, getSpellDescription, getSpellType, isUnstable } from '@brw/game-engine';
import { SPELL_TARGET_DESCRIPTIONS, SPELL_TYPE_LABELS } from './presentation';
import { SpellTypeIcon } from './SpellTypeIcon';

function momentConditionText(when: Moment['when']) {
 switch(when) {
  case 'TARGET_DEFEATED':return 'If target defeated · ';
  case 'UPGRADE_ASSIGNED':return 'If upgrade assigned · ';
  case 'EVOCATION_REMOVED':return 'If evocation removed · ';
  default:return '';
 }
}

const SCALE_SOURCES: Record<AmountScale['from'], string> = {
 CASTER_BLACK_DAMAGE: 'BR damage on your mage',
 CASTER_DAMAGE: 'damage on your mage',
 TARGET_DAMAGE: 'damage on the target',
 EVENT_AMOUNT: 'damage suffered',
 DAMAGED_BLACK_DAMAGE: 'BR damage on the models damaged',
 REVEALED_ELEMENT: 'symbol (or wild) on your other revealed spells',
};
function scaleSource(scale: AmountScale) {
 return scale.from === 'REVEALED_ELEMENT' && scale.element ? `${scale.element} ${SCALE_SOURCES.REVEALED_ELEMENT}` : SCALE_SOURCES[scale.from];
}
function amountText(moment: { amount?: number; scale?: AmountScale }) {
 const { scale, amount = 0 } = moment;
 if (!scale) return String(amount);
 return `${amount > 0 ? `${amount} + ` : ''}${scale.each} per ${scale.per > 1 ? `${scale.per} ` : ''}${scaleSource(scale)}${scale.max !== undefined ? ` (max ${scale.max})` : ''}`;
}

function MomentChip({moment,target}:{moment:Moment;target:Card['target']}) {
 const choose=(moment as { choose?: { label: string } }).choose;
 const chip=<MomentChipBody moment={moment} target={target}/>;
 return choose?<span className="choose-effect">{choose.label}: {chip}</span>:chip;
}

function MomentChipBody({moment,target}:{moment:Moment;target:Card['target']}) {
 const prefix=momentConditionText(moment.when);
 switch(moment.effect) {
  case 'DAMAGE':return <span>⚔ {prefix}Inflict {amountText(moment)}{moment.area?moment.area.choose?` · a different model within range ${moment.area.range} of target`:` · each other mage within range ${moment.area.range} of target`:moment.scope==='TARGET_ROOM'?' · every model in target room':moment.scope==='CASTER_ROOM'?' · enemy models in your room':target==='ROOM'?' · enemy models in target room':''}</span>;
  case 'PAIN':return <span>✦ {prefix}Pain {amountText(moment)}</span>;
  case 'INSTABILITY':return <span>◆ {prefix}{amountText(moment)} instability{moment.scope==='CASTER_ROOM'?' · caster’s room':target==='ROOM'?' · target room':''}</span>;
  case 'HEAL':return <span className="heal-effect">♥ {prefix}{moment.amount} heal{moment.scope==='TARGET_ROOM'?' · all models in target room':''}</span>;
  case 'CONVERT':return <span className="convert-effect">↻ {prefix}{moment.amount} convert · {moment.scope==='TARGET_ROOM'?'damage on every model in target room':target==='ROOM'?'room cubes':'damage cubes'}</span>;
  case 'BLACK_ROSE_CONVERT':return <span className="convert-effect">✺ {prefix}BR convert {moment.amount}{moment.scope==='CASTER'?' · your mage · last damage from other mages':''}</span>;
  case 'SUMMON':return <span className="summon-effect">✧ {prefix}Summon {moment.kind==='CHOICE'?`an evocation of your choice${moment.maxHealth!==undefined?` (max ${moment.maxHealth} health)`:''}`:moment.kind==='EVENT_MODEL'?'the lost evocation again':moment.kind}</span>;
  case 'REMOVE_EVOCATION':return <span className="summon-effect">✕ {prefix}{moment.chosen?'Remove the target evocation':`May remove one of your ${moment.archetype==='UNDEAD'?'undead evocations':moment.archetype==='CONSTRUCT'?'constructs':'evocations'} in the target room`}</span>;
  case 'ACTIVATE_EVOCATION':return <span className="summon-effect">↝ {prefix}It activates · move / attack in either order</span>;
  case 'LOSE_VP':return <span>★ {prefix}Lose {moment.amount} VP</span>;
  case 'ATTACK_BONUS':return <span>⚔ {prefix}Next activation +{moment.amount} attack</span>;
  case 'MOVE_DAMAGED':return <span>→ {prefix}Move a damaged model up to {moment.distance}</span>;
  case 'ACTIVATE_ROOM':return <span>⌖ {prefix}Activate that room</span>;
  case 'ACTIVATE_CHOICE':return <span className="summon-effect">↝ {prefix}Activate one of your {moment.archetype==='CONSTRUCT'?'constructs':'evocations'}{moment.attackBonus?` · +${moment.attackBonus} attack`:''}{moment.movementBonus?` · +${moment.movementBonus} movement`:''}</span>;
  case 'GAIN_VP':return <span>★ {prefix}Gain {amountText(moment)} VP</span>;
  case 'GAIN_VP_PER_ALTAR':return <span>★ {prefix}Gain 1 VP per Altar · max {moment.max}</span>;
  case 'COMPLETE_QUEST':return <span>☾ {prefix}Pay moon level in VP to complete an active quest</span>;
  case 'RESHUFFLE_DRAW':return <span>✧ {prefix}Shuffle discard into grimoire · reveal and draw {moment.amount}</span>;
  case 'DRAW_QUEST':return <span>☷ {prefix}Draw 1 quest</span>;
  case 'ACTIVATE_TARGET_ROOM':return <span>⌖ {prefix}Activate the target room</span>;
  case 'MOVE_MODEL':return <span>→ {prefix}Move any model to a room within range {moment.distance}</span>;
  case 'PLACE_ALTAR_CUBES':return <span>◆ {prefix}Place cubes equal to the Altars in play</span>;
  case 'PREVENT_SPELL':return <span>🛡 {prefix}Ignore that spell effect</span>;
  case 'BLACK_ROSE_ALTAR_TITHE':return <span>🛡 {prefix}Optionally damage an Altar for 1 BR VP</span>;
  case 'REDIRECT_DAMAGE':return <span>🛡 {prefix}One of your evocations may suffer the damage instead</span>;
 }
}

// Dark-side details remain face-specific; only the card name and instability are shared.
export function DarkSideDescription({card,showInstability=true,selected=false,chooseSide=false,onSelectSide,disabled=false}:{card:Card;showInstability?:boolean;selected?:boolean;chooseSide?:boolean;onSelectSide?:()=>void;disabled?:boolean}) {
 const dark=getDarkSide(card);
 const type=dark.spellType??'CONTINGENCY';
 const reactive=['TRAP','PROTECTION'].includes(type);
 const moments:Moment[]=reactive?(dark.triggerEffects??dark.moments):dark.ongoing?dark.ongoing.effects:dark.moments;
 const content=<>
  <span className="spell-meta-line"><span className="spell-type" data-spell-type={type}><SpellTypeIcon type={type}/><span>{SPELL_TYPE_LABELS[type]}</span></span><span>Range {dark.range===Number.POSITIVE_INFINITY?'∞':dark.range}</span><span>Target: {SPELL_TARGET_DESCRIPTIONS[dark.target]}</span>{dark.element&&<span className="spell-element" data-element={dark.element}>{ELEMENT_GLYPHS[dark.element]} {dark.element}</span>}{card.powerful&&<span>Remove after use</span>}</span>
  {dark.triggerText&&<span className="spell-trigger">{dark.triggerText}</span>}
  <span className="spell-dark-effects">{showInstability&&isUnstable(card)&&<span>◆ 1 instability · caster’s room</span>}{moments.map((moment,index)=><MomentChip key={index} moment={moment} target={reactive&&'target' in moment?(moment.target==='BOUND_ROOM'||moment.target==='EVENT_ROOM'?'ROOM':'MODEL'):dark.target}/>)}</span>
  {dark.enhancement&&<span className="spell-enhancement">⚗ {dark.enhancement.text}</span>}
  {dark.rulesText&&<span className="spell-rules">{dark.rulesText}</span>}
 </>;
 if(chooseSide)return <button type="button" className="spell-dark-side spell-face-select" data-side="DARK" data-selected={selected?true:undefined} aria-label={`Choose dark face of ${card.name}`} aria-pressed={selected} disabled={disabled} onClick={onSelectSide}>{content}</button>;
 return <span className="spell-dark-side" data-side="DARK">{content}</span>;
}

// Keep the condition above both printed moments and explanatory effect text.
// Reactive effects come from the instructions that actually resolve on reveal.
export function SpellDescription({card,showMoments=false,showInstability=true}:{card:Card;showMoments?:boolean;showInstability?:boolean}) {
 const {triggerText,rulesText}=getSpellDescription(card);
 const reactive=['TRAP','PROTECTION'].includes(getSpellType(card));
 const moments=reactive?(card.triggerEffects??getMainMoments(card)):getMainMoments(card);
 return <>
  {triggerText&&<span className="spell-trigger">{triggerText}</span>}
    {showMoments&&<span className="spell-effects">{showInstability&&isUnstable(card)&&<span>◆ 1 instability · caster’s room</span>}{moments.map((moment,index)=><MomentChip key={index} moment={moment} target={reactive&&'target' in moment?(moment.target==='BOUND_ROOM'||moment.target==='EVENT_ROOM'?'ROOM':'MODEL'):card.target}/>)}</span>}
  {card.enhancement&&<span className="spell-enhancement">⚗ {card.enhancement.text}</span>}
    {rulesText&&<span className="spell-rules">{rulesText}</span>}
 </>;
}