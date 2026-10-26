import React, { useEffect, useState } from 'react';
import { GameAction, GameState, Player, ROOM_EFFECT_LABELS, getDiscardMoveCards, hexDistance, hexKey, isInStartingRoom, mustLeaveCell } from '@brw/game-engine';
import { targetModels } from './EvocationsPanel';

type Props = {
 game:GameState; me:Player; enabled:boolean; pending:boolean;
 exitCardId:string; setExitCardId:(id:string)=>void; clearSpell:()=>void;
 effectTargetId:string; setEffectTargetId:(id:string)=>void;
 send:(action:GameAction)=>void;
};

function physicalContext(game:GameState,me:Player,effectTargetId:string) {
 const currentRoom=game.board.rooms.find(r=>r.tiles.some(h=>hexKey(h)===hexKey(me.wizard.position)));
 const inStart=isInStartingRoom(game,me);
 const targets=targetModels(game).filter(t=>t.playerId!==me.id&&hexDistance(me.wizard.position,t.position)===0&&!game.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(t.position))));
 const effectTargets=game.board.rooms.filter(r=>!r.startingFor&&currentRoom&&Math.min(...currentRoom.tiles.flatMap(h=>r.tiles.map(t=>hexDistance(h,t))))<=1);
 const roomAvailable=!!currentRoom?.effect&&!inStart&&(!currentRoom.reconstructed||!currentRoom.specialUsed);
 const targetValid=!effectTargetId||effectTargets.some(r=>r.id===effectTargetId);
 const activateRoom=(playerId:string):GameAction=>({type:'ACTIVATE_ROOM',playerId,...(currentRoom?.effect==='INSTABILITY'&&effectTargetId?{roomTargetId:effectTargetId}:{})});
 return {currentRoom,inStart,targets,effectTargets,roomAvailable,targetValid,activateRoom};
}

/** Top-banner shortcuts that complete the chosen physical action without opening the dashboard. */
export function PhysicalBannerActions({game,me,pending,effectTargetId,send}:Pick<Props,'game'|'me'|'pending'|'effectTargetId'|'send'>) {
 const active=game.activation;
 const physical=active?.physicalAction;
 if(!physical)return null;
 const {targets,roomAvailable,targetValid,activateRoom}=physicalContext(game,me,effectTargetId);
 const exploring=!!active?.exploring;
 const mustMove=!!active?.mustExitCell&&isInStartingRoom(game,me);
 return <div className="physical-shortcuts" role="group" aria-label={`${physical.kind==='EXPLORE'?'Explore':'Attack'} shortcuts`} data-physical-kind={physical.kind}>
  {physical.kind==='EXPLORE'?(exploring
  ?<button type="button" disabled={pending||mustMove} onClick={()=>send({type:'END_EXPLORE',playerId:me.id})}>Finish moving early</button>
   :!physical.movementStarted&&!physical.mainEffectUsed&&<button type="button" className="primary" disabled={pending} onClick={()=>send({type:'PERFORM_MOVEMENT',playerId:me.id})}>Move {me.wizard.movement}</button>)
   :!physical.mainEffectUsed&&targets.map(t=><button type="button" className="primary" key={t.id} disabled={pending} title={`Inflict ${me.wizard.attack} damage on ${t.name}`} onClick={()=>send({type:'INFLICT_ATTACK',playerId:me.id,targetId:t.id})}>Attack {t.name}</button>)}
  {roomAvailable&&!active?.roomEffectUsed&&!exploring&&<button type="button" disabled={pending||!targetValid} onClick={()=>send(activateRoom(me.id))}>Activate room</button>}
  <button type="button" disabled={pending||mustMove} title="Skip any remaining effects and finish this physical action" onClick={()=>send({type:'SKIP_PHYSICAL_EFFECTS',playerId:me.id})}>Finish action</button>
 </div>;
}

export function PhysicalActionsPanel({game,me,enabled,pending,exitCardId,setExitCardId,clearSpell,effectTargetId,setEffectTargetId,send}:Props) {
 const [choosingTarget,setChoosingTarget]=useState(false);
 const active=game.activation;
 const physical=active?.physicalAction;
 const myTurn=enabled&&game.currentPlayerId===me.id&&!game.evocationActivation;
 const {currentRoom,inStart,targets,effectTargets,roomAvailable,targetValid,activateRoom}=physicalContext(game,me,effectTargetId);
 useEffect(()=>{setEffectTargetId('');setChoosingTarget(false);},[currentRoom?.id,active?.actionsUsed,game.currentPlayerId,game.round]);
 const canBegin=myTurn&&!pending&&!physical&&!active?.exploring&&(active?.actionsUsed??2)<2&&me.actionTokens>0;
 const exitCards=getDiscardMoveCards(me,active?.playerId===me.id?active:null);
 useEffect(()=>{if(exitCardId&&!exitCards.some(c=>c.id===exitCardId))setExitCardId('');},[exitCardId,exitCards.map(c=>c.id).join('|')]);
 const mustMove=!!active?.mustExitCell&&inStart;
 const begin=(kind:'EXPLORE'|'ATTACK')=>{
  clearSpell();setExitCardId('');send({type:'BEGIN_PHYSICAL_ACTION',playerId:me.id,kind});
 };
 return <section className="actions-panel"><span className="eyebrow">{myTurn?'Your turn':'Waiting'}</span><h2>{myTurn?(physical?`${physical.kind==='EXPLORE'?'Explore':'Attack'} effects`:'Choose a physical action'):`${game.players.find(p=>p.id===game.currentPlayerId)?.name??'Other mage'} is acting`}</h2>
  {myTurn&&<>
    {mustLeaveCell(game,me)&&<p className="notice">Your last action must move your mage out of the cell. Explore or discard a card to move; you cannot finish Explore without leaving.</p>}
   {!physical?<>
    <div className="action-choices"><button className="primary" disabled={!canBegin} onClick={()=>begin('EXPLORE')}>Explore<small>1 token · movement + room effect</small></button><button disabled={!canBegin||inStart} onClick={()=>begin('ATTACK')}>Attack<small>1 token · attack + room effect</small></button></div>
    <div className="notice"><b>{inStart?'Starting-room exit':'Discard to move'}</b><p>{inStart?'Explore out, or discard an unused prepared spell to move one space for 1 turn action and no physical token. Starting rooms cannot be activated.':'Discard an unused prepared spell to move one space for 1 turn action and no physical token. Once per turn; you cannot enter a starting room.'} Any numbered or Quick slot is eligible, even a later numbered spell or after casting a numbered spell this turn. Cards held in hand, already cast or activated spells, and Forgotten spells cannot be discarded to move.</p><label className="action-setting">Card to discard to move<select aria-label="Card to discard to move" disabled={!myTurn||pending||exitCards.length===0||!!active?.discardedExit||(active?.actionsUsed??2)>=2} value={exitCardId} onChange={e=>{setExitCardId(e.target.value);clearSpell();}}><option value="">{exitCards.length?'Choose an unused prepared spell, then an adjacent hex':'No unused prepared spells to discard'}</option>{exitCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
   </>:<div className="physical-effects" data-physical-kind={physical.kind}>
    <p>Choose either effect first, once each. Resolving effects costs no extra token. You may skip anything remaining.</p>
    {physical.kind==='EXPLORE'?<>
     <button className="primary" disabled={pending||physical.movementStarted||physical.mainEffectUsed} onClick={()=>send({type:'PERFORM_MOVEMENT',playerId:me.id})}>Perform {me.wizard.movement} movements<small>{physical.mainEffectUsed?'Movement resolved':'Move one adjacent space at a time'}</small></button>
    {!!active?.exploring&&<div className="notice movement-progress"><strong>{active.exploring} movement remaining</strong><p>Select a highlighted adjacent hex.</p><button disabled={pending||mustMove} onClick={()=>send({type:'END_EXPLORE',playerId:me.id})}>Finish movement early</button></div>}
    </>:<>
     <button className="primary" disabled={pending||physical.mainEffectUsed||targets.length===0} onClick={()=>setChoosingTarget(true)}>Inflict {me.wizard.attack} damage to a model at distance 0<small>{physical.mainEffectUsed?'Attack resolved':'Choose an enemy in your room'}</small></button>
     {!physical.mainEffectUsed&&targets.length===0&&<p className="hint">No enemy model in this room. You can still activate the room or skip.</p>}
     {choosingTarget&&!physical.mainEffectUsed&&<div className="attack-targets" role="group" aria-label="Attack target">{targets.map(t=><button key={t.id} disabled={pending} onClick={()=>{send({type:'INFLICT_ATTACK',playerId:me.id,targetId:t.id});setChoosingTarget(false);}}>Inflict {me.wizard.attack} damage on {t.name}</button>)}</div>}
    </>}
    <div className="physical-room-effect"><p className="hint">{currentRoom?.effect?`${ROOM_EFFECT_LABELS[currentRoom.effect]}${currentRoom.reconstructed?` ×2 · ${currentRoom.specialUsed?'Used this Action phase':'Reconstructed special'}`:''}.`:'Starting rooms cannot be activated.'}</p>
     {currentRoom?.effect==='INSTABILITY'&&!active?.roomEffectUsed&&!active?.exploring&&<label className="action-setting">Emerald effect target<select aria-label="Emerald effect target" disabled={pending} value={effectTargetId} onChange={e=>setEffectTargetId(e.target.value)}><option value="">The activated room (distance 0)</option>{effectTargets.map(r=><option key={r.id} value={r.id}>{r.name} · {r.color??'central'}</option>)}</select></label>}
     <button disabled={pending||!roomAvailable||!!active?.roomEffectUsed||!!active?.exploring||!targetValid} onClick={()=>send(activateRoom(me.id))}>Activate the room<small>{active?.roomEffectUsed?'Room effect resolved':active?.exploring?'Finish movement before activating':'Once with this physical action'}</small></button>
    </div>
    <button className="skip-effects" disabled={pending||mustMove} onClick={()=>send({type:'SKIP_PHYSICAL_EFFECTS',playerId:me.id})}>Skip remaining effects</button>
   </div>}
    <p className="hint">2 actions total per turn: physical actions, prepared spell casts, and discard-to-move each count. Physical actions also spend one of your 2 physical tokens for the round. Finish or skip pending effects before ending your turn from the top banner. Held forgotten spells are saved for a later Preparation and do not keep your Action phase alive.</p>
    {me.cubes.available===0&&<p className="notice">No cubes available: you cannot place room instability. Damage can still wound enemy models without placing a cube.</p>}
  </>}
 </section>;
}