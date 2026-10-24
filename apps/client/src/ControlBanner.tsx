import React from 'react';

export type ControlTab = 'actions' | 'evocations' | 'more';
const tabs: {id: ControlTab; label: string}[] = [
 {id:'actions',label:'Actions'},
 {id:'evocations',label:'Evocations'},
 {id:'more',label:'More'},
];

type Props = {
 selected: ControlTab;
 onSelect: (tab: ControlTab) => void;
 actions: React.ReactNode;
 evocations: React.ReactNode;
 more: React.ReactNode;
 history: React.ReactNode;
};

export function ControlBanner({selected,onSelect,actions,evocations,more,history}: Props) {
 const onKeyDown=(event:React.KeyboardEvent<HTMLButtonElement>,index:number)=>{
  let next:number;
  switch(event.key) {
   case 'ArrowRight':next=(index+1)%tabs.length;break;
   case 'ArrowLeft':next=(index+tabs.length-1)%tabs.length;break;
   case 'Home':next=0;break;
   case 'End':next=tabs.length-1;break;
   default:return;
  }
  event.preventDefault();
  onSelect(tabs[next].id);
  document.getElementById(`controls-tab-${tabs[next].id}`)?.focus();
 };
 return <section className="control-banner" aria-label="Lodge controls">
  <div className="control-banner-heading"><span className="eyebrow">Your control banner</span><span className="hint">The map stays available in every tab</span></div>
  <div className="control-tabs" role="tablist" aria-label="Lodge controls" aria-orientation="horizontal">
   {tabs.map((tab,index)=><button key={tab.id} type="button" role="tab" id={`controls-tab-${tab.id}`} aria-controls={`controls-panel-${tab.id}`} aria-selected={selected===tab.id} tabIndex={selected===tab.id?0:-1} onClick={()=>onSelect(tab.id)} onKeyDown={event=>onKeyDown(event,index)}>{tab.label}</button>)}
  </div>
  <div className="control-panel" role="tabpanel" id="controls-panel-actions" aria-labelledby="controls-tab-actions" tabIndex={0} hidden={selected!=='actions'}>{actions}</div>
  <div className="control-panel" role="tabpanel" id="controls-panel-evocations" aria-labelledby="controls-tab-evocations" tabIndex={0} hidden={selected!=='evocations'}>{evocations}</div>
  <div className="control-panel" role="tabpanel" id="controls-panel-more" aria-labelledby="controls-tab-more" tabIndex={0} hidden={selected!=='more'}>{more}</div>
  {history}
 </section>;
}