import React from 'react';
import type { GameAction, GameState, PendingDecision } from '@brw/game-engine';
import { DecisionDialog } from './DecisionDialog';

type Props={game:GameState;viewerId:string;connected:boolean;pending:boolean;send:(action:GameAction)=>void};

// The paused action cannot continue until the Succubus owner answers. The prompt is a modal
// that can be minimized (Escape included) to inspect the board, but never answers by itself.
function SoulTitheDialog({decision,disabled,send}:{decision:Extract<PendingDecision,{kind:'SOUL_TITHE'}>;disabled:boolean;send:(action:GameAction)=>void}) {
 const answer=(accept:boolean)=>send({type:'RESPOND_SOUL_TITHE',playerId:decision.playerId,accept});
 const survives=decision.evocationWounds+1<decision.evocationHealth;
 return <DecisionDialog labelledBy="soul-tithe-title" describedBy="soul-tithe-body" summary={`Soul Tithe · ${decision.evocationName}`}>
   <span className="eyebrow">Soul Tithe</span>
   <h2 id="soul-tithe-title">Let {decision.evocationName} take a damage cube?</h2>
   <p id="soul-tithe-body">{decision.sourceName} deals {decision.amount} damage to {decision.targetName}. {decision.evocationName} ({decision.evocationWounds}/{decision.evocationHealth} damage) may take one of those cubes instead.{survives?'':` It would be destroyed.`}</p>
   <div className="button-row">
    <button type="button" className="primary" autoFocus disabled={disabled} onClick={()=>answer(true)}>Take a cube</button>
    <button type="button" disabled={disabled} onClick={()=>answer(false)}>Decline</button>
   </div>
   <p className="hint">Turn on the Auto switch on the evocation to accept without being asked.</p>
 </DecisionDialog>;
}

export function SoulTithePrompt({game,viewerId,connected,pending,send}:Props) {
 const decision=game.pendingDecision;
 if(!decision||decision.kind!=='SOUL_TITHE')return null;
 if(decision.playerId===viewerId)return <SoulTitheDialog key={decision.key} decision={decision} disabled={!connected||pending} send={send}/>;
 const name=game.players.find(p=>p.id===decision.playerId)?.name??'another mage';
 return <div className="notice soul-tithe-waiting" role="status">Waiting for {name} to decide whether {decision.evocationName} takes a damage cube…</div>;
}
