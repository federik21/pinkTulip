import React from 'react';

export type ControlTab = 'actions' | 'spells' | 'evocations' | 'quests';
const tabs: {id: ControlTab; label: string}[] = [
 {id:'actions',label:'Physical actions'},
 {id:'spells',label:'Spells'},
 {id:'evocations',label:'Evocations'},
 {id:'quests',label:'Quests'},
];

type Props = {
 selected: ControlTab;
 onSelect: (tab: ControlTab) => void;
 actions: React.ReactNode;
 spells: React.ReactNode;
 evocations: React.ReactNode;
 quests: React.ReactNode;
 floating?: boolean;
 onClose?: () => void;
};

export function ControlBanner({selected,onSelect,actions,spells,evocations,quests,floating=false,onClose}: Props) {
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
 // The tree stays mounted so panel state survives; it is only visible when opened from the bottom bar.
 return <div className="control-banner-slot" hidden={!floating}><section id="lodge-controls" className={`control-banner${floating?' is-floating':''}`} aria-label="Lodge controls" onKeyDown={event=>{if(floating&&event.key==='Escape'){event.preventDefault();onClose?.();}}}>
  <div className="control-banner-heading"><span className="eyebrow">Your control banner</span><button type="button" className="back-to-map" aria-label="Back to map" onClick={onClose}>↓ Back to map</button></div>
  <div className="control-tabs" role="tablist" aria-label="Lodge controls" aria-orientation="horizontal">
   {tabs.map((tab,index)=><button key={tab.id} type="button" role="tab" id={`controls-tab-${tab.id}`} aria-controls={`controls-panel-${tab.id}`} aria-selected={selected===tab.id} tabIndex={selected===tab.id?0:-1} onClick={()=>onSelect(tab.id)} onKeyDown={event=>onKeyDown(event,index)}>{tab.label}</button>)}
  </div>
  <div className="control-panel" role="tabpanel" id="controls-panel-actions" aria-labelledby="controls-tab-actions" tabIndex={0} hidden={selected!=='actions'}>{actions}</div>
    <div className="control-panel" role="tabpanel" id="controls-panel-spells" aria-labelledby="controls-tab-spells" tabIndex={0} hidden={selected!=='spells'}>{spells}</div>
  <div className="control-panel" role="tabpanel" id="controls-panel-evocations" aria-labelledby="controls-tab-evocations" tabIndex={0} hidden={selected!=='evocations'}>{evocations}</div>
    <div className="control-panel" role="tabpanel" id="controls-panel-quests" aria-labelledby="controls-tab-quests" tabIndex={0} hidden={selected!=='quests'}>{quests}</div>
 </section></div>;
}

export function QuickAccess({selected,expanded,chronicleOpen,onSelect,onChronicle}:{selected:ControlTab;expanded:boolean;chronicleOpen:boolean;onSelect:(tab:ControlTab)=>void;onChronicle:()=>void}) {
 const icons:Record<ControlTab,string>={actions:'⚔',spells:'✧',evocations:'☠',quests:'◇'};
 return <nav className="quick-access" aria-label="Quick access">
  {tabs.map(tab=><button type="button" key={tab.id} data-quick-tab={tab.id} aria-label={`Open ${tab.label.toLowerCase()}`} aria-controls="lodge-controls" aria-expanded={expanded&&selected===tab.id} className={expanded&&selected===tab.id?'selected':''} onClick={()=>onSelect(tab.id)}><span aria-hidden="true">{icons[tab.id]}</span><small>{tab.id==='actions'?'Actions':tab.label}</small></button>)}
  <button type="button" aria-label="Open Chronicle" aria-controls="chronicle-drawer" aria-expanded={chronicleOpen} aria-haspopup="dialog" onClick={onChronicle}><span aria-hidden="true">☰</span><small>Chronicle</small></button>
 </nav>;
}