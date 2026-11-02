import React from 'react';
import { BLACK_ROSE_ID, compareFinalStanding, ENDGAME_REWARDS, GameState, getContributionAwards, getMageEvocationCount, getMageMovement, getSpellType, MAGE_DRAFT_POOL } from '@brw/game-engine';
import { JinxList } from './JinxList';
import { DamageBar } from './DamageBar';
import { ModelEffects } from './ModelEffects';
import { MAGE_SYMBOLS, MAGE_COLOR_NAMES, mageStyle, ownerColor, ownerName } from './presentation';

type Props = {
 game: GameState;
 viewerId: string;
 actingPlayerId?: string;
 onViewRetinue: (playerId:string) => void;
};

export function MageRoster({game,viewerId,actingPlayerId,onViewRetinue}: Props) {
 const trophyCounts={...Object.fromEntries(game.players.map(player=>[player.id,player.trophies.length])),[BLACK_ROSE_ID]:game.blackRose.trophies.length};
 const trophyAwards=getContributionAwards(trophyCounts,ENDGAME_REWARDS);
 const questAwards=getContributionAwards(Object.fromEntries(game.players.map(player=>[player.id,player.questsCompleted])),ENDGAME_REWARDS);
 const scores=[
  ...game.players.map(player=>{
   const trophyVP=trophyAwards.find(award=>award.playerId===player.id)?.points??0;
   const questVP=questAwards.find(award=>award.playerId===player.id)?.points??0;
   const firstPlayerVP=game.firstPlayerId===player.id?1:0;
   const endgameVP=trophyVP+questVP+firstPlayerVP;
   const currentVP=player.victoryPoints;
   return {id:player.id,name:player.name,trophies:player.trophies.length,quests:player.questsCompleted,trophyVP,questVP,firstPlayerVP,currentVP,finalVP:game.endgameScored?currentVP:currentVP+endgameVP,baseVP:game.endgameScored?currentVP-endgameVP:currentVP};
  }),
  {id:BLACK_ROSE_ID,name:'BR',trophies:game.blackRose.trophies.length,quests:0,trophyVP:trophyAwards.find(award=>award.playerId===BLACK_ROSE_ID)?.points??0,questVP:0,firstPlayerVP:0,currentVP:game.blackRose.victoryPoints,finalVP:game.blackRose.victoryPoints,baseVP:game.blackRose.victoryPoints},
 ];
 const leaderboard=[...scores].sort((a,b)=>compareFinalStanding(a,b,game.firstPlayerId));
 const vpLabel=(points:number)=>points?`+${points} VP`:'—';
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
  const evocationCount=getMageEvocationCount(game,p.id);
  const contributions={...p.wizard.damageByPlayer};
  if(p.wizard.blackDamage>0)contributions[BLACK_ROSE_ID]=(contributions[BLACK_ROSE_ID]??0)+p.wizard.blackDamage;
  const segments=Object.entries(contributions).filter(([,count])=>count>0).sort(([a],[b])=>a===BLACK_ROSE_ID?1:b===BLACK_ROSE_ID?-1:a.localeCompare(b)).map(([id,count])=>({id,count}));
  const recent = p.wizard.damageOrder.slice(-6).filter(Boolean).map(id => ownerName(game,id));

    return <details className={`player mage-disclosure ${acting?'active-player':''}`} style={mageStyle(p.id)} data-player-id={p.id} aria-current={acting?'true':undefined} key={p.id}>
    <summary className="mage-summary">
     <div className="player-heading"><span><span className={acting?'acting-mage-icon':''} aria-hidden="true">{MAGE_SYMBOLS[p.id]}</span> {p.name} {p.id===game.firstPlayerId&&<span className="first-player" role="img" aria-label="First player" title="First-player token · +1 VP at endgame">♛</span>} {own&&<small>(you)</small>}<small className="mage-color-name">{MAGE_COLOR_NAMES[p.id]}{p.mageId?` · ${MAGE_DRAFT_POOL.find(mage=>mage.id===p.mageId)?.name??p.mageId}`:''}</small></span><b>{p.victoryPoints}<small> VP</small></b></div>
     <DamageBar game={game} name={p.name} {...p.wizard} />
    <ModelEffects game={game} viewerId={viewerId} modelId={p.id}/>
     <div className="mage-critical-stats"><dl className="mage-attributes critical-attributes"><div><dt>Cards</dt><dd>{p.hand.length}/{p.cardLimit}</dd></div></dl><span className="player-stats">⚡ {p.actionTokens} tokens</span></div>
    <span className="remaining-spells" aria-label={`${p.name} spells remaining`}>Spells left: {remaining}</span>
    <span className="active-magic-counts" aria-label={`${p.name} active magic`}>Trap: {types.filter(type=>type==='TRAP').length} · Protection: {types.filter(type=>type==='PROTECTION').length}</span>
     <small className={acting?'acting-label':'hint'}>{status}</small>
     <span className="mage-disclosure-hint hint"><span className="when-closed">Show mage details</span><span className="when-open">Hide mage details</span><span aria-hidden="true">⌄</span></span>
    </summary>
    <div className="mage-secondary">
     <dl className="mage-attributes secondary-attributes"><div><dt>Max HP</dt><dd>{p.wizard.health}</dd></div><div><dt>Attack</dt><dd>{p.wizard.attack}</dd></div><div><dt>Movement</dt><dd>{getMageMovement(p)}</dd></div><div><dt>Quest limit</dt><dd>{p.questLimit}</dd></div></dl>
     {!!p.jinxes?.length&&<JinxList jinxes={p.jinxes} owner={p.name}/>}
     {segments.length>0&&<div className="contributions damage-contributions">{segments.map(segment=><span key={segment.id} style={{'--mage-color':ownerColor(segment.id)} as React.CSSProperties}>{ownerName(game,segment.id)}: {segment.count}</span>)}</div>}
     {recent.length>0&&<div className="contributions damage-history"><span>Recent wounds: {recent.join(' → ')}</span></div>}
     <div className="player-stats"><span title="Available cubes">◆ {p.cubes.available} available</span></div>
     <div className="cube-pool hint">◆ On mages: {p.cubes.onWizard} · On evocations: {p.cubes.onEvocations} · In rooms: {p.cubes.onBoard}{!!p.cubes.onJinxes&&<> · On jinxes: {p.cubes.onJinxes}</>}</div>
     {p.cubes.available===0&&<p className="cube-warning hint">No cubes: room placement unavailable; damage can still wound without attribution.</p>}
     <p className="hint">Grimoire {p.personalDeck.length} · Personal discard {p.discard.length} · Evocations {evocationCount}/3</p>
    <div className="player-actions"><button className="mini-toggle" aria-label={`View evocations for ${p.name} (${evocationCount})`} aria-controls={`retinue-${p.id}`} onClick={()=>onViewRetinue(p.id)}>View evocations ({evocationCount})</button></div>
    </div>
   </details>;
  })}
    <div className="black-rose-score" data-owner-id={BLACK_ROSE_ID} aria-label="BR score"><div className="player-heading"><span>✺ BR</span><b>{game.blackRose.victoryPoints}<small> VP</small></b></div></div>
    <section className="endgame-score-panel" aria-labelledby="endgame-score-heading">
     <span className="eyebrow">{game.endgameScored?'Final standings':'Endgame preview'}</span>
     <h3 id="endgame-score-heading">Leaderboard</h3>
     <ol className="endgame-leaderboard">{leaderboard.map((score,index)=><li key={score.id} data-owner-id={score.id}><span><b>{index+1}.</b> {score.name}{score.id===game.firstPlayerId&&<span className="first-player" aria-label="First player">♛</span>}</span><b>{score.finalVP} VP</b></li>)}</ol>
     <h3>Final VP assignment</h3>
     <p className="hint">{game.endgameScored?'Scoring is complete; final VP includes the assignments below.':'Projected awards use the current trophy and solved-quest standings; ties follow the game rules.'}</p>
     <div className="endgame-score-table-wrap"><table className="endgame-score-table">
      <caption className="visually-hidden">Endgame victory-point assignment by player</caption>
      <thead><tr><th scope="col">Player</th><th scope="col">Trophies<br/><small>count · VP</small></th><th scope="col">Solved quests<br/><small>count · VP</small></th><th scope="col">First player</th><th scope="col">VP before bonuses</th><th scope="col">Final VP</th></tr></thead>
      <tbody>{scores.map(score=><tr key={score.id} data-owner-id={score.id}>
       <th scope="row">{score.name}</th>
       <td>{score.trophies} · {vpLabel(score.trophyVP)}</td>
       <td>{score.quests} · {vpLabel(score.questVP)}</td>
       <td>{score.firstPlayerVP?vpLabel(score.firstPlayerVP):'—'}</td>
       <td>{score.baseVP}</td>
       <td><b>{score.finalVP}</b></td>
      </tr>)}</tbody>
     </table></div>
    </section>
 </section>;
}