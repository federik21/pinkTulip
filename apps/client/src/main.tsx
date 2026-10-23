import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ACTIONS_PER_TURN, Card, GameAction, GameState, Player, Room, MAX_MAGES, MIN_MAGES, MAGE_COLORS, ROOM_COLORS, ROOM_EFFECT_LABELS, isInStartingRoom, isWithinSpellRange, hexDistance, hexKey } from '@brw/game-engine';
import { EvocationsPanel, targetModels } from './EvocationsPanel';
import { PhysicalActionsPanel } from './PhysicalActionsPanel';
import { MAGE_SYMBOLS as emoji, MAGE_COLOR_NAMES, mageStyle, roomNameLines } from './presentation';
import './style.css';

const WS_URL=import.meta.env.VITE_WS_URL??`${location.protocol==='https:'?'wss':'ws'}://${location.hostname}:8080`;
const phaseInfo={
 LOBBY:['✦','Gather the mages','2–4 mages. The battle starts automatically when every joined mage is ready.'],
 BLACK_ROSE:['✺','Black Rose','An event reshapes the lodge. Personal quests follow.'],
 STUDY:['▤','Study','Draw 2 grimoire spells, choose a school for 4 more, discard 2.'],
 PREPARATION:['✧','Preparation','Choose spells in order 1 → 2 → 3, then a flexible spell.'],
 ACTION:['⚔','Action','Up to 2 actions total: Explore, Attack, spell casts, or discard-to-move.'],
 EVOCATION:['☠','Evocation','Activate each summon once. Move, then attack, one model at a time.'],
 CLEANUP:['❖','Cleanup','Rebuilt rooms award points. The lodge remembers your contribution.'],
 GAME_OVER:['♛','Game over','The Black Rose has chosen its champion.'],
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

function DamageContributions({game,player}:{game:GameState;player:Player}) {
 const contributors=Object.entries(player.wizard.damageByPlayer).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
 if(!contributors.length&&!player.wizard.blackDamage)return null;
 return <div className="damage-ledger"><small className="hint">Damage cubes on this mage</small><div className="contributions">{contributors.map(([id,n])=><span style={mageStyle(id)} key={id}>{emoji[id]??'🧙'} {game.players.find(p=>p.id===id)?.name??id}: {n}</span>)}{player.wizard.blackDamage>0&&<span>✺ Black damage: {player.wizard.blackDamage}</span>}</div></div>;
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
 return <section className="phase-panel"><span className="eyebrow">Plan your sequence</span><h2>Three ordered spells. One wild card.</h2><p>Select in order: 1, 2, 3, then ✧ flexible. Numbered spells must be cast progressively; the flexible spell can be cast at any time. Powerful spells can stay in hand for immediate free casts, or be prepared in a slot; unused ones return to hand next round.</p>
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
 const [selectedPowerfulId,setSelectedPowerfulId]=useState<string|null>(null);
 const [selectedModelId,setSelectedModelId]=useState('');
 const [dummy,setDummy]=useState(false),[exitCardId,setExitCardId]=useState('');
 const [retinueVisible,setRetinueVisible]=useState<Record<string,boolean>>({});
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
  setSelectedSlot(null);setSelectedPowerfulId(null);setSelectedRoom(null);setDummy(false);setExitCardId('');
  if(!phase||phase==='LOBBY')return;
  setOverlay(phase);const timer=window.setTimeout(()=>setOverlay(null),2400);return()=>window.clearTimeout(timer);
 },[phase,round]);
 const myActivation=game?.activation?.playerId===playerId;
 const actionsUsed=game?.activation?.actionsUsed,exploring=game?.activation?.exploring;
 const activeEvocationId=game?.evocationActivation?.evocationId;
 const physicalKind=game?.activation?.physicalAction?.kind;
 useEffect(()=>{
  setSelectedSlot(null);setSelectedPowerfulId(null);
  if(phase!=='ACTION'){setToast('');return;}
  setToast(myActivation?(exploring?`Explore: ${exploring} adjacent step${exploring===1?'':'s'} remaining.`:physicalKind?'Resolve your physical action effects, or skip those remaining.':'Your turn · Choose an action: physical, spell, or discard-to-move.'):'Turn handed to the next mage.');
 },[phase,myActivation,actionsUsed,exploring,activeEvocationId,physicalKind]);
 useEffect(()=>{if(!toast)return;const t=window.setTimeout(()=>setToast(''),3200);return()=>window.clearTimeout(t);},[toast]);
 const send:Send=action=>{
  if(wsRef.current?.readyState!==WebSocket.OPEN){setError('Server disconnected. Reload to reconnect.');return;}
    if(requestRef.current)return;
    const requestId=`${Date.now()}-${++requestCount.current}`;
    requestRef.current=requestId;setPending(true);
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
 const spell=active?.physicalAction?null:selectedPowerfulId?powerfulCards.find(c=>c.id===selectedPowerfulId):selectedSlot?me.prepared[selectedSlot]?.card:null;
 const nextSlot=(['slot1','slot2','slot3'] as Slot[]).find(key=>me.prepared[key]&&!me.prepared[key]!.used);
 const spellModelsInRoom=(room:Room)=>!spell||room.startingFor||inStart?[]:enemies.filter(t=>room.tiles.some(h=>hexKey(h)===hexKey(t.position))&&isWithinSpellRange(me.wizard.position,t.position,spell.range));
 const canTarget=(room:Room)=>{
  if(!spell||room.startingFor||inStart)return false;
  if(spell.target==='ROOM'||dummy)return room.tiles.some(h=>isWithinSpellRange(me.wizard.position,h,spell.range));
  return spellModelsInRoom(room).length>0;
 };
 const room=game.board.rooms.find(r=>r.id===selectedRoom);
 const cast=()=>{
  if((!selectedSlot&&!selectedPowerfulId)||!spell||!room||!canTarget(room))return;
  const candidates=spellModelsInRoom(room);
  const target=candidates.find(t=>t.id===selectedModelId)??candidates[0];
  const targeting=spell.target==='ROOM'||dummy?{roomId:room.id,...(dummy?{dummy:true}:{})}:target?.evocation?{targetEvocationId:target.id}:{targetPlayerId:target?.id};
  if(selectedPowerfulId)send({type:'CAST_POWERFUL_SPELL',playerId:me.id,cardId:selectedPowerfulId,...targeting});
  else if(selectedSlot)send({type:'CAST_SPELL',playerId:me.id,slot:selectedSlot,...targeting});
  setSelectedSlot(null);setSelectedPowerfulId(null);
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
    {game.phase==='CLEANUP'&&<section className="phase-panel"><span className="eyebrow">The end of the round</span><h2>❖ The lodge settles</h2><p>Rebuilt rooms have awarded their points and returned physical cubes. Rebuilt rooms stay locked and are never scored twice.</p>{isHost?<button className="primary" disabled={!enabled||pending} onClick={continuePhase}>Begin round {game.round+1} →</button>:<p className="waiting">Waiting for the creator to begin the next round…</p>}</section>}
    {game.phase==='GAME_OVER'&&<section className="phase-panel victory"><span className="eyebrow">The Rose has chosen</span><h2>♛ {game.players.find(p=>p.id===game.winner)?.name} wins</h2><p>{game.players.map(p=>`${p.name}: ${p.victoryPoints} VP`).join(' · ')}</p><button onClick={()=>location.reload()}>Return to lobby</button></section>}
    <section className="board-panel"><div className="section-heading"><div><span className="eyebrow">The lodge</span><h2>{movingEvocation?`${activeEvocation?.name} · choose an adjacent space`:exitCardId&&inStart?'Discard exit · choose an adjacent space':spell?`Target: ${spell.name}${dummy?' · dummy':''}`:active?.exploring&&myTurn?'Explore · choose an adjacent space':'Chambers of the Black Rose'}</h2></div><span className="hint">◆ instability / capacity</span></div>
    <div className="room-legend">{ROOM_COLORS.map(color=><span key={color} data-color={color}><i/>{color} · 3</span>)}</div>
    <div className="mage-legend" aria-label="Mage colors">{game.players.map(p=><span style={mageStyle(p.id)} data-player-id={p.id} key={p.id}><i aria-hidden="true"/>{emoji[p.id]} {p.name} · {MAGE_COLOR_NAMES[p.id]}</span>)}<span className="neutral-owner"><i aria-hidden="true"/>✺ Black Rose · neutral</span></div>
    <p className="board-help hint" id="board-help">Select a named chamber for details. Badges show cubes / capacity; colored dots show each mage’s contribution. Scroll the board on smaller screens.</p>
      <div className="board-viewport" tabIndex={0} role="region" aria-label="Scrollable lodge board" aria-describedby="board-help"><svg className="board" viewBox="-210 -165 420 330" role="group" aria-label="Hexagonal lodge board">{game.board.rooms.map(r=>{
      const h=r.tiles[0],x=(h.q+h.r/2)*62,y=h.r*54;
      const occupants=game.players.filter(p=>hexKey(p.wizard.position)===hexKey(h));
      const summons=game.evocations.filter(e=>hexKey(e.position)===hexKey(h));
      const contributions=Object.entries(r.cubesByPlayer).filter(([,n])=>n>0);
      const summonOwners=game.players.map(p=>({player:p,count:summons.filter(e=>e.playerId===p.id).length})).filter(({count})=>count>0);
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
      return <g key={r.id} data-room-id={r.id} data-color={r.color??undefined} transform={`translate(${x},${y})`} className={`hex ${occupants.some(p=>p.id===actingPlayer?.id)?'acting-room':''} ${r.reconstructed?'rebuilt':''} ${r.startingFor?'start-room':''} ${r.id==='room-0,0'?'central':''} ${selectedRoom===r.id?'selected':''} ${reachable||targetable?'reachable':''}`} role="button" tabIndex={0} aria-label={`${r.name}, ${r.startingFor?'protected starting room':`${r.instability}/${r.instabilityLimit} instability`}${contributions.map(([id,n])=>`, ${game.players.find(p=>p.id===id)?.name??'Black Rose'}: ${n} cubes`).join('')}${occupants.map(p=>`, ${p.name}`).join('')}${summons.map(e=>`, ${e.name} of ${game.players.find(p=>p.id===e.playerId)?.name}`).join('')}`} onClick={choose} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}}}>
       <title>{r.name}{r.color?` · ${r.color}`:''} · {r.effect?ROOM_EFFECT_LABELS[r.effect]:'Protected starting room'} · Rewards {r.rewards.join('/')} VP{r.reconstructed?' · Rebuilt, locked':''}</title><polygon points="0,-33 29,-16 29,16 0,33 -29,16 -29,-16"/>
      <text className="room-name" aria-hidden="true">{roomNameLines(r.name).map((line,i)=><tspan x={0} y={-21+i*7} key={i}>{line}{i===0?' ':''}</tspan>)}</text>
       {occupants.length?occupants.map((p,i)=><g key={p.id} transform={`translate(${(i-(occupants.length-1)/2)*12},-4)`}><g className={p.id===actingPlayer?.id?'acting-mage-token':''} data-mage-id={p.id} style={mageStyle(p.id)}><title>{p.name} · {MAGE_COLOR_NAMES[p.id]}</title><circle className="mage-token-disc" r={6}/><text className="occupants" y={3.5}>{emoji[p.id]}</text></g></g>):<text className="empty-room-icon" y={0}>{r.startingFor?'⌂':r.reconstructed?'❖':r.id==='room-0,0'?'✺':'·'}</text>}
      {summons.length>0&&<g className="evocation-markers"><title>{summonOwners.map(({player,count})=>`${player.name}: ${count} Cadaver${count===1?'':'s'}`).join(' · ')}</title><text className="evocation-marker" x={-14} y={7}>☠{summons.length}</text>{summonOwners.map(({player,count},i)=><text className="evocation-owner-marker" style={mageStyle(player.id)} x={i*7} y={7} key={player.id}>{count}</text>)}</g>}
      {r.startingFor?<text className="start-label" y={17}>START</text>:<g className="capacity-badge">
      <rect className="capacity-background" x={-18} y={10} width={36} height={12} rx={3}/>
      <rect className="capacity-fill" x={-17} y={11} width={34*Math.min(1,r.instability/r.instabilityLimit)} height={10} rx={2}/>
      <text className="cube-count" y={18.5}>◆ {r.instability}/{r.instabilityLimit}</text>
      </g>}
      {!r.startingFor&&contributions.map(([id,n],i)=><g className="cube-owner" transform={`translate(${(i-(contributions.length-1)/2)*5},26)`} key={id}><title>{game.players.find(p=>p.id===id)?.name??'Black Rose'}: {n} cubes</title><circle r={2.5} fill={MAGE_COLORS[id]??'#d4cedd'}/><text y={1.3}>{n}</text></g>)}
      </g>;
     })}</svg></div>
    {room&&<div className="room-detail"><strong>{room.name} {room.reconstructed?'· Rebuilt 🔒':''}</strong><span>{room.startingFor?'Protected starting room · Exit only; no voluntary reentry':`${room.color??'Central'} · ${room.instability}/${room.instabilityLimit} instability · Rewards ${room.rewards[0]} / ${room.rewards[1]} VP`}</span>
    {room.effect&&<span>{room.reconstructed?'Double special':'Free effect'}: {ROOM_EFFECT_LABELS[room.effect]}{room.reconstructed?` ×2 · ${room.specialUsed?'Used this Action phase':'Ready · once per Action phase'}`:' · once within Explore or Attack, before or after its primary effect.'}</span>}
    <div className="contributions">{Object.entries(room.cubesByPlayer).filter(([,n])=>n>0).map(([id,n])=><span style={mageStyle(id)} key={id}>{emoji[id]??'✺'} {game.players.find(p=>p.id===id)?.name??'Black Rose'}: {n}</span>)}</div>
    {spell?.target==='MODEL'&&!dummy&&<label className="action-setting">Spell target model<select aria-label="Spell target model" value={selectedModelId} onChange={e=>setSelectedModelId(e.target.value)}><option value="">First enemy in this room</option>{spellModelsInRoom(room).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
    {spell&&<button className="primary" disabled={pending||!myTurn||turnActionsRemaining===0||!canTarget(room)} onClick={cast}>Cast {spell.name} here{dummy?' on dummy':''}</button>}
    </div>}
    </section>
    {game.phase==='ACTION'&&<section className="phase-panel"><div className="section-heading"><div><span className="eyebrow">Your prepared grimoire · 1 action per cast</span><h2>{game.evocationActivation?.playerId===me.id?'Finish your evocation activation':myTurn?'Choose your next action':'Watch the other mage’s turn'}</h2></div><span className="badge">{myTurn?`${turnActionsRemaining} turn actions left`:me.passed?'Passed':'Waiting'}</span></div>
    {inStart&&<div className="notice">Leave your starting room with Explore or a discarded card before casting or attacking.</div>}
    {myTurn&&active?.physicalAction&&<div className="notice">Finish or skip your {active.physicalAction.kind==='EXPLORE'?'Explore':'Attack'} effects before casting spells.</div>}
      <div className="cards prepared">{slotKeys.map((key,i)=>{const c=me.prepared[key];return c&&<SpellCard key={key} card={c.card} used={c.used} label={key==='rapid'?'✧ Flexible':`Spell ${i+1}`} selected={key===selectedSlot} disabled={pending||!myTurn||turnActionsRemaining===0||inStart||!!active?.physicalAction||!!active?.exploring||c.used||(key!=='rapid'&&(key!==nextSlot||!!active?.sequencedSpellUsed))} onClick={()=>{setSelectedSlot(old=>old===key?null:key);setSelectedPowerfulId(null);setSelectedRoom(null);setDummy(false);setExitCardId('');setToast('Choose a highlighted room containing your target, or select dummy targeting.');}}/>;})}</div>
    {spell&&<><p className="hint">Every spell—including flexible and powerful—uses 1 of your 2 turn actions, but no physical token. Range follows a straight, contiguous hex line without turning; range 0 targets your own hex. Cast at most one numbered spell per turn. Powerful spells are removed after use.</p>{spell.target==='MODEL'&&<div className="button-row target-mode"><button className={!dummy?'primary':''} onClick={()=>{setDummy(false);setSelectedRoom(null);}}>Target enemy model</button><button className={dummy?'primary':''} onClick={()=>{setDummy(true);setSelectedRoom(null);}}>Target dummy · no damage</button></div>}{dummy&&<p className="hint">Select any non-starting room in range on a straight hex line. Only non-damage effects, such as instability, resolve—even if a model is present.</p>}</>}
    </section>}
      {powerfulCards.length>0&&<section className="powerful-panel"><span className="eyebrow">The central chamber's gift</span><h2>Black Rose spells</h2><p>Cast directly from your hand for 1 turn action and no physical token. Keep unused spells across rounds; cast spells are permanently removed. Forced hand-limit discards are the only discard exception.</p><div className="cards">{powerfulCards.map(card=><SpellCard key={card.id} card={card} label="✺ Powerful" selected={selectedPowerfulId===card.id} disabled={pending||!myTurn||turnActionsRemaining===0||inStart||!!active?.physicalAction||!!active?.exploring} onClick={()=>{setSelectedPowerfulId(old=>old===card.id?null:card.id);setSelectedSlot(null);setSelectedRoom(null);setDummy(false);setExitCardId('');}}/>)}</div><p className="hint">Supply: {game.powerfulDeck.length} remaining · {game.removedCards.length} permanently removed</p></section>}
    <section className="log-panel"><div className="section-heading"><h2>Chronicle</h2><span className="hint">Latest events first</span></div><div className="log" role="log">{game.log.slice(-45).reverse().map((entry,i)=><div key={`${game.log.length-i}`}><span>✧</span>{entry}</div>)}</div></section>
   </div>
  <aside><section className="players-panel"><span className="eyebrow">Mages of the lodge · {game.players.length}</span>{game.players.map(p=><div className={`player ${p.id===actingPlayer?.id?'active-player':''}`} style={mageStyle(p.id)} data-player-id={p.id} aria-current={p.id===actingPlayer?.id?'true':undefined} key={p.id}>
   <div className="player-heading"><span><span className={p.id===actingPlayer?.id?'acting-mage-icon':''}>{emoji[p.id]}</span> {p.name} {p.id===me.id&&<small>(you)</small>}</span><b>{p.victoryPoints}<small> VP</small></b></div>
   <div className="health"><i style={{width:`${Math.max(0,100-p.wizard.damageCubes/p.wizard.health*100)}%`}}/></div>
   <div className="player-stats"><span>♥ {p.wizard.health-p.wizard.damageCubes}/{p.wizard.health}</span><span>⚡ {p.actionTokens}</span><span title="Available cubes">◆ {p.cubes.available}</span></div>
  <dl className="mage-attributes"><div><dt>Max HP</dt><dd>{p.wizard.health}</dd></div><div><dt>Attack</dt><dd>{p.wizard.attack}</dd></div><div><dt>Movement</dt><dd>{p.wizard.movement}</dd></div><div><dt>Card limit</dt><dd>{p.cardLimit}</dd></div><div><dt>Quest limit</dt><dd>{p.questLimit}</dd></div></dl>
  <div className="cube-pool hint">◆ On mages: {p.cubes.onWizard} · On evocations: {p.cubes.onEvocations} · In rooms: {p.cubes.onBoard}</div>
   <DamageContributions game={game} player={p}/>
  <small className={p.id===actingPlayer?.id?'acting-label':'hint'}>{!p.connected?'Disconnected':p.id===actingPlayer?.id?game.phase==='EVOCATION'||game.evocationActivation?'Controlling evocations · acting now':'Acting now':p.passed?'Passed this round':p.studyDone&&game.phase==='STUDY'?'Study complete':p.preparationDone&&game.phase==='PREPARATION'?'Prepared':'In the lodge'}</small>
  </div>)}</section>
    {game.phase==='ACTION'&&<PhysicalActionsPanel game={game} me={me} enabled={enabled} pending={pending} exitCardId={exitCardId} setExitCardId={setExitCardId} clearSpell={()=>{setSelectedSlot(null);setSelectedPowerfulId(null);}} send={send}/>}
      <EvocationsPanel game={game} playerId={me.id} enabled={enabled} pending={pending} send={send} show={retinueVisible[me.id] ?? false} toggleShow={()=>toggleRetinue(me.id)}/>
    <section className="quest-panel"><span className="eyebrow">Your personal quests</span>{[me.quest,...me.additionalQuests].filter((q):q is NonNullable<Player['quest']>=>!!q).map(quest=><div className="quest-entry" key={quest.id}><h2>◇ {quest.name}</h2><p>{quest.description}</p><span className="badge">+{quest.reward} VP on completion</span></div>)}{!me.quest&&<><h2>◇ Awaiting a new purpose</h2><p>You receive a quest at the end of Black Rose if you do not have one, or from an Amber room.</p></>}<p className="hint">{me.questsCompleted} quests completed · {me.kills} mages defeated</p></section>
    <section className="reference"><span className="eyebrow">Quick reference</span>
     <p>Victory is checked at Cleanup: reach <b>30 VP</b>.</p>
     <p><b>2 actions total per turn.</b> Explore, Attack, each spell cast (including flexible and powerful), discard-to-move, and paid evocation activation each use one. The turn hands off after the second action finishes.</p>
     <p><b>2 physical tokens per round.</b> Explore, Attack, and paid evocation activation also use a token. Spells and discard-to-move do not. Resolve a physical action's primary effect and room activation in either order, once each, or skip what remains.</p>
     <p>Mage attacks deal <b>{me.wizard.attack} damage at distance 0</b>. Explore permits up to <b>{me.wizard.movement} movements</b>. Numbered spells are limited to one per turn, within the shared two-action budget.</p>
     <p>Before Preparation, discard to <b>{me.cardLimit} cards</b>; excess goes to personal discard. At the end of Black Rose, discard to <b>{me.questLimit} quests</b>.</p>
     <p><b>Evocations:</b> maximum 3. Activate a <b>Grey room</b> to summon a Cadaver; tokens activate existing models, never directly summon. Every model activates once after Action; token activations during Action are extra.</p>
     <p><b>Room effects:</b> once within Explore or Attack. Starting rooms cannot be activated. Rebuilt rooms grant <b>double</b>, once per Action phase; refresh at Cleanup.</p>
     <p>Central chamber: <b>10 cubes · 6 / 3 VP</b>.<br/>Other rooms: <b>5 cubes · 3 / 1 VP</b>.</p>
    <p>Damage places your available cubes on enemy models. On mage defeat, contributors score <b>4 / 2 / 1 VP</b> and recover their cubes. Destroyed evocations return their cubes without VP.</p>
    <p><b>Dense ranks:</b> tied contributions share a rank; the next different total takes the next rank (1, 1, 2). A tied reward is reduced by <b>1 VP, minimum 1</b>, regardless of how many tie.</p>
    <p><b>One-color bonus:</b> gain <b>+1 VP</b> if all cubes in a room are yours when it is completed, or all damage cubes on a mage are yours when they are defeated. Black Rose cubes and black damage are neutral, not yours.</p>
    <p>Normal school discards return to their school; forced hand-limit discards are the exception.</p>
     <p className="hint">Grimoire {me.personalDeck.length} · Hand {me.hand.length}/{me.cardLimit} · Personal discard {me.discard.length}</p>
    </section>
   </aside>
  </main><footer>BLACK ROSE WARS · Unofficial prototype · 2–4 mages · Original placeholder cards</footer>
 </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);