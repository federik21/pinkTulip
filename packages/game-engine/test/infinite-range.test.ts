import { describe, expect, it } from 'vitest';
import { applyAction, createAgonyDeck, createGame, hexLineDistance, isWithinSpellRange, moment, summonEvocation, upgradeLegacyCards } from '../src';
import type { Card, GameAction, GameState, Hex } from '../src';

const offAxis: Hex[] = [{q:1,r:-2},{q:-1,r:-1},{q:2,r:-1},{q:-2,r:1},{q:1,r:1},{q:-1,r:2}];
const modes = ['ROOM','DUMMY','MAGE','EVOCATION'] as const;
type Mode = typeof modes[number];

function fixture(mode:Mode='ROOM',position:Hex={q:1,r:1},range=Number.POSITIVE_INFINITY) {
 const game=createGame(2);game.phase='ACTION';game.round=1;game.currentPlayerId='p1';game.firstPlayerId='p1';
 game.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of game.players){p.connected=true;p.wizard.position={q:0,r:0};}
 game.players[1].wizard.position={...position};
 const card:Card={id:'infinite',name:'Infinite spell',kind:'SPELL',spellType:'COMBAT',target:mode==='ROOM'?'ROOM':'MODEL',range,moments:[moment.instability(1),moment.damage(1)]};
 game.players[0].prepared.slot1={card,used:false};
 const evocation=mode==='EVOCATION'?summonEvocation(game,game.players[1],'CADAVER',position):undefined;
 const targeting=mode==='ROOM'?{roomId:`room-${position.q},${position.r}`}:
  mode==='DUMMY'?{roomId:`room-${position.q},${position.r}`,dummy:true}:
  mode==='MAGE'?{targetPlayerId:'p2'}:{targetEvocationId:evocation!.id};
 const action:GameAction={type:'CAST_SPELL',playerId:'p1',slot:'slot1',...targeting};
 return {game,action,card};
}

function roundTrip(game:GameState):GameState {
 const restored:GameState=JSON.parse(JSON.stringify(game));
 upgradeLegacyCards(restored);
 return restored;
}

describe('infinite range ignores distance and line of sight',()=>{
 for(const mode of modes) {
  it.each(offAxis)(`allows off-axis ${mode} at $q,$r after JSON transport`,position=>{
   const {game,action}=fixture(mode,position),restored=roundTrip(game),before=structuredClone(restored);
   expect(hexLineDistance(game.players[0].wizard.position,position)).toBe(Number.POSITIVE_INFINITY);
   expect(restored.players[0].prepared.slot1!.card.range).toBe(Number.POSITIVE_INFINITY);
   const result=applyAction(restored,action);
   expect(restored).toEqual(before);
   expect(result.players[0].prepared.slot1?.used).toBe(true);
   expect(result.board.rooms.find(r=>r.id===`room-${position.q},${position.r}`)!.instability).toBe(1);
   expect(result.players[1].wizard.damageCubes).toBe(mode==='ROOM'||mode==='MAGE'?1:0);
   if(mode==='EVOCATION')expect(result.evocations[0].damageCubes).toBe(1);
  });

  it(`retains finite-range line of sight for ${mode}`,()=>{
   const {game,action}=fixture(mode,{q:1,r:1},4),restored=roundTrip(game),before=structuredClone(restored);
   expect(()=>applyAction(restored,action)).toThrow(/out of range/);
   expect(restored).toEqual(before);
  });

  it(`retains starting-room protection for infinite-range ${mode}`,()=>{
   const {game}=fixture(mode),start=game.board.rooms.find(r=>r.startingFor==='p2')!;
   game.players[1].wizard.position={...start.tiles[0]};
   if(mode==='EVOCATION')game.evocations[0].position={...start.tiles[0]};
   const action:GameAction={type:'CAST_SPELL',playerId:'p1',slot:'slot1',...(mode==='ROOM'?{roomId:start.id}:
    mode==='DUMMY'?{roomId:start.id,dummy:true}:mode==='MAGE'?{targetPlayerId:'p2'}:{targetEvocationId:game.evocations[0].id})};
   const restored=roundTrip(game),before=structuredClone(restored);
   expect(()=>applyAction(restored,action)).toThrow(/starting room/i);
   expect(restored).toEqual(before);
  });
 }

 it('has no distance or alignment limit, while finite range still checks both',()=>{
  expect(isWithinSpellRange({q:-8,r:3},{q:18,r:19},Number.POSITIVE_INFINITY)).toBe(true);
  expect(isWithinSpellRange({q:0,r:0},{q:1,r:1},100)).toBe(false);
  expect(isWithinSpellRange({q:0,r:0},{q:5,r:0},4)).toBe(false);
  expect(isWithinSpellRange({q:0,r:0},{q:4,r:0},4)).toBe(true);
  expect(isWithinSpellRange({q:0,r:0},{q:0,r:0},0)).toBe(true);
 });

 it.each(['ROOM','MAGE'] as const)('restores nested infinite-range %s quest rewards on reload',mode=>{
  const {game,card}=fixture(mode);
  game.players[0].quest={...game.questDeck[0],id:'global-reward',completed:true,claimed:false,reward:0,rewardAction:card};
  const result=applyAction(roundTrip(game),{type:'USE_QUEST_REWARD',playerId:'p1',questId:'global-reward',...(mode==='ROOM'?{roomId:'room-1,1'}:{targetPlayerId:'p2'})});
  expect(result.board.rooms.find(r=>r.id==='room-1,1')!.instability).toBe(1);
  expect(result.players[1].wizard.damageCubes).toBe(1);
  expect(result.players[0].questsCompleted).toBe(1);
  expect(result.activation?.actionsUsed).toBe(0);
 });

 it('offers every non-starting room for infinite-range reactive spells after reload and replay',()=>{
  const {game}=fixture('MAGE',{q:0,r:0});game.players[1].wizard.health=1;
    const card:Card={id:'global-trap-card',name:'Choose any room',kind:'SPELL',spellType:'TRAP',target:'ROOM',range:Infinity,moments:[],
      trigger:{event:'MAGE_DEFEATED',relation:'ANY',scope:'ANY'},triggerEffects:[{effect:'SUMMON',kind:'SUCCUBUS',position:'TARGET',target:'BOUND_ROOM'}]};
  game.readiedSpells=[{id:'global-trap',playerId:'p1',card}];game.activeSpellOrder=['global-trap'];
  const prompt=applyAction(roundTrip(game),{type:'CAST_SPELL',playerId:'p1',slot:'slot1',targetPlayerId:'p2'});
  const decision=prompt.pendingDecision;
  expect(decision?.kind).toBe('REACTIVE_SPELL');
  if(decision?.kind!=='REACTIVE_SPELL')throw new Error('Expected reactive target selection');
  expect(decision.options[0].targets.map(t=>t.id).sort()).toEqual(game.board.rooms.filter(r=>!r.startingFor).map(r=>r.id).sort());
  const restored=roundTrip(prompt);
  const result=applyAction(restored,{type:'RESPOND_REACTIVE_SPELL',playerId:'p1',key:decision.key,activeSpellId:'global-trap',targetId:'room-1,1'});
  expect(result.evocations[0]).toMatchObject({kind:'SUCCUBUS',playerId:'p1',position:{q:1,r:1}});
  expect(result.pendingDecision).toBeUndefined();
 });

 it('normalizes only null spell ranges and is idempotent',()=>{
  const cards=createAgonyDeck('test');
  const payload=JSON.parse(JSON.stringify({cards,other:{range:null},missing:{kind:'SPELL',moments:[]}}));
  upgradeLegacyCards(payload);
  expect(payload.cards).toEqual(cards);
  expect(payload.other.range).toBeNull();
  expect(payload.missing).not.toHaveProperty('range');
  const before=structuredClone(payload);upgradeLegacyCards(payload);expect(payload).toEqual(before);
 });
});