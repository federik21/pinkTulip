import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
const ZOOM_STEP = 1.25;
const BOARD_MIN_WIDTH = 720;
const clamp = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 1000) / 1000));

type Focus = { x: number; y: number };

/** Zoom state for the scrollable lodge board: buttons, keyboard, ctrl/trackpad wheel and two-finger pinch. */
export function useBoardZoom() {
 const [zoom, setZoomState] = useState(1);
 const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
 const zoomRef = useRef(1);
 const anchor = useRef<{ fx: number; fy: number; vx: number; vy: number } | null>(null);

 // Remember which board point sits under the focus so it stays put while the board grows or shrinks.
 const setZoom = useCallback((next: number, focus?: Focus) => {
  const value = clamp(next);
  if (value === zoomRef.current) return;
  if (viewport) {
   const rect = viewport.getBoundingClientRect();
   const vx = focus ? focus.x - rect.left : viewport.clientWidth / 2;
   const vy = focus ? focus.y - rect.top : viewport.clientHeight / 2;
   anchor.current = {
    fx: (viewport.scrollLeft + vx) / Math.max(1, viewport.scrollWidth),
    fy: (viewport.scrollTop + vy) / Math.max(1, viewport.scrollHeight),
    vx,
    vy,
   };
  }
  zoomRef.current = value;
  setZoomState(value);
 }, [viewport]);

 useLayoutEffect(() => {
  const saved = anchor.current;
  anchor.current = null;
  if (!saved || !viewport) return;
  viewport.scrollLeft = saved.fx * viewport.scrollWidth - saved.vx;
  viewport.scrollTop = saved.fy * viewport.scrollHeight - saved.vy;
 }, [zoom, viewport]);

 useEffect(() => {
  if (!viewport) return;
  const onWheel = (event: WheelEvent) => {
   if (!event.ctrlKey && !event.metaKey) return;
   event.preventDefault();
   const delta = Math.max(-25, Math.min(25, event.deltaY));
   setZoom(zoomRef.current * Math.exp(-delta * 0.01), { x: event.clientX, y: event.clientY });
  };
  let pinch: { distance: number; zoom: number } | null = null;
  const distance = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  const begin = (event: TouchEvent) => {
   pinch = event.touches.length === 2 ? { distance: distance(event.touches), zoom: zoomRef.current } : null;
  };
  const move = (event: TouchEvent) => {
   if (!pinch || event.touches.length !== 2) return;
   event.preventDefault();
   const { touches } = event;
   setZoom(pinch.zoom * distance(touches) / Math.max(1, pinch.distance), {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
   });
  };
  const onKeyDown = (event: KeyboardEvent) => {
   if (event.ctrlKey || event.metaKey || event.altKey) return;
   if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(zoomRef.current * ZOOM_STEP); }
   else if (event.key === '-' || event.key === '_') { event.preventDefault(); setZoom(zoomRef.current / ZOOM_STEP); }
   else if (event.key === '0') { event.preventDefault(); setZoom(1); }
  };
  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('touchstart', begin, { passive: true });
  viewport.addEventListener('touchmove', move, { passive: false });
  viewport.addEventListener('touchend', begin, { passive: true });
  viewport.addEventListener('touchcancel', begin, { passive: true });
  viewport.addEventListener('keydown', onKeyDown);
  return () => {
   viewport.removeEventListener('wheel', onWheel);
   viewport.removeEventListener('touchstart', begin);
   viewport.removeEventListener('touchmove', move);
   viewport.removeEventListener('touchend', begin);
   viewport.removeEventListener('touchcancel', begin);
   viewport.removeEventListener('keydown', onKeyDown);
  };
 }, [viewport, setZoom]);

 const zoomed = zoom !== 1;
 // At 100% no style is applied, so the board keeps its original layout.
 const boardStyle: React.CSSProperties | undefined = zoomed
  ? { width: `${zoom * 100}%`, minWidth: `${Math.round(BOARD_MIN_WIDTH * zoom)}px`, ...(zoom < 1 ? { display: 'block', margin: '0 auto' } : {}) }
  : undefined;
 const viewportStyle: React.CSSProperties | undefined = zoomed ? { maxHeight: '78vh', overflowY: 'auto' } : undefined;
 return {
  zoom,
  setViewport,
  boardStyle,
  viewportStyle,
  zoomIn: () => setZoom(zoomRef.current * ZOOM_STEP),
  zoomOut: () => setZoom(zoomRef.current / ZOOM_STEP),
  resetZoom: () => setZoom(1),
 };
}

type ControlsProps = { zoom: number; onZoomIn: () => void; onZoomOut: () => void; onReset: () => void };

export function ZoomControls({ zoom, onZoomIn, onZoomOut, onReset }: ControlsProps) {
 const percent = Math.round(zoom * 100);
 return <div className="zoom-controls" role="group" aria-label="Map zoom">
  <button type="button" aria-label="Zoom out" title="Zoom out (-)" disabled={zoom <= MIN_ZOOM} onClick={onZoomOut}><span aria-hidden="true">−</span></button>
  <button type="button" className="zoom-level" aria-label={`Reset zoom, currently ${percent}%`} title="Reset zoom (0)" onClick={onReset}>{percent}%</button>
  <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={zoom >= MAX_ZOOM} onClick={onZoomIn}><span aria-hidden="true">+</span></button>
 </div>;
}
