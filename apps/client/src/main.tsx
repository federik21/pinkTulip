import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ACTIONS_PER_TURN, ELEMENT_GLYPHS, getEffectiveSpell, spellFilterAllows, spellReaches, getSpellType, getDiscardMoveCards, canUseSpellDummy, spellCanTargetModel, upgradeLegacyCards, Card, GameAction, GameState, Player, Room, MAX_MAGES, MIN_MAGES, ROOM_COLORS, ROOM_EFFECT_LABELS, isInStartingRoom, isWithinSpellRange, mustLeaveCell, hexDistance, hexKey } from '@brw/game-engine';
import { ActiveEvocationControls, EvocationSupply, EvocationsPanel, targetModels } from './EvocationsPanel';
import { PhysicalActionsPanel, PhysicalBannerActions } from './PhysicalActionsPanel';
import { useBoardZoom, ZoomControls } from './BoardZoom';
import { CombatFeedback, FeedbackPulse, useGameFeedback } from './CombatFeedback';
import { BotTurnRecap } from './TurnRecap';
import { ControlBanner, ControlTab, QuickAccess } from './ControlBanner';
import { ChronicleDrawer } from './ChronicleDrawer';
import { MageRoster } from './MageRoster';
import { ActiveSpellsPanel, TrapReminders } from './ActiveSpellsPanel';
import { QuestsPanel, QuickReference } from './MorePanels';
import { SpellTypeIcon } from './SpellTypeIcon';
import { SpellDescription } from './SpellDescription';
import { SchoolIcon } from './SchoolIcon';
import { LobbyPanel } from './LobbyPanel';
import { InfoPopup } from './InfoPopup';
import { SoulTithePrompt } from './SoulTithePrompt';
import { ChoicePrompt } from './ChoicePrompt';
import { ActivationConfirmation, ReactiveSpellPrompt } from './ReactiveSpellPrompt';
import { ModelEffectMarkers, RoomTrapTokens } from './ModelEffects';
import { MAGE_SYMBOLS as emoji, MAGE_COLOR_NAMES, SPELL_TYPE_LABELS, SPELL_TARGET_LABELS, SPELL_TARGET_DESCRIPTIONS, cubeSegments, evocationNumber, mageStyle, ownerColor, ownerName, roomModelLayout, roomNameLines, roomStatus } from './presentation';
import './style.css';
import './quick-access.css';
import './preparation.css';
import './soul-tithe.css';

const WS_URL=import.meta.env.VITE_WS_URL??`${location.protocol==='https:'?'wss':'ws'}://${location.hostname}:8080`;
const phaseInfo={
 LOBBY:['✦','Gather the mages','2–4 mages. Choose a school: start with 6 cards in your personal deck, 1 in personal discard, and an empty hand.'],
 BLACK_ROSE:['✺','BR','An event reshapes the lodge. Personal quests follow.'],
 STUDY:['▤','Study','Draw 2 personal spells, then 4 from any mix of schools. Discard 2 of those 4 library cards only.'],
 PREPARATION:['✧','Preparation','Choose a card, then tap its numbered or Quick slot. Place at least 2 spells, then tap Done.'],
 ACTION:['⚔','Action','Up to 2 actions total: Explore, Attack, spell casts, or discard-to-move.'],
 EVOCATION:['☠','Evocation','Activate each summon once. Move and attack in either order, or use only one, one model at a time.'],
 CLEANUP:['❖','Cleanup','Full rooms rebuild, award contribution points and return cubes once. Endgame follows round 3 or 30 VP, including BR.'],
 GAME_OVER:['♛','Game over','Final majorities and the first-player token have been scored. BR can win.'],
};
type Send=(action:GameAction)=>void;
type Slot='slot1'|'slot2'|'slot3'|'rapid';
const slotKeys:Slot[]=['slot1','slot2','slot3','rapid'];
const randomName=()=>['Ember','Moon','Storm','Rune','Thorn'][Math.floor(Math.random()*5)]+['Warden','Seer','Mancer','Sage','Bloom'][Math.floor(Math.random()*5)];

function SpellCard({card,label,selected,disabled,onClick,used=false}:{card:Card;label?:string;selected?:boolean;disabled?:boolean;onClick?:()=>void;used?:boolean}) {
 const spellType=getSpellType(card);
 return <button type="button" className={`spell ${card.powerful?'powerful':''} ${selected?'chosen':''} ${used?'used':''}`} aria-pressed={onClick?!!selected:undefined} disabled={disabled} onClick={onClick}>
  <span className="eyebrow">{label??'Spell'} · {SPELL_TARGET_LABELS[card.target]}</span>
  <span className="spell-type" data-spell-type={spellType}><SpellTypeIcon type={spellType}/><span>{SPELL_TYPE_LABELS[spellType]}{card.ongoing?' · Ongoing':''}</span></span>
  <strong>{card.name}</strong><span className="spell-rune"><SchoolIcon schoolId={card.schoolId} powerful={card.powerful}/></span>
  {card.element&&<span className="spell-element" data-element={card.element} title={`${card.element} symbol`}>{ELEMENT_GLYPHS[card.element]} {card.element}</span>}
  <SpellDescription card={card} showMoments/>
  {used&&<span className="spell-status" data-spell-status="SPENT">Spent</span>}
  <span className="hint">Range {card.range===Number.POSITIVE_INFINITY?'∞ · ignores line of sight':card.range} · {SPELL_TARGET_DESCRIPTIONS[card.target]}{card.powerful?' · Remove after use':''}</span>
 </button>;
}

function StudyPanel({game,me,send}:{game:GameState;me:Player;send:Send}) {
 const [selected,setSelected]=useState<string[]>([]);
 const [schools,setSchools]=useState<string[]>([]);
 const eligible=new Set(me.studyCardIds??[]);
 const validSelection=schools.length===4&&game.library.every(deck=>schools.filter(id=>id===deck.id).length<=deck.cards.length+deck.discard.length);
 if(me.studyDone)return <div className="notice">✓ Study complete. Waiting for the other mages.</div>;
 return <section className="phase-panel"><div className="section-heading"><div><span className="eyebrow">The shared library</span><h2>Schools of magic</h2></div><span className="badge">Grimoire +2 ✓</span></div>
  {!me.studyDrawn?<><p>Choose 4 blind draws in any school combination. Tap a school once per card. Each school has 12 spells with 3 copies each.</p><div className="schools">{game.library.map(deck=>{const count=schools.filter(id=>id===deck.id).length;return <div className="school-choice" key={deck.id}><button data-school-id={deck.id} disabled={schools.length>=4||count>=deck.cards.length+deck.discard.length} onClick={()=>setSchools(old=>[...old,deck.id])}><span className="school-rune"><SchoolIcon schoolId={deck.id}/></span><strong>{deck.name}</strong><span className="hint">Damage · Instability</span><small>{deck.cards.length} draw · {deck.discard.length} discard</small><span className="school-selected">Selected: {count}</span></button>{count>0&&<button className="remove-school" aria-label={`Remove 1 ${deck.name} card`} onClick={()=>setSchools(old=>old.filter((_,index)=>index!==old.lastIndexOf(deck.id)))}>− Remove one</button>}</div>;})}</div><div className="button-row"><button disabled={!schools.length} onClick={()=>setSchools([])}>Reset selection</button><button className="primary" disabled={!validSelection} onClick={()=>send({type:'DRAW_STUDY',playerId:me.id,deckIds:schools})}>Draw selected cards ({schools.length}/4)</button></div></>:
  <><p>Discard exactly 2 of the 4 new library cards. Older hand cards and your 2 personal draws are protected and cannot be selected.</p><div className="cards">{me.hand.map(card=><SpellCard key={card.id} card={card} disabled={!!card.powerful||!eligible.has(card.id)} selected={selected.includes(card.id)} onClick={()=>{if(eligible.has(card.id))setSelected(old=>old.includes(card.id)?old.filter(id=>id!==card.id):old.length<2?[...old,card.id]:old);}}/>)}</div><button className="primary" disabled={selected.length!==2||selected.some(id=>!eligible.has(id))} onClick={()=>send({type:'DISCARD_STUDY',playerId:me.id,cardIds:selected})}>Discard selected ({selected.length}/2)</button></>}
 </section>;
}

function PreparationPanel({me,send}:{me:Player;send:Send}) {
 const [selected,setSelected]=useState<string|null>(null);
 const [placed,setPlaced]=useState<Record<Slot,string|null>>({slot1:null,slot2:null,slot3:null,rapid:null});
 const count=slotKeys.filter(slot=>placed[slot]!==null).length;
 const selectedCard=me.hand.find(card=>card.id===selected);
 const destination=(slot:Slot)=>slot==='rapid'?'Quick slot':`slot ${slot.slice(-1)}`;
 const place=(slot:Slot)=>{
  if(!selectedCard)return;
  setPlaced(old=>{
   const next={...old};
   for(const key of slotKeys)if(next[key]===selectedCard.id)next[key]=null;
   next[slot]=selectedCard.id;
   return next;
  });
  setSelected(null);
 };
 const submit=()=>{
  if(count<2)return;
  const preparedCardIds=[placed.slot1,placed.slot2,placed.slot3];
  while(preparedCardIds.length&&preparedCardIds[preparedCardIds.length-1]===null)preparedCardIds.pop();
  send({type:'PREPARE_CARDS',playerId:me.id,preparedCardIds,...(placed.rapid?{rapidCardId:placed.rapid}:{})});
 };
 if(me.preparationDone)return <div className="notice">✓ Spells prepared. Waiting for the other mages.</div>;
 if(me.hand.length>me.cardLimit)return <HandLimitPanel me={me} send={send}/>;
 return <section className="phase-panel preparation-panel"><span className="eyebrow">Plan your sequence</span><h2>Prepare 2–4 spells</h2><p>Tap one card, then the slot where you want to prepare it. Numbered spells cast in order; the ✧ Quick spell can be cast on any turn. Place at least 2 spells. Unplaced cards stay in hand. Forgotten spells must be prepared before casting.</p>
  <div className="preparation-toolbar">
   <div className="preparation-order" role="group" aria-label="Prepared spell slots">{slotKeys.map((slot,index)=>{
    const card=me.hand.find(card=>card.id===placed[slot]);
    return <div key={slot} className={`preparation-slot${card?' is-filled':''}`} data-preparation-slot={slot}>
     <button type="button" className="preparation-destination" aria-label={`Place in ${destination(slot)}`} disabled={!selectedCard} onClick={()=>place(slot)}><b>{slot==='rapid'?'✧ Quick':`Slot ${index+1}`}</b><span>{card?.name??'Empty slot'}</span></button>
     {card&&<button type="button" className="preparation-remove" aria-label={`Remove from ${destination(slot)}`} onClick={()=>setPlaced(old=>({...old,[slot]:null}))}>✕</button>}
    </div>;
   })}</div>
   <div className="preparation-status" role="status" aria-live="polite">{selectedCard?`${selectedCard.name} selected. Tap a slot to place it.`:`${count}/4 spells placed. ${count<2?'Place at least 2 to finish.':'Ready when you are.'}`}</div>
   <div className="button-row"><button type="button" disabled={!count&&!selected} onClick={()=>{setSelected(null);setPlaced({slot1:null,slot2:null,slot3:null,rapid:null});}}>Reset selection</button><button type="button" className="primary" disabled={count<2} onClick={submit}>Done</button></div>
  </div>
  <div className="cards">{me.hand.map(card=>{const slot=slotKeys.find(key=>placed[key]===card.id);return <SpellCard key={card.id} card={card} label={slot?`In ${destination(slot)}`:'Choose this spell'} selected={selected===card.id} onClick={()=>setSelected(old=>old===card.id?null:card.id)}/>;})}</div>
  <p className="hint">To move or replace a prepared spell, select its card and tap another slot. Use ✕ to empty a slot, or Reset selection to start again.</p>
 </section>;
}

function HandLimitPanel({me,send}:{me:Player;send:Send}) {
 const [selected,setSelected]=useState<string[]>([]);
 const excess=me.hand.length-me.cardLimit;
 return <section className="phase-panel hand-limit-panel"><span className="eyebrow">Before assigning spell slots</span><h2>Reduce your hand to {me.cardLimit} cards</h2><p>You hold {me.hand.length} cards. Choose exactly {excess} to discard before preparing spells. These cards go to your <b>personal discard</b>, including school and forgotten cards; this is the hand-limit exception.</p><div className="cards">{me.hand.map(card=><SpellCard key={card.id} card={card} selected={selected.includes(card.id)} onClick={()=>setSelected(old=>old.includes(card.id)?old.filter(id=>id!==card.id):old.length<excess?[...old,card.id]:old)}/>)}</div><button className="primary" disabled={selected.length!==excess} onClick={()=>send({type:'DISCARD_HAND_LIMIT',playerId:me.id,cardIds:selected})}>Discard excess cards ({selected.length}/{excess})</button></section>;
}

function QuestLimitPanel({me,send}:{me:Player;send:Send}) {
 const [selected,setSelected]=useState<string[]>([]);
 const quests=[me.quest,...me.additionalQuests].filter((q):q is NonNullable<Player['quest']>=>!!q);
 const excess=quests.length-me.questLimit;
 if(excess<=0)return <div className="notice">Your quests meet the limit of {me.questLimit}. Waiting for the other mages to discard excess quests.</div>;
 return <section className="phase-panel quest-limit-panel"><span className="eyebrow">End of BR</span><h2>Keep up to {me.questLimit} quests</h2><p>Choose exactly {excess} quests to discard. Study will begin when all mages meet their limits.</p><div className="quest-choices">{quests.map(quest=><button key={quest.id} className={selected.includes(quest.id)?'chosen':''} aria-pressed={selected.includes(quest.id)} onClick={()=>setSelected(old=>old.includes(quest.id)?old.filter(id=>id!==quest.id):old.length<excess?[...old,quest.id]:old)}><strong>{quest.name}</strong><span>{quest.description}</span><small>+{quest.reward} VP</small></button>)}</div><button className="primary" disabled={selected.length!==excess} onClick={()=>send({type:'DISCARD_QUESTS',playerId:me.id,questIds:selected})}>Discard excess quests ({selected.length}/{excess})</button></section>;
}

function App() {
 const [game,setGame]=useState<GameState|null>(null),[playerId,setPlayerId]=useState<string|null>(null);
 const [connected,setConnected]=useState(false),[error,setError]=useState('');
 const [roomId,setRoomId]=useState('demo'),[playerName,setPlayerName]=useState(randomName);
 const [roomList,setRoomList]=useState<Array<{id:string;players:number;status:string;mages?:string[]}>>([]);
 const [canSave,setCanSave]=useState(false);
 const [overlay,setOverlay]=useState<GameState['phase']|null>(null),[toast,setToast]=useState('');
 const [selectedSlot,setSelectedSlot]=useState<Slot|null>(null),[selectedRoom,setSelectedRoom]=useState<string|null>(null);
 const [selectedModelId,setSelectedModelId]=useState('');
 const [dummy,setDummy]=useState(false),[exitCardId,setExitCardId]=useState('');
 const [retinueVisible,setRetinueVisible]=useState<Record<string,boolean>>({});
 const [controlTab,setControlTab]=useState<ControlTab>('actions');
 const [chronicleOpen,setChronicleOpen]=useState(false);
 const [quickControls,setQuickControls]=useState(false),[quickMode,setQuickMode]=useState(false);
 const quickOpener=useRef<HTMLElement|null>(null);
 const [infoPopup,setInfoPopup]=useState<'lodge'|'reference'|null>(null);
 const [historyRevision,setHistoryRevision]=useState(0);
 const [effectTargetId,setEffectTargetId]=useState('');
 const boardZoom=useBoardZoom();
 const feedback=useGameFeedback(game);
 const wsRef=useRef<WebSocket|null>(null);
 const requestRef=useRef<string|null>(null),requestCount=useRef(0);
 const [pending,setPending]=useState(false);
 useEffect(()=>{
  const ws=new WebSocket(WS_URL); wsRef.current=ws;
  ws.onopen=()=>setConnected(true);ws.onerror=()=>setError('Cannot reach the WebSocket server. Check that it is running on port 8080.');
    ws.onclose=()=>{setConnected(false);requestRef.current=null;setPending(false);setError('Connection closed. Reload to reconnect to your room.');};
  ws.onmessage=e=>{
   const msg=JSON.parse(e.data);
   if(msg.type==='CONNECTED')setCanSave(!!msg.canSave);
   if(msg.type==='WELCOME'){setPlayerId(msg.playerId);setRoomId(msg.roomId);}
   if(msg.type==='SESSION_SAVED'){setError('');setToast(`Session saved. Rejoin room "${msg.roomId}" with your mage name to resume.`);}
  if(msg.type==='STATE'){upgradeLegacyCards(msg.state);setGame(msg.state);setError('');}
   if(msg.type==='ROOM_LIST')setRoomList(msg.rooms);
    if(msg.type==='ERROR'){setError(msg.message);requestRef.current=null;setPending(false);}
    if(msg.type==='ACTION_APPLIED'&&msg.requestId===requestRef.current){requestRef.current=null;setPending(false);}
  };
  return()=>ws.close();
 },[]);
 const phase=game?.phase,round=game?.round;
 useEffect(()=>{
  setQuickControls(false);
  setSelectedSlot(null);setSelectedRoom(null);setSelectedModelId('');setDummy(false);setExitCardId('');
  if(!phase||phase==='LOBBY')return;
  setOverlay(phase);const timer=window.setTimeout(()=>setOverlay(null),2400);return()=>window.clearTimeout(timer);
 },[phase,round]);
 const myActivation=game?.activation?.playerId===playerId;
 const actionsUsed=game?.activation?.actionsUsed,exploring=game?.activation?.exploring;
 const activeEvocationId=game?.evocationActivation?.evocationId;
 const physicalKind=game?.activation?.physicalAction?.kind;
 const ownEvocationActive=!!playerId&&game?.evocationActivation?.playerId===playerId;
 useEffect(()=>{
  if(phase==='EVOCATION'||ownEvocationActive)setControlTab('evocations');
  else if(phase==='ACTION')setControlTab('actions');
 },[phase,ownEvocationActive]);
 useEffect(()=>{
  setSelectedSlot(null);
  if(phase!=='ACTION'){setToast('');return;}
  setToast(myActivation?(exploring?`Explore: ${exploring} adjacent step${exploring===1?'':'s'} remaining.`:physicalKind?'Resolve your physical action effects, or skip those remaining.':'Your turn · Choose an action: physical, spell, or discard-to-move.'):'Turn handed to the next mage.');
 },[phase,myActivation,actionsUsed,exploring,activeEvocationId,physicalKind]);
 useEffect(()=>{if(!toast)return;const t=window.setTimeout(()=>setToast(''),3200);return()=>window.clearTimeout(t);},[toast]);
 const send:Send=action=>{
  if(wsRef.current?.readyState!==WebSocket.OPEN){setError('Server disconnected. Reload to reconnect.');return;}
    if(requestRef.current)return;
    const requestId=`${Date.now()}-${++requestCount.current}`;
    requestRef.current=requestId;setPending(true);
    if(action.type==='PERFORM_MOVEMENT'||action.type==='ACTIVATE_EVOCATION'||action.type==='DISCARD_EXIT')setQuickControls(false);
    if(action.type==='UNDO_ACTION'||action.type==='REDO_ACTION') {
     setSelectedSlot(null);setSelectedRoom(null);setSelectedModelId('');setDummy(false);setExitCardId('');setEffectTargetId('');setHistoryRevision(n=>n+1);
    }
    setError('');wsRef.current.send(JSON.stringify({action,requestId}));
 };
 const continuePhase=()=>{if(game&&playerId)send({type:'ADVANCE_PHASE',playerId,expectedPhase:game.phase,expectedRound:game.round});};
 const join=(create:boolean)=>{
  if(wsRef.current?.readyState!==WebSocket.OPEN){setError('Wait for the server connection.');return;}
  setError('');wsRef.current.send(JSON.stringify({type:create?'CREATE_ROOM':'JOIN',roomId,playerName}));
 };
 if(!game || !playerId)return <div className="entry"><div className="entry-decoration">✺</div><div className="entry-card"><span className="eyebrow">A lodge of ambition and ruin</span><h1>BRW<br/><em>BATTLES</em></h1><p>A {MIN_MAGES}–{MAX_MAGES} mage online battle. Build your grimoire. Shape the lodge. Claim BRW.</p><label>Mage name<input value={playerName} maxLength={32} onChange={e=>setPlayerName(e.target.value)}/></label><label>Room name<input value={roomId} maxLength={48} onChange={e=>setRoomId(e.target.value)}/></label><div className="button-row"><button disabled={!connected} onClick={()=>join(false)}>Join room</button><button className="primary" disabled={!connected} onClick={()=>join(true)}>Create room</button></div><span className="hint">{connected?'● Connected to the lodge':'○ Connecting to server…'}</span>{error&&<p className="error" role="alert">{error}</p>}{roomList.length>0&&<div className="room-list"><h3>Open lodges</h3>{roomList.map(r=><button key={r.id} onClick={()=>setRoomId(r.id)}><b>{r.id}</b><span>{r.players}/{MAX_MAGES} · {r.status}{r.mages?`: ${r.mages.join(', ')}`:''}</span></button>)}</div>}</div></div>;
 const me=game.players.find(p=>p.id===playerId)!;
 const isHost=game.hostId===me.id;
 const paused=game.phase!=='LOBBY'&&!game.players.every(p=>p.connected);
 const enabled=connected&&!paused&&!game.pendingDecision;
 const myTurn=game.phase==='ACTION'&&game.currentPlayerId===me.id&&enabled&&!game.evocationActivation;
 const active=game.activation;
 const turnActionsRemaining=myTurn?Math.max(0,ACTIONS_PER_TURN-(active?.actionsUsed??0)):0;
 const inStart=isInStartingRoom(game,me);
 const activeEvocation=game.evocations.find(e=>e.id===game.evocationActivation?.evocationId);
 const movingEvocation=enabled&&game.evocationActivation?.playerId===me.id&&(game.evocationActivation?.movesRemaining??0)>0&&activeEvocation;
 const actingPlayer=enabled&&(game.phase==='ACTION'||game.phase==='EVOCATION')?game.players.find(p=>p.id===game.currentPlayerId):undefined;
 // The free Evocation-phase activation is mine to make, or my activated model still needs finishing.
 const evocationDue=game.evocationActivation?game.evocationActivation.playerId===me.id:game.phase==='EVOCATION'&&game.currentPlayerId===me.id&&game.evocations.some(e=>e.playerId===me.id&&!e.activated);
 const turnActionsUsed=active?.actionsUsed??0;
 const showHistory=!!game.history&&(game.history.canUndo||game.history.canRedo);
 const cellExitRequired=mustLeaveCell(game,me);
 const readyExitCard=!!exitCardId&&getDiscardMoveCards(me,active?.playerId===me.id?active:null).some(card=>card.id===exitCardId);
 const endTurnDisabled=pending||cellExitRequired||!!active?.physicalAction||!!active?.exploring||(turnActionsUsed<1&&!active?.spellsCast&&!active?.discardedExit);
 const openQuickControls=(tab:ControlTab)=>{
  quickOpener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  setControlTab(tab);setQuickMode(true);setQuickControls(true);
  window.requestAnimationFrame(()=>document.querySelector<HTMLElement>('#lodge-controls .back-to-map')?.focus({preventScroll:true}));
 };
 const closeQuickControls=()=>{setQuickControls(false);quickOpener.current?.focus({preventScroll:true});};
 const toggleRetinue=(playerId:string)=>{
  setRetinueVisible(prev=>({...prev,[playerId]:!prev[playerId]}));
  setControlTab('evocations');
 };
 const viewRetinue=(ownerId:string)=>{
  if(ownerId!==me.id)setRetinueVisible(prev=>({...prev,[ownerId]:true}));
  openQuickControls('evocations');
 };
 const powerfulCards=me.hand.filter(c=>c.powerful);
 const printedSpell=active?.physicalAction?null:selectedSlot?me.prepared[selectedSlot]?.card:null;
 // Enhancements change targeting only when the other revealed spells show the symbols.
 const spell=printedSpell?(['TRAP','PROTECTION'].includes(getSpellType(printedSpell))?printedSpell:getEffectiveSpell(game,me,printedSpell)):null;
 const activatingSpell=!!spell&&['TRAP','PROTECTION'].includes(getSpellType(spell));
 const nextSlot=(['slot1','slot2','slot3'] as Slot[]).find(key=>me.prepared[key]&&!me.prepared[key]!.used);
 const spellModelsInRoom=(room:Room)=>!spell||room.startingFor||inStart?[]:targetModels(game).filter(t=>spellCanTargetModel(spell,me.id,t.playerId,t.evocation?'EVOCATION':'MAGE')&&spellFilterAllows(spell,me.id,{playerId:t.playerId,evocation:game.evocations.find(e=>e.id===t.id)})&&room.tiles.some(h=>hexKey(h)===hexKey(t.position))&&spellReaches(game,spell,me.wizard.position,t.position));
 const canTarget=(room:Room)=>{
  if(!spell||activatingSpell||room.startingFor||inStart)return false;
  if(spell.target==='ROOM'||dummy&&canUseSpellDummy(spell))return room.tiles.some(h=>spellReaches(game,spell,me.wizard.position,h));
  return spellModelsInRoom(room).length>0;
 };
 const room=game.board.rooms.find(r=>r.id===selectedRoom);
 const cast=()=>{
  if(!selectedSlot||!spell)return;
  if(activatingSpell && !dummy) {
  send({type:'ACTIVATE_SPELL',playerId:me.id,slot:selectedSlot});
   setSelectedSlot(null);
   return;
  }
  if(!room||!canTarget(room))return;
  const candidates=spellModelsInRoom(room);
  const target=candidates.find(t=>t.id===selectedModelId)??candidates[0];
  const targeting=spell.target==='ROOM'||dummy?{roomId:room.id,...(dummy?{dummy:true}:{})}:target?.evocation?{targetEvocationId:target.id}:{targetPlayerId:target?.id};
  send({type:'CAST_SPELL',playerId:me.id,slot:selectedSlot,...targeting});
  setSelectedSlot(null);
 };
 const targetModes=spell&&!activatingSpell&&canUseSpellDummy(spell)?<>
      <div className="button-row target-mode">
       <button type="button" className={!dummy?'primary':''} aria-pressed={!dummy} onClick={()=>{setDummy(false);setSelectedRoom(null);setSelectedModelId('');}}>Target model</button>
       <button type="button" className={dummy?'primary':''} aria-pressed={dummy} onClick={()=>{setDummy(true);setSelectedRoom(null);setSelectedModelId('');}}>Target dummy · no damage</button>
      </div>
      {dummy&&<p className="hint dummy-target-help">Select any non-starting room in spell range, occupied or empty. Infinite range ignores line of sight. Only printed room instability resolves. Damage, healing, conversion and model-bound effects are ignored. The spell still costs its card and 1 turn action.</p>}
     </>:null;
 // With the dashboard closed after choosing a spell, the same toggle stays reachable beside the target confirmation.
 const dockedModes=!quickControls&&game.phase==='ACTION'?targetModes:null;
 const spellControls=<>
    {game.phase==='ACTION'&&<section className="phase-panel"><div className="section-heading"><div><span className="eyebrow">Your prepared grimoire · 1 action per cast</span><h2>{game.evocationActivation?.playerId===me.id?'Finish your evocation activation':myTurn?'Choose your next action':'Watch the other mage’s turn'}</h2></div><span className="badge">{myTurn?`${turnActionsRemaining} turn actions left`:me.passed?'Passed':'Waiting'}</span></div>
    {inStart&&<div className="notice">Leave your starting room with Explore or discard-to-move using any unused prepared spell before casting or attacking.</div>}
    {myTurn&&active?.physicalAction&&<div className="notice">Finish or skip your {active.physicalAction.kind==='EXPLORE'?'Explore':'Attack'} effects before casting spells.</div>}
      <div className="cards prepared">{slotKeys.map((key,i)=>{const c=me.prepared[key];return c&&<SpellCard key={key} card={c.card} used={c.used} label={key==='rapid'?'✧ Quick':`Spell ${i+1}`} selected={key===selectedSlot} disabled={pending||!myTurn||turnActionsRemaining===0||inStart||!!active?.physicalAction||!!active?.exploring||c.used||(key!=='rapid'&&(key!==nextSlot||!!active?.sequencedSpellUsed))} onClick={()=>{const hidden=['TRAP','PROTECTION'].includes(getSpellType(c.card));setSelectedSlot(old=>old===key?null:key);setSelectedRoom(!hidden&&selectedSlot!==key&&c.card.target==='SELF'?game.board.rooms.find(r=>r.tiles.some(h=>hexKey(h)===hexKey(me.wizard.position)))?.id??null:null);setSelectedModelId('');setDummy(false);setExitCardId('');if(quickControls)closeQuickControls();setToast(hidden?'Confirm activation. No room or target is chosen.':c.card.target==='SELF'?'Your mage is selected. Confirm the spell to cast on yourself.':'Choose a highlighted room, then an eligible target.');}}/>;})}</div>
    {spell&&<>
    <p className="hint">1 turn action per spell; no physical token. One numbered spell per turn. Finite range follows a straight hex line; infinite range ignores line of sight.</p>
    {activatingSpell&&<p className="notice">Activate face down without choosing a room or target. Only the spell type is public. You may reveal when its condition occurs, or keep it hidden. Unrevealed cards return to hand at Cleanup.</p>}
    {spell.ongoing&&!dummy&&<p className="notice">Ongoing: persists after mage defeat, follows the bound mage after respawn, and reacts automatically until Cleanup discards it.</p>}
    {!activatingSpell&&<p className="spell-target-help hint">{spell.moments.some(m=>m.effect==='BLACK_ROSE_CONVERT'&&m.scope==='CASTER')?`Choose a room within range ${spell.range}. First damage enemy models there, never your mage or friendly evocations. Then convert your mage’s last damage cubes received from other mages to BR black, returning those cubes without changing wounds. Finally resolve the printed Pain moment.`:<>Target: {SPELL_TARGET_DESCRIPTIONS[spell.target]}. Only Self spells can select your mage. Support can select friendly evocations. Damage never harms your mage or your evocations. Heal removes wounds from each selected model. Convert replaces other-colored {spell.target==='ROOM'?'instability cubes in the room':'damage cubes on an enemy model'} with your available cubes; it does not add damage or instability. Ordinary damage conversion is ignored on your own mage and evocations; other spell effects still resolve.</>}</p>}
     {quickControls&&targetModes}
    </>}
    </section>}
    <ActiveSpellsPanel game={game} viewerId={me.id} send={send} disabled={!enabled||pending}/>
    {powerfulCards.length>0&&<section className="powerful-panel"><span className="eyebrow">The central chamber's gift · saved in hand</span><h2>Forgotten spells</h2><p>Prepare in a later round; never cast directly from hand. Casting permanently removes the card. Unused prepared forgotten spells return to hand next round.</p><div className="cards">{powerfulCards.map(card=><SpellCard key={card.id} card={card} label="✺ Prepare in a later round" disabled/>)}</div><p className="hint">Supply: {game.powerfulDeck.length} remaining · {game.removedCards.length} permanently removed</p></section>}
 </>;
 return <div className="app"><header><a className="brand" href="/">✺ <span>BRW BATTLES <small>ONLINE LODGE</small></span></a><div className="header-meta">{canSave&&game.phase!=='LOBBY'&&game.phase!=='GAME_OVER'&&<button type="button" className="info-button" onClick={()=>wsRef.current?.send(JSON.stringify({type:'SAVE_SESSION'}))}>Save session</button>}<button type="button" className="info-button" onClick={()=>setInfoPopup('reference')}>Quick reference</button><span className="badge">{roomId}</span><span>Round {game.round}</span><span className={connected?'online':'error'}>{connected?'● Live':'○ Offline'}</span></div></header>
  <nav className="phase-track">{(['BLACK_ROSE','STUDY','PREPARATION','ACTION','EVOCATION','CLEANUP'] as const).map((phase,i)=><div key={phase} className={game.phase===phase?'current':''}><small>0{i+1}</small><span>{phaseInfo[phase][1]}</span></div>)}</nav>
  {actingPlayer&&<div className="turn-banner" style={mageStyle(actingPlayer.id)}><span className="acting-mage-icon" aria-hidden="true">{emoji[actingPlayer.id]}</span><div className="turn-banner-text" role="status" aria-live="polite"><span className="eyebrow">{actingPlayer.id===me.id?'Your turn':'Mage acting'}</span><strong>{actingPlayer.name}</strong><small>{game.evocationActivation?'Controlling an evocation':game.phase==='EVOCATION'?'Choosing an evocation':'Taking an Action turn'}</small></div>
  {(showHistory||myTurn)&&<div className="turn-banner-controls">
    {myTurn&&active?.physicalAction&&<PhysicalBannerActions game={game} me={me} pending={pending} effectTargetId={effectTargetId} send={send}/>}
    {showHistory&&<div className="turn-history" role="group" aria-label="Action history"><button type="button" aria-label="Undo action" title={game.history?.undoLabel?`Undo: ${game.history.undoLabel}`:undefined} disabled={!enabled||pending||!game.history?.canUndo} onClick={()=>send({type:'UNDO_ACTION',playerId:me.id})}><span aria-hidden="true">↶ </span>Undo</button><button type="button" aria-label="Redo action" title={game.history?.redoLabel?`Redo: ${game.history.redoLabel}`:undefined} disabled={!enabled||pending||!game.history?.canRedo} onClick={()=>send({type:'REDO_ACTION',playerId:me.id})}>Redo<span aria-hidden="true"> ↷</span></button></div>}
    {myTurn&&cellExitRequired&&<small className="cell-exit-reminder" role="status">Use your last action to leave the cell.</small>}
    {myTurn&&<button type="button" className="primary end-turn" disabled={endTurnDisabled} onClick={()=>{setExitCardId('');send({type:'END_ACTIVATION',playerId:me.id});}}>End turn <span className="turn-action-count">({turnActionsUsed}/{ACTIONS_PER_TURN})</span></button>}
   </div>}
    {ownEvocationActive&&<ActiveEvocationControls game={game} playerId={me.id} enabled={enabled} pending={pending} send={send}/>}
  </div>}
  {overlay&&<div className="phase-overlay" role="status" onClick={()=>setOverlay(null)}><span>{phaseInfo[overlay][0]}</span><small>ROUND {game.round}</small><h1>{phaseInfo[overlay][1]}</h1><p>{phaseInfo[overlay][2]}</p><small>Click to continue</small></div>}
  {toast&&<div className="toast" role="status">{toast}</div>}
  <CombatFeedback game={game} feedback={feedback}/>
  <BotTurnRecap game={game}/>
  <SoulTithePrompt game={game} viewerId={me.id} connected={connected&&!paused} pending={pending} send={send}/>
  <ReactiveSpellPrompt game={game} viewerId={me.id} connected={connected&&!paused} pending={pending} send={send}/>
  <ChoicePrompt game={game} viewerId={me.id} connected={connected&&!paused} pending={pending} send={send}/>
  {spell&&activatingSpell&&!game.pendingDecision&&<ActivationConfirmation card={spell} disabled={pending||!myTurn||turnActionsRemaining===0} onConfirm={cast} onCancel={()=>{setSelectedSlot(null);setSelectedRoom(null);}}/>}
  <main>
   <div className="game-column">
    {error&&<div className="error notice" role="alert">{error}</div>}
    {paused&&<div className="notice">Game paused. Waiting for the disconnected mage to rejoin room <b>{roomId}</b>.</div>}
    {game.phase==='LOBBY'&&<LobbyPanel game={game} me={me} connected={connected} pending={pending} send={send}/>}
    {game.phase==='BLACK_ROSE'&&<section className="phase-panel event-panel"><span className="eyebrow">Event revealed · Round {game.round}</span><h2>✺ {game.usedEvent?.name}</h2><p>{game.usedEvent?.description}</p><div className="notice">{game.usedEvent?.kind==='BLACK_DAMAGE'?`${game.usedEvent.amount} black damage to every mage.`:`${game.usedEvent?.amount} neutral instability in ${game.usedEvent?.rooms} random unfinished rooms.`} See the log for resolved effects.</div><p className="hint">At the end of BR, discard excess quests to meet your limit of {me.questLimit}. Study and its 2 grimoire draws wait until all mages meet their limits.</p>{game.blackRoseResolved?<fieldset disabled={!enabled||pending}><QuestLimitPanel key={`quests-${game.round}`} me={me} send={send}/></fieldset>:isHost?<button className="primary" disabled={!enabled||pending} onClick={continuePhase}>Receive quests & begin Study →</button>:<p className="waiting">Waiting for the creator to begin Study…</p>}</section>}
    {game.phase==='STUDY'&&<fieldset disabled={!enabled||pending}><StudyPanel key={`study-${game.round}`} game={game} me={me} send={send}/></fieldset>}
    {game.phase==='PREPARATION'&&<fieldset disabled={!enabled||pending}><PreparationPanel key={`prep-${game.round}`} me={me} send={send}/></fieldset>}
    {game.phase==='CLEANUP'&&<section className="phase-panel"><span className="eyebrow">The end of the round</span><h2>❖ The lodge settles</h2><p>Full rooms have rebuilt, awarded contribution points and returned their cubes once. They accept no more instability; their double specials are now ready. Endgame follows Cleanup in round 3, or when any mage or the BR reaches 30 VP.</p>{isHost?<button className="primary" disabled={!enabled||pending} onClick={continuePhase}>Begin round {game.round+1} →</button>:<p className="waiting">Waiting for the creator to begin the next round…</p>}</section>}
    {game.phase==='GAME_OVER'&&<section className="phase-panel victory"><span className="eyebrow">The Lotus has chosen</span><h2>♛ {game.winner?ownerName(game,game.winner):'The lodge'} wins</h2><p>{[...game.players.map(p=>`${p.name}: ${p.victoryPoints} VP`),`BR: ${game.blackRose.victoryPoints} VP · ${game.blackRose.kills} kills`].join(' · ')}</p><p className="hint">{game.endgameScored?'Final majorities and first-player bonus included.':'Final scores are being resolved.'}</p><button onClick={()=>location.reload()}>Return to lobby</button></section>}
    <TrapReminders game={game} viewerId={me.id}/>
    <ControlBanner selected={controlTab} floating={quickControls} onClose={closeQuickControls}
    actions={<>{game.phase==='ACTION'&&game.currentPlayerId===me.id&&!game.evocationActivation?<PhysicalActionsPanel key={historyRevision} game={game} me={me} enabled={enabled} pending={pending} exitCardId={exitCardId} setExitCardId={setExitCardId} effectTargetId={effectTargetId} setEffectTargetId={setEffectTargetId} clearSpell={()=>{setSelectedSlot(null);setSelectedRoom(null);setSelectedModelId('');setDummy(false);}} send={send}/>:<div className="control-waiting"><h2>Physical actions</h2><p>{game.evocationActivation?'An evocation is active. Open Evocations to continue.':game.phase==='ACTION'?`${game.players.find(p=>p.id===game.currentPlayerId)?.name??'Another mage'} is acting.`:'Physical actions are available during the Action phase.'}</p></div>}</>}
    spells={spellControls}
     evocations={<>
      {game.phase==='EVOCATION'&&<section className="evocation-phase"><span className="eyebrow">After the mages act</span><h2>Evocation phase</h2><p>{game.currentPlayerId===me.id?'Choose an unused evocation from your retinue.':`${game.players.find(p=>p.id===game.currentPlayerId)?.name} is controlling their evocations.`} Each model activates once. Move and attack in either order, or use only one; attacks target an enemy in the same room. Active controls are in the top banner.</p></section>}
      <EvocationSupply game={game}/>
      <EvocationsPanel game={game} playerId={me.id} viewerId={me.id} enabled={enabled} pending={pending} send={send}/>
      <div className="opponent-retinue-toggles" role="group" aria-label="Opponent retinues">{game.players.filter(p=>p.id!==me.id).map(p=><button key={p.id} className="mini-toggle" aria-label={`${retinueVisible[p.id]?'Hide':'Show'} evocations for ${p.name} (${game.evocations.filter(e=>e.playerId===p.id).length})`} aria-expanded={!!retinueVisible[p.id]} aria-controls={`retinue-${p.id}`} onClick={()=>toggleRetinue(p.id)}>{retinueVisible[p.id]?'Hide':'Show'} {p.name} evocations ({game.evocations.filter(e=>e.playerId===p.id).length})</button>)}</div>
      {game.players.filter(p=>p.id!==me.id).map(p=><div key={p.id} hidden={!retinueVisible[p.id]}><EvocationsPanel game={game} playerId={p.id} viewerId={me.id} enabled={enabled} pending={pending} send={send}/></div>)}
     </>}
    quests={<QuestsPanel game={game} me={me} disabled={!enabled||pending} send={send}/>}
    />
    <section className="board-panel"><div className="section-heading"><div><span className="eyebrow">The lodge</span><h2>{movingEvocation&&activeEvocation?`${activeEvocation.name} #${evocationNumber(game,activeEvocation)} · choose an adjacent space`:exitCardId&&myTurn?'Discard to move · choose an adjacent space':spell?`Target: ${spell.name}${dummy?' · dummy':''}`:active?.exploring&&myTurn?'Explore · choose an adjacent space':'Chambers of the BR'}</h2></div><div className="board-tools"><ZoomControls zoom={boardZoom.zoom} onZoomIn={boardZoom.zoomIn} onZoomOut={boardZoom.zoomOut} onReset={boardZoom.resetZoom}/><button type="button" className="info-button" aria-label="Lodge information" onClick={()=>setInfoPopup('lodge')}>ⓘ Info</button></div></div>
      <div className="board-viewport" ref={boardZoom.setViewport} style={boardZoom.viewportStyle} tabIndex={0} role="region" aria-label="Scrollable lodge board"><svg className="board" style={boardZoom.boardStyle} viewBox="-210 -165 420 330" role="group" aria-label="Hexagonal lodge board">{game.board.rooms.map(r=>{
      const h=r.tiles[0],x=(h.q+h.r/2)*62,y=h.r*54;
      const occupants=game.players.filter(p=>r.tiles.some(tile=>hexKey(p.wizard.position)===hexKey(tile)));
      const summons=game.evocations.filter(e=>r.tiles.some(tile=>hexKey(e.position)===hexKey(tile)));
      const modelLayout=roomModelLayout(occupants.length+summons.length);
      const contributions=Object.entries(r.cubesByPlayer).filter(([,n])=>n>0);
      const segments=cubeSegments(r.cubesByPlayer,r.instability,r.instabilityLimit);
      const evocationReachable=!!movingEvocation&&(game.evocationActivation?.movesRemaining??0)>0&&hexDistance(h,movingEvocation.position)===1&&!r.startingFor;
      const mageReachable=myTurn&&(!!active?.exploring||readyExitCard&&turnActionsRemaining>0&&!active?.physicalAction&&!active?.discardedExit)&&hexDistance(h,me.wizard.position)===1&&!r.startingFor;
      const reachable=evocationReachable||mageReachable;
      const targetable=myTurn&&turnActionsRemaining>0&&!!spell&&canTarget(r);
      const choose=()=>{
      if(pending)return;
      if(evocationReachable)send({type:'EVOCATION_STEP',playerId:me.id,destination:h});
      else if(mageReachable&&exitCardId&&!active?.exploring){send({type:'DISCARD_EXIT',playerId:me.id,cardId:exitCardId,destination:h});setExitCardId('');}
      else if(reachable)send({type:'EXPLORE_STEP',playerId:me.id,destination:h});
      else {setSelectedRoom(r.id);setSelectedModelId('');}
      };
      return <g key={r.id} data-room-id={r.id} data-color={r.color??undefined} transform={`translate(${x},${y})`} className={`hex ${occupants.some(p=>p.id===actingPlayer?.id)?'acting-room':''} ${r.reconstructed?'rebuilt':''} ${r.startingFor?'start-room':''} ${r.id==='room-0,0'?'central':''} ${selectedRoom===r.id?'selected':''} ${reachable||targetable?'reachable':''}`} role="button" tabIndex={0} aria-label={`${r.name}, ${r.startingFor?'protected starting room':roomStatus(r)}${!r.reconstructed?contributions.map(([id,n])=>`, ${ownerName(game,id)}: ${n} cubes`).join(''):''}${occupants.map(p=>`, ${p.name}`).join('')}${summons.map(e=>`, ${e.name} #${evocationNumber(game,e)} of ${ownerName(game,e.playerId)}`).join('')}`} onClick={choose} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}}}>
      <title>{r.name}{r.color?` · ${r.color}`:''} · {r.effect?ROOM_EFFECT_LABELS[r.effect]:'Protected starting room'}{r.reconstructed?` · Rebuilt · ${roomStatus(r)}`:` · Rewards ${r.rewards.join('/')} VP`}</title><polygon points="0,-33 29,-16 29,16 0,33 -29,16 -29,-16"/>
          <FeedbackPulse feedback={feedback} kind="ROOM" targetId={r.id} svg/>
          <RoomTrapTokens game={game} viewerId={me.id} roomId={r.id}/>
      <text className="room-name" aria-hidden="true">{roomNameLines(r.name).map((line,i)=><tspan x={0} y={-21+i*7} key={i}>{line}{i===0?' ':''}</tspan>)}</text>
          {occupants.length?occupants.map((p,i)=>{const token=modelLayout(i);return <g key={p.id} transform={`translate(${token.x},${token.y})`}><FeedbackPulse feedback={feedback} kind="MAGE" targetId={p.id} svg/><g className={p.id===actingPlayer?.id?'acting-mage-token':''} data-mage-id={p.id} style={mageStyle(p.id)}><title>{p.name} · {MAGE_COLOR_NAMES[p.id]}</title><circle className="mage-token-disc" r={token.radius}/><text className="occupants" style={{fontSize:token.radius*1.8}} y={token.radius*.6}>{emoji[p.id]}</text></g><ModelEffectMarkers game={game} viewerId={me.id} modelId={p.id} radius={token.radius}/></g>;}):!summons.length&&<text className="empty-room-icon" y={0}>{r.startingFor?'⌂':r.reconstructed?'❖':r.id==='room-0,0'?'✺':'·'}</text>}
          {summons.length>0&&<g className="evocation-markers">{summons.map((e,i)=>{const token=modelLayout(occupants.length+i);const big=e.kind==='COLOSSUS',tr=big?token.radius*1.35:token.radius;return <g className={`evocation-marker${big?' big-evocation':''}`} data-evocation-id={e.id} data-owner-id={e.playerId} style={mageStyle(e.playerId)} transform={`translate(${token.x},${token.y})`} key={e.id}><title>{ownerName(game,e.playerId)} · {e.name} #{evocationNumber(game,e)}</title><FeedbackPulse feedback={feedback} kind="EVOCATION" targetId={e.id} svg/><circle className="mage-token-disc evocation-token-disc" r={tr}/><text style={{fontSize:tr*1.2}} y={tr*.4}>{evocationNumber(game,e)}</text><ModelEffectMarkers game={game} viewerId={me.id} modelId={e.id} radius={tr}/></g>;})}</g>}
      {r.startingFor?<text className="start-label" y={17}>START</text>:r.reconstructed?<g className={`rebuilt-badge ${r.specialUsed?'used':'ready'}`}><rect x={-18} y={10} width={36} height={12} rx={3}/><text y={18.5}>{roomStatus(r)}</text></g>:<g className="capacity-badge">
      <rect className="capacity-background" x={-18} y={10} width={36} height={12} rx={3}/>
      {segments.length?segments.map(segment=><rect className="capacity-fill" data-owner-id={segment.id} data-cubes={segment.count} key={segment.id} x={-17+34*segment.start} y={11} width={34*segment.fraction} height={10} style={{fill:ownerColor(segment.id)}}/>):<rect className="capacity-fill" x={-17} y={11} width={0} height={10}/>}
      <text className="cube-count" y={18.5}>◆ {r.instability}/{r.instabilityLimit}</text>
      </g>}
      {!r.startingFor&&!r.reconstructed&&contributions.map(([id,n],i)=><g className="cube-owner" transform={`translate(${(i-(contributions.length-1)/2)*5},26)`} key={id}><title>{ownerName(game,id)}: {n} cubes</title><circle r={2.5} fill={ownerColor(id)}/><text y={1.3}>{n}</text></g>)}
      </g>;
     })}</svg></div>
    {room&&<div className={`room-detail${quickMode&&spell&&!quickControls?' quick-target':''}`}><strong>{room.name} {room.reconstructed?'· Rebuilt':''}</strong><span>{room.startingFor?'Protected starting room · Exit only; no voluntary reentry':room.reconstructed?`Double special · ${roomStatus(room)} · no further cube placement`:`${room.color??'Central'} · ${room.instability}/${room.instabilityLimit} instability · Rewards ${room.rewards.join(' / ')} VP${room.instability>=room.instabilityLimit?' · Full: locked to new cubes; rebuilds at Cleanup, then unlocks its double special.':''}`}</span>
    {room.effect&&<span>{room.reconstructed?'Double special':'Free effect'}: {ROOM_EFFECT_LABELS[room.effect]}{room.reconstructed?` ×2 · ${room.specialUsed?'Used this Action phase':'Ready · once per Action phase'}`:' · once within Explore or Attack, before or after its primary effect.'}</span>}
    {!room.reconstructed&&<div className="contributions">{Object.entries(room.cubesByPlayer).filter(([,n])=>n>0).map(([id,n])=><span style={mageStyle(id)} key={id}>{emoji[id]??'✺'} {ownerName(game,id)}: {n}</span>)}</div>}
    {dockedModes}
    {!activatingSpell&&spell&&spell.target!=='ROOM'&&spell.target!=='SELF'&&!dummy&&<label className="action-setting">Spell target model<select aria-label="Spell target model" value={selectedModelId} onChange={e=>setSelectedModelId(e.target.value)}><option value="">First eligible model in this room</option>{spellModelsInRoom(room).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
    {!activatingSpell&&spell?.target==='SELF'&&<p className="hint">This spell targets only your mage.</p>}
    {spell&&!activatingSpell&&<button className="primary" disabled={pending||!myTurn||turnActionsRemaining===0||!canTarget(room)} onClick={cast}>Cast {spell.name} {spell.target==='SELF'?'on yourself':'here'}{dummy?' on dummy':''}</button>}
    </div>}
    {!room&&dockedModes&&quickMode&&<div className="quick-modes">{dockedModes}</div>}
    </section>
    <MageRoster game={game} viewerId={me.id} actingPlayerId={actingPlayer?.id} onViewRetinue={viewRetinue}/>
   </div>
  <ChronicleDrawer open={chronicleOpen} entries={game.log} players={game.players} onClose={()=>setChronicleOpen(false)}/>
  {infoPopup==='reference'&&<InfoPopup id="quick-reference" title="Quick reference" onClose={()=>setInfoPopup(null)}><QuickReference game={game} me={me}/></InfoPopup>}
  {infoPopup==='lodge'&&<InfoPopup id="lodge-info" title="Lodge information" onClose={()=>setInfoPopup(null)}><p className="board-help">Select a chamber to inspect it or confirm a spell target. Scroll the board on smaller screens. Protected starting cells allow exits only. Segmented badges show instability / capacity by mage color; light gray is BR. Full rooms rebuild at Cleanup. Rebuilt rooms show READY / USED instead of returned cubes. Numbered circles are owner-colored evocations. Bound models show shield, trap and ✧ ongoing-effect icons. Your hidden bindings are visible only to you; ongoing effects are public. Repeated effects show counts on mage and evocation cards.</p><div className="room-legend">{ROOM_COLORS.map(color=><span data-color={color} key={color}><i/>{color} · {game.board.rooms.filter(room=>room.color===color).length}</span>)}</div><div className="mage-legend" aria-label="Mage colors">{game.players.map(p=><span style={mageStyle(p.id)} data-player-id={p.id} key={p.id}><i aria-hidden="true"/>{emoji[p.id]} {p.name} · {MAGE_COLOR_NAMES[p.id]}</span>)}<span className="neutral-owner"><i aria-hidden="true"/>✺ BR · neutral</span></div><dl className="room-effect-reference">{ROOM_COLORS.map(color=><React.Fragment key={color}><dt>{color}</dt><dd>{ROOM_EFFECT_LABELS[game.board.rooms.find(room=>room.color===color)?.effect??'DRAW_POWERFUL']}</dd></React.Fragment>)}</dl><p>The central chamber grants a Forgotten spell for discarding 2 cards. Violet rooms place 1 cube and give you the first-player token. Room effects are optional within a physical action; rebuilt rooms double their special, once per Action phase.</p></InfoPopup>}
  </main><footer>BRW BATTLES · Unofficial prototype · 2–4 mages · Original placeholder cards</footer>
  <QuickAccess selected={controlTab} expanded={quickControls} chronicleOpen={chronicleOpen} readyQuests={[me.quest,...me.additionalQuests].filter(quest=>quest?.completed&&!quest.claimed).length} evocationDue={evocationDue} onSelect={openQuickControls} onChronicle={()=>setChronicleOpen(true)}/>
 </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);