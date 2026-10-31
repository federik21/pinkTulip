import React from 'react';
import { GameAction, GameState, MageDraftId, MAGE_DRAFT_POOL, Player } from '@brw/game-engine';

export function SetupPanel({game,me,connected,pending,send}:{game:GameState;me:Player;connected:boolean;pending:boolean;send:(action:GameAction)=>void}) {
 const order=game.setupOrder??[];
 const draftOrder=game.setupStage==='MAGE'?[...order].reverse():order;
 const drafter=draftOrder.map(id=>game.players.find(player=>player.id===id)).find(player=>player&&(game.setupStage==='SCHOOL'?player.startingSchoolId==null:player.mageId==null));
 const schools=game.library.filter(deck=>!game.players.some(player=>player.startingSchoolId===deck.id));
 const mages=MAGE_DRAFT_POOL.filter(mage=>!game.players.some(player=>player.mageId===mage.id));
 const mageName=(id?:MageDraftId|null)=>MAGE_DRAFT_POOL.find(mage=>mage.id===id)?.name;
 const schoolName=(id?:string|null)=>game.library.find(deck=>deck.id===id)?.name;
 const canDraft=connected&&!pending&&drafter?.id===me.id;
 return <section className="phase-panel setup-panel">
  <div className="section-heading"><div><span className="eyebrow">Game setup</span><h2>{game.setupStage==='SCHOOL'?'Draft a school':'Draft a mage'}</h2></div><span className="badge">{drafter?`${drafter.name} picks`:'Draft complete'}</span></div>
  <p>{game.setupStage==='SCHOOL'?'Pick a school in randomized starting-player order. Each school can only be chosen once.':'Pick a mage in reverse order. Each mage adds their signature spell to their grimoire.'} Your starting rooms and first-player position were randomized when the game began.</p>
  <div className="setup-draft-order">{order.map((id,index)=>{
   const player=game.players.find(candidate=>candidate.id===id)!;
   const room=game.board.rooms.find(candidate=>candidate.startingFor===id);
   return <div className="seat" key={id}><div><strong>{index+1}. {player.name}</strong><small>{index===0?'Starting player':''}{room?` · ${room.name}`:''}</small><span className="seat-school">{player.startingSchoolId?schoolName(player.startingSchoolId):'School pending'}</span><span className="seat-school">{player.mageId?mageName(player.mageId):'Mage pending'}</span></div></div>;
  })}</div>
  {game.setupStage==='SCHOOL'?<div className="schools">{schools.map(deck=><button key={deck.id} disabled={!canDraft||deck.cards.length+deck.discard.length<6} onClick={()=>send({type:'DRAFT_SCHOOL',playerId:me.id,schoolId:deck.id})}><strong>{deck.name}</strong><small>{deck.cards.length} cards available · adds 6 random school cards</small></button>)}</div>:
   <div className="schools">{mages.map(mage=><button key={mage.id} disabled={!canDraft} onClick={()=>send({type:'DRAFT_MAGE',playerId:me.id,mageId:mage.id})}><strong>{mage.name}</strong><small>Health 10 · Attack 2 · Movement 2 · {mage.name}'s signature spell</small></button>)}</div>}
  <p className="notice" role="status" aria-live="polite">{drafter?drafter.id===me.id?'It is your pick.':`Waiting for ${drafter.name} to draft.`:'Finishing setup.'}</p>
 </section>;
}
