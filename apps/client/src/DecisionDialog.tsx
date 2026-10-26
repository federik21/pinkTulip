import React, { useEffect, useRef, useState } from 'react';

type Props = {
 /** Short label shown on the reopen pill while the dialog is minimized. */
 summary: string;
 children: React.ReactNode;
 ariaLabel?: string;
 labelledBy?: string;
 describedBy?: string;
};

/**
 * Modal that blocks the paused action but can be minimized to a pill, so the player can
 * inspect the board, rooms and cards before answering. The content stays mounted, so
 * anything already chosen inside it survives minimizing. Escape minimizes (never answers).
 */
export function DecisionDialog({ summary, children, ariaLabel, labelledBy, describedBy }: Props) {
 const ref = useRef<HTMLDialogElement>(null);
 const pill = useRef<HTMLButtonElement>(null);
 const [minimized, setMinimized] = useState(false);
 useEffect(() => {
  const dialog = ref.current!;
  if (minimized) { pill.current?.focus({ preventScroll: true }); return; }
  const previous = document.activeElement;
  if (!dialog.open) dialog.showModal();
  return () => {
   if (dialog.open) dialog.close();
   if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
  };
 }, [minimized]);
 return <>
  <dialog ref={ref} className="info-popup soul-tithe-popup decision-dialog" aria-label={ariaLabel} aria-labelledby={labelledBy} aria-describedby={describedBy}
   onCancel={event => { event.preventDefault(); setMinimized(true); }}>
   <div className="info-popup-content">
    <button type="button" className="decision-minimize" aria-label="Minimize to inspect the game" title="Minimize to inspect the game" onClick={() => setMinimized(true)}>
     <span aria-hidden="true">▾ </span>Minimize
    </button>
    {children}
   </div>
  </dialog>
  {minimized && <div className="decision-pill" role="region" aria-label="Minimized decision">
   <span>Decision pending · {summary}</span>
   <button ref={pill} type="button" className="primary" onClick={() => setMinimized(false)}>Reopen</button>
  </div>}
 </>;
}
