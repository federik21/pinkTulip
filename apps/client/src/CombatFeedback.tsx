import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FeedbackTarget, GameFeedbackEvent, GameState, TriggerEvent } from '@brw/game-engine';
import { mageStyle, ownerName } from './presentation';
import { SpellTypeIcon } from './SpellTypeIcon';
import './feedback.css';

type PulseEvent = Extract<GameFeedbackEvent, { kind: 'DAMAGE' | 'CONVERT' | 'HEAL' }>;
type InterruptEvent = Extract<GameFeedbackEvent, { kind: 'SPELL_TRIGGERED' }>;
type PopupEvent = Extract<GameFeedbackEvent, { kind: 'MAGE_DEFEATED' | 'SPELL_TRIGGERED' }>;
type TimedPulse = { event: PulseEvent; starts: number; expires: number; slot: number; boardSlot: number };
type TimedInterrupt = { event: InterruptEvent; starts: number; expires: number };
type FeedbackState = { queue: PopupEvent[]; pulses: TimedPulse[]; interrupts: TimedInterrupt[]; outcomes: Record<string, PulseEvent[]>; announcement: string };
export type Feedback = FeedbackState & { game: GameState | null; dismiss: () => void };
const empty = (): FeedbackState => ({ queue: [], pulses: [], interrupts: [], outcomes: {}, announcement: '' });
const PULSE_MS = 2800;
const REVEAL_DELAY_MS = 500;
const REVEAL_STEP_MS = 550;
const INTERRUPT_MS = 4800;
const SVG_STACK_STEP = 34; // Balloon height + its entire rise + a clear gap.
const targetRoomKey = (target: FeedbackTarget) => target.roomId ?? `${target.kind}:${target.id}`;
const boardRow = (slot: number) => slot % 4;
const boardColumn = (slot: number) => {
 const column = Math.floor(slot / 4);
 return Math.ceil(column / 2) * (column % 2 ? 1 : -1);
};
const isPulse = (event: GameFeedbackEvent): event is PulseEvent => event.kind === 'DAMAGE' || event.kind === 'CONVERT' || event.kind === 'HEAL';
const pulseLabel = (event: PulseEvent) => event.kind === 'DAMAGE' ? `+${event.amount} damage`
 : event.kind === 'HEAL' ? `+${event.amount} healed` : `↻ ${event.amount} converted`;
const outcomeLabel = (event: PulseEvent) => `${event.target.name}: ${event.kind === 'HEAL'
 ? `${event.amount} wound${event.amount === 1 ? '' : 's'} healed` : event.kind === 'CONVERT'
 ? `${event.amount} cube${event.amount === 1 ? '' : 's'} converted; total unchanged` : `${event.amount} damage`}.`;

function effectLines(event: InterruptEvent, outcomes: PulseEvent[] = []) {
 // Outcomes are actual resolved amounts, not the printed maximum. Never inspect
 // active spells/bindings or infer a reaction from another player's hidden card.
 return outcomes.length ? outcomes.map(outcomeLabel) : event.effects ?? [];
}

function useProgressiveLines(id: string, length: number, starts?: number) {
 const [progress, setProgress] = useState({ id, count: 0 });
 const count = progress.id === id ? progress.count : 0;
 useEffect(() => {
  const start = starts ?? Date.now();
  const timers: number[] = [];
  setProgress({ id, count: 0 });
  for (let index = 0; index < length; index++) {
   const delay = Math.max(0, start + REVEAL_DELAY_MS + index * REVEAL_STEP_MS - Date.now());
   timers.push(window.setTimeout(() => setProgress({ id, count: index + 1 }), delay));
  }
  return () => timers.forEach(timer => window.clearTimeout(timer));
 }, [id, length, starts]);
 return Math.min(count, length);
}

function ProgressiveEffects({ event, outcomes }: { event: InterruptEvent; outcomes?: PulseEvent[] }) {
 const lines = effectLines(event, outcomes);
 const visible = useProgressiveLines(event.id, lines.length);
 return <div className="interrupt-effects" aria-label="Revealed spell effects" data-interrupt-id={event.id}>
  <span className="hint">{visible < lines.length ? 'Revealing effects…' : 'Resolved effects'}</span>
  <ol aria-live="polite" aria-relevant="additions">{lines.slice(0, visible).map((line, index) => <li className="interrupt-effect-line" key={index}>{line}</li>)}</ol>
 </div>;
}

export const TRIGGER_LABELS: Record<TriggerEvent, string> = {
 ENTER_ROOM: 'A model enters the room', DAMAGE_TAKEN: 'The bound model takes damage',
 SPELL_CAST: 'A model casts a spell', ROOM_ACTIVATED: 'A model activates the room',
 EVOCATION_ACTIVATED: 'An evocation activates', MAGE_ATTACK: 'A mage attacks',
 EVOCATION_ATTACK: 'An evocation attacks', DAMAGE_DEALT: 'A model inflicts damage',
 QUEST_SOLVED: 'A mage solves a quest', MAGE_DEFEATED: 'A mage is defeated', VP_CHANGED: 'Victory points change',
 EVOCATION_LOST: 'An evocation is defeated or removed',
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
   const effects = fresh.filter(isPulse).filter(event => event.amount > 0);
   for (const event of effects) {
    const occupied = new Set(pulses.filter(pulse => pulse.event.target.kind === event.target.kind && pulse.event.target.id === event.target.id).map(pulse => pulse.slot));
    let slot = 0;
    while (occupied.has(slot)) slot++;
    const occupiedBoard = new Set(pulses.filter(pulse => targetRoomKey(pulse.event.target) === targetRoomKey(event.target)).map(pulse => pulse.boardSlot));
    let boardSlot = 0;
    while (occupiedBoard.has(boardSlot)) boardSlot++;
    pulses.push({ event, starts: now, expires: now + PULSE_MS, slot, boardSlot });
   }
   const interrupts = [...(rewound ? previous.interrupts.filter(item => ids.has(item.event.id)) : previous.interrupts)
    .filter(item => item.expires > now), ...popups.filter((event): event is InterruptEvent => event.kind === 'SPELL_TRIGGERED')
    .map(event => ({ event, starts: now, expires: now + Math.max(INTERRUPT_MS, REVEAL_DELAY_MS + effectLines(event).length * REVEAL_STEP_MS + 1200) }))];
   const nextQueue = [...queue, ...popups];
   const outcomes: Record<string, PulseEvent[]> = {};
   for (const event of [...nextQueue, ...interrupts.map(item => item.event)]) {
    if (event.kind !== 'SPELL_TRIGGERED') continue;
    // The trigger's own ID is the correlation key. Its optional interruptId is
    // its parent interrupt, so nested reactions must not borrow parent results.
    const retained = (previous.outcomes[event.id] ?? []).filter(effect => !rewound || ids.has(effect.id));
    const grouped = events.filter(isPulse).filter(effect => effect.interruptId === event.id && effect.amount > 0);
    outcomes[event.id] = [...new Map([...retained, ...grouped].map(effect => [effect.id, effect])).values()];
   }
   return {
    queue: nextQueue, pulses, interrupts, outcomes,
    announcement: effects.map(outcomeLabel).join(' '),
   };
  });
 }, [game]);
 useEffect(() => {
  if (!state.pulses.length && !state.interrupts.length) return;
  const remaining = Math.max(0, Math.min(...state.pulses.map(pulse => pulse.expires), ...state.interrupts.map(item => item.expires)) - Date.now());
  const timer = window.setTimeout(() => setState(previous => ({ ...previous,
   pulses: previous.pulses.filter(pulse => pulse.expires > Date.now()),
   interrupts: previous.interrupts.filter(item => item.expires > Date.now()),
   outcomes: Object.fromEntries(Object.entries(previous.outcomes).filter(([id]) => previous.queue.some(event => event.id === id)
    || previous.interrupts.some(item => item.event.id === id && item.expires > Date.now()))),
  })), remaining);
  return () => window.clearTimeout(timer);
 }, [state.pulses, state.interrupts]);
 return { ...state, game, dismiss: () => setState(previous => {
  const queue = previous.queue.slice(1);
  return { ...previous, queue, outcomes: Object.fromEntries(Object.entries(previous.outcomes).filter(([id]) => queue.some(event => event.id === id)
   || previous.interrupts.some(item => item.event.id === id))) };
 }) };
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
    <ProgressiveEffects key={event.id} event={event} outcomes={feedback.outcomes[event.id]}/>
    <p className="hint">The revealed spell resolves automatically between instructions, then the interrupted action resumes.</p>
   </>}
   <button type="button" onClick={feedback.dismiss}>Dismiss event</button>
  </section>}
  <EvocationFeedback feedback={feedback}/>
 </div>;
}

function modelStillAtEventRoom(game: GameState | null, target: FeedbackTarget) {
 if (!game || target.kind === 'ROOM') return false;
 const position = target.kind === 'MAGE' ? game.players.find(player => player.id === target.id)?.wizard.position : game.evocations.find(model => model.id === target.id)?.position;
 if (!position) return false;
 return !target.roomId || game.board.rooms.find(room => room.id === target.roomId)?.tiles.some(tile => tile.q === position.q && tile.r === position.r);
}

function matchesTarget(game: GameState | null, target: FeedbackTarget, kind: FeedbackTarget['kind'], id: string) {
 if (kind === 'ROOM') return target.kind === 'ROOM' ? target.id === id
  : target.roomId === id && !modelStillAtEventRoom(game, target);
 return target.kind === kind && target.id === id && modelStillAtEventRoom(game, target);
}

function interruptTarget(event: InterruptEvent): FeedbackTarget | undefined {
 return event.target ?? (event.roomId ? { kind: 'ROOM', id: event.roomId, roomId: event.roomId, name: 'Revealed room' } : undefined);
}

function interruptRoomKey(event: InterruptEvent) {
 const target = interruptTarget(event);
 return target ? target.roomId ?? event.roomId ?? `${target.kind}:${target.id}` : undefined;
}

function visibleInterrupts(feedback: Feedback) {
 const rooms = new Set<string>();
 // One balloon per affected room, not one per FeedbackPulse mount or hidden
 // binding. All remaining nested interrupts stay available in the recap queue.
 return feedback.interrupts.filter(({ event }) => {
  const key = interruptRoomKey(event);
  if (!key) return false;
  if (rooms.has(key)) return false;
  rooms.add(key); return true;
 });
}

function wrapBalloonLine(line: string, width = 27) {
 const words = line.split(/\s+/), lines: string[] = [];
 for (const word of words) {
  const last = lines.length - 1;
  if (last >= 0 && lines[last].length + word.length < width) lines[last] += ` ${word}`;
  else lines.push(word);
 }
 return lines;
}

export function SVGInterruptBalloon({ item, outcomes, more = 0, offset = -28 }: { item: TimedInterrupt; outcomes?: PulseEvent[]; more?: number; offset?: number }) {
 const { event } = item;
 const effects = effectLines(event, outcomes);
 const visible = useProgressiveLines(event.id, effects.length, item.starts);
 const lines = effects.slice(0, visible).flatMap(line => wrapBalloonLine(line)).slice(0, 4);
 const name = wrapBalloonLine(event.cardName);
 const title = event.spellType === 'PROTECTION' ? 'Protection triggered' : 'Trap triggered';
 const height = 16 + (name.length + lines.length + (more ? 1 : 0)) * 6;
 return <g className="feedback-interrupt" role="img" aria-label={`${title}: ${event.cardName}. ${effects.slice(0, visible).join(' ')}`}
  data-event-id={event.id} data-interrupt-id={event.id} data-target-id={event.target?.id ?? event.roomId} data-more-interrupts={more}
  data-room-id={interruptTarget(event)?.roomId ?? event.roomId}
  transform={`translate(0,${offset})`}>
  <rect className="interrupt-balloon-background" x={-43} y={-height} width={86} height={height} rx={3}/>
  <path className="interrupt-balloon-tail" d="M -3 0 L 0 4 L 3 0"/>
  <text className="interrupt-balloon-heading" textAnchor="middle" y={-height + 7}>{title}</text>
  {name.map((line, index) => <text className="interrupt-balloon-name" textAnchor="middle" y={-height + 14 + index * 6} key={`name-${index}`}>{line}</text>)}
  {lines.map((line, index) => <text className="interrupt-balloon-effect" textAnchor="middle" y={-height + 14 + (name.length + index) * 6} key={`effect-${index}`}>{line}</text>)}
  {more > 0 && <text className="interrupt-balloon-more" textAnchor="middle" y={-4}>+{more} interrupt{more === 1 ? '' : 's'} · see recap</text>}
 </g>;
}

/** Only the empty anchor belongs to the clickable hex. Pointer transparency alone
 * cannot stop visible SVG descendants from enlarging its getBBox/client rect. */
function SVGFeedbackOverlay({ active, kind, targetId, children }: {
 active: boolean; kind: FeedbackTarget['kind']; targetId: string; children: React.ReactNode;
}) {
 const anchor = useRef<SVGGElement>(null);
 const [host, setHost] = useState<SVGGElement | null>(null);
 useLayoutEffect(() => {
  if (!active) { setHost(null); return; }
  const svg = anchor.current?.ownerSVGElement;
  if (!svg) return;
  const namespace = 'http://www.w3.org/2000/svg';
  let layer = Array.from(svg.children).find(child => child.classList.contains('feedback-svg-layer')) as SVGGElement | undefined;
  if (!layer) {
   layer = document.createElementNS(namespace, 'g');
   layer.setAttribute('class', 'feedback-svg-layer');
   layer.setAttribute('pointer-events', 'none');
   svg.appendChild(layer);
  }
  const position = document.createElementNS(namespace, 'g');
  position.setAttribute('class', 'feedback-svg-position');
  layer.appendChild(position);
  // The portal and its transform commit synchronously before the first paint.
  setHost(position);
  return () => {
   position.remove();
   if (!layer.childElementCount) layer.remove();
  };
 }, [active]);
 useLayoutEffect(() => {
  const node = anchor.current, svg = node?.ownerSVGElement;
  if (!node || !svg || !host) return;
  const rootCTM = svg.getScreenCTM(), anchorCTM = node.getScreenCTM();
  if (!rootCTM || !anchorCTM) return;
  const matrix = rootCTM.inverse().multiply(anchorCTM);
  host.setAttribute('transform', `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`);
  host.setAttribute('data-anchor-kind', kind);
  host.setAttribute('data-anchor-id', targetId);
  // Recompute after every commit: crowding/model positions and lanes may change
  // on STATE. Root-relative coordinates also stay correct on resize and scroll.
  const layer = host.parentNode;
  if (layer && svg.lastElementChild !== layer) svg.appendChild(layer);
 });
 return <><g ref={anchor} className="feedback-anchor" data-anchor-kind={kind} data-anchor-id={targetId} aria-hidden="true"/>
  {active && host && createPortal(children, host)}</>;
}

/** SVG-safe labels. Animate an inner group so the static stack never loses its transform. */
export function FeedbackPulse({ feedback, kind, targetId, svg = false }: { feedback: Feedback; kind: FeedbackTarget['kind']; targetId: string; svg?: boolean }) {
 const pulses = feedback.pulses.filter(pulse => matchesTarget(feedback.game, pulse.event.target, kind, targetId));
 const interrupts = visibleInterrupts(feedback).filter(item => matchesTarget(feedback.game, interruptTarget(item.event)!, kind, targetId));
 const balloons = <>{pulses.map(pulse => <NumericBalloon key={pulse.event.id} pulse={pulse} svg={svg}
  slot={svg ? pulse.boardSlot : pulse.slot}/>)}{svg && interrupts.map(item => <SVGInterruptBalloon key={item.event.id} item={item} outcomes={feedback.outcomes[item.event.id]}
  offset={-28 - Math.max(0, ...feedback.pulses.filter(pulse => targetRoomKey(pulse.event.target) === targetRoomKey(interruptTarget(item.event)!)).map(pulse => boardRow(pulse.boardSlot))) * SVG_STACK_STEP}
  more={feedback.interrupts.filter(other => other.event.id !== item.event.id && interruptRoomKey(other.event) === interruptRoomKey(item.event)).length}/>)}</>;
 return svg ? <SVGFeedbackOverlay active={!!(pulses.length || interrupts.length)} kind={kind} targetId={targetId}>{balloons}</SVGFeedbackOverlay> : balloons;
}

function NumericBalloon({ pulse, svg, slot }: { pulse: TimedPulse; svg: boolean; slot: number }) {
 const { event } = pulse;
 // Only compensate when mounting (for example, opening a retinue mid-effect).
 // Changing the delay on every STATE would double-advance existing animations.
 const [age] = useState(() => -Math.max(0, Date.now() - pulse.starts));
 const label = pulseLabel(event);
 const style = { '--feedback-slot': slot, '--feedback-age': `${age}ms`, ...mageStyle(event.sourceId) } as React.CSSProperties;
 const props = { className: `feedback-pulse ${event.kind.toLowerCase()}-pulse`, style,
  'data-event-id': event.id, 'data-feedback-kind': event.kind, 'data-source-id': event.sourceId, 'data-target-id': event.target.id, 'data-target-kind': event.target.kind,
  'data-stack-slot': slot, 'aria-label': `${event.target.name}: ${label}`, role: 'img' };
 return svg ? <g {...props} transform={`translate(${boardColumn(slot) * 46 + (slot % 2 ? 3 : -3)},${-10 - boardRow(slot) * SVG_STACK_STEP})`}>
  <g className="feedback-motion"><rect className="feedback-balloon-background" x={-11} y={-8} width={22} height={14} rx={4}/>
   <text className="feedback-number" textAnchor="middle" y={0}>{event.kind === 'CONVERT' ? '↻' : '+'}{event.amount}</text>
   <text className="feedback-label" textAnchor="middle" y={4.5}>{event.kind === 'DAMAGE' ? 'damage' : event.kind === 'HEAL' ? 'healed' : 'converted'}</text>
  </g></g> : <span {...props}><span className="feedback-motion">{label}</span></span>;
}

/** Keep card integration here: no layout/panel changes, and never render onto unrelated cards. */
function EvocationFeedback({ feedback }: { feedback: Feedback }) {
 const [hosts, setHosts] = useState<HTMLElement[]>([]);
 const hasEffects = feedback.pulses.some(pulse => pulse.event.target.kind === 'EVOCATION');
 useEffect(() => {
  if (!hasEffects) { setHosts([]); return; }
  const root = document.querySelector('.app');
  if (!root) return;
  const update = () => {
   const next = Array.from(root.querySelectorAll<HTMLElement>('.evocation-card[data-evocation-id]'));
   setHosts(previous => previous.length === next.length && previous.every((host, index) => host === next[index]) ? previous : next);
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
 }, [hasEffects]);
 return <>{hasEffects && hosts.filter(host => feedback.pulses.some(pulse => pulse.event.target.kind === 'EVOCATION' && pulse.event.target.id === host.dataset.evocationId))
  .map(host => createPortal(<span className="evocation-feedback-layer">
  <FeedbackPulse feedback={feedback} kind="EVOCATION" targetId={host.dataset.evocationId!}/>
 </span>, host, host.dataset.evocationId))}</>;
}