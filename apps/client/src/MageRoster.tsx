import React from 'react';
import { BLACK_ROSE_ID, GameState, getSpellType } from '@brw/game-engine';
import { DamageBar } from './DamageBar';
import { ModelEffects } from './ModelEffects';
import { MAGE_SYMBOLS, MAGE_COLOR_NAMES, mageStyle } from './presentation';

type Props = {
 game: GameState;
 viewerId: string;
 actingPlayerId?: string;
 onViewRetinue: (playerId:string) => void;
};

export function MageRoster({game,viewerId,actingPlayerId,onViewRetinue}: Props) {
 return <section className="players-panel" aria-labelledby="mages-heading">
  <span className="eyebrow">Mages of the lodge · {game.players.length}</span><h2 id="mages-heading">Mages of the lodge</h2>
  {game.players.map(p=>{
   const own=p.id===viewerId;
   const acting=p.id===actingPlayerId;
   const readied=(game.readiedSpells??[]).filter(active=>active.playerId===p.id);
    // Types and counts are public; card identities, rules and bindings are not.
    const types=readied.map(active=>getSpellType(active.card));
    const remaining=Object.values(p.prepared).filter(slot=>slot&&!slot.used).length;
   const status=!p.connected?'Disconnected':acting?game.phase==='EVOCATION'||game.evocationActivation?'Controlling evocations · acting now':'Acting now':p.passed?'Passed this round':p.studyDone&&game.phase==='STUDY'?'Study complete':p.preparationDone&&game.phase==='PREPARATION'?'Prepared':'In the lodge';
   const evocationCount=game.evocations.filter(e=>e.playerId===p.id).length;
    return <details open className={`player mage-disclosure ${acting?'active-player':''}`} style={mageStyle(p.id)} data-player-id={p.id} aria-current={acting?'true':undefined} key={p.id}>
    <summary className="mage-summary">
     <div className="player-heading"><span><span className={acting?'acting-mage-icon':''} aria-hidden="true">{MAGE_SYMBOLS[p.id]}</span> {p.name} {p.id===game.firstPlayerId&&<span className="first-player" role="img" aria-label="First player" title="First-player token · +1 VP at endgame">♛</span>} {own&&<small>(you)</small>}<small className="mage-color-name">{MAGE_COLOR_NAMES[p.id]}</small></span><b>{p.victoryPoints}<small> VP</small></b></div>
     <DamageBar game={game} name={p.name} {...p.wizard}/>
    <ModelEffects game={game} viewerId={viewerId} modelId={p.id}/>
     <div className="mage-critical-stats"><dl className="mage-attributes critical-attributes"><div><dt>Cards</dt><dd>{p.hand.length}/{p.cardLimit}</dd></div></dl><span className="player-stats">⚡ {p.actionTokens} tokens</span></div>
    <span className="remaining-spells" aria-label={`${p.name} spells remaining`}>Spells left: {remaining}</span>
    <span className="active-magic-counts" aria-label={`${p.name} active magic`}>Trap: {types.filter(type=>type==='TRAP').length} · Protection: {types.filter(type=>type==='PROTECTION').length}</span>
     <small className={acting?'acting-label':'hint'}>{status}</small>
     <span className="mage-disclosure-hint hint"><span className="when-closed">Show mage details</span><span className="when-open">Hide mage details</span><span aria-hidden="true">⌄</span></span>
    </summary>
    <div className="mage-secondary">
     <dl className="mage-attributes secondary-attributes"><div><dt>Max HP</dt><dd>{p.wizard.health}</dd></div><div><dt>Attack</dt><dd>{p.wizard.attack}</dd></div><div><dt>Movement</dt><dd>{p.wizard.movement}</dd></div><div><dt>Quest limit</dt><dd>{p.questLimit}</dd></div></dl>
     <div className="player-stats"><span title="Available cubes">◆ {p.cubes.available} available</span></div>
     <div className="cube-pool hint">◆ On mages: {p.cubes.onWizard} · On evocations: {p.cubes.onEvocations} · In rooms: {p.cubes.onBoard}</div>
     {p.cubes.available===0&&<p className="cube-warning hint">No cubes: room placement unavailable; damage can still wound without attribution.</p>}
     <p className="hint">Grimoire {p.personalDeck.length} · Personal discard {p.discard.length} · Evocations {evocationCount}/3</p>
    <div className="player-actions"><button className="mini-toggle" aria-label={`View evocations for ${p.name} (${evocationCount})`} aria-controls={`retinue-${p.id}`} onClick={()=>onViewRetinue(p.id)}>View evocations ({evocationCount})</button></div>
    </div>
   </details>;
  })}
    <div className="black-rose-score" data-owner-id={BLACK_ROSE_ID} aria-label="BR score"><div className="player-heading"><span>✺ BR</span><b>{game.blackRose.victoryPoints}<small> VP</small></b></div><small>{game.blackRose.kills} kills · neutral competitor</small></div>
 </section>;
}