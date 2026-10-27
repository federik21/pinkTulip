import React from 'react';
import { Card, Moment, getSpellDescription, getSpellType } from '@brw/game-engine';

function MomentChip({moment,target}:{moment:Moment;target:Card['target']}) {
 switch(moment.effect) {
  case 'DAMAGE':return <span>⚔ {moment.when==='TARGET_DEFEATED'?'If target defeated · ':''}Inflict {moment.amount}{moment.area?` · each other mage within range ${moment.area.range} of target`:moment.scope==='CASTER_ROOM'?' · enemy models in your room':target==='ROOM'?' · enemy models in target room':''}</span>;
  case 'PAIN':return <span>✦ Pain {moment.amount}</span>;
  case 'INSTABILITY':return <span>◆ {moment.amount} instability</span>;
  case 'HEAL':return <span className="heal-effect">♥ {moment.amount} heal</span>;
  case 'CONVERT':return <span className="convert-effect">↻ {moment.amount} convert · {target==='ROOM'?'room cubes':'damage cubes'}</span>;
  case 'BLACK_ROSE_CONVERT':return <span className="convert-effect">✺ BR convert {moment.amount}{moment.scope==='CASTER'?' · your mage · last damage from other mages':''}</span>;
  case 'SUMMON':return <span className="summon-effect">✧ Summon {moment.kind}</span>;
  case 'ACTIVATE_EVOCATION':return <span className="summon-effect">↝ It activates · move / attack in either order</span>;
  case 'LOSE_VP':return <span>★ Lose {moment.amount} VP</span>;
  case 'ATTACK_BONUS':return <span>⚔ Next activation +{moment.amount} attack</span>;
  case 'MOVE_DAMAGED':return <span>→ Move a damaged model up to {moment.distance}</span>;
  case 'ACTIVATE_ROOM':return <span>⌖ Activate that room</span>;
  case 'ACTIVATE_CHOICE':return <span className="summon-effect">↝ Activate one of your evocations</span>;
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
    {showMoments&&<span className="spell-effects">{card.instability&&<span>◆ Instability first · 1 cube in your room</span>}{moments.map((moment,index)=><MomentChip key={index} moment={moment} target={reactive&&'target' in moment?(moment.target==='BOUND_ROOM'||moment.target==='EVENT_ROOM'?'ROOM':'MODEL'):card.target}/>)}</span>}
  {rulesText&&<span className="spell-rules">{rulesText}</span>}
  {card.enhancement&&<span className="spell-enhancement">⚗ {card.enhancement.text}</span>}
 </>;
}