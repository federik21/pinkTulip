import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ACTIONS_PER_TURN, BLACK_ROSE_ID, ENDGAME_REWARDS, getRoomRewards, Card, GameAction, GameState, Player, Room, MAX_MAGES, MIN_MAGES, ROOM_COLORS, ROOM_EFFECT_LABELS, isInStartingRoom, isWithinSpellRange, hexDistance, hexKey } from '@brw/game-engine';
import { ActiveEvocationControls, EvocationsPanel, targetModels } from './EvocationsPanel';
import { DamageBar } from './DamageBar';
import { PhysicalActionsPanel } from './PhysicalActionsPanel';
import { MAGE_SYMBOLS as emoji, MAGE_COLOR_NAMES, cubeSegments, evocationNumber, mageStyle, ownerColor, ownerName, roomNameLines, roomStatus } from './presentation';
import './style.css';

const WS_URL=import.meta.env.VITE_WS_URL??`${location.protocol==='https:'?'wss':'ws'}://${location.hostname}:8080`;
const phaseInfo={
 LOBBY:['✦','Gather the mages','2–4 mages. The battle starts automatically when every joined mage is ready.'],
 BLACK_ROSE:['✺','Black Rose','An event reshapes the lodge. Personal quests follow.'],
 STUDY:['▤','Study','Draw 2 grimoire spells, choose a school for 4 more, discard 2.'],
 PREPARATION:['✧','Preparation','Choose spells in order 1 → 2 → 3, then a flexible spell. Held powers must be prepared before casting.'],
 ACTION:['⚔','Action','Up to 2 actions total: Explore, Attack, spell casts, or discard-to-move.'],
 EVOCATION:['☠','Evocation','Activate each summon once. Move, then attack, one model at a time.'],
 CLEANUP:['❖','Cleanup','Full rooms rebuild, award contribution points and return cubes once. Endgame follows round 3 or 30 VP, including the Black Rose.'],
 GAME_OVER:['♛','Game over','Final majorities and the first-player token have been scored. The Black Rose can win.'],
};
type Send=(action:GameAction)=>void;
type Slot='slot1'|'slot2'|'slot3'|'rapid';
const slotKeys:Slot[]=['slot1','slot2','slot3','rapid'];
const randomName=()=>['Ember','Moon','Storm','Rune','Thorn'][Math.floor(Math.random()*5)]+['Warden','Seer','Mancer','Sage','Bloom'][Math.floor(Math.random()*5)];

function SpellCard({card,label,selected,disabled,onClick,used=false}:{card:Card;label?:string;selected?:boolean;disabled?:boolean;onClick?:()=>void;used?:boolean}) {
 return <button type="button" className={`spell ${card.powerful?'powerful':''} ${selected?'chosen':''} ${used?'used':''}`} disabled={disabled} onClick={onClick}>
  <span className="eyebrow">{label??'Spell'} · {card.target==='ROOM'?'Room':'Model'}</span>
  <strong>{card.name}</strong><span className="spell-rune">{card.damage>2?'✹':card.instability>0?'◈':'✧'}</span>
  <span className="spell-effects">{card.damage>0&&<span>🔥 {card.damage} damage</span>}{card.instability>0&&<span>◆ {card.instability} instability</span>}</span>
  <span className="hint">Range {card.range} · {card.target==='ROOM'?'all enemy models':'single enemy model'} · 1 action to cast{card.powerful?' · Remove after use':''}{used?' · Spent':''}</span>
 </button>;
}

function StudyPanel({game,me,send}:{game:GameState;me:Player;send:Send}) {
 const [selected,setSelected]=useState<string[]>([]);
 if(me.studyDone)return <div className="notice">✓ Study complete. Waiting for the other mages.</div>;
 return <section className="phase-panel"><div className="section-heading"><div><span className="eyebrow">The shared library</span><h2>Six schools. Infinite possibilities.</h2></div><span className="badge">Grimoire +2 ✓</span></div>
  {!me.studyDrawn?<><p>Choose one school to draw 4 spells. All six currently contain the same 36-card set.</p><div className="schools">{game.library.map((deck,i)=><button key={deck.id} disabled={deck.cards.length+deck.discard.length<4} onClick={()=>send({type:'DRAW_STUDY',playerId:me.id,deckId:deck.id})}><span className="school-rune">{['✺','❖','✧','☽','⚚','✹'][i]}</span><strong>{deck.name}</strong><small>{deck.cards.length} draw · {deck.discard.length} discard</small></button>)}</div></>:
  <><p>Choose exactly 2 spells to discard. School spells return to that school's discard; personal spells return to your grimoire discard. Powerful spells cannot be discarded.</p><div className="cards">{me.hand.map(card=><SpellCard key={card.id} card={card} disabled={!!card.powerful} selected={selected.includes(card.id)} onClick={()=>setSelected(old=>old.includes(card.id)?old.filter(id=>id!==card.id):old.length<2?[...old,card.id]:old)}/>)}</div><button className="primary" disabled={selected.length!==2} onClick={()=>send({type:'DISCARD_STUDY',playerId:me.id,cardIds:selected})}>Discard selected ({selected.length}/2)</button></>}
 </section>;
}

function PreparationPanel({me,send}:{me:Player;send:Send}) {
 const [selected,setSelected]=useState<string[]>([]);
 if(me.preparationDone)return <div className="notice">✓ Spells prepared. Waiting for the other mages.</div>;
 if(me.hand.length>me.cardLimit)return <HandLimitPanel me={me} send={send}/>;
 return <section className="phase-panel"><span className="eyebrow">Plan your sequence</span><h2>Three ordered spells. One wild card.</h2><p>Select in order: 1, 2, 3, then ✧ flexible. Numbered spells must be cast progressively; the flexible spell can be cast on any of your turns. Powerful spells must be prepared in a slot, never cast from hand. Cast powers are permanently removed; unused prepared powers return to hand next round. Keep held powers for a later Preparation.</p>
  <div className="preparation-order">{['1','2','3','✧ Flexible'].map((label,i)=><div key={label}><b>{label}</b><span>{me.hand.find(c=>c.id===selected[i])?.name??'Select a spell'}</span></div>)}</div>
  <div className="cards">{me.hand.map(card=>{const index=selected.indexOf(card.id);return <SpellCard key={card.id} card={card} label={index<0?'Spell':index===3?'✧ Flexible':`Order ${index+1}`} selected={index>=0} onClick={()=>setSelected(old=>old.includes(card.id)?old.filter(id=>id!==card.id):old.length<4?[...old,card.id]:old)}/>;})}</div>
  <div className="button-row"><button onClick={()=>setSelected([])}>Reset selection</button><button className="primary" disabled={selected.length!==4} onClick={()=>send({type:'PREPARE_CARDS',playerId:me.id,preparedCardIds:selected.slice(0,3),rapidCardId:selected[3]})}>Prepare spells</button></div>
 </section>;
}

function HandLimitPanel({me,send}:{me:Player;send:Send}) {
 const [selected,setSelected]=useState<string[]>([]);
 const excess=me.hand.length-me.cardLimit;
 return <section className="phase-panel hand-limit-panel"><span className="eyebrow">Before assigning spell slots</span><h2>Reduce your hand to {me.cardLimit} cards</h2><p>You hold {me.hand.length} cards. Choose exactly {excess} to discard before preparing spells. These cards go to your <b>personal discard</b>, including school and powerful cards; this is the hand-limit exception.</p><div className="cards">{me.hand.map(card=><SpellCard key={card.id} card={card} selected={selected.includes(card.id)} onClick={()=>setSelected(old=>old.includes(card.id)?old.filter(id=>id!==card.id):old.length<excess?[...old,card.id]:old)}/>)}</div><button className="primary" disabled={selected.length!==excess} onClick={()=>send({type:'DISCARD_HAND_LIMIT',playerId:me.id,cardIds:selected})}>Discard excess cards ({selected.length}/{excess})</button></section>;
}

function QuestLimitPanel({me,send}:{me:Player;send:Send}) {
 const [selected,setSelected]=useState<string[]>([]);
 const quests=[me.quest,...me.additionalQuests].filter((q):q is NonNullable<Player['quest']>=>!!q);
 const excess=quests.length-me.questLimit;
 if(excess<=0)return <div className="notice">Your quests meet the limit of {me.questLimit}. Waiting for the other mages to discard excess quests.</div>;
 return <section className="phase-panel quest-limit-panel"><span className="eyebrow">End of Black Rose</span><h2>Keep up to {me.questLimit} quests</h2><p>Choose exactly {excess} quests to discard. Study will begin when all mages meet their limits.</p><div className="quest-choices">{quests.map(quest=><button key={quest.id} className={selected.includes(quest.id)?'chosen':''} aria-pressed={selected.includes(quest.id)} onClick={()=>setSelected(old=>old.includes(quest.id)?old.filter(id=>id!==quest.id):old.length<excess?[...old,quest.id]:old)}><strong>{quest.name}</strong><span>{quest.description}</span><small>+{quest.reward} VP</small></button>)}</div><button className="primary" disabled={selected.length!==excess} onClick={()=>send({type:'DISCARD_QUESTS',playerId:me.id,questIds:selected})}>Discard excess quests ({selected.length}/{excess})</button></section>;
}

function App() {
 const [game,setGame]=useState<GameState|null>(null),[playerId,setPlayerId]=useState<string|null>(null);
 const [connected,setConnected]=useState(false),[error,setError]=useState('');
 const [roomId,setRoomId]=useState('demo'),[playerName,setPlayerName]=useState(randomName);
 const [roomList,setRoomList]=useState<Array<{id:string;players:number;status:string}>>([]);
 const [overlay,setOverlay]=useState<GameState['phase']|null>(null),[toast,setToast]=useState('');
 const [selectedSlot,setSelectedSlot]=useState<Slot|null>(null),[selectedRoom,setSelectedRoom]=useState<string|null>(null);
 const [selectedModelId,setSelectedModelId]=useState('');
 const [dummy,setDummy]=useState(false),[exitCardId,setExitCardId]=useState('');
 const [retinueVisible,setRetinueVisible]=useState<Record<string,boolean>>({});
 const [historyRevision,setHistoryRevision]=useState(0);
 const wsRef=useRef<WebSocket|null>(null);
 const requestRef=useRef<string|null>(null),requestCount=useRef(0);
 const [pending,setPending]=useState(false);
 useEffect(()=>{
  const ws=new WebSocket(WS_URL); wsRef.current=ws;
  ws.onopen=()=>setConnected(true);ws.onerror=()=>setError('Cannot reach the WebSocket server. Check that it is running on port 8080.');
    ws.onclose=()=>{setConnected(false);requestRef.current=null;setPending(false);setError('Connection closed. Reload to reconnect to your room.');};
  ws.onmessage=e=>{
   const msg=JSON.parse(e.data);
   if(msg.type==='WELCOME'){setPlayerId(msg.playerId);setRoomId(msg.roomId);}
   if(msg.type==='STATE'){setGame(msg.state);setError('');}
   if(msg.type==='ROOM_LIST')setRoomList(msg.rooms);
    if(msg.type==='ERROR'){setError(msg.message);requestRef.current=null;setPending(false);}
    if(msg.type==='ACTION_APPLIED'&&msg.requestId===requestRef.current){requestRef.current=null;setPending(false);}
  };
  return()=>ws.close();
 },[]);
 const phase=game?.phase,round=game?.round;
 useEffect(()=>{
  setSelectedSlot(null);setSelectedRoom(null);setSelectedModelId('');setDummy(false);setExitCardId('');
  if(!phase||phase==='LOBBY')return;
  setOverlay(phase);const timer=window.setTimeout(()=>setOverlay(null),2400);return()=>window.clearTimeout(timer);
 },[phase,round]);
 const myActivation=game?.activation?.playerId===playerId;
 const actionsUsed=game?.activation?.actionsUsed,exploring=game?.activation?.exploring;
 const activeEvocationId=game?.evocationActivation?.evocationId;
 const physicalKind=game?.activation?.physicalAction?.kind;
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
    if(action.type==='UNDO_ACTION'||action.type==='REDO_ACTION') {
     setSelectedSlot(null);setSelectedRoom(null);setSelectedModelId('');setDummy(false);setExitCardId('');setHistoryRevision(n=>n+1);
    }
    setError('');wsRef.current.send(JSON.stringify({action,requestId}));
 };
 const continuePhase=()=>{if(game&&playerId)send({type:'ADVANCE_PHASE',playerId,expectedPhase:game.phase,expectedRound:game.round});};
 const join=(create:boolean)=>{
  if(wsRef.current?.readyState!==WebSocket.OPEN){setError('Wait for the server connection.');return;}
  setError('');wsRef.current.send(JSON.stringify({type:create?'CREATE_ROOM':'JOIN',roomId,playerName}));
 };
 if(!game || !playerId)return <div className="entry"><div className="entry-decoration">✺</div><div className="entry-card"><span className="eyebrow">A lodge of ambition and ruin</span><h1>BLACK<br/><em>ROSE</em> WARS</h1><p>A {MIN_MAGES}–{MAX_MAGES} mage online battle. Build your grimoire. Shape the lodge. Claim the Rose.</p><label>Mage name<input value={playerName} maxLength={32} onChange={e=>setPlayerName(e.target.value)}/></label><label>Room name<input value={roomId} maxLength={48} onChange={e=>setRoomId(e.target.value)}/></label><div className="button-row"><button disabled={!connected} onClick={()=>join(false)}>Join room</button><button className="primary" disabled={!connected} onClick={()=>join(true)}>Create room</button></div><span className="hint">{connected?'● Connected to the lodge':'○ Connecting to server…'}</span>{error&&<p className="error" role="alert">{error}</p>}{roomList.length>0&&<div className="room-list"><h3>Open lodges</h3>{roomList.map(r=><button key={r.id} onClick={()=>setRoomId(r.id)}><b>{r.id}</b><span>{r.players}/{MAX_MAGES} · {r.status}</span></button>)}</div>}</div></div>;
 const me=game.players.find(p=>p.id===playerId)!;
 const isHost=game.hostId===me.id;
 const joinedCount=game.players.filter(p=>p.connected).length;
 const readyCount=game.players.filter(p=>p.connected&&p.ready).length;
 const paused=game.phase!=='LOBBY'&&!game.players.every(p=>p.connected);
 const enabled=connected&&!paused;
 const myTurn=game.phase==='ACTION'&&game.currentPlayerId===me.id&&enabled&&!game.evocationActivation;
 const active=game.activation;
 const turnActionsRemaining=myTurn?Math.max(0,ACTIONS_PER_TURN-(active?.actionsUsed??0)):0;
 const inStart=isInStartingRoom(game,me);
 const activeEvocation=game.evocations.find(e=>e.id===game.evocationActivation?.evocationId);
 const movingEvocation=enabled&&game.evocationActivation?.playerId===me.id&&activeEvocation;
 const enemies=targetModels(game).filter(t=>t.playerId!==me.id);
 const actingPlayer=enabled&&(game.phase==='ACTION'||game.phase==='EVOCATION')?game.players.find(p=>p.id===game.currentPlayerId):undefined;
 const toggleRetinue=(playerId:string)=>setRetinueVisible(prev=>({...prev,[playerId]:!prev[playerId]}));
 const powerfulCards=me.hand.filter(c=>c.powerful);
 const spell=active?.physicalAction?null:selectedSlot?me.prepared[selectedSlot]?.card:null;
 const nextSlot=(['slot1','slot2','slot3'] as Slot[]).find(key=>me.prepared[key]&&!me.prepared[key]!.used);
 const spellModelsInRoom=(room:Room)=>!spell||room.startingFor||inStart?[]:enemies.filter(t=>room.tiles.some(h=>hexKey(h)===hexKey(t.position))&&isWithinSpellRange(me.wizard.position,t.position,spell.range));
 const canTarget=(room:Room)=>{
  if(!spell||room.startingFor||inStart)return false;
  if(spell.target==='ROOM'||dummy)return room.tiles.some(h=>isWithinSpellRange(me.wizard.position,h,spell.range));
  return spellModelsInRoom(room).length>0;
 };
 const room=game.board.rooms.find(r=>r.id===selectedRoom);
 const cast=()=>{
  if(!selectedSlot||!spell||!room||!canTarget(room))return;
  const candidates=spellModelsInRoom(room);
  const target=candidates.find(t=>t.id===selectedModelId)??candidates[0];
  const targeting=spell.target==='ROOM'||dummy?{roomId:room.id,...(dummy?{dummy:true}:{})}:target?.evocation?{targetEvocationId:target.id}:{targetPlayerId:target?.id};
  send({type:'CAST_SPELL',playerId:me.id,slot:selectedSlot,...targeting});
  setSelectedSlot(null);
 };
 return <div className="app"><header><a className="brand" href="/">✺ <span>BLACK ROSE <small>ONLINE LODGE</small></span></a><div className="header-meta"><span className="badge">{roomId}</span><span>Round {game.round}</span><span className={connected?'online':'error'}>{connected?'● Live':'○ Offline'}</span></div></header>
  <nav className="phase-track">{(['BLACK_ROSE','STUDY','PREPARATION','ACTION','EVOCATION','CLEANUP'] as const).map((phase,i)=><div key={phase} className={game.phase===phase?'current':''}><small>0{i+1}</small><span>{phaseInfo[phase][1]}</span></div>)}</nav>
  {actingPlayer&&<div className="turn-banner" style={mageStyle(actingPlayer.id)} role="status" aria-live="polite"><span className="acting-mage-icon" aria-hidden="true">{emoji[actingPlayer.id]}</span><div><span className="eyebrow">{actingPlayer.id===me.id?'Your turn':'Mage acting'}</span><strong>{actingPlayer.name}</strong><small>{game.evocationActivation?'Controlling an evocation':game.phase==='EVOCATION'?'Choosing an evocation':'Taking an Action turn'}</small></div></div>}
  {overlay&&<div className="phase-overlay" role="status" onClick={()=>setOverlay(null)}><span>{phaseInfo[overlay][0]}</span><small>ROUND {game.round}</small><h1>{phaseInfo[overlay][1]}</h1><p>{phaseInfo[overlay][2]}</p><small>Click to continue</small></div>}
  {toast&&<div className="toast" role="status">{toast}</div>}
  <main>
   <div className="game-column">
    {error&&<div className="error notice" role="alert">{error}</div>}
    {paused&&<div className="notice">Game paused. Waiting for the disconnected mage to rejoin room <b>{roomId}</b>.</div>}
    {game.phase==='LOBBY'&&<section className="phase-panel lobby-panel"><div className="section-heading"><div><span className="eyebrow">Before the first Black Rose</span><h2>Gather the mages</h2></div><span className="badge lobby-count">{joinedCount} / {MAX_MAGES} mages · {readyCount} ready</span></div><p>Invite up to {MAX_MAGES} mages. The battle starts automatically when every joined mage is ready, with at least {MIN_MAGES} mages (the creator + one other). Invite everyone before the final ready.</p><div className="lobby-seats">{game.players.map(p=><div className="seat" style={mageStyle(p.id)} data-player-id={p.id} key={p.id}><span className="mage-icon" aria-hidden="true">{emoji[p.id]}</span><div><strong>{p.name}</strong><small>{MAGE_COLOR_NAMES[p.id]} · {p.id===game.hostId?'Creator · ':''}{!p.connected?'Disconnected · waiting to rejoin':p.ready?'✓ Ready':'Not ready'}</small></div></div>)}</div><p className="lobby-readiness notice" role="status" aria-live="polite">{joinedCount<MIN_MAGES?`Waiting for at least ${MIN_MAGES} mages. Invite one more mage to begin.`:`${readyCount} of ${joinedCount} joined mages ready. Waiting for everyone to mark ready.`}{joinedCount<MAX_MAGES&&` ${MAX_MAGES-joinedCount} open seat${MAX_MAGES-joinedCount===1?'':'s'}; unused seats do not delay the battle.`}</p><div className="button-row"><button className={me.ready?'':'primary'} disabled={!connected||pending} onClick={()=>send({type:'SET_READY',playerId:me.id,ready:!me.ready})}>{me.ready?'Cancel ready':'Mark ready'}</button></div></section>}
    {game.phase==='BLACK_ROSE'&&<section className="phase-panel event-panel"><span className="eyebrow">Event revealed · Round {game.round}</span><h2>✺ {game.usedEvent?.name}</h2><p>{game.usedEvent?.description}</p><div className="notice">{game.usedEvent?.kind==='BLACK_DAMAGE'?`${game.usedEvent.amount} black damage to every mage.`:`${game.usedEvent?.amount} neutral instability in ${game.usedEvent?.rooms} random unfinished rooms.`} See the log for resolved effects.</div><p className="hint">At the end of Black Rose, discard excess quests to meet your limit of {me.questLimit}. Study and its 2 grimoire draws wait until all mages meet their limits.</p>{game.blackRoseResolved?<fieldset disabled={!enabled||pending}><QuestLimitPanel key={`quests-${game.round}`} me={me} send={send}/></fieldset>:isHost?<button className="primary" disabled={!enabled||pending} onClick={continuePhase}>Receive quests & begin Study →</button>:<p className="waiting">Waiting for the creator to begin Study…</p>}</section>}
    {game.phase==='STUDY'&&<fieldset disabled={!enabled||pending}><StudyPanel key={`study-${game.round}`} game={game} me={me} send={send}/></fieldset>}
    {game.phase==='PREPARATION'&&<fieldset disabled={!enabled||pending}><PreparationPanel key={`prep-${game.round}`} me={me} send={send}/></fieldset>}
    {game.phase==='EVOCATION'&&<section className="evocation-phase"><span className="eyebrow">After the mages act</span><h2>Evocation phase</h2><p>{game.currentPlayerId===me.id?'Choose an unused evocation from your retinue.':`${game.players.find(p=>p.id===game.currentPlayerId)?.name} is controlling their evocations.`} Each model activates once; movement is optional, followed by one attack.</p></section>}
    {game.phase==='CLEANUP'&&<section className="phase-panel"><span className="eyebrow">The end of the round</span><h2>❖ The lodge settles</h2><p>Full rooms have rebuilt, awarded contribution points and returned their cubes once. They accept no more instability; their double specials are now ready. Endgame follows Cleanup in round 3, or when any mage or the Black Rose reaches 30 VP.</p>{isHost?<button className="primary" disabled={!enabled||pending} onClick={continuePhase}>Begin round {game.round+1} →</button>:<p className="waiting">Waiting for the creator to begin the next round…</p>}</section>}
    {game.phase==='GAME_OVER'&&<section className="phase-panel victory"><span className="eyebrow">The Rose has chosen</span><h2>♛ {game.winner?ownerName(game,game.winner):'The lodge'} wins</h2><p>{[...game.players.map(p=>`${p.name}: ${p.victoryPoints} VP`),`Black Rose: ${game.blackRose.victoryPoints} VP · ${game.blackRose.kills} kills`].join(' · ')}</p><p className="hint">{game.endgameScored?'Final majorities and first-player bonus included.':'Final scores are being resolved.'}</p><button onClick={()=>location.reload()}>Return to lobby</button></section>}
    <section className="board-panel"><div className="section-heading"><div><span className="eyebrow">The lodge</span><h2>{movingEvocation&&activeEvocation?`${activeEvocation.name} #${evocationNumber(game,activeEvocation)} · choose an adjacent space`:exitCardId&&inStart?'Discard exit · choose an adjacent space':spell?`Target: ${spell.name}${dummy?' · dummy':''}`:active?.exploring&&myTurn?'Explore · choose an adjacent space':'Chambers of the Black Rose'}</h2></div><span className="hint">◆ instability / capacity · rebuilt: READY / USED</span></div>
    <div className="room-legend">{ROOM_COLORS.map(color=><span key={color} data-color={color}><i/>{color} · 3</span>)}</div>
    <div className="mage-legend" aria-label="Mage colors">{game.players.map(p=><span style={mageStyle(p.id)} data-player-id={p.id} key={p.id}><i aria-hidden="true"/>{emoji[p.id]} {p.name} · {MAGE_COLOR_NAMES[p.id]}</span>)}<span className="neutral-owner"><i aria-hidden="true"/>✺ Black Rose · neutral</span></div>
    <p className="board-help hint" id="board-help">Select a named chamber for details. Segmented badges show cubes / capacity by mage color; light gray is Black Rose. Full rooms wait for Cleanup to rebuild. Rebuilt badges show special readiness, not returned cubes. Numbered circles are owner-colored evocations. Scroll the board on smaller screens.</p>
      <div className="board-viewport" tabIndex={0} role="region" aria-label="Scrollable lodge board" aria-describedby="board-help"><svg className="board" viewBox="-210 -165 420 330" role="group" aria-label="Hexagonal lodge board">{game.board.rooms.map(r=>{
      const h=r.tiles[0],x=(h.q+h.r/2)*62,y=h.r*54;
      const occupants=game.players.filter(p=>hexKey(p.wizard.position)===hexKey(h));
      const summons=game.evocations.filter(e=>hexKey(e.position)===hexKey(h));
      const contributions=Object.entries(r.cubesByPlayer).filter(([,n])=>n>0);
      const segments=cubeSegments(r.cubesByPlayer,r.instability,r.instabilityLimit);
      const evocationReachable=!!movingEvocation&&(game.evocationActivation?.movesRemaining??0)>0&&hexDistance(h,movingEvocation.position)===1&&!r.startingFor;
      const mageReachable=myTurn&&(!!active?.exploring||!!exitCardId&&turnActionsRemaining>0&&inStart&&!active?.physicalAction&&!active?.discardedExit)&&hexDistance(h,me.wizard.position)===1&&!r.startingFor;
      const reachable=evocationReachable||mageReachable;
      const targetable=myTurn&&turnActionsRemaining>0&&!!spell&&canTarget(r);
      const choose=()=>{
      if(pending)return;
      if(evocationReachable)send({type:'EVOCATION_STEP',playerId:me.id,destination:h});
      else if(mageReachable&&exitCardId&&inStart&&!active?.exploring){send({type:'DISCARD_EXIT',playerId:me.id,cardId:exitCardId,destination:h});setExitCardId('');}
      else if(reachable)send({type:'EXPLORE_STEP',playerId:me.id,destination:h});
      else {setSelectedRoom(r.id);setSelectedModelId('');}
      };
      return <g key={r.id} data-room-id={r.id} data-color={r.color??undefined} transform={`translate(${x},${y})`} className={`hex ${occupants.some(p=>p.id===actingPlayer?.id)?'acting-room':''} ${r.reconstructed?'rebuilt':''} ${r.startingFor?'start-room':''} ${r.id==='room-0,0'?'central':''} ${selectedRoom===r.id?'selected':''} ${reachable||targetable?'reachable':''}`} role="button" tabIndex={0} aria-label={`${r.name}, ${r.startingFor?'protected starting room':roomStatus(r)}${!r.reconstructed?contributions.map(([id,n])=>`, ${ownerName(game,id)}: ${n} cubes`).join(''):''}${occupants.map(p=>`, ${p.name}`).join('')}${summons.map(e=>`, ${e.name} #${evocationNumber(game,e)} of ${ownerName(game,e.playerId)}`).join('')}`} onClick={choose} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}}}>
       <title>{r.name}{r.color?` · ${r.color}`:''} · {r.effect?ROOM_EFFECT_LABELS[r.effect]:'Protected starting room'}{r.reconstructed?` · Rebuilt · ${roomStatus(r)}`:` · Rewards ${r.rewards.join('/')} VP`}</title><polygon points="0,-33 29,-16 29,16 0,33 -29,16 -29,-16"/>
      <text className="room-name" aria-hidden="true">{roomNameLines(r.name).map((line,i)=><tspan x={0} y={-21+i*7} key={i}>{line}{i===0?' ':''}</tspan>)}</text>
      {occupants.length?occupants.map((p,i)=><g key={p.id} transform={`translate(${(i-(occupants.length-1)/2)*12},-6.5)`}><g className={p.id===actingPlayer?.id?'acting-mage-token':''} data-mage-id={p.id} style={mageStyle(p.id)}><title>{p.name} · {MAGE_COLOR_NAMES[p.id]}</title><circle className="mage-token-disc" r={5}/><text className="occupants" y={3}>{emoji[p.id]}</text></g></g>):!summons.length&&<text className="empty-room-icon" y={0}>{r.startingFor?'⌂':r.reconstructed?'❖':r.id==='room-0,0'?'✺':'·'}</text>}
      {summons.length>0&&<g className="evocation-markers">{summons.map((e,i)=><g className="evocation-marker" data-evocation-id={e.id} data-owner-id={e.playerId} style={mageStyle(e.playerId)} transform={`translate(${(i%6-((Math.min(6,summons.length)-1)/2))*5},${2.5+Math.floor(i/6)*5})`} key={e.id}><title>{ownerName(game,e.playerId)} · {e.name} #{evocationNumber(game,e)}</title><circle r={2.2}/><text y={1.2}>{evocationNumber(game,e)}</text></g>)}</g>}
      {r.startingFor?<text className="start-label" y={17}>START</text>:r.reconstructed?<g className={`rebuilt-badge ${r.specialUsed?'used':'ready'}`}><rect x={-18} y={10} width={36} height={12} rx={3}/><text y={18.5}>{roomStatus(r)}</text></g>:<g className="capacity-badge">
      <rect className="capacity-background" x={-18} y={10} width={36} height={12} rx={3}/>
      {segments.length?segments.map(segment=><rect className="capacity-fill" data-owner-id={segment.id} data-cubes={segment.count} key={segment.id} x={-17+34*segment.start} y={11} width={34*segment.fraction} height={10} style={{fill:ownerColor(segment.id)}}/>):<rect className="capacity-fill" x={-17} y={11} width={0} height={10}/>}
      <text className="cube-count" y={18.5}>◆ {r.instability}/{r.instabilityLimit}</text>
      </g>}
      {!r.startingFor&&!r.reconstructed&&contributions.map(([id,n],i)=><g className="cube-owner" transform={`translate(${(i-(contributions.length-1)/2)*5},26)`} key={id}><title>{ownerName(game,id)}: {n} cubes</title><circle r={2.5} fill={ownerColor(id)}/><text y={1.3}>{n}</text></g>)}
      </g>;
     })}</svg></div>
    {room&&<div className="room-detail"><strong>{room.name} {room.reconstructed?'· Rebuilt':''}</strong><span>{room.startingFor?'Protected starting room · Exit only; no voluntary reentry':room.reconstructed?`Double special · ${roomStatus(room)} · no further cube placement`:`${room.color??'Central'} · ${room.instability}/${room.instabilityLimit} instability · Rewards ${room.rewards.join(' / ')} VP${room.instability>=room.instabilityLimit?' · Full: locked to new cubes; rebuilds at Cleanup, then unlocks its double special.':''}`}</span>
    {room.effect&&<span>{room.reconstructed?'Double special':'Free effect'}: {ROOM_EFFECT_LABELS[room.effect]}{room.reconstructed?` ×2 · ${room.specialUsed?'Used this Action phase':'Ready · once per Action phase'}`:' · once within Explore or Attack, before or after its primary effect.'}</span>}
    {!room.reconstructed&&<div className="contributions">{Object.entries(room.cubesByPlayer).filter(([,n])=>n>0).map(([id,n])=><span style={mageStyle(id)} key={id}>{emoji[id]??'✺'} {ownerName(game,id)}: {n}</span>)}</div>}
    {spell?.target==='MODEL'&&!dummy&&<label className="action-setting">Spell target model<select aria-label="Spell target model" value={selectedModelId} onChange={e=>setSelectedModelId(e.target.value)}><option value="">First enemy in this room</option>{spellModelsInRoom(room).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
    {spell&&<button className="primary" disabled={pending||!myTurn||turnActionsRemaining===0||!canTarget(room)} onClick={cast}>Cast {spell.name} here{dummy?' on dummy':''}</button>}
    </div>}
    </section>
    {game.phase==='ACTION'&&<section className="phase-panel"><div className="section-heading"><div><span className="eyebrow">Your prepared grimoire · 1 action per cast</span><h2>{game.evocationActivation?.playerId===me.id?'Finish your evocation activation':myTurn?'Choose your next action':'Watch the other mage’s turn'}</h2></div><span className="badge">{myTurn?`${turnActionsRemaining} turn actions left`:me.passed?'Passed':'Waiting'}</span></div>
    {inStart&&<div className="notice">Leave your starting room with Explore or a discarded card before casting or attacking.</div>}
    {myTurn&&active?.physicalAction&&<div className="notice">Finish or skip your {active.physicalAction.kind==='EXPLORE'?'Explore':'Attack'} effects before casting spells.</div>}
      <div className="cards prepared">{slotKeys.map((key,i)=>{const c=me.prepared[key];return c&&<SpellCard key={key} card={c.card} used={c.used} label={key==='rapid'?'✧ Flexible':`Spell ${i+1}`} selected={key===selectedSlot} disabled={pending||!myTurn||turnActionsRemaining===0||inStart||!!active?.physicalAction||!!active?.exploring||c.used||(key!=='rapid'&&(key!==nextSlot||!!active?.sequencedSpellUsed))} onClick={()=>{setSelectedSlot(old=>old===key?null:key);setSelectedRoom(null);setDummy(false);setExitCardId('');setToast('Choose a highlighted room containing your target, or select dummy targeting.');}}/>;})}</div>
    {spell&&<><p className="hint">Every spell—including flexible and powerful—uses 1 of your 2 turn actions, but no physical token. Range follows a straight, contiguous hex line without turning; range 0 targets your own hex. Cast at most one numbered spell per turn. Powerful spells are removed after use.</p>{spell.target==='MODEL'&&<div className="button-row target-mode"><button className={!dummy?'primary':''} onClick={()=>{setDummy(false);setSelectedRoom(null);}}>Target enemy model</button><button className={dummy?'primary':''} onClick={()=>{setDummy(true);setSelectedRoom(null);}}>Target dummy · no damage</button></div>}{dummy&&<p className="hint">Select any non-starting room in range on a straight hex line. Only non-damage effects, such as instability, resolve—even if a model is present.</p>}</>}
    </section>}
      {powerfulCards.length>0&&<section className="powerful-panel"><span className="eyebrow">The central chamber's gift · saved in hand</span><h2>Black Rose spells</h2><p>Prepare in a later round. Held powers cannot be cast from hand and do not keep your Action phase alive. Prepare a power in an ordered or flexible slot; casting uses 1 turn action, no physical token, and permanently removes it. Unused prepared powers return to hand next round. Forced hand-limit discards are the only discard exception.</p><div className="cards">{powerfulCards.map(card=><SpellCard key={card.id} card={card} label="✺ Prepare in a later round" disabled/>)}</div><p className="hint">Supply: {game.powerfulDeck.length} remaining · {game.removedCards.length} permanently removed</p></section>}
    <section className="log-panel"><div className="section-heading"><h2>Chronicle</h2><span className="hint">Latest events first</span></div><div className="log" role="log">{game.log.slice(-45).reverse().map((entry,i)=><div key={`${game.log.length-i}`}><span>✧</span>{entry}</div>)}</div></section>
   </div>
  <aside>
    {(game.history?.canUndo||game.history?.canRedo)&&<section className="history-panel" aria-label="Action history"><span className="eyebrow">Your recent actions</span><div className="button-row"><button disabled={!enabled||pending||!game.history.canUndo} onClick={()=>send({type:'UNDO_ACTION',playerId:me.id})}>Undo action</button><button disabled={!enabled||pending||!game.history.canRedo} onClick={()=>send({type:'REDO_ACTION',playerId:me.id})}>Redo action</button></div><p className="hint">{game.history.undoLabel&&`Undo: ${game.history.undoLabel}. `}{game.history.redoLabel&&`Redo: ${game.history.redoLabel}. `}No undo across draws, quest draws, random retrievals or phase changes. A same-phase handoff can be undone until the opponent acts. The server decides availability.</p></section>}
    {game.phase==='ACTION'&&game.currentPlayerId===me.id&&!game.evocationActivation&&<PhysicalActionsPanel key={historyRevision} game={game} me={me} enabled={enabled} pending={pending} exitCardId={exitCardId} setExitCardId={setExitCardId} clearSpell={()=>{setSelectedSlot(null);setSelectedRoom(null);setSelectedModelId('');setDummy(false);}} send={send}/>}
    <ActiveEvocationControls game={game} playerId={me.id} enabled={enabled} pending={pending} send={send}/>
    <section className="players-panel"><span className="eyebrow">Mages of the lodge · {game.players.length}</span>{game.players.map(p=><div className={`player ${p.id===actingPlayer?.id?'active-player':''}`} style={mageStyle(p.id)} data-player-id={p.id} aria-current={p.id===actingPlayer?.id?'true':undefined} key={p.id}>
   <div className="player-heading"><span><span className={p.id===actingPlayer?.id?'acting-mage-icon':''}>{emoji[p.id]}</span> {p.name} {p.id===game.firstPlayerId&&<span className="first-player" role="img" aria-label="First player" title="First-player token · +1 VP at endgame">♛</span>} {p.id===me.id&&<small>(you)</small>}</span><b>{p.victoryPoints}<small> VP</small></b></div>
   <DamageBar game={game} name={p.name} {...p.wizard}/>
   <div className="player-stats"><span>⚡ {p.actionTokens} tokens</span><span title="Available cubes">◆ {p.cubes.available} available</span></div>
  <dl className="mage-attributes"><div><dt>Max HP</dt><dd>{p.wizard.health}</dd></div><div><dt>Attack</dt><dd>{p.wizard.attack}</dd></div><div><dt>Movement</dt><dd>{p.wizard.movement}</dd></div><div><dt>Card limit</dt><dd>{p.cardLimit}</dd></div><div><dt>Quest limit</dt><dd>{p.questLimit}</dd></div></dl>
  <div className="cube-pool hint">◆ On mages: {p.cubes.onWizard} · On evocations: {p.cubes.onEvocations} · In rooms: {p.cubes.onBoard}</div>
  {p.cubes.available===0&&<p className="cube-warning hint">No cubes: room placement unavailable; damage can still wound without attribution.</p>}
  <small className={p.id===actingPlayer?.id?'acting-label':'hint'}>{!p.connected?'Disconnected':p.id===actingPlayer?.id?game.phase==='EVOCATION'||game.evocationActivation?'Controlling evocations · acting now':'Acting now':p.passed?'Passed this round':p.studyDone&&game.phase==='STUDY'?'Study complete':p.preparationDone&&game.phase==='PREPARATION'?'Prepared':'In the lodge'}</small>
   <div className="player-actions"><button className="mini-toggle" aria-label={`${retinueVisible[p.id]?'Hide':'Show'} evocations for ${p.name} (${game.evocations.filter(e=>e.playerId===p.id).length})`} aria-expanded={!!retinueVisible[p.id]} aria-controls={`retinue-${p.id}`} onClick={()=>toggleRetinue(p.id)}>{retinueVisible[p.id]?'Hide':'Show'} evocations ({game.evocations.filter(e=>e.playerId===p.id).length})</button></div>
  </div>)}<div className="black-rose-score" data-owner-id={BLACK_ROSE_ID} aria-label="Black Rose score"><div className="player-heading"><span>✺ Black Rose</span><b>{game.blackRose.victoryPoints}<small> VP</small></b></div><small>{game.blackRose.kills} kills · neutral competitor</small></div></section>
    {game.players.filter(p=>retinueVisible[p.id]).map(p=><EvocationsPanel key={p.id} game={game} playerId={p.id} viewerId={me.id} enabled={enabled} pending={pending} send={send}/>)}
    <section className="quest-panel"><span className="eyebrow">Your personal quests</span>{[me.quest,...me.additionalQuests].filter((q):q is NonNullable<Player['quest']>=>!!q).map(quest=><div className="quest-entry" key={quest.id}><h2>◇ {quest.name}</h2><p>{quest.description}</p><span className="badge">+{quest.reward} VP on completion</span></div>)}{!me.quest&&<><h2>◇ Awaiting a new purpose</h2><p>You receive a quest at the end of Black Rose if you do not have one, or from an Amber room.</p></>}<p className="hint">{me.questsCompleted} quests completed · {me.kills} mages defeated</p></section>
    <section className="reference"><span className="eyebrow">Quick reference</span>
    <p>Endgame follows Cleanup after <b>round 3</b>, or when a mage or the Black Rose reaches <b>30 VP</b>. Final scores determine the winner; the Black Rose can win. Equal final scores favor mage seating order, then the Black Rose.</p>
     <p><b>2 actions total per turn.</b> Explore, Attack, each spell cast (including flexible and powerful), discard-to-move, and paid evocation activation each use one. The turn hands off after the second action finishes.</p>
     <p><b>2 physical tokens per round.</b> Explore, Attack, and paid evocation activation also use a token. Spells and discard-to-move do not. Resolve a physical action's primary effect and room activation in either order, once each, or skip what remains.</p>
     <p>Mage attacks deal <b>{me.wizard.attack} damage at distance 0</b>. Explore permits up to <b>{me.wizard.movement} movements</b>. Numbered spells are limited to one per turn, within the shared two-action budget.</p>
     <p>Before Preparation, discard to <b>{me.cardLimit} cards</b>; excess goes to personal discard. At the end of Black Rose, discard to <b>{me.questLimit} quests</b>.</p>
     <p><b>Evocations:</b> maximum 3. Activate a <b>Grey room</b> to summon a Cadaver; tokens activate existing models, never directly summon. Every model activates once after Action; token activations during Action are extra.</p>
    <p><b>Room effects:</b> once within Explore or Attack. Starting rooms cannot be activated. Full rooms immediately reject cubes, but only rebuild at Cleanup: score once, return cubes once, unlock the <b>double special</b>. Rebuilt specials are usable once per Action phase and refresh at Cleanup.</p>
    <p><b>Capacity → rank rewards:</b>{[4,5,6,10].map(capacity=><React.Fragment key={capacity}><br/>{capacity} cubes · {getRoomRewards(capacity).join(' / ')} VP{capacity===4?' · Violet (3 rooms)':capacity===5?' · ordinary (12 rooms)':capacity===6?' · Grey (3 rooms)':' · central chamber'}</React.Fragment>)}</p>
    <p>Damage places your available cubes on enemy models. On mage defeat, contributors score <b>4 / 2 / 1 VP</b> and recover their cubes. Destroyed evocations return their cubes without VP.</p>
    <p><b>Dense ranks:</b> positive contributions share ranks when tied; the next different total takes the next rank (1, 1, 2). A tied positive reward is reduced by <b>1 VP, minimum 1</b>. Zero prizes and ranks beyond the reward table stay zero. Black Rose cubes and black damage compete for room and defeat rewards.</p>
    <p><b>Endgame:</b> positive kills and completed-quest majorities each award <b>{ENDGAME_REWARDS.join(' / ')} VP</b>, with the same dense-rank tie rule. Black Rose competes for kills, not quests. The first-player token grants <b>+1 VP</b>. Bonuses are scored once.</p>
    <p><b>One-color bonus:</b> gain <b>+1 VP</b> if all cubes in a room are yours when it is completed, or all damage cubes on a mage are yours when they are defeated. Black Rose cubes, black damage and unattributed wounds prevent a mage’s one-color bonus.</p>
    <p>Normal school discards return to their school; forced hand-limit discards are the exception.</p>
    <p><b>Central powers:</b> save in hand for a later Preparation, never cast directly. Prepared powers cost one turn action and are permanently removed on casting; unused prepared powers return to hand next round. Held powers do not keep Action alive.</p>
    <p><b>Cube supply:</b> with zero available cubes you cannot place room instability, but attacks and spells can still wound. Damage bars count received damage, including neutral black damage and separately labeled unattributed wounds, not remaining health.</p>
     <p className="hint">Grimoire {me.personalDeck.length} · Hand {me.hand.length}/{me.cardLimit} · Personal discard {me.discard.length}</p>
    </section>
   </aside>
  </main><footer>BLACK ROSE WARS · Unofficial prototype · 2–4 mages · Original placeholder cards</footer>
 </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);