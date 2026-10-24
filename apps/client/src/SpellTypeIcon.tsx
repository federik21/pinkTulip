import React from 'react';
import type { SpellType } from '@brw/game-engine';
import { SPELL_TYPE_LABELS } from './presentation';

export function SpellTypeIcon({type}:{type:SpellType}) {
 const label=`${SPELL_TYPE_LABELS[type]} spell`;
 if(type==='TRAP')return <svg className="spell-type-icon bear-trap" viewBox="0 0 32 32" role="img" aria-label={label}>
  <title>Bear trap</title>
  <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
   <path d="M4 18c0 7 5 11 12 11s12-4 12-11M4 18l3 4 2-5 3 6 4-5 4 5 3-6 2 5 3-4"/>
   <path d="M5 13C5 6 10 3 16 3s11 3 11 10l-3-3-2 5-3-5-3 5-3-5-3 5-2-5-3 3Z"/>
   <path d="M9 24h14M16 15v8M12 20h8M27 24l3 2-2 3"/>
  </g>
 </svg>;
 return <span className="spell-type-icon" role="img" aria-label={label}>{type==='COMBAT'?'⚡':type==='CONTINGENCY'?'🔮':'🛡️'}</span>;
}