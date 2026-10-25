import React from 'react';
import { GameState, getSpellType } from '@brw/game-engine';
import { SpellTypeIcon } from './SpellTypeIcon';

type EffectKind='TRAP'|'PROTECTION'|'ONGOING';
type ModelEffect={kind:EffectKind;count:number;label:string};

export function getModelEffects(game:GameState,viewerId:string,modelId:string):ModelEffect[] {
 const mage=game.players.find(p=>p.id===modelId||p.wizard.id===modelId);
 const evocation=!mage&&game.evocations.find(e=>e.id===modelId);
 if(!mage&&!evocation)return [];
 const counts:Record<EffectKind,number>={PROTECTION:0,TRAP:0,ONGOING:0};
 const bound=(active:NonNullable<GameState['readiedSpells']>[number])=>mage
  ? !!active.targetPlayerId&&(active.targetPlayerId===mage.id||active.targetPlayerId===mage.wizard.id)
  : active.targetEvocationId===modelId;
 // Filter ownership before inspecting private type/binding data, even if an
 // accidental unmasked projection reaches the client. Ongoing effects are public.
 for(const active of game.readiedSpells??[]) {
  if(active.playerId!==viewerId)continue;
  if(!bound(active))continue;
  const type=getSpellType(active.card);
  if(type==='TRAP'||type==='PROTECTION')counts[type]++;
 }
 for(const active of game.ongoingSpells??[])if(bound(active))counts.ONGOING++;
 return (['PROTECTION','TRAP','ONGOING'] as const).filter(kind=>counts[kind]>0).map(kind=>({
  kind,count:counts[kind],label:kind==='ONGOING'?'Ongoing effect':kind==='PROTECTION'?'Protection':'Trap',
 }));
}

function EffectGlyph({kind}:{kind:EffectKind}) {
 if(kind==='TRAP')return <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
  <path d="M4 18c0 7 5 11 12 11s12-4 12-11M4 18l3 4 2-5 3 6 4-5 4 5 3-6 2 5 3-4"/>
  <path d="M5 13C5 6 10 3 16 3s11 3 11 10l-3-3-2 5-3-5-3 5-3-5-3 5-2-5-3 3Z"/>
  <path d="M9 24h14M16 15v8M12 20h8M27 24l3 2-2 3"/>
 </g>;
 if(kind==='PROTECTION')return <path d="M16 3 27 7v8c0 7-5 11-11 14C10 26 5 22 5 15V7Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/>;
 return <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="16" cy="16" r="10"/><path d="M16 3v8m0 10v8M3 16h8m10 0h8M8 8l5 5m6 6 5 5m0-16-5 5m-6 6-5 5"/></g>;
}

type Props={game:GameState;viewerId:string;modelId:string};
const description=(effect:ModelEffect)=>`${effect.count} ${effect.label.toLowerCase()}${effect.count===1?'':'s'}`;

export function ModelEffects({game,viewerId,modelId}:Props) {
 const effects=getModelEffects(game,viewerId,modelId);
 if(!effects.length)return null;
 return <span className="model-effects" data-model-id={modelId} role="group" aria-label="Bound effects">
  {effects.map(effect=><span className="model-effect" data-effect-kind={effect.kind} data-effect-count={effect.count} title={description(effect)} key={effect.kind}>
   {effect.kind==='ONGOING'?<span className="ongoing-effect-icon" role="img" aria-label="Ongoing effect">✧</span>:<SpellTypeIcon type={effect.kind}/>}
   <span>{effect.label} ×{effect.count}</span>
  </span>)}
 </span>;
}

// Private room tokens: only the caster's own Trap/Protection cast on this exact
// room. Foreign bindings stay hidden, and owner is checked before the type.
export function RoomTrapTokens({game,viewerId,roomId}:{game:GameState;viewerId:string;roomId:string}) {
 const counts={TRAP:0,PROTECTION:0};
 for(const active of game.readiedSpells??[]) {
  if(active.playerId!==viewerId||active.roomId!==roomId||active.targetPlayerId||active.targetEvocationId)continue;
  const type=getSpellType(active.card);
  if(type==='TRAP'||type==='PROTECTION')counts[type]++;
 }
 const kinds=(['TRAP','PROTECTION'] as const).filter(kind=>counts[kind]>0);
 if(!kinds.length)return null;
 return <g className="room-trap-tokens" data-room-id={roomId} role="group" aria-label="Your bindings in this room">
  {kinds.map(kind=>{
   const label=`${counts[kind]} ${kind==='TRAP'?'trap':'protection'}${counts[kind]===1?'':'s'} set here`;
   return <g className="room-trap-token" data-token-kind={kind} data-token-count={counts[kind]} role="img" aria-label={label} key={kind}
    transform={`translate(${kind==='TRAP'?23:-23},-15)`}>
    <title>{label}</title><circle r={5.6}/>
    <svg x={-3.8} y={-3.8} width={7.6} height={7.6} viewBox="0 0 32 32" aria-hidden="true"><EffectGlyph kind={kind}/></svg>
    {counts[kind]>1&&<text className="room-trap-count" x={4.6} y={6.6}>{counts[kind]}</text>}
   </g>;
  })}
 </g>;
}

export function ModelEffectMarkers({game,viewerId,modelId,radius}:Props&{radius:number}) {
 const effects=getModelEffects(game,viewerId,modelId);
 if(!effects.length)return null;
 // Hug the token's upper rim. Scaling with the shared model radius also keeps
 // badges inside the room in the densest four-mage/twelve-evocation layout.
 const diameter=Math.min(radius*1.2,(radius*2+.5)/effects.length);
 const size=diameter*.82,step=diameter+.25;
 return <g className="model-effect-markers" data-model-id={modelId} role="group" aria-label="Bound effects">
  {effects.map((effect,index)=><g className="model-effect" data-effect-kind={effect.kind} data-effect-count={effect.count} role="img" aria-label={description(effect)} key={effect.kind}
   transform={`translate(${(index-(effects.length-1)/2)*step},${-radius*.85})`}>
    <title>{description(effect)}</title><circle r={diameter/2}/>
   <svg x={-size/2} y={-size/2} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true"><EffectGlyph kind={effect.kind}/></svg>
  </g>)}
 </g>;
}