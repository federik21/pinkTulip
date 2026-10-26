import React, { useEffect, useRef, useState } from 'react';
import { GameState, TurnRecap as Recap, TurnRecapCard, getSpellType } from '@brw/game-engine';
import { highlightMages } from './ChronicleDrawer';
import { TRIGGER_LABELS } from './CombatFeedback';
import { mageStyle, ownerName } from './presentation';
import { SpellDescription } from './SpellDescription';
import { SpellTypeIcon } from './SpellTypeIcon';

const ROLE_LABELS: Record<TurnRecapCard['role'], string> = { CAST: 'Cast', DISCARDED: 'Discarded to move', TRIGGERED: 'Triggered' };

function RecapCard({ game, entry }: { game: GameState; entry: TurnRecapCard }) {
 const { card } = entry;
 return <div className="recap-card" data-recap-role={entry.role} data-card-name={card.name} style={mageStyle(entry.ownerId)}>
  <strong><SpellTypeIcon type={getSpellType(card)} /> {card.name}</strong>
  <small>{ROLE_LABELS[entry.role]} · {ownerName(game, entry.ownerId)}{entry.trigger ? ` · ${TRIGGER_LABELS[entry.trigger]}` : ''}</small>
  <SpellDescription card={card} />
 </div>;
}

/** Ordered recap of the most recent bot turn: every logged step, with full cards where public. */
export function BotTurnRecap({ game }: { game: GameState }) {
 const recap: Recap | undefined = [...(game.turnRecaps ?? [])].reverse().find(item => item.isBot);
 const seen = useRef<{ gameId: string; id?: string } | null>(null);
 const [open, setOpen] = useState(false);
 useEffect(() => {
  // A recap already present when joining/reconnecting stays collapsed; a new one opens.
  if (!seen.current || seen.current.gameId !== game.gameId) { seen.current = { gameId: game.gameId, id: recap?.id }; setOpen(false); return; }
  if (recap && recap.id !== seen.current.id) { seen.current.id = recap.id; setOpen(true); }
 }, [game.gameId, recap?.id]);
 if (!recap) return null;
 const last = recap.lines.length - 1;
 const cardsAfter = (index: number) => recap.cards.filter(entry => Math.min(last, Math.max(0, entry.at - 1)) === index);
 return <section className="turn-recap" aria-label="Last bot turn recap" data-recap-id={recap.id}>
  <button type="button" className="turn-recap-toggle" aria-expanded={open} aria-controls="turn-recap-steps" onClick={() => setOpen(value => !value)}>
   <span className="eyebrow">Last bot turn · Round {recap.round}</span>
   <strong className="log-mage" style={mageStyle(recap.playerId)}>{recap.playerName}</strong>
   <small>{recap.lines.length} step{recap.lines.length === 1 ? '' : 's'} · {recap.cards.length} card{recap.cards.length === 1 ? '' : 's'}</small>
   <span aria-hidden="true">{open ? '▾ Hide' : '▸ Show'}</span>
  </button>
  {open && <ol id="turn-recap-steps" className="turn-recap-steps" aria-label={`${recap.playerName}'s turn, in order`}>
   {recap.lines.map((line, index) => <li key={index}>
    <p>{highlightMages(line, game.players)}</p>
    {cardsAfter(index).map((entry, i) => <RecapCard key={i} game={game} entry={entry} />)}
   </li>)}
  </ol>}
 </section>;
}
