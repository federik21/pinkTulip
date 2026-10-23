import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Card, GameAction, GameState, Player, Room, ROOM_COLORS, ROOM_EFFECT_LABELS, canPassActionPhase, isInStartingRoom, hexDistance, hexKey } from '@brw/game-engine';
import { EvocationsPanel, targetModels } from './EvocationsPanel';
import './style.css';

const WS_URL=import.meta.env.VITE_WS_URL??`${location.protocol==='https:'?'wss':'ws'}://${location.hostname}:8080`;
const emoji:Record<string,string>={p1:'🧙‍♀️',p2:'🧙‍♂️'};
const phaseInfo={
 LOBBY:['✦','Gather the mages','Join, mark yourself ready, then the creator starts.'],
 BLACK_ROSE:['✺','Black Rose','An event reshapes the lodge. Personal quests follow.'],
 STUDY:['▤','Study','Draw 2 grimoire spells, choose a school for 4 more, discard 2.'],
 PREPARATION:['✧','Preparation','Choose spells in order 1 → 2 → 3, then a flexible spell.'],
 ACTION:['⚔','Action','Up to 2 physical actions, one numbered spell and your flexible spell. Spells are free.'],
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
  <span className="hint">Range {card.range} · {card.target==='ROOM'?'all enemy models':'single enemy model'}{card.powerful?' · Remove after use':''}{used?' · Spent':''}</span>
 </button>;
}

function DamageContributions({game,player}:{game:GameState;player:Player}) {
 const contributors=Object.entries(player.wizard.damageByPlayer).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
 if(!contributors.length&&!player.wizard.blackDamage)return null;
 return <div className="damage-ledger"><small className="hint">Damage cubes on this mage</small><div className="contributions">{contributors.map(([id,n])=><span key={id}>{emoji[id]??'🧙'} {game.players.find(p=>p.id===id)?.name??id}: {n}</span>)}{player.wizard.blackDamage>0&&<span>✺ Black damage: {player.wizard.blackDamage}</span>}</div></div>;
}

function StudyPanel({game,me,send}:{game:GameState;me:Player;send:Send}) {
 const [selected,setSelected]=useState<string[]>([]);
 if(me.studyDone)return <div className="notice">✓ Study complete. Waiting for the other mage.</div>;
 return <section className="phase-panel"><div className="section-heading"><div><span className="eyebrow">The shared library</span><h2>Six schools. Infinite possibilities.</h2></div><span className="badge">Grimoire +2 ✓</span></div>
  {!me.studyDrawn?<><p>Choose one school to draw 4 spells. All six currently contain the same 36-card set.</p><div className="schools">{game.library.map((deck,i)=><button key={deck.id} disabled={deck.cards.length+deck.discard.length<4} onClick={()=>send({type:'DRAW_STUDY',playerId:me.id,deckId:deck.id})}><span className="school-rune">{['✺','❖','✧','☽','⚚','✹'][i]}</span><strong>{deck.name}</strong><small>{deck.cards.length} draw · {deck.discard.length} discard</small></button>)}</div></>:
  <><p>Choose exactly 2 spells to discard. School spells return to that school's discard; personal spells return to your grimoire discard. Powerful spells cannot be discarded.</p><div className="cards">{me.hand.map(card=><SpellCard key={card.id} card={card} disabled={!!card.powerful} selected={selected.includes(card.id)} onClick={()=>setSelected(old=>old.includes(card.id)?old.filter(id=>id!==card.id):old.length<2?[...old,card.id]:old)}/>)}</div><button className="primary" disabled={selected.length!==2} onClick={()=>send({type:'DISCARD_STUDY',playerId:me.id,cardIds:selected})}>Discard selected ({selected.length}/2)</button></>}
 </section>;
}

function PreparationPanel({me,send}:{me:Player;send:Send}) {
 const [selected,setSelected]=useState<string[]>([]);
 if(me.preparationDone)return <div className="notice">✓ Spells prepared. Waiting for the other mage.</div>;
 return <section className="phase-panel"><span className="eyebrow">Plan your sequence</span><h2>Three ordered spells. One wild card.</h2><p>Select in order: 1, 2, 3, then ✧ flexible. Numbered spells must be cast progressively; the flexible spell can be cast at any time. Powerful spells can stay in hand for immediate free casts, or be prepared in a slot; unused ones return to hand next round.</p>
  <div className="preparation-order">{['1','2','3','✧ Flexible'].map((label,i)=><div key={label}><b>{label}</b><span>{me.hand.find(c=>c.id===selected[i])?.name??'Select a spell'}</span></div>)}</div>
  <div className="cards">{me.hand.map(card=>{const index=selected.indexOf(card.id);return <SpellCard key={card.id} card={card} label={index<0?'Spell':index===3?'✧ Flexible':`Order ${index+1}`} selected={index>=0} onClick={()=>setSelected(old=>old.includes(card.id)?old.filter(id=>id!==card.id):old.length<4?[...old,card.id]:old)}/>;})}</div>
  <div className="button-row"><button onClick={()=>setSelected([])}>Reset selection</button><button className="primary" disabled={selected.length!==4} onClick={()=>send({type:'PREPARE_CARDS',playerId:me.id,preparedCardIds:selected.slice(0,3),rapidCardId:selected[3]})}>Prepare spells</button></div>
 </section>;
}

function App() {
 const [game,setGame]=useState<GameState|null>(null),[playerId,setPlayerId]=useState<string|null>(null);
 const [connected,setConnected]=useState(false),[error,setError]=useState('');
 const [roomId,setRoomId]=useState('demo'),[playerName,setPlayerName]=useState(randomName);
 const [roomList,setRoomList]=useState<Array<{id:string;players:number;status:string}>>([]);
 const [overlay,setOverlay]=useState<GameState['phase']|null>(null),[toast,setToast]=useState('');
 const [selectedSlot,setSelectedSlot]=useState<Slot|null>(null),[selectedRoom,setSelectedRoom]=useState<string|null>(null);
 const [selectedPowerfulId,setSelectedPowerfulId]=useState<string|null>(null),[effectTargetId,setEffectTargetId]=useState('');
 const [selectedModelId,setSelectedModelId]=useState('');
 const [dummy,setDummy]=useState(false),[exitCardId,setExitCardId]=useState('');
 const [movementDestination,setMovementDestination]=useState<Room|null>(null);
 const [punchTargetId,setPunchTargetId]=useState('');
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
  setSelectedSlot(null);setSelectedPowerfulId(null);setSelectedRoom(null);setDummy(false);setExitCardId('');setMovementDestination(null);setPunchTargetId('');setEffectTargetId('');
  if(!phase||phase==='LOBBY')return;
  setOverlay(phase);const timer=window.setTimeout(()=>setOverlay(null),2400);return()=>window.clearTimeout(timer);
 },[phase,round]);
 const myActivation=game?.activation?.playerId===playerId;
 const actionsUsed=game?.activation?.actionsUsed,exploring=game?.activation?.exploring;
 const activeEvocationId=game?.evocationActivation?.evocationId;
 useEffect(()=>{
  setSelectedSlot(null);setSelectedPowerfulId(null);setMovementDestination(null);setPunchTargetId('');
  if(phase!=='ACTION'){setToast('');return;}
  setToast(myActivation?(exploring?`Explore: ${exploring} adjacent step${exploring===1?'':'s'} remaining.`:`Your turn · ${2-(actionsUsed??0)} physical action(s) remaining. Spells are free.`):'Turn handed to the other mage.');
 },[phase,myActivation,actionsUsed,exploring,activeEvocationId]);
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
 if(!game || !playerId)return <div className="entry"><div className="entry-decoration">✺</div><div className="entry-card"><span className="eyebrow">A lodge of ambition and ruin</span><h1>BLACK<br/><em>ROSE</em> WARS</h1><p>A two-mage online prototype. Build your grimoire. Shape the lodge. Claim the Rose.</p><label>Mage name<input value={playerName} maxLength={32} onChange={e=>setPlayerName(e.target.value)}/></label><label>Room name<input value={roomId} maxLength={48} onChange={e=>setRoomId(e.target.value)}/></label><div className="button-row"><button disabled={!connected} onClick={()=>join(false)}>Join room</button><button className="primary" disabled={!connected} onClick={()=>join(true)}>Create room</button></div><span className="hint">{connected?'● Connected to the lodge':'○ Connecting to server…'}</span>{error&&<p className="error" role="alert">{error}</p>}{roomList.length>0&&<div className="room-list"><h3>Open lodges</h3>{roomList.map(r=><button key={r.id} onClick={()=>setRoomId(r.id)}><b>{r.id}</b><span>{r.players}/2 · {r.status}</span></button>)}</div>}</div></div>;
 const me=game.players.find(p=>p.id===playerId)!;
 const isHost=game.hostId===me.id;
 const paused=game.phase!=='LOBBY'&&!game.players.every(p=>p.connected);
 const enabled=connected&&!paused;
 const myTurn=game.phase==='ACTION'&&game.currentPlayerId===me.id&&enabled&&!game.evocationActivation;
 const active=game.activation;
 const inStart=isInStartingRoom(game,me);
 const currentRoom=game.board.rooms.find(r=>r.tiles.some(h=>hexKey(h)===hexKey(me.wizard.position)));
 const activeEvocation=game.evocations.find(e=>e.id===game.evocationActivation?.evocationId);
 const movingEvocation=enabled&&game.evocationActivation?.playerId===me.id&&activeEvocation;
 const enemies=targetModels(game).filter(t=>t.playerId!==me.id);
 const actingPlayer=enabled&&(game.phase==='ACTION'||game.phase==='EVOCATION')?game.players.find(p=>p.id===game.currentPlayerId):undefined;
 const roomReady=(r:Room|undefined)=>!!r?.effect&&!r.startingFor&&(!r.reconstructed||!r.specialUsed);
 const canPhysical=myTurn&&(active?.actionsUsed??0)<2&&me.actionTokens>0;
 const exitCards=[...me.hand,...Object.values(me.prepared).filter(p=>p&&!p.used).map(p=>p!.card)].filter(c=>!c.powerful);
 const powerfulCards=me.hand.filter(c=>c.powerful);
 const activationRoom=movementDestination??currentRoom;
 const spell=selectedPowerfulId?powerfulCards.find(c=>c.id===selectedPowerfulId):selectedSlot?me.prepared[selectedSlot]?.card:null;
 const effectTarget=game.board.rooms.find(r=>r.id===effectTargetId);
 const validEffectTarget=(origin:Room|undefined)=>origin?.effect!=='INSTABILITY'||!effectTargetId||!!effectTarget&&Math.min(...origin.tiles.flatMap(h=>effectTarget.tiles.map(t=>hexDistance(h,t))))<=1;
 const roomTarget=(origin:Room|undefined)=>origin?.effect==='INSTABILITY'&&effectTargetId?{roomTargetId:effectTargetId}:{};
 const nextSlot=(['slot1','slot2','slot3'] as Slot[]).find(key=>me.prepared[key]&&!me.prepared[key]!.used);
 const canTarget=(room:Room)=>{
  if(!spell||room.startingFor||inStart)return false;
  if(spell.target==='ROOM'||dummy)return Math.min(...room.tiles.map(h=>hexDistance(me.wizard.position,h)))<=spell.range;
  return enemies.some(t=>room.tiles.some(h=>hexKey(h)===hexKey(t.position))&&hexDistance(me.wizard.position,t.position)<=spell.range);
 };
 const room=game.board.rooms.find(r=>r.id===selectedRoom);
 const beginMovement=(activate:boolean)=>{
  setSelectedSlot(null);setSelectedPowerfulId(null);setExitCardId('');setPunchTargetId('');setMovementDestination(null);
  send({type:'EXPLORE',playerId:me.id,activateRoomAtStart:activate,...(activate?roomTarget(currentRoom):{})});
 };
 const finishMovement=(activate:boolean)=>{
  if(movementDestination)send({type:'EXPLORE_STEP',playerId:me.id,destination:movementDestination.tiles[0],activateRoomAtEnd:activate,...(activate?roomTarget(movementDestination):{})});
  else send({type:'END_EXPLORE',playerId:me.id,activateRoomAtEnd:activate,...(activate?roomTarget(currentRoom):{})});
  setMovementDestination(null);
 };
 const punch=(timing?:'START'|'END')=>{
  send({type:'PUNCH',playerId:me.id,targetId:punchTargetId,...(timing?{roomEffect:timing,...roomTarget(currentRoom)}:{})});
  setPunchTargetId('');
 };
 const cast=()=>{
  if((!selectedSlot&&!selectedPowerfulId)||!spell||!room||!canTarget(room))return;
  const candidates=enemies.filter(t=>room.tiles.some(h=>hexKey(h)===hexKey(t.position))&&hexDistance(me.wizard.position,t.position)<=spell.range);
  const target=candidates.find(t=>t.id===selectedModelId)??candidates[0];
  const targeting=spell.target==='ROOM'||dummy?{roomId:room.id,...(dummy?{dummy:true}:{})}:target?.evocation?{targetEvocationId:target.id}:{targetPlayerId:target?.id};
  if(selectedPowerfulId)send({type:'CAST_POWERFUL_SPELL',playerId:me.id,cardId:selectedPowerfulId,...targeting});
  else if(selectedSlot)send({type:'CAST_SPELL',playerId:me.id,slot:selectedSlot,...targeting});
  setSelectedSlot(null);setSelectedPowerfulId(null);
 };
 return <div className="app"><header><a className="brand" href="/">✺ <span>BLACK ROSE <small>ONLINE LODGE</small></span></a><div className="header-meta"><span className="badge">{roomId}</span><span>Round {game.round}</span><span className={connected?'online':'error'}>{connected?'● Live':'○ Offline'}</span></div></header>
  <nav className="phase-track">{(['BLACK_ROSE','STUDY','PREPARATION','ACTION','EVOCATION','CLEANUP'] as const).map((phase,i)=><div key={phase} className={game.phase===phase?'current':''}><small>0{i+1}</small><span>{phaseInfo[phase][1]}</span></div>)}</nav>
  {actingPlayer&&<div className="turn-banner" role="status" aria-live="polite"><span className="acting-mage-icon" aria-hidden="true">{emoji[actingPlayer.id]}</span><div><span className="eyebrow">{actingPlayer.id===me.id?'Your turn':'Mage acting'}</span><strong>{actingPlayer.name}</strong><small>{game.evocationActivation?'Controlling an evocation':game.phase==='EVOCATION'?'Choosing an evocation':'Taking an Action turn'}</small></div></div>}
  {overlay&&<div className="phase-overlay" role="status" onClick={()=>setOverlay(null)}><span>{phaseInfo[overlay][0]}</span><small>ROUND {game.round}</small><h1>{phaseInfo[overlay][1]}</h1><p>{phaseInfo[overlay][2]}</p><small>Click to continue</small></div>}
  {toast&&<div className="toast" role="status">{toast}</div>}
  <main>
   <div className="game-column">
    {error&&<div className="error notice" role="alert">{error}</div>}
    {paused&&<div className="notice">Game paused. Waiting for the disconnected mage to rejoin room <b>{roomId}</b>.</div>}
    {game.phase==='LOBBY'&&<section className="phase-panel"><span className="eyebrow">Before the first Black Rose</span><h2>Gather the mages</h2><p>Both players must join and mark themselves ready. Only the creator can start.</p><div className="lobby-seats">{game.players.map(p=><div className="seat" key={p.id}><span className="mage-icon">{emoji[p.id]}</span><div><strong>{p.connected?p.name:'Empty seat'}</strong><small>{p.id===game.hostId?'Creator · ':''}{!p.connected?'Waiting for a player':p.ready?'✓ Ready':'Not ready'}</small></div></div>)}</div><div className="button-row"><button disabled={!connected} onClick={()=>send({type:'SET_READY',playerId:me.id,ready:!me.ready})}>{me.ready?'Cancel ready':'Mark ready'}</button>{isHost&&<button className="primary" disabled={!connected||!game.players.every(p=>p.connected&&p.ready)} onClick={()=>send({type:'START_GAME',playerId:me.id})}>Start game</button>}</div></section>}
    {game.phase==='BLACK_ROSE'&&<section className="phase-panel event-panel"><span className="eyebrow">Event revealed · Round {game.round}</span><h2>✺ {game.usedEvent?.name}</h2><p>{game.usedEvent?.description}</p><div className="notice">{game.usedEvent?.kind==='BLACK_DAMAGE'?`${game.usedEvent.amount} black damage to every mage.`:`${game.usedEvent?.amount} neutral instability in ${game.usedEvent?.rooms} random unfinished rooms.`} See the log for resolved effects.</div><p className="hint">When this phase ends, each mage without a quest receives one, then draws 2 grimoire spells.</p>{isHost?<button className="primary" disabled={!enabled||pending} onClick={continuePhase}>Receive quests & begin Study →</button>:<p className="waiting">Waiting for the creator to begin Study…</p>}</section>}
    {game.phase==='STUDY'&&<fieldset disabled={!enabled}><StudyPanel key={`study-${game.round}`} game={game} me={me} send={send}/></fieldset>}
    {game.phase==='PREPARATION'&&<fieldset disabled={!enabled}><PreparationPanel key={`prep-${game.round}`} me={me} send={send}/></fieldset>}
    {game.phase==='EVOCATION'&&<section className="evocation-phase"><span className="eyebrow">After the mages act</span><h2>Evocation phase</h2><p>{game.currentPlayerId===me.id?'Choose an unused evocation from your retinue.':`${game.players.find(p=>p.id===game.currentPlayerId)?.name} is controlling their evocations.`} Each model activates once; movement is optional, followed by one attack.</p></section>}
    {game.phase==='CLEANUP'&&<section className="phase-panel"><span className="eyebrow">The end of the round</span><h2>❖ The lodge settles</h2><p>Rebuilt rooms have awarded their points and returned physical cubes. Rebuilt rooms stay locked and are never scored twice.</p>{isHost?<button className="primary" disabled={!enabled||pending} onClick={continuePhase}>Begin round {game.round+1} →</button>:<p className="waiting">Waiting for the creator to begin the next round…</p>}</section>}
    {game.phase==='GAME_OVER'&&<section className="phase-panel victory"><span className="eyebrow">The Rose has chosen</span><h2>♛ {game.players.find(p=>p.id===game.winner)?.name} wins</h2><p>{game.players.map(p=>`${p.name}: ${p.victoryPoints} VP`).join(' · ')}</p><button onClick={()=>location.reload()}>Return to lobby</button></section>}
    <section className="board-panel"><div className="section-heading"><div><span className="eyebrow">The lodge</span><h2>{movingEvocation?`${activeEvocation?.name} · choose an adjacent space`:exitCardId&&inStart?'Discard exit · choose an adjacent space':spell?`Target: ${spell.name}${dummy?' · dummy':''}`:active?.exploring&&myTurn?'Explore · choose an adjacent space':'Chambers of the Black Rose'}</h2></div><span className="hint">◆ instability / capacity</span></div>
     <div className="room-legend">{ROOM_COLORS.map(color=><span key={color} data-color={color}><i/>{color} · 3</span>)}</div>
    <svg className="board" viewBox="-210 -165 420 330" role="group" aria-label="Hexagonal lodge board">{game.board.rooms.map(r=>{
      const h=r.tiles[0],x=(h.q+h.r/2)*62,y=h.r*54;
      const occupants=game.players.filter(p=>hexKey(p.wizard.position)===hexKey(h));
      const summons=game.evocations.filter(e=>hexKey(e.position)===hexKey(h));
      const evocationReachable=!!movingEvocation&&(game.evocationActivation?.movesRemaining??0)>0&&hexDistance(h,movingEvocation.position)===1&&!r.startingFor;
      const mageReachable=myTurn&&(!!active?.exploring||!!exitCardId&&inStart)&&hexDistance(h,me.wizard.position)===1&&!r.startingFor;
      const reachable=evocationReachable||mageReachable;
      const targetable=myTurn&&!!spell&&canTarget(r);
      const choose=()=>{
      if(evocationReachable)send({type:'EVOCATION_STEP',playerId:me.id,destination:h});
      else if(mageReachable&&exitCardId&&inStart&&!active?.exploring){send({type:'DISCARD_EXIT',playerId:me.id,cardId:exitCardId,destination:h});setExitCardId('');}
      else if(reachable){
       if(active?.exploring===1&&!active.roomEffectUsed&&roomReady(r)){setMovementDestination(r);setSelectedRoom(r.id);return;}
       setMovementDestination(null);
       send({type:'EXPLORE_STEP',playerId:me.id,destination:h});
      }
      else {setSelectedRoom(r.id);setSelectedModelId('');}
      };
      return <g key={r.id} data-color={r.color??undefined} transform={`translate(${x},${y})`} className={`hex ${occupants.some(p=>p.id===actingPlayer?.id)?'acting-room':''} ${r.reconstructed?'rebuilt':''} ${r.startingFor?'start-room':''} ${r.id==='room-0,0'?'central':''} ${selectedRoom===r.id?'selected':''} ${reachable||targetable?'reachable':''}`} role="button" tabIndex={0} aria-label={`${r.name}, ${r.instability}/${r.instabilityLimit} instability${occupants.map(p=>`, ${p.name}`).join('')}${summons.map(e=>`, ${e.name} of ${game.players.find(p=>p.id===e.playerId)?.name}`).join('')}`} onClick={choose} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}}}>
       <title>{r.name}{r.color?` · ${r.color}`:''} · {r.effect?ROOM_EFFECT_LABELS[r.effect]:'Protected starting room'} · Rewards {r.rewards.join('/')} VP{r.reconstructed?' · Rebuilt, locked':''}</title><polygon points="0,-33 29,-16 29,16 0,33 -29,16 -29,-16"/>
      <text className="coordinate" y={-17}>{h.q},{h.r}</text>{occupants.length?occupants.map((p,i)=><g key={p.id} transform={`translate(${(i-(occupants.length-1)/2)*19},0)`}><g className={p.id===actingPlayer?.id?'acting-mage-token':''} data-mage-id={p.id}><text className="occupants" y={5}>{emoji[p.id]}</text></g></g>):<text className="occupants" y={5}>{r.startingFor?'⌂':r.reconstructed?'❖':r.id==='room-0,0'?'✺':'·'}</text>}
      {summons.length>0&&<text className="evocation-marker" x={19} y={-3}>☠{summons.length}</text>}
       <text className="cube-count" y={23}>{r.startingFor?'START':`◆ ${r.instability}/${r.instabilityLimit}`}</text>
      </g>;
     })}</svg>
    {room&&<div className="room-detail"><strong>{room.name} {room.reconstructed?'· Rebuilt 🔒':''}</strong><span>{room.startingFor?'Protected starting room · Exit only; no voluntary reentry':`${room.color??'Central'} · ${room.instability}/${room.instabilityLimit} instability · Rewards ${room.rewards[0]} / ${room.rewards[1]} VP`}</span>
     {room.effect&&<span>{room.reconstructed?'Double special':'Free effect'}: {ROOM_EFFECT_LABELS[room.effect]}{room.reconstructed?` ×2 · ${room.specialUsed?'Used this Action phase':'Ready · once per Action phase'}`:' · once at the start OR end of Explore/Punch.'}</span>}
     <div className="contributions">{Object.entries(room.cubesByPlayer).map(([id,n])=><span key={id}>{emoji[id]??'✺'} {game.players.find(p=>p.id===id)?.name??'Black Rose'}: {n}</span>)}</div>
     {spell?.target==='MODEL'&&!dummy&&<label className="action-setting">Spell target model<select aria-label="Spell target model" value={selectedModelId} onChange={e=>setSelectedModelId(e.target.value)}><option value="">First enemy in this room</option>{enemies.filter(t=>room.tiles.some(h=>hexKey(h)===hexKey(t.position))&&hexDistance(me.wizard.position,t.position)<=spell.range).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
     {spell&&<button className="primary" disabled={!myTurn||!canTarget(room)} onClick={cast}>Cast {spell.name} here{dummy?' on dummy':''}</button>}
    </div>}
    </section>
    {game.phase==='ACTION'&&<section className="phase-panel"><div className="section-heading"><div><span className="eyebrow">Your prepared grimoire · free spells</span><h2>{game.evocationActivation?.playerId===me.id?'Finish your evocation activation':myTurn?'Choose your next action':'Watch the other mage’s turn'}</h2></div><span className="badge">{myTurn?`${Math.min(2-(active?.actionsUsed??0),me.actionTokens)} physical actions left`:me.passed?'Passed':'Waiting'}</span></div>
     {inStart&&<div className="notice">Leave your starting room with Explore or a discarded card before casting or punching.</div>}
    <div className="cards prepared">{slotKeys.map((key,i)=>{const c=me.prepared[key];return c&&<SpellCard key={key} card={c.card} used={c.used} label={key==='rapid'?'✧ Flexible':`Spell ${i+1}`} selected={key===selectedSlot} disabled={!myTurn||inStart||!!active?.exploring||c.used||(key!=='rapid'&&(key!==nextSlot||!!active?.sequencedSpellUsed))} onClick={()=>{setSelectedSlot(old=>old===key?null:key);setSelectedPowerfulId(null);setSelectedRoom(null);setDummy(false);setExitCardId('');setToast('Choose a highlighted room containing your target, or select dummy targeting.');}}/>;})}</div>
    {spell&&<><p className="hint">Spells use no physical action or token. Cast at most one numbered spell this turn, plus your flexible spell. Powerful spells in hand are independent; each is removed after use.</p>{spell.target==='MODEL'&&<div className="button-row target-mode"><button className={!dummy?'primary':''} onClick={()=>{setDummy(false);setSelectedRoom(null);}}>Target enemy model</button><button className={dummy?'primary':''} onClick={()=>{setDummy(true);setSelectedRoom(null);}}>Target dummy · no damage</button></div>}{dummy&&<p className="hint">Select any non-starting room in range. Only non-damage effects, such as instability, resolve—even if a model is present.</p>}</>}
    </section>}
      {powerfulCards.length>0&&<section className="powerful-panel"><span className="eyebrow">The central chamber's gift</span><h2>Black Rose spells</h2><p>Cast directly from your hand for free. Keep unused spells across rounds; cast spells are permanently removed, never discarded.</p><div className="cards">{powerfulCards.map(card=><SpellCard key={card.id} card={card} label="✺ Powerful" selected={selectedPowerfulId===card.id} disabled={!myTurn||inStart||!!active?.exploring} onClick={()=>{setSelectedPowerfulId(old=>old===card.id?null:card.id);setSelectedSlot(null);setSelectedRoom(null);setDummy(false);setExitCardId('');}}/>)}</div><p className="hint">Supply: {game.powerfulDeck.length} remaining · {game.removedCards.length} permanently removed</p></section>}
    <section className="log-panel"><div className="section-heading"><h2>Chronicle</h2><span className="hint">Latest events first</span></div><div className="log" role="log">{game.log.slice(-45).reverse().map((entry,i)=><div key={`${game.log.length-i}`}><span>✧</span>{entry}</div>)}</div></section>
   </div>
  <aside><section className="players-panel"><span className="eyebrow">Mages of the lodge</span>{game.players.map(p=><div className={`player ${p.id===actingPlayer?.id?'active-player':''}`} data-player-id={p.id} aria-current={p.id===actingPlayer?.id?'true':undefined} key={p.id}>
   <div className="player-heading"><span><span className={p.id===actingPlayer?.id?'acting-mage-icon':''}>{emoji[p.id]}</span> {p.name} {p.id===me.id&&<small>(you)</small>}</span><b>{p.victoryPoints}<small> VP</small></b></div>
   <div className="health"><i style={{width:`${Math.max(0,100-p.wizard.damageCubes/p.wizard.health*100)}%`}}/></div>
   <div className="player-stats"><span>♥ {p.wizard.health-p.wizard.damageCubes}/{p.wizard.health}</span><span>⚡ {p.actionTokens}</span><span title="Available cubes">◆ {p.cubes.available}</span></div>
  <div className="cube-pool hint">◆ On mages: {p.cubes.onWizard} · On evocations: {p.cubes.onEvocations} · In rooms: {p.cubes.onBoard}</div>
   <DamageContributions game={game} player={p}/>
  <small className={p.id===actingPlayer?.id?'acting-label':'hint'}>{!p.connected?'Disconnected':p.id===actingPlayer?.id?game.phase==='EVOCATION'||game.evocationActivation?'Controlling evocations · acting now':'Acting now':p.passed?'Passed this round':p.studyDone&&game.phase==='STUDY'?'Study complete':p.preparationDone&&game.phase==='PREPARATION'?'Prepared':'In the lodge'}</small>
  </div>)}</section>
    {game.phase==='ACTION'&&<section className="actions-panel"><span className="eyebrow">{myTurn?'Your turn':'Waiting'}</span><h2>{myTurn?'Make your mark':`${game.players.find(p=>p.id===game.currentPlayerId)?.name??'Other mage'} is acting`}</h2>{myTurn&&<>
    <p className="hint">{activationRoom?.effect?`${movementDestination?'Destination':'Here'}: ${ROOM_EFFECT_LABELS[activationRoom.effect]}${activationRoom.reconstructed?` ×2 · ${activationRoom.specialUsed?'Already used; refreshes at Cleanup':'Ready once this Action phase'}`:''}.`:'Starting rooms cannot be activated.'} At most one room effect per Explore or Punch.</p>
    {activationRoom?.effect==='INSTABILITY'&&<label className="action-setting">Emerald effect target<select aria-label="Emerald effect target" value={effectTargetId} onChange={e=>setEffectTargetId(e.target.value)}><option value="">The activated room (distance 0)</option>{game.board.rooms.filter(r=>!r.startingFor&&Math.min(...activationRoom.tiles.flatMap(h=>r.tiles.map(t=>hexDistance(h,t))))<=1).map(r=><option key={r.id} value={r.id}>{r.name} · {r.color??'central'}</option>)}</select><span className="hint">Choose a room within distance 1 of the activated Emerald room.</span></label>}
    {activationRoom?.effect==='INSTABILITY'&&!validEffectTarget(activationRoom)&&<p className="hint">Choose an Emerald target within distance 1, or choose the activated room.</p>}
    {active?.exploring?<><div className="notice">{movementDestination?`Final step: ${movementDestination.name}. Move here, or activate its effect on arrival.`:`Movement: ${active.exploring} step(s) left. Select a highlighted adjacent hex, or finish here.`}{active.roomEffectUsed?' Free room effect already used.':''}</div><button className="primary" disabled={pending} onClick={()=>finishMovement(false)}>{movementDestination?'Move here without activating':'Finish movement'}</button><button disabled={pending||!!active.roomEffectUsed||!roomReady(activationRoom)||!validEffectTarget(activationRoom)} onClick={()=>finishMovement(true)}>{movementDestination?'Move here & activate room':'Activate room & finish movement'}</button>{movementDestination&&<button onClick={()=>setMovementDestination(null)}>Choose another destination</button>}</>:<>
      {inStart&&<div className="notice"><b>Starting-room exit</b><p>Explore out, or discard a held/unused prepared card to move one space without spending a token or physical action.</p><label className="action-setting">Card to discard for exit<select aria-label="Card to discard for exit" value={exitCardId} onChange={e=>{setExitCardId(e.target.value);setSelectedSlot(null);}}><option value="">Choose a card, then an adjacent hex</option>{exitCards.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>}
      <div className="action-choices"><button className="primary" disabled={pending||!canPhysical} onClick={()=>beginMovement(false)}>Begin movement <small>1 token · up to 2 steps</small></button><button disabled={pending||!canPhysical||inStart||!roomReady(currentRoom)||!validEffectTarget(currentRoom)} onClick={()=>beginMovement(true)}>Activate room <small>1 token · optional movement afterwards</small></button></div>
      {enemies.map(t=><button key={t.id} disabled={pending||!canPhysical||inStart||hexDistance(me.wizard.position,t.position)>1||game.board.rooms.some(r=>r.startingFor&&r.tiles.some(h=>hexKey(h)===hexKey(t.position)))} onClick={()=>setPunchTargetId(old=>old===t.id?'':t.id)}>Punch {t.name} <small>1 token · 1 damage</small></button>)}
      {punchTargetId&&<div className="punch-choices"><p>Activate this room with your punch?</p><button disabled={pending} onClick={()=>punch()}>Punch only</button><button disabled={pending||!roomReady(currentRoom)||!validEffectTarget(currentRoom)} onClick={()=>punch('START')}>Activate room, then punch</button><button disabled={pending||!roomReady(currentRoom)||!validEffectTarget(currentRoom)} onClick={()=>punch('END')}>Punch, then activate room</button><button onClick={()=>setPunchTargetId('')}>Cancel punch</button></div>}
      <button disabled={(active?.actionsUsed??0)<1&&!(active?.spellsCast)&&!active?.discardedExit} onClick={()=>{setExitCardId('');send({type:'END_ACTIVATION',playerId:me.id});}}>End turn <small>Keep remaining resources</small></button>
     </>}
    <button className="danger" disabled={!canPassActionPhase(game,me)||!!active?.exploring} onClick={()=>{setExitCardId('');send({type:'PASS_ROUND',playerId:me.id});}}>Pass for this round</button><p className="hint">2 physical tokens for the entire round. Permanent passing requires 0 tokens and no unused prepared or held powerful spells. Use End turn to save resources. After Action, each evocation activates once before Cleanup.</p>
    </>}</section>}
      <EvocationsPanel game={game} playerId={me.id} enabled={enabled} pending={pending} send={send}/>
    <section className="quest-panel"><span className="eyebrow">Your personal quests</span>{[me.quest,...me.additionalQuests].filter((q):q is NonNullable<Player['quest']>=>!!q).map(quest=><div className="quest-entry" key={quest.id}><h2>◇ {quest.name}</h2><p>{quest.description}</p><span className="badge">+{quest.reward} VP on completion</span></div>)}{!me.quest&&<><h2>◇ Awaiting a new purpose</h2><p>You receive a quest at the end of Black Rose if you do not have one, or from an Amber room.</p></>}<p className="hint">{me.questsCompleted} quests completed · {me.kills} mages defeated</p></section>
    <section className="reference"><span className="eyebrow">Quick reference</span><p>Victory is checked at Cleanup: reach <b>30 VP</b>.</p><p><b>2 physical tokens per round.</b> Spells are free: one numbered spell per turn, plus your flexible spell.</p><p><b>Evocations:</b> maximum 3. Activate a <b>Grey room</b> to summon a Cadaver; tokens activate existing models, never directly summon. Every model activates once after Action; token activations during Action are extra.</p><p><b>Room effects:</b> optional at either end of Explore/Punch. Starting rooms cannot be activated. Rebuilt rooms grant <b>double</b>, once per Action phase; refresh at Cleanup.</p><p>Central chamber: <b>10 cubes · 6 / 3 VP</b>.<br/>Other rooms: <b>5 cubes · 3 / 1 VP</b>.</p><p>Damage places your available cubes on enemy models. On mage defeat, contributors score <b>4 / 2 / 1 VP</b> and recover their cubes. Destroyed evocations return their cubes without VP.</p><p>Tied contributors share their rank. Black damage is neutral. School spells return to their school's discard.</p><p className="hint">Grimoire {me.personalDeck.length} · Hand {me.hand.length} · Personal discard {me.discard.length}</p></section>
   </aside>
  </main><footer>BLACK ROSE WARS · Unofficial prototype · 2 mages · Original placeholder cards</footer>
 </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);