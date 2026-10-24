import type { CSSProperties } from 'react';
import { BLACK_ROSE_ID, Evocation, GameState, Hex, MAGE_COLORS, SpellTarget, hexKey } from '@brw/game-engine';

export const MAGE_SYMBOLS:Record<string,string>={p1:'🧙‍♀️',p2:'🧙‍♂️',p3:'🧝‍♀️',p4:'🧝‍♂️'};
export const MAGE_COLOR_NAMES:Record<string,string>={p1:'Rose',p2:'Blue',p3:'Amber',p4:'Green'};
export const SPELL_TARGET_LABELS:Record<SpellTarget,string>={SELF:'Self',ROOM:'Room',MAGE:'Mage',EVOCATION:'Evocation',MODEL:'Model'};
export const SPELL_TARGET_DESCRIPTIONS:Record<SpellTarget,string>={SELF:'only your mage',ROOM:'all models in a room',MAGE:'one mage',EVOCATION:'one evocation',MODEL:'one mage or evocation'};
export const ownerColor=(id:string)=>MAGE_COLORS[id]??'#d4cedd';
export const mageStyle=(id:string)=>({'--mage-color':ownerColor(id)} as CSSProperties);
export const ownerName=(game:GameState,id:string)=>id===BLACK_ROSE_ID?'Black Rose':game.players.find(p=>p.id===id)?.name??'Unknown mage';
export const roomStatus=(room:GameState['board']['rooms'][number])=>room.reconstructed?(room.specialUsed?'USED':'READY'):room.instability>=room.instabilityLimit?'Full · pending Cleanup':`${room.instability}/${room.instabilityLimit} instability`;

// Clamp cumulative widths, not each segment independently, so a bar never overflows.
export function cubeSegments(contributions:Record<string,number>,total:number,capacity:number) {
 let offset=0;
 const entries=Object.entries(contributions).filter(([,count])=>count>0).sort(([a],[b])=>a===BLACK_ROSE_ID?1:b===BLACK_ROSE_ID?-1:a.localeCompare(b));
 const attributed=entries.reduce((sum,[,count])=>sum+count,0);
 if(total>attributed)entries.push(['unattributed',total-attributed]);
 return entries.map(([id,count])=>{
  const start=Math.min(capacity,offset);offset+=count;
  return {id,count,start:start/capacity,fraction:Math.max(0,Math.min(capacity,offset)-start)/capacity};
 });
}

export function evocationNumber(game:GameState,evocation:Evocation):number {
 if(evocation.number!==undefined)return evocation.number;
 const owned=game.evocations.filter(e=>e.playerId===evocation.playerId);
 const available=[1,2,3].filter(n=>!owned.some(e=>e.number===n));
 const legacy=owned.filter(e=>e.number===undefined).sort((a,b)=>a.id.localeCompare(b.id));
 return available[legacy.findIndex(e=>e.id===evocation.id)]??1;
}
export const roomNameAt=(game:GameState,position:Hex)=>game.board.rooms.find(room=>room.tiles.some(tile=>hexKey(tile)===hexKey(position)))?.name??'Unknown chamber';

// Mages and evocations use the same token size and grid. Crowded rooms shrink
// every model together so circles stay inside the hex, clear of names and bars.
export function roomModelLayout(count:number) {
 const columns=Math.min(4,Math.max(1,count));
 const rows=Math.max(1,Math.ceil(count/columns));
 const radius=Math.min(5,(17-(rows-1)*2)/(rows*2));
 const step=radius*2+2;
 return (index:number)=>{
  const row=Math.floor(index/columns);
  const rowCount=Math.min(columns,count-row*columns);
  return {x:(index%columns-(rowCount-1)/2)*step,y:-1.5+(row-(rows-1)/2)*step,radius};
 };
}

export function roomNameLines(name:string):string[] {
 const words=name.split(' ');
 if(words.length===1)return [name];
 let split=1;
 for(let i=2;i<words.length;i++) {
  if(Math.max(words.slice(0,i).join(' ').length,words.slice(i).join(' ').length)<Math.max(words.slice(0,split).join(' ').length,words.slice(split).join(' ').length))split=i;
 }
 return [words.slice(0,split).join(' '),words.slice(split).join(' ')];
}