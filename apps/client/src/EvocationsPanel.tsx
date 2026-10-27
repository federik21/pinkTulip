import React from 'react';
import { areInSameRoom, evocationAttack, evocationMovement, UPGRADE_LABELS, UPGRADE_RULES, Evocation, EVOCATION_MODEL_LIMITS, getEvocationKind, getEvocationSupply, getUpgradeSupply, GameAction, GameState, Hex, isInStartingRoom, hexKey } from '@brw/game-engine';
import { evocationNumber, mageStyle, ownerName, roomNameAt } from './presentation';
import { DamageBar } from './DamageBar';
import { ModelEffects } from './ModelEffects';

export type TargetModel = {id:string;playerId:string;name:string;position:Hex;evocation:boolean};
export function targetModels(game:GameState):TargetModel[] {
 return [
  ...game.players.map(p=>({id:p.id,playerId:p.id,name:p.name,position:p.wizard.position,evocation:false})),
  ...game.evocations.map(e=>({id:e.id,playerId:e.playerId,name:`${e.name} #${evocationNumber(game,e)} (${ownerName(game,e.playerId)})`,position:e.position,evocation:true})),
 ];
}

const portrait=(e:Evocation)=>getEvocationKind(e)==='COLOSSUS'?'♜':e.archetype==='DEMON'?'♆':'☠';
type Props={game:GameState;playerId:string;viewerId:string;enabled:boolean;pending:boolean;send:(action:GameAction)=>void};

export function EvocationSupply({game}:{game:GameState}) {
 const supply=getEvocationSupply(game);
 return <section className="evocation-supply" aria-label="Shared evocation supply"><span className="eyebrow">Shared by all mages</span><h2>Model supply</h2>
  <div className="model-stats" aria-live="polite">
   <span data-evocation-kind="SUCCUBUS">♆ Succubi <b>{supply.SUCCUBUS}/{EVOCATION_MODEL_LIMITS.SUCCUBUS}</b> available</span>
   <span data-evocation-kind="CADAVER">☠ Cadavers <b>{supply.CADAVER}/{EVOCATION_MODEL_LIMITS.CADAVER}</b> available</span>
   <span data-evocation-kind="COLOSSUS">♜ Colossi <b>{supply.COLOSSUS}/{EVOCATION_MODEL_LIMITS.COLOSSUS}</b> available</span>
  </div><p className="hint">Destroyed models return to this supply. Each mage may control at most 3 evocations.</p>
  <p className="hint" data-upgrade-supply>Upgrade cards left: {Object.entries(getUpgradeSupply(game)).map(([name,count])=>`${UPGRADE_LABELS[name as keyof typeof UPGRADE_LABELS]} ${count}/3`).join(' · ')}</p>
 </section>;
}

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
    <strong className="evocation-heading"><span className={`evocation-portrait${getEvocationKind(e)==='COLOSSUS'?' big-portrait':''}`} aria-hidden="true">{portrait(e)}</span><span>{e.name} <span className="evocation-number">#{evocationNumber(game,e)}</span></span></strong>
   <small>{owner.name} · {e.archetype==='DEMON'?'Demon':'Undead'} · {roomNameAt(game,e.position)}</small>
  <ModelEffects game={game} viewerId={viewerId} modelId={e.id}/>
   <div className="model-stats"><span>↝ {evocationMovement(e)} movement</span><span>⚔ {evocationAttack(e)} attack</span></div>
   {e.upgrade&&<p className="hint" data-upgrade={e.upgrade}><strong>{UPGRADE_LABELS[e.upgrade]}</strong>: {UPGRADE_RULES[e.upgrade]}</p>}
   <DamageBar game={game} {...e} name={`${owner.name} ${e.name} #${evocationNumber(game,e)}`}/>
    {getEvocationKind(e)==='SUCCUBUS'&&e.passive==='WOUNDED_FURY'&&<p className="hint">Wounded Fury: +1 attack per damage taken.</p>}
    {e.ability==='ENTRY_SHOCK'&&<p className="hint">Entry shock: inflicts 3 damage on each other mage that enters its room.</p>}
    <p className="hint">Attack one enemy model in the same room.</p>
   {e.ability==='SOUL_TITHE'&&<div className="soul-tithe"><p className="hint">Soul Tithe: when {owner.name} takes damage, one of those damage cubes may go on this model instead, wherever it stands.</p>
    <label className="auto-switch"><input type="checkbox" role="switch" aria-label={`Auto Soul Tithe for ${e.name} #${evocationNumber(game,e)}`} checked={!!e.autoAbility} disabled={!isOwn||!enabled||pending} onChange={event=>send({type:'SET_EVOCATION_AUTO',playerId:viewerId,evocationId:e.id,auto:event.target.checked})}/><span>Auto <small>{e.autoAbility?'Takes a cube without asking':'Asks before taking a cube'}</small></span></label></div>}
   {isOwn&&<button disabled={!canActivate||(game.phase==='EVOCATION'&&e.activated)} onClick={()=>send({type:'ACTIVATE_EVOCATION',playerId:viewerId,evocationId:e.id})}>Activate {e.name} #{evocationNumber(game,e)} <small>{game.phase==='EVOCATION'?(e.activated?'Already activated':'Free · once this phase'):'1 token · extra activation'}</small></button>}
  </div>)}
  <p className="hint">{isOwn?'Free activations follow Action, one model at a time. Token activations are extra.':'Read-only · only the owner can activate these models.'} Friendly models cannot damage each other.</p>
 </section>;
}

// Active controls must never be hidden by the optional per-mage detail toggles.
export function ActiveEvocationControls({game,playerId,enabled,pending,send}:Omit<Props,'viewerId'>) {
 const active=game.evocationActivation;
 const acting=game.evocations.find(e=>e.id===active?.evocationId);
 if(!active||!acting||active.playerId!==playerId)return null;
 const targets=targetModels(game).filter(t=>t.playerId!==playerId&&t.id!==acting.id&&areInSameRoom(game,t.position,acting.position)&&!game.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(t.position))));
 return <section className="evocation-controls" aria-label="Active evocation controls" style={mageStyle(acting.playerId)}>
  <div className="evocation-control-heading"><h2><span className="evocation-portrait" aria-hidden="true">{portrait(acting)}</span>{acting.name} #{evocationNumber(game,acting)}</h2><p>{active.movesRemaining} movement remaining · {active.attackUsed?'Attack used':'One attack available'}.</p>
   {acting.upgrade&&<p className="hint" data-upgrade={acting.upgrade}><strong>{UPGRADE_LABELS[acting.upgrade]}</strong>: {UPGRADE_RULES[acting.upgrade]}</p>}</div>
  {!active.attackUsed&&targets.length>0&&<div className="evocation-attack-targets" role="group" aria-label="Evocation attack targets" tabIndex={0}>
   {targets.map(t=><button disabled={!enabled||pending} key={t.id} onClick={()=>send({type:'EVOCATION_ATTACK',playerId,targetId:t.id})}>{acting.name} attack {t.name}<small>{evocationAttack(acting)} damage</small></button>)}
  </div>}
  {!active.attackUsed&&targets.length===0&&<p className="evocation-no-targets hint">No enemy models in this room. {active.movesRemaining>0?'Move into an enemy’s room to attack, or finish the activation.':'Finish the activation to skip the attack.'}</p>}
  {active.attackUsed&&<p className="evocation-no-targets hint">Move to an adjacent room, stop movement early, or finish.</p>}
  <div className="evocation-finish-actions" role="group" aria-label="Evocation completion">
   {active.movesRemaining>0&&<button disabled={!enabled||pending} onClick={()=>send({type:'END_EVOCATION_MOVEMENT',playerId})}>Finish evocation movement early</button>}
   <button disabled={!enabled||pending} onClick={()=>send({type:'END_EVOCATION',playerId})}>Finish evocation</button>
  </div>
 </section>;
}