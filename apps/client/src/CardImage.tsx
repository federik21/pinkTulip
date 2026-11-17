import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Card, SpellSide } from '@brw/game-engine';
import { getCardImage } from './cardImages';

const CARD_RATIO = 744 / 1040;
type Anchor = { left: number; right: number; top: number; height: number };

function zoomStyle(anchor: Anchor): React.CSSProperties {
 const width = Math.max(120, Math.min(380, window.innerWidth - 24, (window.innerHeight - 24) * CARD_RATIO));
 const height = width / CARD_RATIO;
 const left = anchor.right + 12 + width <= window.innerWidth - 8 ? anchor.right + 12 : Math.max(8, anchor.left - 12 - width);
 const top = Math.min(Math.max(8, anchor.top + anchor.height / 2 - height / 2), Math.max(8, window.innerHeight - height - 8));
 return { left, top, width };
}

/**
 * Card scan. Full cards show both faces; `half` shows only the active face (light on top, dark rotated 180°).
 * Hovering with a mouse shows a larger copy of the whole card, oriented like the active side.
 */
export function CardImage({ card, side = 'LIGHT', half = false }: { card: Card; side?: SpellSide; half?: boolean }) {
 const image = getCardImage(card);
 const [anchor, setAnchor] = useState<Anchor | null>(null);
 if (!image) return null;
 const dark = side === 'DARK' && !card.lightOnly;
 const alt = `${card.name}${dark ? ' (dark side)' : ''}`;
 return <span
  className={`card-image${half ? ' is-half' : ''}${dark ? ' is-dark' : ''}`}
  data-card-side={dark ? 'DARK' : 'LIGHT'}
  onPointerEnter={event => {
   if (event.pointerType !== 'mouse') return;
   const rect = event.currentTarget.getBoundingClientRect();
   setAnchor({ left: rect.left, right: rect.right, top: rect.top, height: rect.height });
  }}
  onPointerLeave={() => setAnchor(null)}
 >
  <img src={image.thumb} alt={alt} draggable={false} loading="lazy" />
  {anchor && createPortal(<div className="card-zoom" role="presentation" style={zoomStyle(anchor)}><img src={image.large} alt="" className={dark ? 'is-dark' : undefined} draggable={false} /></div>, document.body)}
 </span>;
}
