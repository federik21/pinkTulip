import React, { useEffect, useRef } from 'react';
import { mageStyle } from './presentation';

const isWordChar=(char:string|undefined)=>!!char&&/[\p{L}\p{N}_]/u.test(char);

// Wrap whole-word mage names so they glow in their color; the text itself is unchanged.
export function highlightMages(entry:string,players:{id:string;name:string}[]):React.ReactNode[] {
 const names=players.filter(p=>p.name).sort((a,b)=>b.name.length-a.name.length);
 const parts:React.ReactNode[]=[];
 let text='',i=0;
 while(i<entry.length) {
  const player=isWordChar(entry[i-1])?undefined:names.find(p=>entry.startsWith(p.name,i)&&!isWordChar(entry[i+p.name.length]));
  if(player) {
   if(text){parts.push(text);text='';}
   parts.push(<span key={parts.length} className="log-mage" data-player-id={player.id} style={mageStyle(player.id)}>{player.name}</span>);
   i+=player.name.length;
  } else text+=entry[i++];
 }
 if(text)parts.push(text);
 return parts;
}

export function ChronicleDrawer({open,entries,players,onClose}:{open:boolean;entries:string[];players:{id:string;name:string}[];onClose:()=>void}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  if(!open)return;
  const dialog=ref.current!,opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';dialog.showModal();
  return()=>{dialog.close();document.body.style.overflow=overflow;opener?.focus({preventScroll:true});};
 },[open]);
 const keepFocus=(event:React.KeyboardEvent<HTMLDialogElement>)=>{
  if(event.key!=='Tab')return;
  const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]')).filter(element=>element.getClientRects().length>0);
  const index=controls.indexOf(document.activeElement as HTMLElement);
  if(event.shiftKey&&index<=0){event.preventDefault();controls[controls.length-1]?.focus();}
  else if(!event.shiftKey&&(index<0||index===controls.length-1)){event.preventDefault();controls[0]?.focus();}
 };
 return <dialog ref={ref} id="chronicle-drawer" className="chronicle-drawer" aria-labelledby="chronicle-title" onCancel={event=>{event.preventDefault();onClose();}} onKeyDown={keepFocus}
  onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
  <section className="log-panel" onClick={event=>event.stopPropagation()}>
   <div className="drawer-heading"><div><span className="eyebrow">The lodge’s memory</span><h2 id="chronicle-title">Chronicle</h2></div><button type="button" autoFocus aria-label="Close Chronicle" onClick={onClose}>✕ Close</button></div>
   <p className="hint">Latest events first · live updates</p>
   <div className="log" role="log" aria-label="Lodge events" tabIndex={0}>{entries.slice(-45).reverse().map((entry,i)=><div key={`${entries.length-i}`}><span aria-hidden="true">✧</span><p className="log-text">{highlightMages(entry,players)}</p></div>)}</div>
  </section>
 </dialog>;
}