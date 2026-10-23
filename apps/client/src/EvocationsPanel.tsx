import React from 'react';
import { areInSameRoom, evocationAttack, GameAction, GameState, Hex, isInStartingRoom, hexKey } from '@brw/game-engine';
import { evocationNumber, mageStyle, ownerName, roomNameAt } from './presentation';
import { DamageBar } from './DamageBar';

export type TargetModel = {id:string;playerId:string;name:string;position:Hex;evocation:boolean};
export function targetModels(game:GameState):TargetModel[] {
 return [
  ...game.players.map(p=>({id:p.id,playerId:p.id,name:p.name,position:p.wizard.position,evocation:false})),
  ...game.evocations.map(e=>({id:e.id,playerId:e.playerId,name:`${e.name} #${evocationNumber(game,e)} (${ownerName(game,e.playerId)})`,position:e.position,evocation:true})),
 ];
}

type Props={game:GameState;playerId:string;viewerId:string;enabled:boolean;pending:boolean;send:(action:GameAction)=>void};

export function EvocationsPanel({game,playerId,viewerId,enabled,pending,send}:Props) {
 const owner=game.players.find(p=>p.id===playerId)!;
 const active=game.evocationActivation;
 const isOwn=playerId===viewerId;
 const myTurn=enabled&&game.currentPlayerId===viewerId;
 const paid=game.phase==='ACTION'&&!isInStartingRoom(game,owner)&&owner.actionTokens>0&&(game.activation?.actionsUsed??2)<2&&!game.activation?.exploring&&!game.activation?.physicalAction;
 const canActivate=isOwn&&myTurn&&!active&&(game.phase==='EVOCATION'||paid)&&!pending;
 const evocations=game.evocations.filter(e=>e.playerId===playerId);
 return <section className="evocations-panel" id={`retinue-${playerId}`} aria-label={`${owner.name} evocations`}><div className="section-heading"><div><span className="eyebrow">{isOwn?'Your':`${owner.name}’s`} retinue · {evocations.length}/3</span><h2>Evocations · {owner.name}</h2></div></div>
  {!evocations.length&&<p>No evocations yet. Activate a Grey room to summon a Cadaver. Each mage may control up to three models; tokens activate existing models, not summon them.</p>}
  {evocations.map(e=><div className={`evocation-card ${e.id===active?.evocationId?'active-model':''}`} style={mageStyle(e.playerId)} data-owned={isOwn} data-owner-id={e.playerId} data-evocation-id={e.id} key={e.id}>
    <strong className="evocation-heading"><span className="evocation-portrait" aria-hidden="true">☠</span><span>{e.name} <span className="evocation-number">#{evocationNumber(game,e)}</span></span></strong>
   <small>{owner.name} · Undead · {roomNameAt(game,e.position)}</small>
   <div className="model-stats"><span>↝ {e.movement} movement</span><span>⚔ {evocationAttack(e)} attack</span></div>
   <DamageBar game={game} {...e} name={`${owner.name} ${e.name} #${evocationNumber(game,e)}`}/>
    <p className="hint">Wounded Fury: +1 attack per damage taken. Attack one enemy model in the same room.</p>
   {isOwn&&<button disabled={!canActivate||(game.phase==='EVOCATION'&&e.activated)} onClick={()=>send({type:'ACTIVATE_EVOCATION',playerId:viewerId,evocationId:e.id})}>Activate Cadaver #{evocationNumber(game,e)} <small>{game.phase==='EVOCATION'?(e.activated?'Already activated':'Free · once this phase'):'1 token · extra activation'}</small></button>}
  </div>)}
  <p className="hint">{isOwn?'Free activations follow Action, one model at a time. Token activations are extra.':'Read-only · only the owner can activate these models.'} Friendly models cannot damage each other.</p>
 </section>;
}

// Active controls must never be hidden by the optional per-mage detail toggles.
export function ActiveEvocationControls({game,playerId,enabled,pending,send}:Omit<Props,'viewerId'>) {
 const active=game.evocationActivation;
 const acting=game.evocations.find(e=>e.id===active?.evocationId);
 if(!active||!acting||active.playerId!==playerId)return null;
 const targets=targetModels(game).filter(t=>t.playerId!==playerId&&areInSameRoom(game,t.position,acting.position)&&!game.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(t.position))));
 return <section className="evocation-controls" style={mageStyle(acting.playerId)}><span className="eyebrow">Your active evocation</span><h2><span className="evocation-portrait" aria-hidden="true">☠</span>{acting.name} #{evocationNumber(game,acting)}</h2><p>{active.movesRemaining} movement remaining. Move on the board, then attack one enemy model in this room or finish. Retinue details can stay hidden.</p>
  {targets.length===0&&<p className="hint">No enemy models in this room. Move into an enemy’s room to attack, or finish the activation.</p>}
  {targets.map(t=><button disabled={!enabled||pending} key={t.id} onClick={()=>send({type:'EVOCATION_ATTACK',playerId,targetId:t.id})}>Cadaver attack {t.name}<small>{evocationAttack(acting)} damage</small></button>)}
  <button disabled={!enabled||pending} onClick={()=>send({type:'END_EVOCATION',playerId})}>Finish evocation</button>
 </section>;
}