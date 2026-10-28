import React from 'react';
import { EVENT_BOARD_SIZE, EventCard, GameState } from '@brw/game-engine';

const SLOT_LABELS = ['Newest', 'Next out', 'Leaves next'];

function pointsText(event: EventCard) {
 const { entryPoints = 0, exitPoints = 0 } = event.ongoing ?? {};
 return `Entered: BR +${entryPoints} VP · Shifts out: BR +${exitPoints} VP`;
}

/** Public ongoing-event board. Slot 1 is newest; the last slot shifts out first. */
export function EventBoard({ game }: { game: GameState }) {
 const slots = Array.from({ length: EVENT_BOARD_SIZE }, (_, i) => game.eventBoard?.[i] ?? null);
 return <section className="event-board" aria-label="Event board" data-testid="event-board">
  <div className="section-heading"><div><span className="eyebrow">Ongoing events</span><h2>Event board</h2></div></div>
  <ol className="event-board-slots">
   {slots.map((event, i) => <li key={i} className={`event-slot${event ? ' occupied' : ''}`} data-slot={i + 1} data-event-id={event?.id}>
    <small className="event-slot-label">{i + 1} · {SLOT_LABELS[i] ?? `Place ${i + 1}`}</small>
    {event
     ? <><strong>{event.name}</strong><span className="event-slot-points">{pointsText(event)}</span><span className="hint">{event.description}</span></>
     : <span className="hint">Empty</span>}
   </li>)}
  </ol>
  <p className="hint">Each round, every ongoing event shifts one place before a new event is drawn. The last one shifts out.</p>
 </section>;
}
