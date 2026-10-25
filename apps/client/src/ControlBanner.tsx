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
 actions: React.ReactNode;
 spells: React.ReactNode;
 evocations: React.ReactNode;
 quests: React.ReactNode;
 floating?: boolean;
 onClose?: () => void;
};

// Navigation lives in the bottom dock, so the dashboard only shows the selected panel plus a Close button.
export function ControlBanner({selected,actions,spells,evocations,quests,floating=false,onClose}: Props) {
 const panels:Record<ControlTab,React.ReactNode>={actions,spells,evocations,quests};
 // The tree stays mounted so panel state survives; it is only visible when opened from the bottom bar.
 return <div className="control-banner-slot" hidden={!floating}><section id="lodge-controls" className={`control-banner${floating?' is-floating':''}`} aria-label="Lodge controls" onKeyDown={event=>{if(floating&&event.key==='Escape'){event.preventDefault();onClose?.();}}}>
  <div className="control-banner-heading"><span className="eyebrow">Your control banner</span><button type="button" className="back-to-map" aria-label="Close controls" onClick={onClose}><span aria-hidden="true">✕ </span>Close</button></div>
  {tabs.map(tab=><div className="control-panel" role="region" aria-label={tab.label} id={`controls-panel-${tab.id}`} tabIndex={0} hidden={selected!==tab.id} key={tab.id}>{panels[tab.id]}</div>)}
 </section></div>;
}

export function QuickAccess({selected,expanded,chronicleOpen,onSelect,onChronicle}:{selected:ControlTab;expanded:boolean;chronicleOpen:boolean;onSelect:(tab:ControlTab)=>void;onChronicle:()=>void}) {
 const icons:Record<ControlTab,string>={actions:'⚔',spells:'✧',evocations:'☠',quests:'◇'};
 return <nav className="quick-access" aria-label="Quick access">
  {tabs.map(tab=><button type="button" key={tab.id} data-quick-tab={tab.id} aria-label={`Open ${tab.label.toLowerCase()}`} aria-controls="lodge-controls" aria-expanded={expanded&&selected===tab.id} className={expanded&&selected===tab.id?'selected':''} onClick={()=>onSelect(tab.id)}><span aria-hidden="true">{icons[tab.id]}</span><small>{tab.id==='actions'?'Actions':tab.label}</small></button>)}
  <button type="button" aria-label="Open Chronicle" aria-controls="chronicle-drawer" aria-expanded={chronicleOpen} aria-haspopup="dialog" onClick={onChronicle}><span aria-hidden="true">☰</span><small>Chronicle</small></button>
 </nav>;
}