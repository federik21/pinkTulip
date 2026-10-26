import React from 'react';
import { GameAction, GameState, MAX_MAGES, MIN_MAGES, Player, STARTING_SCHOOL_CARDS, getDefaultRoomsPerColor } from '@brw/game-engine';
import { MAGE_COLOR_NAMES, MAGE_SYMBOLS, mageStyle } from './presentation';

export function LobbyPanel({game,me,connected,pending,send}:{game:GameState;me:Player;connected:boolean;pending:boolean;send:(action:GameAction)=>void}) {
 const joinedCount=game.players.filter(p=>p.connected).length;
 const readyCount=game.players.filter(p=>p.connected&&p.ready).length;
 const school=game.library.find(deck=>deck.id===me.startingSchoolId);
 const botFits=joinedCount<MAX_MAGES&&game.library.reduce((n,deck)=>n+deck.cards.length+deck.discard.length,0)>=(joinedCount+1)*(STARTING_SCHOOL_CARDS+2)+2;
 return <section className="phase-panel lobby-panel">
  <div className="section-heading"><div><span className="eyebrow">Before the first White Lotus</span><h2>Gather the mages</h2></div><span className="badge lobby-count">{joinedCount} / {MAX_MAGES} mages · {readyCount} ready</span></div>
  <p>Invite friends or add a basic AI opponent to play solo. Choose a starting magic school before marking ready. The battle starts automatically when every joined mage is ready, with at least {MIN_MAGES} mages. Invite everyone before the final ready.</p>
  <div className="lobby-seats">{game.players.map(p=><div className="seat" style={mageStyle(p.id)} data-player-id={p.id} key={p.id}>
  <span className="mage-icon" aria-hidden="true">{MAGE_SYMBOLS[p.id]}</span><div><strong>{p.name}</strong><small>{MAGE_COLOR_NAMES[p.id]} · {p.isBot?'Basic AI · ':''}{p.id===game.hostId?'Creator · ':''}{!p.connected?'Disconnected · waiting to rejoin':p.ready?'✓ Ready':'Not ready'}</small><span className="seat-school">{game.library.find(deck=>deck.id===p.startingSchoolId)?.name??'Choose a starting school'}</span>{p.isBot&&game.hostId===me.id&&<button disabled={!connected||pending} aria-label={`Remove ${p.name}`} onClick={()=>send({type:'REMOVE_BOT',playerId:me.id,botId:p.id})}>Remove AI</button>}</div>
  </div>)}</div>
  {game.hostId===me.id&&<div className="ai-opponents"><div className="button-row"><button disabled={!connected||pending||!botFits} onClick={()=>send({type:'ADD_BOT',playerId:me.id})}>Add AI opponent</button></div><p className="hint">The AI chooses its school, studies and prepares automatically, then pursues enemies and uses attacks, spells and evocations. You still continue the White Lotus and Cleanup phases. {botFits?'Adding or removing AI resets readiness.':'No more AI seats fit the current room capacity or shared library supply.'}</p></div>}
  <div className="room-count-choice"><label className="action-setting">Rooms per color<select aria-label="Rooms per color" value={game.roomsPerColor??'auto'} disabled={!connected||pending||game.hostId!==me.id} onChange={event=>send({type:'SET_ROOM_COUNT',playerId:me.id,roomsPerColor:event.target.value==='auto'?null:Number(event.target.value) as 1|2|3})}><option value="auto">Automatic · {getDefaultRoomsPerColor(joinedCount)} per color</option><option value="1">1 per color · 6 colored rooms</option><option value="2">2 per color · 12 colored rooms</option><option value="3">3 per color · 18 colored rooms</option></select></label><p className="hint">The host chooses the lodge size. Defaults: 2 mages → 1, 3 mages → 2, 4 mages → 3 rooms per color. Changes reset everyone's readiness; the board is built when the battle starts.</p></div>
  <div className="starting-school-choice">
   <label className="action-setting">Starting magic school<select aria-label="Starting magic school" value={school?.id??''} disabled={!connected||pending} onChange={e=>send({type:'SELECT_STARTING_SCHOOL',playerId:me.id,schoolId:e.target.value})}>
    <option value="" disabled>Choose your school</option>{game.library.map(deck=><option value={deck.id} key={deck.id}>{deck.name}</option>)}
   </select></label>
    <p className="hint">When the battle starts, {STARTING_SCHOOL_CARDS} cards from your chosen school become your entire personal grimoire: {STARTING_SCHOOL_CARDS-1} in your personal deck and one already in your public personal discard. Your hand starts empty; there are no extra base cards. Starting-school choices and personal discards are public, but future draw identities are hidden even from you. Players may choose the same school; its physical copies are shared. No cards are dealt before everyone is ready. Changing your school cancels your ready status.</p>
  </div>
  <p className="lobby-readiness notice" role="status" aria-live="polite">{joinedCount<MIN_MAGES?`Waiting for at least ${MIN_MAGES} mages. Invite one more mage or add an AI opponent to begin.`:`${readyCount} of ${joinedCount} joined mages ready. Waiting for everyone to choose a school and mark ready.`}{joinedCount<MAX_MAGES&&` ${MAX_MAGES-joinedCount} open seat${MAX_MAGES-joinedCount===1?'':'s'}; unused seats do not delay the battle.`}</p>
  <div className="button-row"><button className={me.ready?'':'primary'} disabled={!connected||pending||!me.ready&&!school} onClick={()=>send({type:'SET_READY',playerId:me.id,ready:!me.ready})}>{me.ready?'Cancel ready':'Mark ready'}</button></div>
 </section>;
}