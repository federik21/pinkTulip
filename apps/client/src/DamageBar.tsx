import React from 'react';
import { BLACK_ROSE_ID, GameState } from '@brw/game-engine';
import { cubeSegments, ownerColor, ownerName } from './presentation';

export function DamageBar({game,name,damageCubes,health,damageByPlayer,blackDamage=0}:{game:GameState;name:string;damageCubes:number;health:number;damageByPlayer:Record<string,number>;blackDamage?:number}) {
 const contributions={...damageByPlayer};
 if(blackDamage>0)contributions[BLACK_ROSE_ID]=(contributions[BLACK_ROSE_ID]??0)+blackDamage;
 const segments=cubeSegments(contributions,damageCubes,health);
 return <div className="damage-meter">
  <div className="health damage-bar" role="meter" aria-label={`${name} damage cubes`} aria-valuemin={0} aria-valuemax={health} aria-valuenow={damageCubes} aria-valuetext={`${damageCubes} damage cubes / ${health} capacity`}>
   {segments.map(segment=><i className={`damage-segment ${segment.id==='unattributed'?'unattributed':''}`} data-owner-id={segment.id} data-cubes={segment.count} key={segment.id} style={{width:`${segment.fraction*100}%`,backgroundColor:ownerColor(segment.id)}}/>)}</div>
  <p className="damage-count">{damageCubes} damage cubes / {health} capacity</p>
  {segments.length>0&&<div className="contributions damage-contributions">{segments.map(segment=><span key={segment.id} style={{'--mage-color':ownerColor(segment.id)} as React.CSSProperties}>{segment.id==='unattributed'?'Unattributed wounds (no cube available)':ownerName(game,segment.id)}: {segment.count}</span>)}</div>}
 </div>;
}