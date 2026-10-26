import { describe, expect, it } from 'vitest';
import { applyAction, areAdjacent, createGame, isInStartingRoom, moment, mustLeaveCell, summonEvocation, upgradeLegacyCards } from '../src';
import type { Card, GameAction, GameState, Moment, Quest } from '../src';

function fixture():GameState {
 const s=createGame(4);s.round=1;s.phase='ACTION';s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,spellsCast:0,sequencedSpellUsed:false,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 return s;
}
function prepare(s:GameState,moments:Moment[],target:Card['target']='MAGE',owner='p1') {
 const card:Card={id:s.library[0].cards.shift()!.id,name:'Test spell',kind:'SPELL',spellType:'COMBAT',moments,target,range:Infinity};
 s.players.find(p=>p.id===owner)!.prepared.rapid={used:false,card};return card;
}
function inCell(s:GameState) {
 const p=s.players[0];p.wizard.position={...s.board.rooms.find(r=>r.startingFor==='p1')!.tiles[0]};s.activation!.actionsUsed=1;return p;
}
function destination(s:GameState) {
 return s.board.tiles.find(h=>areAdjacent(s.players[0].wizard.position,h)&&!s.board.rooms.some(r=>r.startingFor&&r.tiles.some(t=>t.q===h.q&&t.r===h.r)))!;
}
const use=(s:GameState,type:GameAction['type'])=>applyAction(s,{type,playerId:'p1'} as GameAction);
function catalog(s:GameState,name:string) {
 const index=s.library[0].cards.findIndex(c=>c.name===name);expect(index).toBeGreaterThanOrEqual(0);return s.library[0].cards.splice(index,1)[0];
}
function wound(s:GameState,index:number,history:string[]) {
 const p=s.players[index];p.wizard.damageOrder=[...history];p.wizard.damageCubes=history.length;p.wizard.blackDamage=history.filter(id=>id==='black-rose').length;
 p.wizard.damageByPlayer={};
 for(const id of history)if(id!=='black-rose'){p.wizard.damageByPlayer[id]=(p.wizard.damageByPlayer[id]??0)+1;const owner=s.players.find(p=>p.id===id)!;owner.cubes.available--;owner.cubes.onWizard++;}
}
function cubes(s:GameState) {
 for(const p of s.players){expect(Object.values(p.cubes).reduce((a,b)=>a+b,0)).toBe(25);
  expect(p.cubes.onWizard).toBe(s.players.reduce((n,t)=>n+(t.wizard.damageByPlayer[p.id]??0),0));
  expect(p.cubes.onEvocations).toBe(s.evocations.reduce((n,e)=>n+(e.damageByPlayer[p.id]??0),0));}
}
function peak(s:GameState,roomId='room-0,0') {
 s.players[0].prepared.rapid={used:false,card:catalog(s,'Peak of Agony')};
 return applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId});
}

describe('one remaining turn action in the cell must be used to exit',()=>{
 it('rejects End turn and cannot skip or finish the paid Explore before moving',()=>{
  let s=fixture();inCell(s);expect(mustLeaveCell(s,s.players[0])).toBe(true);const before=structuredClone(s);
  expect(()=>use(s,'END_ACTIVATION')).toThrow(/leave the cell/);expect(s).toEqual(before);
  s=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'});expect(s.activation!.mustExitCell).toBe(true);
  expect(()=>use(s,'SKIP_PHYSICAL_EFFECTS')).toThrow(/Leave the cell/);
  s=use(s,'PERFORM_MOVEMENT');expect(()=>use(s,'END_EXPLORE')).toThrow(/leave the cell/);
  s=applyAction(s,{type:'EXPLORE_STEP',playerId:'p1',destination:destination(s)});expect(s.activation!.mustExitCell).toBeUndefined();
  s=use(s,'END_EXPLORE');s=use(s,'SKIP_PHYSICAL_EFFECTS');expect(s.currentPlayerId).toBe('p2');expect(isInStartingRoom(s,s.players[0])).toBe(false);
 });
 it('allows discard-to-move without a physical token, but not a pass instead',()=>{
  const s=fixture(),p=inCell(s);p.actionTokens=0;const card=s.library[0].cards.shift()!;p.prepared.slot1={card,used:false};
  expect(()=>use(s,'END_ACTIVATION')).toThrow(/leave the cell/);expect(()=>use(s,'PASS_ROUND')).toThrow(/leave the cell/);
  const after=applyAction(s,{type:'DISCARD_EXIT',playerId:'p1',cardId:card.id,destination:destination(s)});
  expect(isInStartingRoom(after,after.players[0])).toBe(false);expect(after.players[0].actionTokens).toBe(0);expect(after.currentPlayerId).toBe('p2');
 });
 it('enforces the same exit when using the legacy Explore command',()=>{
  let s=fixture();inCell(s);s=use(s,'EXPLORE');expect(()=>use(s,'END_EXPLORE')).toThrow(/leave the cell/);
  s=applyAction(s,{type:'EXPLORE_STEP',playerId:'p1',destination:destination(s)});s=use(s,'END_EXPLORE');expect(s.currentPlayerId).toBe('p2');
 });
 it('allows the first Explore to be skipped, but the second must actually leave',()=>{
  let s=fixture();inCell(s);s.activation!.actionsUsed=0;
  s=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'});s=use(s,'SKIP_PHYSICAL_EFFECTS');
  expect(mustLeaveCell(s,s.players[0])).toBe(true);expect(()=>use(s,'END_ACTIVATION')).toThrow(/leave the cell/);
 });
 it.each(['empty','blocked'] as const)('does not deadlock an impossible exit (%s)',mode=>{
  const s=fixture(),p=inCell(s);
  if(mode==='empty'){p.actionTokens=0;p.hand=[];p.prepared={slot1:null,slot2:null,slot3:null,rapid:null};}
  else s.board.tiles=s.board.tiles.filter(h=>!areAdjacent(p.wizard.position,h));
  expect(mustLeaveCell(s,p)).toBe(false);expect(use(s,'END_ACTIVATION').currentPlayerId).toBe('p2');
 });
 it('requires leaving after a first-action defeat sends the acting mage back to their cell',()=>{
  const s=fixture();s.players[0].wizard.health=1;prepare(s,[moment.pain(1)],'SELF');
  const after=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p1'});
  expect(after.currentPlayerId).toBe('p1');expect(mustLeaveCell(after,after.players[0])).toBe(true);
  expect(()=>use(after,'END_ACTIVATION')).toThrow(/leave the cell/);
 });
 it('does not retain an impossible exit lock if an entry reaction defeats the mage after they moved out',()=>{
  let s=fixture();inCell(s);s.players[0].wizard.health=1;
  const trap:Card={id:s.library[0].cards.shift()!.id,name:'Lethal entry',kind:'SPELL',spellType:'TRAP',target:'MAGE',range:Infinity,moments:[moment.damage(1)],trigger:{event:'ENTER_ROOM',relation:'ENEMY',scope:'ANY'}};
  s.readiedSpells!.push({id:'entry-trap',playerId:'p2',card:trap});s.activeSpellOrder!.push('entry-trap');
  s=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'});s=use(s,'PERFORM_MOVEMENT');
  s=applyAction(s,{type:'EXPLORE_STEP',playerId:'p1',destination:destination(s)});expect(s.pendingDecision?.kind).toBe('REACTIVE_SPELL');
  s=applyAction(s,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:s.pendingDecision!.key,activeSpellId:'entry-trap',targetId:'p1'});
  expect(s.currentPlayerId).toBe('p2');expect(isInStartingRoom(s,s.players[0])).toBe(true);expect(s.activation!.mustExitCell).toBeUndefined();
 });
});

describe('ongoing spells survive defeat without stale-target damage',()=>{
 it.each(['p1','p2'] as const)('preserves ongoing identity when %s (owner or bound mage) is defeated',victim=>{
  const s=fixture(),card=catalog(s,'Pain Mark');s.ongoingSpells!.push({id:'persistent-mark',playerId:'p1',targetPlayerId:'p2',card});s.activeSpellOrder!.push('persistent-mark');
  s.players.find(p=>p.id===victim)!.wizard.health=1;
  prepare(s,[moment.damage(1)],'MAGE','p3');s.currentPlayerId='p3';s.activation!.playerId='p3';
  const after=applyAction(s,{type:'CAST_SPELL',playerId:'p3',slot:'rapid',targetPlayerId:victim});
  expect(after.ongoingSpells).toEqual(s.ongoingSpells);expect(after.activeSpellOrder).toContain('persistent-mark');
  expect(after.library[0].discard.some(c=>c.id===card.id)).toBe(false);expect(after.log.join(' ')).not.toContain('expires with');cubes(after);
 });
 it('keeps stale moments off the new life, then triggers from the same bound mage in a later action',()=>{
  const s=fixture(),card=catalog(s,'Pain Mark');s.ongoingSpells!.push({id:'mark',playerId:'p3',targetPlayerId:'p2',card});s.activeSpellOrder!.push('mark');
  s.players[1].wizard.health=1;prepare(s,[moment.damage(1),moment.damage(1)]);
  const after=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
  expect(after.players[1].wizard.damageCubes).toBe(0);expect(after.feedbackEvents!.filter(e=>e.kind==='MAGE_DEFEATED'&&e.target.id==='p2')).toHaveLength(1);
  // Start a later root action with the same surviving physical binding.
  after.players[1].wizard.health=10;after.players[1].wizard.position={q:0,r:0};after.currentPlayerId='p2';after.activation={...s.activation!,playerId:'p2'};
  prepare(after,[moment.damage(1)],'MAGE','p2');
  const later=applyAction(after,{type:'CAST_SPELL',playerId:'p2',slot:'rapid',targetPlayerId:'p4'});
  expect(later.players[1].wizard.damageCubes).toBe(2);expect(later.ongoingSpells![0].id).toBe('mark');cubes(later);
 });
 it('keeps a destroyed-evocation binding dormant rather than retargeting a new summon',()=>{
  const s=fixture(),e=summonEvocation(s,s.players[1],'CADAVER',{q:0,r:0})!,card=catalog(s,'Pain Mark');
  s.ongoingSpells!.push({id:'evocation-mark',playerId:'p3',targetEvocationId:e.id,card});s.activeSpellOrder!.push('evocation-mark');prepare(s,[moment.damage(2)],'EVOCATION');
  const after=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetEvocationId:e.id});expect(after.evocations).toEqual([]);expect(after.ongoingSpells).toEqual(s.ongoingSpells);
  const other=summonEvocation(after,after.players[1],'CADAVER',{q:0,r:0})!;expect(other.id).not.toBe(e.id);expect(after.ongoingSpells![0].targetEvocationId).toBe(e.id);
 });
 it('still retires the surviving ongoing card once at Cleanup',()=>{
  const s=fixture(),card=catalog(s,'Pain Mark');s.ongoingSpells!.push({id:'mark',playerId:'p1',targetPlayerId:'p2',card});s.activeSpellOrder!.push('mark');
  s.activation!.actionsUsed=1;for(const p of s.players){p.actionTokens=0;p.prepared={slot1:null,slot2:null,slot3:null,rapid:null};}
  const after=use(s,'END_ACTIVATION');expect(after.phase).toBe('CLEANUP');expect(after.ongoingSpells).toEqual([]);expect(after.library[0].discard.filter(c=>c.id===card.id)).toHaveLength(1);
 });
});

describe('Chronicle records public cards and their ordered moments, not face-down details',()=>{
 it('logs the played card followed by its repeated, numbered moments and actual results',()=>{
  const s=fixture();prepare(s,[moment.damage(1),moment.damage(2)]);
  const after=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'}),entries=after.log;
  const cast=entries.findIndex(line=>line.includes('casts Test spell')),first=entries.findIndex(line=>line.includes('Moment 1/2 · Test spell: Deal 1 damage')),
   second=entries.findIndex(line=>line.includes('Moment 2/2 · Test spell: Deal 2 damage'));
  expect(cast).toBeGreaterThanOrEqual(0);expect(first).toBeGreaterThan(cast);expect(second).toBeGreaterThan(first);expect(after.players[1].wizard.damageCubes).toBe(3);
 });
 it('hides a trap name and moments on activation, then logs them only after reveal',()=>{
  let s=fixture();const card=catalog(s,'Torment');s.players[0].prepared.rapid={card,used:false};
  s=applyAction(s,{type:'ACTIVATE_SPELL',playerId:'p1',slot:'rapid'});expect(s.log.join(' ')).not.toContain('Torment');
  s.currentPlayerId='p2';s.activation={...s.activation!,playerId:'p2',actionsUsed:0};prepare(s,[moment.damage(1)],'MAGE','p2');
  s=applyAction(s,{type:'CAST_SPELL',playerId:'p2',slot:'rapid',targetPlayerId:'p3'});expect(s.pendingDecision?.kind).toBe('REACTIVE_SPELL');expect(s.log.join(' ')).not.toContain('Torment');
  s=applyAction(s,{type:'RESPOND_REACTIVE_SPELL',playerId:'p1',key:s.pendingDecision!.key,activeSpellId:s.readiedSpells![0].id,targetId:'p2'});
  expect(s.log.some(line=>line.includes('reveals Torment'))).toBe(true);expect(s.log.some(line=>line.includes('Moment 1/2 · Torment'))).toBe(true);expect(s.log.some(line=>line.includes('Moment 2/2 · Torment'))).toBe(true);
 });
});

describe('Pink Tulip only counts unsolved quests when issuing replacements',()=>{
 it.each(['none','solved-only','completed-unsolved','incomplete','solved-and-additional'] as const)('handles %s without duplicating cards or losing a free reward',mode=>{
  const s=fixture();s.phase='BLACK_ROSE';s.activation=null;s.currentPlayerId=null;const p=s.players[0],quest=s.questDeck.shift()!;
  if(mode!=='none')p.quest=quest;else s.questDeck.push(quest);
  if(mode==='solved-only'||mode==='solved-and-additional')Object.assign(quest,{completed:true,claimed:true});
  if(mode==='completed-unsolved')Object.assign(quest,{completed:true,claimed:false});
  let additional:Quest|undefined;
  if(mode==='solved-and-additional'){additional=s.questDeck.shift()!;p.additionalQuests.push(additional);}
  const after=applyAction(s,{type:'ADVANCE_PHASE',playerId:s.hostId,expectedPhase:'BLACK_ROSE',expectedRound:s.round});
  expect(after.players[0].quest).toBeTruthy();expect(after.players[0].quest!.claimed).toBe(false);
  if(mode==='completed-unsolved'||mode==='incomplete')expect(after.players[0].quest).toEqual(quest);
  if(mode==='solved-and-additional')expect(after.players[0].quest!.id).toBe(additional!.id);
  if(mode==='solved-only')expect(after.players[0].quest!.id).not.toBe(quest.id);
  const held=after.players.flatMap(p=>[...(p.quest?[p.quest]:[]),...p.additionalQuests]);const ids=[...after.questDeck,...after.questDiscard,...held].map(q=>q.id);
  expect(ids).toHaveLength(24);expect(new Set(ids).size).toBe(24);
 });
});

describe('Peak of Agony: range-2 room damage, caster conversion, then Pain 2',()=>{
 it('prints three independently targeted moments in the required order',()=>{
  const card=catalog(fixture(),'Peak of Agony');expect(card.target).toBe('ROOM');expect(card.range).toBe(2);
  expect(card.moments).toEqual([{effect:'DAMAGE',amount:2},{effect:'BLACK_ROSE_CONVERT',amount:2,scope:'CASTER'},{effect:'PAIN',amount:2}]);
 });
 it.each(['flat','scoped','friendly'] as const)('upgrades the old %s Peak without overwriting other customized definitions',format=>{
  const s=fixture(),card=catalog(s,'Peak of Agony');card.target='SELF';card.range=0;
  card.moments=format==='flat'?[moment.damage(2),moment.blackRoseConvert(2)]:[{effect:'DAMAGE',amount:2,scope:'CASTER_ROOM',...(format==='friendly'?{includeFriendly:true}:{})} as Moment,{effect:'BLACK_ROSE_CONVERT',amount:2,scope:'CASTER'}];
  s.players[0].prepared.rapid={used:false,card};const restored:GameState=JSON.parse(JSON.stringify(s));upgradeLegacyCards(restored);
  expect(restored.players[0].prepared.rapid!.card).toEqual({...catalog(fixture(),'Peak of Agony'),id:card.id});
  const copy=structuredClone(restored);upgradeLegacyCards(restored);expect(restored).toEqual(copy);
  card.moments=[moment.damage(3)];const custom=structuredClone(card);upgradeLegacyCards(card);expect(card).toEqual(custom);
 });
 it('damages only enemies in the chosen room at range 2, not the caster’s room or friendly evocations',()=>{
  const s=fixture();s.players[1].wizard.position={q:2,r:0};s.players[3].wizard.position={q:1,r:0};
  const own=summonEvocation(s,s.players[0],'CADAVER',{q:2,r:0})!,enemy=summonEvocation(s,s.players[1],'CADAVER',{q:2,r:0})!,outside=summonEvocation(s,s.players[2],'CADAVER',{q:0,r:0})!;
  const after=peak(s,'room-2,0');expect(after.players.map(p=>p.wizard.damageCubes)).toEqual([2,2,0,0]);
  expect(after.evocations.map(e=>e.id)).toEqual([own.id,outside.id]);
  expect(after.feedbackEvents!.filter(e=>e.kind==='DAMAGE'&&e.sourceId==='p1').map(e=>e.target.id)).toEqual(['p2',enemy.id]);
  expect(after.players[0].wizard.blackDamage).toBe(2);cubes(after);
 });
 it('never deals friendly player damage even when the selected room contains the caster',()=>{
  const s=fixture(),own=summonEvocation(s,s.players[0],'CADAVER',{q:0,r:0})!;const after=peak(s);
  expect(after.players[0].wizard.damageByPlayer).toEqual({});expect(after.players[0].wizard.blackDamage).toBe(2);
  expect(after.evocations.find(e=>e.id===own.id)!.damageCubes).toBe(0);cubes(after);
 });
 it('converts the newest two foreign cubes, skips self/black wounds and returns colored supply before Pain',()=>{
  const s=fixture();s.players[0].wizard.health=20;wound(s,0,['p2','p3','p2','black-rose','p1','p4']);wound(s,1,['p3']);
  const after=peak(s),p=after.players[0];expect(p.wizard.damageCubes).toBe(8);expect(p.wizard.blackDamage).toBe(5);
  expect(p.wizard.damageOrder).toEqual(['p2','p3','black-rose','black-rose','p1','black-rose','black-rose','black-rose']);
  expect(p.wizard.damageByPlayer).toEqual({p2:1,p3:1,p1:1});expect(after.players[1].wizard.damageByPlayer).toEqual({p3:1,p1:2});
  const events=after.feedbackEvents!,convert=events.findIndex(e=>e.kind==='CONVERT');expect(events[convert]).toMatchObject({target:{id:'p1'},amount:2,total:6});
  expect(events.slice(convert+1).filter(e=>e.kind==='DAMAGE')).toMatchObject([{target:{id:'p1'},sourceId:'black-rose',amount:2}]);cubes(after);
 });
 it.each([0,1])('converts only the %s available foreign cubes and still applies Pain 2',foreign=>{
  const s=fixture();wound(s,0,[...Array<string>(foreign).fill('p2'),'p1','black-rose']);const after=peak(s);
  expect(after.players[0].wizard.damageCubes).toBe(foreign+4);expect(after.players[0].wizard.blackDamage).toBe(foreign+3);
  expect(after.players[0].wizard.damageByPlayer).toEqual({p1:1});cubes(after);
 });
 it.each(['room-1,1','room-2,-1','room-3,-2'])('rejects off-axis, distant or protected target %s atomically',roomId=>{
  const s=fixture(),card=catalog(s,'Peak of Agony');s.players[0].prepared.rapid={used:false,card};const before=structuredClone(s);
  expect(()=>applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId})).toThrow(/range|Starting rooms/);expect(s).toEqual(before);
 });
 it('rejects a room farther than 2 along an axis and still accepts empty rooms',()=>{
  const s=fixture();s.players[0].wizard.position={q:-1,r:0};const card=catalog(s,'Peak of Agony');s.players[0].prepared.rapid={used:false,card};
  expect(()=>applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-2,0'})).toThrow(/out of range/);
  const after=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-1,0'});expect(after.players[0].wizard.blackDamage).toBe(2);cubes(after);
 });
 it('fully resolves room damage and its reactions before conversion, including after JSON replay',()=>{
  const s=fixture();wound(s,0,['p3','p4']);
  const ward:Card={id:s.library[0].cards.shift()!.id,name:'Reaction ward',kind:'SPELL',target:'SELF',range:0,spellType:'PROTECTION',moments:[moment.heal(1)],trigger:{event:'DAMAGE_TAKEN',relation:'ENEMY',scope:'BOUND_MODEL'}};
  s.readiedSpells!.push({id:'ward',playerId:'p2',card:ward});s.activeSpellOrder!.push('ward');const paused=peak(s);
  expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL');const restored:GameState=JSON.parse(JSON.stringify(paused));upgradeLegacyCards(restored);
  const after=applyAction(restored,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:paused.pendingDecision!.key,activeSpellId:'ward',targetId:'p2'});
  const events=after.feedbackEvents!,reaction=events.findIndex(e=>e.kind==='SPELL_TRIGGERED'),converted=events.findIndex(e=>e.kind==='CONVERT');
  expect(events.slice(0,reaction).filter(e=>e.kind==='DAMAGE')).toHaveLength(3);expect(converted).toBeGreaterThan(reaction);
  expect(after.players[0].wizard).toMatchObject({damageCubes:4,blackDamage:4,damageByPlayer:{}});cubes(after);
 });
 it('converts wounds from a first-moment Pain Mark reaction before older damage',()=>{
  const s=fixture();s.players[1].wizard.position={q:2,r:0};wound(s,0,['p2','p4']);const card=catalog(s,'Pain Mark');
  s.ongoingSpells!.push({id:'mark',playerId:'p3',targetPlayerId:'p1',card});s.activeSpellOrder!.push('mark');const after=peak(s,'room-2,0');
  expect(after.players[0].wizard).toMatchObject({damageCubes:6,blackDamage:4,damageByPlayer:{p2:1,p4:1},damageOrder:['p2','p4','black-rose','black-rose','black-rose','black-rose']});cubes(after);
 });
 it.each([true,false])('offers Soul Tithe only for the final neutral Pain, after caster conversion (accept=%s)',accept=>{
  const s=fixture(),succubus=summonEvocation(s,s.players[0],'SUCCUBUS',{q:0,r:0})!;wound(s,0,['p3','p4']);
  const paused=peak(s);expect(paused.pendingDecision?.kind).toBe('SOUL_TITHE');const restored:GameState=JSON.parse(JSON.stringify(paused));upgradeLegacyCards(restored);
  const after=applyAction(restored,{type:'RESPOND_SOUL_TITHE',playerId:'p1',accept});
  expect(after.players[0].wizard.blackDamage).toBe(accept?3:4);expect(after.evocations.find(e=>e.id===succubus.id)!.damageCubes).toBe(accept?1:0);
  expect(after.feedbackEvents!.find(e=>e.kind==='CONVERT')).toMatchObject({target:{id:'p1'},amount:2,total:2});cubes(after);
 });
 it('converts before a lethal final Pain and scores the resulting neutral damage correctly',()=>{
  const s=fixture();s.players[0].wizard.health=4;wound(s,0,['p2','p2']);const after=peak(s);
  expect(isInStartingRoom(after,after.players[0])).toBe(true);expect(after.players[0].wizard.damageCubes).toBe(0);expect(after.blackRose.kills).toBe(1);
  expect(after.feedbackEvents!.find(e=>e.kind==='MAGE_DEFEATED'&&e.target.id==='p1')).toMatchObject({contributions:{'black-rose':4},sourceId:'black-rose'});
  expect(after.players[0].trophies).not.toContain('p1');cubes(after);
 });
 it('does not convert a respawned life after a first-moment reaction defeats the caster',()=>{
  const s=fixture();s.players[0].wizard.health=2;s.players[1].wizard.position={q:2,r:0};
  const card=catalog(s,'Pain Mark');s.ongoingSpells!.push({id:'mark',playerId:'p3',targetPlayerId:'p1',card});s.activeSpellOrder!.push('mark');
  const after=peak(s,'room-2,0');expect(after.feedbackEvents!.filter(e=>e.kind==='CONVERT')).toEqual([]);
  expect(after.feedbackEvents!.findIndex(e=>e.kind==='MAGE_DEFEATED'&&e.sourceId==='p3')).toBeGreaterThanOrEqual(0);cubes(after);
 });
});