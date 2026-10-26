import React, { useEffect, useRef, useState } from 'react';
import { Card, GameAction, GameState, PendingDecision, getSpellType } from '@brw/game-engine';
import { SPELL_TYPE_LABELS } from './presentation';

function Modal({title,children,onCancel}:{title:string;children:React.ReactNode;onCancel?:()=>void}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=ref.current!,previous=document.activeElement;
  dialog.showModal();
  return()=>{dialog.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});};
 },[]);
 return <dialog ref={ref} className="info-popup soul-tithe-popup" aria-label={title} onCancel={event=>{event.preventDefault();onCancel?.();}}>
  <div className="info-popup-content"><h2>{title}</h2>{children}</div>
 </dialog>;
}

export function ActivationConfirmation({card,disabled,onConfirm,onCancel}:{card:Card;disabled:boolean;onConfirm:()=>void;onCancel:()=>void}) {
 return <Modal title={`Activate ${card.name}?`} onCancel={onCancel}>
  <p>{SPELL_TYPE_LABELS[getSpellType(card)]} · Place this spell face down and mark it Active. No room or target is chosen.</p>
  {card.rulesText&&<p>{card.rulesText}</p>}
  <p className="hint">Costs 1 turn action. When its condition occurs, you may reveal and resolve it, or keep it hidden for later.</p>
  <div className="button-row"><button type="button" className="primary" autoFocus disabled={disabled} onClick={onConfirm}>Confirm activation</button><button type="button" disabled={disabled} onClick={onCancel}>Cancel</button></div>
 </Modal>;
}

function RevealDecision({decision,disabled,send}:{decision:Extract<PendingDecision,{kind:'REACTIVE_SPELL'}>;disabled:boolean;send:(action:GameAction)=>void}) {
 const [spellId,setSpellId]=useState(decision.options[0].activeSpellId);
 const option=decision.options.find(o=>o.activeSpellId===spellId)!;
 const [targetId,setTargetId]=useState('');
 const respond=(reveal:boolean)=>send({type:'RESPOND_REACTIVE_SPELL',playerId:decision.playerId,key:decision.key,...(reveal?{activeSpellId:spellId,targetId}:{} )});
 return <Modal title="Reveal an active spell?">
  <p>The current moment has finished. You may reveal a matching Trap or Protection, or keep all of them hidden for a later trigger.</p>
  <label>Spell to resolve next<select aria-label="Spell to reveal" value={spellId} disabled={disabled} onChange={event=>{setSpellId(event.target.value);setTargetId('');}}>{decision.options.map(o=><option key={o.activeSpellId} value={o.activeSpellId}>{o.card.name}</option>)}</select></label>
  {option.card.rulesText&&<p>{option.card.rulesText}</p>}
  <label>Target<select aria-label="Triggered spell target" value={targetId} disabled={disabled} onChange={event=>setTargetId(event.target.value)}><option value="">Choose a target</option>{option.targets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
  <div className="button-row"><button type="button" className="primary" disabled={disabled||!targetId} onClick={()=>respond(true)}>Reveal and resolve</button><button type="button" disabled={disabled} onClick={()=>respond(false)}>Keep all hidden</button></div>
  <p className="hint">Choose the order of your matching spells. Nested reactions finish before the interrupted effect resumes.</p>
 </Modal>;
}

export function ReactiveSpellPrompt({game,viewerId,connected,pending,send}:{game:GameState;viewerId:string;connected:boolean;pending:boolean;send:(action:GameAction)=>void}) {
 const decision=game.pendingDecision;
 if(!decision||decision.kind==='SOUL_TITHE')return null;
 if(decision.kind==='REACTIVE_SPELL'&&decision.playerId===viewerId)return <RevealDecision key={decision.key} decision={decision} disabled={!connected||pending} send={send}/>;
 return <div className="notice" role="status">Waiting for {game.players.find(p=>p.id===decision.playerId)?.name??'another mage'} to resolve an interrupt decision…</div>;
}