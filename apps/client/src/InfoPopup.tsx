import React, { useEffect, useRef } from 'react';

export function InfoPopup({id,title,onClose,children}:{id:string;title:string;onClose:()=>void;children:React.ReactNode}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const dialog=ref.current!;
  const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
  dialog.showModal();
  return()=>{dialog.close();opener?.focus();};
 },[]);
 const keepFocus=(event:React.KeyboardEvent<HTMLDialogElement>)=>{
  if(event.key!=='Tab')return;
  const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter(element=>element.getClientRects().length>0);
  const index=controls.indexOf(document.activeElement as HTMLElement);
  if(!controls.length){event.preventDefault();event.currentTarget.focus();return;}
  if(event.shiftKey&&index<=0){event.preventDefault();controls[controls.length-1].focus();}
  else if(!event.shiftKey&&(index<0||index===controls.length-1)){event.preventDefault();controls[0].focus();}
 };
 return <dialog ref={ref} className="info-popup" aria-labelledby={`${id}-title`} onClose={onClose} onKeyDown={keepFocus} onClick={event=>{if(event.target===event.currentTarget)ref.current?.close();}}>
  <div className="info-popup-content" onClick={event=>event.stopPropagation()}>
   <div className="popup-heading"><h2 id={`${id}-title`}>{title}</h2><button type="button" autoFocus onClick={()=>ref.current?.close()}>Close</button></div>
   {children}
  </div>
 </dialog>;
}