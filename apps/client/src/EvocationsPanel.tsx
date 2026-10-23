import React from 'react';
import { evocationAttack, GameAction, GameState, Hex, isInStartingRoom, hexDistance, hexKey } from '@brw/game-engine';

export type TargetModel = {id:string;playerId:string;name:string;position:Hex;evocation:boolean};
export function targetModels(game:GameState):TargetModel[] {
 return [
  ...game.players.map(p=>({id:p.id,playerId:p.id,name:p.name,position:p.wizard.position,evocation:false})),
  ...game.evocations.map(e=>({id:e.id,playerId:e.playerId,name:`${e.name} (${game.players.find(p=>p.id===e.playerId)?.name??e.playerId})`,position:e.position,evocation:true})),
 ];
}

export function EvocationsPanel({game,playerId,enabled,pending,send}:{game:GameState;playerId:string;enabled:boolean;pending:boolean;send:(action:GameAction)=>void}) {
 const me=game.players.find(p=>p.id===playerId)!;
 const active=game.evocationActivation;
 const acting=game.evocations.find(e=>e.id===active?.evocationId);
 const myTurn=enabled&&game.currentPlayerId===playerId;
 const paid=game.phase==='ACTION'&&!isInStartingRoom(game,me)&&me.actionTokens>0&&(game.activation?.actionsUsed??2)<2&&!game.activation?.exploring;
 const canActivate=myTurn&&!active&&(game.phase==='EVOCATION'||paid)&&!pending;
 const targets=acting?targetModels(game).filter(t=>t.playerId!==playerId&&hexDistance(t.position,acting.position)<=1&&!game.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(t.position)))):[];
 return <section className="evocations-panel"><div className="section-heading"><div><span className="eyebrow">Your retinue · {game.evocations.filter(e=>e.playerId===playerId).length}/3</span><h2>Evocations</h2></div><span className="badge">☠ Cadaver</span></div>
    {!game.evocations.length&&<p>Activate a Grey room to summon a Cadaver. Each mage may control up to three models; tokens activate existing models, not summon them.</p>}
  {game.evocations.map(e=><div className={`evocation-card ${e.id===active?.evocationId?'active-model':''}`} data-owned={e.playerId===playerId} data-evocation-id={e.id} key={e.id}>
   <strong>☠ {e.name}</strong><small>{game.players.find(p=>p.id===e.playerId)?.name} · Undead · {e.position.q},{e.position.r}</small>
   <div className="model-stats"><span>↝ {e.movement}</span><span>⚔ {evocationAttack(e)}</span><span>♥ {e.health-e.damageCubes}/{e.health}</span></div>
   <p className="hint">Wounded Fury: +1 attack per damage taken.</p>
   <div className="contributions">{Object.entries(e.damageByPlayer).map(([id,n])=><span key={id}>{game.players.find(p=>p.id===id)?.name}: {n} cube{n===1?'':'s'}</span>)}</div>
   {e.playerId===playerId&&<button disabled={!canActivate||(game.phase==='EVOCATION'&&e.activated)} onClick={()=>send({type:'ACTIVATE_EVOCATION',playerId,evocationId:e.id})}>Activate Cadaver <small>{game.phase==='EVOCATION'?(e.activated?'Already activated':'Free · once this phase'):'1 token · extra activation'}</small></button>}
  </div>)}
  {active&&acting&&<div className="notice evocation-controls"><strong>{acting.name} is active</strong><p>{active.movesRemaining} movement remaining. Move on the board, then attack once or finish.</p>{active.playerId===playerId&&enabled&&<>
   {targets.map(t=><button disabled={pending} key={t.id} onClick={()=>send({type:'EVOCATION_ATTACK',playerId,targetId:t.id})}>Cadaver attack {t.name}<small>{evocationAttack(acting)} damage</small></button>)}
   <button disabled={pending} onClick={()=>send({type:'END_EVOCATION',playerId})}>Finish evocation</button>
  </>}</div>}
  <p className="hint">Free activations follow Action, one model at a time. Token activations are extra. Friendly models cannot damage each other.</p>
 </section>;
}