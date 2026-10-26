import React, { useEffect, useRef } from 'react';
import type { GameAction, GameState, PendingDecision } from '@brw/game-engine';

type Props={game:GameState;viewerId:string;connected:boolean;pending:boolean;send:(action:GameAction)=>void};

// The paused action cannot continue until the Succubus owner answers, so the prompt
// is a modal that cannot be dismissed (Escape is ignored).
function DecisionDialog({decision,disabled,send}:{decision:Extract<PendingDecision,{kind:'SOUL_TITHE'}>;disabled:boolean;send:(action:GameAction)=>void}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=ref.current!;
  if(!dialog.open)dialog.showModal();
  return()=>{if(dialog.open)dialog.close();};
 },[]);
 const answer=(accept:boolean)=>send({type:'RESPOND_SOUL_TITHE',playerId:decision.playerId,accept});
 const survives=decision.evocationWounds+1<decision.evocationHealth;
 return <dialog ref={ref} className="info-popup soul-tithe-popup" aria-labelledby="soul-tithe-title" aria-describedby="soul-tithe-body" onCancel={event=>event.preventDefault()}>
  <div className="info-popup-content">
   <span className="eyebrow">Soul Tithe</span>
   <h2 id="soul-tithe-title">Let {decision.evocationName} take a damage cube?</h2>
   <p id="soul-tithe-body">{decision.sourceName} deals {decision.amount} damage to {decision.targetName}. {decision.evocationName} ({decision.evocationWounds}/{decision.evocationHealth} damage) may take one of those cubes instead.{survives?'':` It would be destroyed.`}</p>
   <div className="button-row">
    <button type="button" className="primary" autoFocus disabled={disabled} onClick={()=>answer(true)}>Take a cube</button>
    <button type="button" disabled={disabled} onClick={()=>answer(false)}>Decline</button>
   </div>
   <p className="hint">Turn on the Auto switch on the evocation to accept without being asked.</p>
  </div>
 </dialog>;
}

export function SoulTithePrompt({game,viewerId,connected,pending,send}:Props) {
 const decision=game.pendingDecision;
 if(!decision||decision.kind!=='SOUL_TITHE')return null;
 if(decision.playerId===viewerId)return <DecisionDialog key={decision.key} decision={decision} disabled={!connected||pending} send={send}/>;
 const name=game.players.find(p=>p.id===decision.playerId)?.name??'another mage';
 return <div className="notice soul-tithe-waiting" role="status">Waiting for {name} to decide whether {decision.evocationName} takes a damage cube…</div>;
}
