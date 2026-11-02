import React from 'react';
import { JINX_LABELS, JINX_RULES, JINX_TARGET, Jinx } from '@brw/game-engine';

/** Public jinx cards: effect, progress trigger and the three-cube progress track. */
export function JinxList({jinxes,owner,compact=false}:{jinxes:Jinx[];owner?:string;compact?:boolean}) {
 if(!jinxes.length)return null;
 return <ul className={`jinx-list${compact?' jinx-compact':''}`} aria-label={owner?`${owner} jinxes`:'Jinxes'}>
  {jinxes.map(jinx=><li className="jinx-card" key={jinx.id} data-jinx={jinx.name}>
   <div className="jinx-heading"><strong><span aria-hidden="true">⛧ </span>{JINX_LABELS[jinx.name]}</strong>
    <span className="badge jinx-progress" aria-label={`${JINX_LABELS[jinx.name]} progress ${jinx.cubes} of ${JINX_TARGET}`}>{jinx.cubes}/{JINX_TARGET}</span></div>
   {!compact&&<><p className="jinx-effect">{JINX_RULES[jinx.name].effect}</p><p className="hint jinx-trigger">Progress: {JINX_RULES[jinx.name].progress}</p></>}
  </li>)}
 </ul>;
}
