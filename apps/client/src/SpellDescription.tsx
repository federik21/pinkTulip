import React from 'react';
import { Card, Moment, getSpellDescription, getSpellType } from '@brw/game-engine';
import { SPELL_TARGET_DESCRIPTIONS } from './presentation';

function momentConditionText(when: Moment['when']) {
 switch(when) {
  case 'TARGET_DEFEATED':return 'If target defeated · ';
  case 'UPGRADE_ASSIGNED':return 'If upgrade assigned · ';
  case 'EVOCATION_REMOVED':return 'If evocation removed · ';
  default:return '';
 }
}

function MomentChip({moment,target}:{moment:Moment;target:Card['target']}) {
 const prefix=momentConditionText(moment.when);
 switch(moment.effect) {
  case 'DAMAGE':return <span>⚔ {prefix}Inflict {moment.amount}{moment.area?` · each other mage within range ${moment.area.range} of target`:moment.scope==='CASTER_ROOM'?' · enemy models in your room':target==='ROOM'?' · enemy models in target room':''}</span>;
  case 'PAIN':return <span>✦ {prefix}Pain {moment.amount}</span>;
  case 'INSTABILITY':return <span>◆ {prefix}{moment.amount} instability</span>;
  case 'HEAL':return <span className="heal-effect">♥ {prefix}{moment.amount} heal</span>;
  case 'CONVERT':return <span className="convert-effect">↻ {prefix}{moment.amount} convert · {target==='ROOM'?'room cubes':'damage cubes'}</span>;
  case 'BLACK_ROSE_CONVERT':return <span className="convert-effect">✺ {prefix}BR convert {moment.amount}{moment.scope==='CASTER'?' · your mage · last damage from other mages':''}</span>;
  case 'SUMMON':return <span className="summon-effect">✧ {prefix}Summon {moment.kind}</span>;
  case 'ACTIVATE_EVOCATION':return <span className="summon-effect">↝ {prefix}It activates · move / attack in either order</span>;
  case 'LOSE_VP':return <span>★ {prefix}Lose {moment.amount} VP</span>;
  case 'ATTACK_BONUS':return <span>⚔ {prefix}Next activation +{moment.amount} attack</span>;
  case 'MOVE_DAMAGED':return <span>→ {prefix}Move a damaged model up to {moment.distance}</span>;
  case 'ACTIVATE_ROOM':return <span>⌖ {prefix}Activate that room</span>;
  case 'ACTIVATE_CHOICE':return <span className="summon-effect">↝ {prefix}Activate one of your evocations</span>;
 }
}

// Keep the condition above both printed moments and explanatory effect text.
// Reactive effects come from the instructions that actually resolve on reveal.
export function SpellDescription({card,showMoments=false}:{card:Card;showMoments?:boolean}) {
 const {triggerText,rulesText}=getSpellDescription(card);
 const reactive=['TRAP','PROTECTION'].includes(getSpellType(card));
 const moments=reactive?(card.triggerEffects??card.moments):card.moments;
 return <>
  {triggerText&&<span className="spell-trigger">{triggerText}</span>}
  {showMoments&&<span className="spell-effects">{moments.map((moment,index)=><MomentChip key={index} moment={moment} target={reactive&&'target' in moment?(moment.target==='BOUND_ROOM'||moment.target==='EVENT_ROOM'?'ROOM':'MODEL'):card.target}/>)}</span>}
  {card.enhancement&&<span className="spell-enhancement">⚗ {card.enhancement.text}</span>}
  {rulesText&&<span className="spell-rules"> full card text: {rulesText}</span>}
 </>;
}