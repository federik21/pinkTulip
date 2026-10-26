import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getQuestRewardTargets, summonEvocation } from '../src';
import type { Card, GameAction, GameState, Quest } from '../src';

function fixture():GameState {
 const s=createGame(2);s.phase='ACTION';s.round=1;s.firstPlayerId='p1';s.currentPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:1,exploring:0,spellsCast:1,sequencedSpellUsed:true,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 return s;
}
function takeQuest(s:GameState,kind:Quest['kind']='ROOM_ACTIVATE',completed=true):Quest {
 const index=s.questDeck.findIndex(q=>q.kind===kind),quest=s.questDeck.splice(index,1)[0];
 expect(quest).toBeDefined();Object.assign(quest,{progress:completed?quest.amount:0,completed,claimed:false});
 s.players[0].quest=quest;return quest;
}
const solve=(s:GameState,extra:Partial<Extract<GameAction,{type:'USE_QUEST_REWARD'}>>={})=>applyAction(s,{type:'USE_QUEST_REWARD',playerId:'p1',questId:s.players[0].quest?.id??'missing',...extra});
const allQuestIds=(s:GameState)=>[...s.questDeck,...s.questDiscard,...s.players.flatMap(p=>[...(p.quest?[p.quest]:[]),...p.additionalQuests])].map(q=>q.id).sort();
function prepared(s:GameState,moments:Card['moments'],target:Card['target']='ROOM') {
 const id=s.library[0].cards.shift()!.id;
 s.players[0].prepared.rapid={used:false,card:{id,name:'Objective fixture',kind:'SPELL',spellType:'COMBAT',moments,target,range:2}};
}
const cast=(s:GameState)=>applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});

describe('quest objectives complete without automatically solving or paying rewards',()=>{
 it.each(['REBUILD','INSTABILITY'] as const)('keeps a completed %s quest until the player uses its free reward',kind=>{
  const s=fixture(),quest=takeQuest(s,kind,false);
  const room=s.board.rooms.find(r=>r.id==='room-0,0')!;
  const amount=kind==='REBUILD'?1:2;
  if(kind==='REBUILD'){room.instability=room.instabilityLimit-1;room.cubesByPlayer={'black-rose':room.instability};}
  prepared(s,[{effect:'INSTABILITY',amount}]);
  const after=cast(s),p=after.players[0];
  expect(p.quest).toMatchObject({id:quest.id,progress:quest.amount,completed:true,claimed:false});
  expect(p.victoryPoints).toBe(0);expect(p.questsCompleted).toBe(0);expect(after.questDiscard).toEqual([]);
 });
 it('does not accumulate separate one-cube spells into a single-spell two-instability objective',()=>{
  const s=fixture();s.activation!.actionsUsed=0;const quest=takeQuest(s,'INSTABILITY',false);
  prepared(s,[{effect:'INSTABILITY',amount:1},{effect:'INSTABILITY',amount:1}]);
  const after=cast(s);expect(after.players[0].quest).toMatchObject({id:quest.id,completed:false});
 });
 it('keeps kill objectives unsolved after defeat scoring',()=>{
  const s=fixture(),quest=takeQuest(s,'ROOM_ACTIVATE',false);Object.assign(quest,{kind:'KILL',amount:1});
  s.players[1].wizard.health=1;prepared(s,[{effect:'DAMAGE',amount:1}]);
  const after=cast(s);expect(after.players[0].kills).toBe(1);
  expect(after.players[0].quest).toMatchObject({id:quest.id,completed:true,claimed:false});
  expect(after.players[0].questsCompleted).toBe(0);expect(after.players[0].victoryPoints).toBe(5);
 });
 it('records room activation progress for every held quest and readies each independently',()=>{
  const s=fixture(),quest=takeQuest(s,'ROOM_ACTIVATE',false);quest.progress=2;
  const index=s.questDeck.findIndex(q=>q.kind==='ROOM_ACTIVATE'),additional=s.questDeck.splice(index,1)[0];
  additional.progress=1;s.players[0].additionalQuests.push(additional);
  s.activation!.physicalAction={kind:'EXPLORE',mainEffectUsed:false,movementStarted:false};
  s.board.rooms.find(r=>r.id==='room-0,0')!.effect='DRAW_GRIMOIRE';
  const after=applyAction(s,{type:'ACTIVATE_ROOM',playerId:'p1'});
  expect(after.players[0].quest).toMatchObject({id:quest.id,progress:3,completed:true});
  expect(after.players[0].additionalQuests[0]).toMatchObject({id:additional.id,progress:2,completed:false});
  expect(after.players[0].questsCompleted).toBe(0);
 });
});

describe('completed quest rewards are free and recycle their physical quest',()=>{
 it.each([0,1])('uses a Self reward without spending an action, token, slot or numbered quota (%i used actions)',actionsUsed=>{
  const s=fixture();s.activation!.actionsUsed=actionsUsed;const quest=takeQuest(s),before=structuredClone(s),ids=allQuestIds(s);
  s.players[0].wizard.damageCubes=3;s.players[0].wizard.blackDamage=3;
  const after=solve(s),p=after.players[0];
  expect(p.wizard.damageCubes).toBe(1);expect(p.wizard.blackDamage).toBe(1);
  expect(after.activation).toEqual(before.activation);expect(p.actionTokens).toBe(before.players[0].actionTokens);
  expect(p.prepared).toEqual(before.players[0].prepared);expect(after.currentPlayerId).toBe('p1');
  expect(p.quest).toBeNull();expect(p.questsCompleted).toBe(1);expect(p.victoryPoints).toBe(quest.reward);
  expect(after.questDiscard).toEqual([{...quest,claimed:true}]);expect(allQuestIds(after)).toEqual(ids);
  expect(()=>solve(after,{questId:quest.id})).toThrow(/unavailable/);
 });
 it('keeps the last paid-action window open for its newly completed reward, then hands off after solving',()=>{
  const s=fixture();takeQuest(s,'INSTABILITY',false);prepared(s,[{effect:'INSTABILITY',amount:2}]);
  const ready=cast(s);expect(ready.activation).toMatchObject({playerId:'p1',actionsUsed:2});expect(ready.currentPlayerId).toBe('p1');
  expect(()=>applyAction(ready,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'})).toThrow(/both turn actions/);
  const after=solve(ready,{targetPlayerId:'p2'});expect(after.currentPlayerId).toBe('p2');
  expect(after.players[0].actionTokens).toBe(ready.players[0].actionTokens);expect(after.players[0].questsCompleted).toBe(1);
 });
 it('allows End turn to leave a last-action reward unsolved without adding quest-only turns',()=>{
  const s=fixture();takeQuest(s,'INSTABILITY',false);prepared(s,[{effect:'INSTABILITY',amount:2}]);
  const ready=cast(s),after=applyAction(ready,{type:'END_ACTIVATION',playerId:'p1'});
  expect(after.currentPlayerId).toBe('p2');expect(after.players[0].quest).toMatchObject({completed:true,claimed:false});
 });
 it('keeps the free window open when one reward completes another quest, then hands off exactly once',()=>{
  const s=fixture();s.activation!.actionsUsed=2;const first=takeQuest(s,'INSTABILITY');
  const index=s.questDeck.findIndex(q=>q.kind==='ROOM_ACTIVATE'),second=s.questDeck.splice(index,1)[0];
  Object.assign(second,{kind:'KILL',amount:1,completed:false,progress:0});s.players[0].additionalQuests.push(second);s.players[1].wizard.health=1;
  const ids=allQuestIds(s),ready=solve(s,{targetPlayerId:'p2'});
  expect(ready.currentPlayerId).toBe('p1');expect(ready.activation!.actionsUsed).toBe(2);
  expect(ready.players[0].quest).toMatchObject({id:second.id,completed:true,claimed:false});expect(ready.questDiscard.map(q=>q.id)).toEqual([first.id]);
  const after=solve(ready);expect(after.currentPlayerId).toBe('p2');expect(after.players[0].questsCompleted).toBe(2);
  expect(after.questDiscard.map(q=>q.id)).toEqual([first.id,second.id]);expect(allQuestIds(after)).toEqual(ids);
 });
 it('promotes an additional quest without losing or duplicating either quest',()=>{
  const s=fixture();takeQuest(s);const additional=s.questDeck.shift()!;s.players[0].additionalQuests.push(additional);const ids=allQuestIds(s);
  const after=solve(s);expect(after.players[0].quest!.id).toBe(additional.id);expect(after.players[0].additionalQuests).toEqual([]);
  expect(allQuestIds(after)).toEqual(ids);
 });
 it('solves an additional quest by its own ID, leaving the primary quest in place',()=>{
  const s=fixture(),primary=takeQuest(s);const index=s.questDeck.findIndex(q=>q.kind==='ROOM_ACTIVATE'),additional=s.questDeck.splice(index,1)[0];
  additional.completed=true;s.players[0].additionalQuests.push(additional);
  const after=solve(s,{questId:additional.id});expect(after.players[0].quest).toEqual(primary);expect(after.questDiscard[0].id).toBe(additional.id);
 });
 it('can use an older quest without a printed action and still moves it to discard',()=>{
  const s=fixture(),quest=takeQuest(s);delete quest.rewardAction;
  const after=solve(s);expect(after.players[0].victoryPoints).toBe(quest.reward);expect(after.questDiscard[0].id).toBe(quest.id);
 });
 it('resolves room and model reward targets without using a prepared slot',()=>{
  const s=fixture();takeQuest(s,'REBUILD');const after=solve(s,{roomId:'room-1,0'});
  expect(after.board.rooms.find(r=>r.id==='room-1,0')!.instability).toBe(1);expect(after.activation!.actionsUsed).toBe(1);
  const t=fixture();takeQuest(t,'INSTABILITY');const hit=solve(t,{targetPlayerId:'p2'});
  expect(hit.players[1].wizard.damageCubes).toBe(1);expect(hit.activation!.actionsUsed).toBe(1);
 });
 it.each(['incomplete','claimed','foreign','moving','physical','evocation','interrupt','phase'] as const)('rejects %s quest reward usage atomically',condition=>{
  const s=fixture();takeQuest(s);
  if(condition==='incomplete')s.players[0].quest!.completed=false;
  if(condition==='claimed')s.players[0].quest!.claimed=true;
  if(condition==='foreign'){s.currentPlayerId='p2';s.activation!.playerId='p2';}
  if(condition==='moving')s.activation!.exploring=1;
  if(condition==='physical')s.activation!.physicalAction={kind:'ATTACK',mainEffectUsed:false,movementStarted:false};
  if(condition==='evocation')s.evocationActivation={playerId:'p1',evocationId:'e',movesRemaining:2,returnToAction:true};
  if(condition==='interrupt')s.pendingDecision={kind:'WAITING',playerId:'p2',key:'waiting'};
  if(condition==='phase')s.phase='EVOCATION';
  const before=structuredClone(s);expect(()=>solve(s)).toThrow();expect(s).toEqual(before);
 });
 it('keeps a quest unsolved until the QUEST_SOLVED interrupt commits, and discards it only once',()=>{
  const s=fixture(),quest=takeQuest(s);const index=s.library[0].cards.findIndex(c=>c.name==='Master of Pleasure'),card=s.library[0].cards.splice(index,1)[0];
  s.readiedSpells!.push({id:'master',playerId:'p2',card});s.activeSpellOrder!.push('master');
  const paused=solve(s);expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL');expect(paused.players[0].quest!.claimed).toBe(false);
  expect(paused.questDiscard).toEqual([]);
  const after=applyAction(paused,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:paused.pendingDecision!.key});
  expect(after.players[0].quest).toBeNull();expect(after.questDiscard.filter(q=>q.id===quest.id)).toHaveLength(1);expect(after.players[0].questsCompleted).toBe(1);
 });
});

describe('quest reward choices match authoritative target categories, ownership and range',()=>{
 it('offers Self even in a cell, and excludes the caster from every other model category',()=>{
  const s=fixture(),p=s.players[0],quest=takeQuest(s);p.wizard.position=s.board.rooms.find(r=>r.startingFor==='p1')!.tiles[0];
  expect(getQuestRewardTargets(s,p,quest.rewardAction!).map(t=>t.id)).toEqual(['p1']);
  const card={...quest.rewardAction!,target:'MODEL' as const,range:Infinity};expect(getQuestRewardTargets(s,p,card).map(t=>t.id)).not.toContain('p1');
 });
 it('excludes off-axis finite targets and protected cells, but infinite ranges reach all other rooms',()=>{
  const s=fixture(),p=s.players[0],quest=takeQuest(s,'REBUILD'),card=quest.rewardAction!;
  const finite=getQuestRewardTargets(s,p,card);expect(finite.map(t=>t.id)).not.toContain('room-1,1');expect(finite.some(t=>t.id.startsWith('start'))).toBe(false);
  const all=getQuestRewardTargets(s,p,{...card,range:Infinity});expect(all.map(t=>t.id)).toContain('room-1,1');expect(all).toHaveLength(s.board.rooms.filter(r=>!r.startingFor).length);
  expect(()=>solve(s,{roomId:'room-1,1'})).toThrow(/range/);
 });
 it('offers only appropriate evocations and rejects a forged own-mage damage target',()=>{
  const s=fixture(),p=s.players[0],quest=takeQuest(s,'INSTABILITY');const own=summonEvocation(s,p,'CADAVER',{q:0,r:0})!;
  const enemy=summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0})!;
  expect(getQuestRewardTargets(s,p,quest.rewardAction!).map(t=>t.id)).toEqual(['p2',enemy.id]);
  expect(()=>solve(s,{targetPlayerId:'p1'})).toThrow(/category or ownership/);
  const heal={...quest.rewardAction!,moments:[{effect:'HEAL' as const,amount:1}]};expect(getQuestRewardTargets(s,p,heal).map(t=>t.id)).toContain(own.id);
 });
});