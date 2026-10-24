import React, { useEffect, useRef, useState } from 'react';
import type { FeedbackTarget, GameFeedbackEvent, GameState, TriggerEvent } from '@brw/game-engine';
import { ownerName } from './presentation';
import { SpellTypeIcon } from './SpellTypeIcon';
import './feedback.css';

type PulseEvent = Extract<GameFeedbackEvent, { kind: 'DAMAGE' | 'CONVERT' }>;
type PopupEvent = Extract<GameFeedbackEvent, { kind: 'MAGE_DEFEATED' | 'SPELL_TRIGGERED' }>;
type TimedPulse = { event: PulseEvent; expires: number };
type FeedbackState = { queue: PopupEvent[]; pulses: TimedPulse[]; announcement: string };
export type Feedback = FeedbackState & { game: GameState | null; dismiss: () => void };
const empty = (): FeedbackState => ({ queue: [], pulses: [], announcement: '' });
const PULSE_MS = 1600;

export const TRIGGER_LABELS: Record<TriggerEvent, string> = {
 ENTER_ROOM: 'A model enters the room', DAMAGE_TAKEN: 'The bound model takes damage',
 SPELL_CAST: 'A model casts a spell', ROOM_ACTIVATED: 'A model activates the room',
 EVOCATION_ACTIVATED: 'An evocation activates', MAGE_ATTACK: 'A mage attacks',
 EVOCATION_ATTACK: 'An evocation attacks',
};

/** Consume public resolution facts, never infer hidden reactions from card disappearance. */
export function useGameFeedback(game: GameState | null): Feedback {
 const [state, setState] = useState<FeedbackState>(empty);
 const session = useRef<{ gameId: string | null; seen: Set<string>; tail?: string }>({ gameId: null, seen: new Set() });
 useEffect(() => {
  const events = game?.feedbackEvents ?? [];
  const cursor = session.current;
  if (!game || cursor.gameId !== game.gameId) {
   // Joining/reconnecting baselines the existing feed. Old results are not new notifications.
  session.current = { gameId: game?.gameId ?? null, seen: new Set(events.map(event => event.id)), tail: events[events.length - 1]?.id };
   setState(empty());
   return;
  }
  const fresh = events.filter(event => !cursor.seen.has(event.id));
  const ids = new Set(events.map(event => event.id));
  const rewound = !!cursor.tail && !ids.has(cursor.tail) && !fresh.length;
  for (const event of fresh) cursor.seen.add(event.id);
  cursor.tail = events[events.length - 1]?.id;
  if (!fresh.length && !rewound) return;
  const now = Date.now();
  setState(previous => {
   const queue = rewound ? previous.queue.filter(event => ids.has(event.id)) : previous.queue;
   const pulses = (rewound ? previous.pulses.filter(pulse => ids.has(pulse.event.id)) : previous.pulses)
    .filter(pulse => pulse.expires > now);
   const popups = fresh.filter((event): event is PopupEvent => event.kind === 'MAGE_DEFEATED' || event.kind === 'SPELL_TRIGGERED' && !event.ongoing);
   const effects = fresh.filter((event): event is PulseEvent => event.kind === 'DAMAGE' || event.kind === 'CONVERT');
   return {
    queue: [...queue, ...popups],
    pulses: [...pulses, ...effects.map(event => ({ event, expires: now + PULSE_MS }))],
    announcement: effects.map(event => `${event.target.name}: ${event.kind === 'DAMAGE' ? `${event.amount} damage` : `${event.amount} cubes converted; total unchanged`}.`).join(' '),
   };
  });
 }, [game]);
 useEffect(() => {
  if (!state.pulses.length) return;
  const remaining = Math.max(0, Math.min(...state.pulses.map(pulse => pulse.expires)) - Date.now());
  const timer = window.setTimeout(() => setState(previous => ({ ...previous,
   pulses: previous.pulses.filter(pulse => pulse.expires > Date.now()),
  })), remaining);
  return () => window.clearTimeout(timer);
 }, [state.pulses]);
 return { ...state, game, dismiss: () => setState(previous => ({ ...previous, queue: previous.queue.slice(1) })) };
}

function roomName(game: GameState, id?: string) {
 return game.board.rooms.find(room => room.id === id)?.name ?? 'the lodge';
}

export function CombatFeedback({ game, feedback }: { game: GameState; feedback: Feedback }) {
 const event = feedback.queue[0];
 const title = !event ? '' : event.kind === 'MAGE_DEFEATED' ? 'Mage defeated' : event.spellType === 'PROTECTION' ? 'Protection triggered' : 'Trap triggered';
 return <div className="combat-feedback" role="region" aria-label="Combat notifications" data-queue-count={feedback.queue.length}>
  <div className="feedback-announcement" role="status" aria-live="polite" aria-atomic="true">{event && `${title}: ${event.kind === 'MAGE_DEFEATED' ? event.target.name : event.cardName}. ${feedback.queue.length} events to review. `}{feedback.announcement}</div>
  {event && <section key={event.id} className={`combat-popup ${event.kind === 'MAGE_DEFEATED' ? 'defeat-popup' : 'trigger-popup'}`} role="dialog" aria-modal="false" aria-label={title}>
  <div className="combat-popup-heading"><span className="eyebrow">{title} · Round {event.round}</span>{' '}<span className="hint">{feedback.queue.length} event{feedback.queue.length === 1 ? '' : 's'} to review</span></div>
   {event.kind === 'MAGE_DEFEATED' ? <>
    <h2>{event.target.name} is defeated</h2>
    <p>Final blow: <b>{ownerName(game, event.sourceId)}</b> · {roomName(game, event.target.roomId)}.<br/>Respawn: <b>{roomName(game, event.respawnRoomId)}</b>. Damage cleared.</p>
    {event.awards.length > 0 ? <ul className="defeat-awards">{event.awards.map(award => <li key={award.playerId}><strong>{ownerName(game, award.playerId)} </strong><span>Rank {award.rank}{award.tied ? ' · tied' : ''} · {award.cubes} cube{award.cubes === 1 ? '' : 's'} </span><b>+{award.points} VP </b></li>)}</ul> : <p>No attributed damage: no contribution VP.</p>}
    {event.bonusPlayerId && <p className="defeat-bonus">Exclusive-color bonus: +1 VP to {ownerName(game, event.bonusPlayerId)}.</p>}
    <div className="returned-cubes"><h3>Returned cubes</h3>{Object.keys(event.returnedCubes).length ? Object.entries(event.returnedCubes).map(([id, count]) => <p key={id}>{ownerName(game, id)}: {count} cube{count === 1 ? '' : 's'} returned</p>) : <p>No player cubes to return.</p>}</div>
   </> : <>
    <h2><SpellTypeIcon type={event.spellType}/> {event.cardName}</h2>
    <p><b>{ownerName(game, event.ownerId)}</b> reveals this {event.spellType === 'PROTECTION' ? 'protection' : 'trap'}. {TRIGGER_LABELS[event.trigger]}.</p>
    {event.target && <p>Target: <b>{event.target.name}</b>.</p>}
    {event.roomId && <p>Triggered in <b>{roomName(game, event.roomId)}</b>.</p>}
    <p className="hint">The revealed spell resolves automatically between instructions, then the interrupted action resumes.</p>
   </>}
   <button type="button" onClick={feedback.dismiss}>Dismiss event</button>
  </section>}
 </div>;
}

function modelStillAtEventRoom(game: GameState | null, target: FeedbackTarget) {
 if (!game || target.kind === 'ROOM') return false;
 const position = target.kind === 'MAGE' ? game.players.find(player => player.id === target.id)?.wizard.position : game.evocations.find(model => model.id === target.id)?.position;
 if (!position) return false;
 return !target.roomId || game.board.rooms.find(room => room.id === target.roomId)?.tiles.some(tile => tile.q === position.q && tile.r === position.r);
}

/** SVG-safe, pointer-transparent labels; displaced/destroyed targets fall back to their hit room. */
export function FeedbackPulse({ feedback, kind, targetId, svg = false }: { feedback: Feedback; kind: FeedbackTarget['kind']; targetId: string; svg?: boolean }) {
 const events = feedback.pulses.map(pulse => pulse.event).filter(event => {
  if (kind === 'ROOM') return event.target.kind === 'ROOM' ? event.target.id === targetId
   : event.target.roomId === targetId && !modelStillAtEventRoom(feedback.game, event.target);
  return event.target.kind === kind && event.target.id === targetId && modelStillAtEventRoom(feedback.game, event.target);
 });
 return <>{events.map((event, index) => {
  const label = event.kind === 'DAMAGE' ? `+${event.amount} damage` : `↻ ${event.amount} converted`;
  const props = { className: `feedback-pulse ${event.kind === 'DAMAGE' ? 'damage-pulse' : 'convert-pulse'}`,
   'data-event-id': event.id, 'data-feedback-kind': event.kind, 'data-target-id': event.target.id, 'data-target-kind': event.target.kind,
   'aria-label': `${event.target.name}: ${label}`, role: 'img' };
  return svg ? <g {...props} key={event.id} transform={`translate(0,${-index * 10})`}><circle className="feedback-ring" r={kind === 'ROOM' ? 23 : 9}/><text className="feedback-label" textAnchor="middle" y={-11}>{label}</text></g>
   : <span {...props} key={event.id}>{label}</span>;
 })}</>;
}