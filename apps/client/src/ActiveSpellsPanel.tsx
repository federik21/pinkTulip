import React from 'react';
import { ActiveSpell, GameState, getSpellType } from '@brw/game-engine';
import { SPELL_TYPE_LABELS, evocationNumber, mageStyle, ownerName } from './presentation';
import { SpellTypeIcon } from './SpellTypeIcon';

function binding(game:GameState,active:ActiveSpell) {
 if(active.targetPlayerId)return game.players.find(p=>p.id===active.targetPlayerId||p.wizard.id===active.targetPlayerId)?.name??'Unknown mage';
 const evocation=game.evocations.find(e=>e.id===active.targetEvocationId);
 if(evocation)return `${ownerName(game,evocation.playerId)} · ${evocation.name} #${evocationNumber(game,evocation)}`;
 const room=active.roomId?game.board.rooms.find(room=>room.id===active.roomId):undefined;
 if(!room)return active.roomId?'Unknown room':'Unknown model';
 return active.card.trigger?.scope==='BOUND_COLOR'&&room.color?`${room.name} · all ${room.color} rooms`:room.name;
}

function coversRoom(game:GameState,active:ActiveSpell,roomId:string) {
 if(active.roomId===roomId)return true;
 if(active.card.trigger?.scope!=='BOUND_COLOR')return false;
 const color=game.board.rooms.find(room=>room.id===active.roomId)?.color;
 return !!color&&game.board.rooms.find(room=>room.id===roomId)?.color===color;
}

function condition(active:ActiveSpell) {
 const enemy=active.card.trigger?.relation==='ENEMY'?'An enemy':'The bound model';
 const color=active.card.trigger?.scope==='BOUND_COLOR';
 switch(active.card.trigger?.event) {
  case 'ENTER_ROOM':return `${enemy} enters the room`;
  case 'DAMAGE_TAKEN':return 'The bound model takes damage';
  case 'SPELL_CAST':return `${enemy} casts a spell`;
  case 'ROOM_ACTIVATED':return `${enemy} activates ${color?'a room of that color':'the room'}`;
  case 'EVOCATION_ACTIVATED':return `${enemy} evocation activates${color?' in a room of that color':''}`;
  case 'MAGE_ATTACK':return `${enemy} mage attacks`;
  case 'EVOCATION_ATTACK':return `${enemy} evocation attacks`;
  default:return 'Awaiting its condition';
 }
}

export function TrapReminders({game,viewerId,roomId,targetPlayerId,compact=false}:{game:GameState;viewerId:string;roomId?:string;targetPlayerId?:string;compact?:boolean}) {
 // Select the owner before inspecting any binding or type. Foreign hidden
 // cards remain secret even if a malformed/test projection includes details.
 const own=(game.readiedSpells??[]).filter(active=>active.playerId===viewerId).filter(active=>{
  if(roomId && (active.targetPlayerId || active.targetEvocationId || !coversRoom(game,active,roomId)))return false;
  if(targetPlayerId && ![targetPlayerId,game.players.find(p=>p.id===targetPlayerId)?.wizard.id].includes(active.targetPlayerId))return false;
  if(roomId || targetPlayerId)return true;
  if(active.targetPlayerId)return ![viewerId,game.players.find(p=>p.id===viewerId)?.wizard.id].includes(active.targetPlayerId);
  if(active.targetEvocationId)return game.evocations.some(model=>model.id===active.targetEvocationId&&model.playerId!==viewerId);
  return !!active.roomId;
 });
 if(!own.length)return null;
 return <section className={`trap-reminders${compact?' compact':''}`} role="region" aria-label="Your trap and protection reminders">
  <span className="eyebrow">Your active bindings · private reminder</span><h2>Remember your active magic</h2>
  <div className="trap-reminder-list">{own.map(active=><article className="trap-reminder" data-active-spell-id={active.id} style={mageStyle(viewerId)} key={active.id}>
   <strong><SpellTypeIcon type={getSpellType(active.card)}/>{active.card.name}</strong><small>Bound to {binding(game,active)}</small><small>{condition(active)} · Active</small>
  </article>)}</div>
 </section>;
}

export function ActiveSpellsPanel({game,viewerId}:{game:GameState;viewerId:string}) {
 const readied=game.readiedSpells??[],ongoing=game.ongoingSpells??[];
 if(!readied.length&&!ongoing.length)return null;
 return <section className="active-spells-panel" aria-label="Active and ongoing spells">
  <span className="eyebrow">Magic at work</span><h2>Active & ongoing</h2>
  <p className="hint">Conditions resolve automatically after the current instruction. Nested reactions finish before the interrupted effect resumes.</p>
  {readied.map(active=>{
   const own=active.playerId===viewerId;
   const type=getSpellType(active.card);
   const known=type==='TRAP'||type==='PROTECTION';
   return <article className={`active-spell readied-spell ${own?'own-spell':'hidden-spell'}`} data-active-spell-id={active.id} style={mageStyle(active.playerId)} key={active.id}>
    <span className="spell-type" data-spell-type={own||known?type:undefined}>{(own||known)&&<SpellTypeIcon type={type}/>} {own||known?`${SPELL_TYPE_LABELS[type]} · Active`:'Face down · Active'}</span>
    <strong>{own?active.card.name:'Hidden active spell'}</strong>
    <small>{ownerName(game,active.playerId)}{own?` · ${binding(game,active)}`:''}</small>
    <p>{own?active.card.rulesText:'Only its type is public. Its name, binding and trigger stay hidden until it reveals.'}</p>
   </article>;
  })}
  {ongoing.map(active=><article className="active-spell ongoing-spell" data-active-spell-id={active.id} style={mageStyle(active.playerId)} key={active.id}>
    <span className="spell-type" data-spell-type={getSpellType(active.card)}><SpellTypeIcon type={getSpellType(active.card)}/> {SPELL_TYPE_LABELS[getSpellType(active.card)]} · Ongoing</span>
   <strong>{active.card.name}</strong><small>{ownerName(game,active.playerId)} · Bound to {binding(game,active)}</small>
   <p>{active.card.rulesText}</p>
  </article>)}
 </section>;
}