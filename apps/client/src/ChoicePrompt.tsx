import React from 'react';
import type { GameAction, GameState, PendingDecision } from '@brw/game-engine';
import { DecisionDialog } from './DecisionDialog';

type Props={game:GameState;viewerId:string;connected:boolean;pending:boolean;send:(action:GameAction)=>void};

// A generic pick-one prompt: upgrade replacement, evocation removal, library look.
function ChoiceDialog({decision,disabled,send}:{decision:Extract<PendingDecision,{kind:'CHOICE'}>;disabled:boolean;send:(action:GameAction)=>void}) {
 const answer=(choiceId?:string)=>send({type:'RESPOND_CHOICE',playerId:decision.playerId,key:decision.key,...(choiceId===undefined?{}:{choiceId})});
 return <DecisionDialog ariaLabel={decision.prompt} summary={decision.prompt}>
  <span className="eyebrow">Choose</span>
  <h2>{decision.prompt}</h2>
  <div className="button-row" role="group" aria-label="Options">
   {decision.options.map((option,index)=><button type="button" key={option.id} className={index===0?'primary':undefined} disabled={disabled} onClick={()=>answer(option.id)}>{option.label}</button>)}
   {decision.optional&&<button type="button" disabled={disabled} onClick={()=>answer()}>Decline</button>}
  </div>
 </DecisionDialog>;
}

/** Choices whose every option is a room are answered by clicking the map and confirming in the top bar. */
export function isRoomChoice(decision:Extract<PendingDecision,{kind:'CHOICE'}>):boolean {
 return decision.options.length>0&&decision.options.every(o=>!!o.roomId);
}

export function ChoicePrompt({game,viewerId,connected,pending,send}:Props) {
 const decision=game.pendingDecision;
 if(!decision||decision.kind!=='CHOICE'||isRoomChoice(decision))return null;
 if(decision.playerId===viewerId)return <ChoiceDialog key={decision.key} decision={decision} disabled={!connected||pending} send={send}/>;
 return null;
}
