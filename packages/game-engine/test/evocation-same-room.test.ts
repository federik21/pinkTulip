import { describe, expect, it } from 'vitest';
import { applyAction, areInSameRoom, createGame, hexDistance } from '../src';
import type { Evocation, GameAction, GameState, Hex } from '../src';

const origin:Hex={q:0,r:0};
const model=(id:string,playerId:string,position:Hex=origin):Evocation=>({
 id,playerId,name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:2,
 passive:'WOUNDED_FURY',position:{...position},damageCubes:0,damageByPlayer:{},activated:false,
});
type Target='mage'|'evocation';
const targetId=(target:Target)=>target==='mage'?'p2':'victim';
function targetPosition(game:GameState,target:Target,position:Hex) {
 if(target==='mage')game.players[1].wizard.position={...position};
 else game.evocations.find(e=>e.id==='victim')!.position={...position};
}
function fixture(phase:'ACTION'|'EVOCATION') {
 const game=createGame(3);game.round=1;game.phase=phase;game.currentPlayerId='p1';
 game.activation=phase==='ACTION'?{playerId:'p1',actionsUsed:0,exploring:0,
  sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false}:null;
 for(const player of game.players) {
  player.wizard.position={...origin};
  if(phase==='EVOCATION')player.actionTokens=0;
 }
 game.evocations=[model('attacker','p1'),model('friendly','p1'),model('victim','p2'),model('next','p2')];
 game.evocations[2].health=5;
 return game;
}
const activate=(game:GameState)=>applyAction(game,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'attacker'});
const attack=(target:Target):GameAction=>({type:'EVOCATION_ATTACK',playerId:'p1',targetId:targetId(target)});
const step=(position:Hex):GameAction=>({type:'EVOCATION_STEP',playerId:'p1',destination:position});
function rejected(game:GameState,action:GameAction,error:RegExp) {
 const before=structuredClone(game);
 expect(()=>applyAction(game,action)).toThrow(error);expect(game).toEqual(before);
}
function cubesConserved(game:GameState) {
 for(const player of game.players) {
  expect(player.cubes.available+player.cubes.onWizard+player.cubes.onEvocations+player.cubes.onBoard).toBe(25);
  expect(player.cubes.onWizard).toBe(game.players.reduce((n,p)=>n+(p.wizard.damageByPlayer[player.id]??0),0));
  expect(player.cubes.onEvocations).toBe(game.evocations.reduce((n,e)=>n+(e.damageByPlayer[player.id]??0),0));
  expect(player.cubes.onBoard).toBe(game.board.rooms.filter(r=>!r.scored).reduce((n,r)=>n+(r.cubesByPlayer[player.id]??0),0));
 }
}
function sharedRoom(game:GameState,position:Hex) {
 const room=game.board.rooms.find(r=>r.tiles.some(h=>h.q===origin.q&&h.r===origin.r))!;
 const other=game.board.rooms.find(r=>r.tiles.some(h=>h.q===position.q&&h.r===position.r))!;
 game.board.rooms=game.board.rooms.filter(r=>r!==other);
 room.tiles.push({...position});
}

describe('areInSameRoom shared room membership',()=>{
 it('accepts a board-only view and equal coordinates in a known room without mutation',()=>{
  const game=createGame(),view:Pick<GameState,'board'>={board:game.board},before=structuredClone(view);
  expect(areInSameRoom(view,origin,{...origin})).toBe(true);expect(view).toEqual(before);
 });
 it.each([1,2])('rejects different rooms at hex distance %i in either argument order',distance=>{
  const game=createGame(),other={q:distance,r:0};
  expect(areInSameRoom(game,origin,other)).toBe(false);expect(areInSameRoom(game,other,origin)).toBe(false);
 });
 it.each([1,2])('accepts distinct tiles at distance %i belonging to one room in either order',distance=>{
  const game=createGame(),other={q:distance,r:0};sharedRoom(game,other);
  expect(hexDistance(origin,other)).toBe(distance);
  expect(areInSameRoom(game,origin,other)).toBe(true);expect(areInSameRoom(game,other,origin)).toBe(true);
 });
 it('does not infer a room from equal unknown coordinates, board.tiles, IDs or an empty room',()=>{
  const game=createGame(),unknown={q:99,r:99};game.board.tiles.push(unknown);
  expect(areInSameRoom(game,unknown,{...unknown})).toBe(false);
  expect(areInSameRoom(game,origin,unknown)).toBe(false);
  game.board.rooms.find(r=>r.id==='room-0,0')!.tiles=[];
  expect(areInSameRoom(game,origin,{...origin})).toBe(false);
 });
});

describe.each(['ACTION','EVOCATION'] as const)('%s authoritative evocation combat',phase=>{
 describe.each(['mage','evocation'] as const)('enemy %s targets',target=>{
  it('attacks a co-located enemy, attributes damage/cubes, and finishes when unused movement is skipped',()=>{
   const initial=fixture(phase),before=structuredClone(initial),active=activate(initial);
   expect(initial).toEqual(before);
   expect(active.players[0].actionTokens).toBe(phase==='ACTION'?1:0);
   expect(active.evocations[0].activated).toBe(phase==='EVOCATION');
  const activeBefore=structuredClone(active),attacked=applyAction(active,attack(target));
  expect(attacked.evocationActivation).toMatchObject({attackUsed:true,movesRemaining:2});
  const result=applyAction(attacked,{type:'END_EVOCATION_MOVEMENT',playerId:'p1'});
   expect(active).toEqual(activeBefore);expect(result.evocationActivation).toBeNull();
   const victim=target==='mage'?result.players[1].wizard:result.evocations.find(e=>e.id==='victim')!;
   expect(victim.damageCubes).toBe(2);expect(victim.damageByPlayer).toEqual({p1:2});
   expect(result.players[0].cubes).toEqual({available:23,onWizard:target==='mage'?2:0,onEvocations:target==='evocation'?2:0,onBoard:0});
   expect(result.players[0]).toMatchObject({kills:0,questsCompleted:0,victoryPoints:0});
   expect(result.currentPlayerId).toBe(phase==='ACTION'?'p1':'p2');
   if(phase==='ACTION')expect(result.activation?.actionsUsed).toBe(1);
   expect(result.board).toEqual(before.board);expect(result.library).toEqual(before.library);
   rejected(result,attack(target),/No active evocation/);
   rejected(result,step({q:1,r:0}),/No active evocation/);cubesConserved(result);
  });

  it.each([1,2])('rejects a different room at distance %i without changing any state',distance=>{
   const initial=fixture(phase);targetPosition(initial,target,{q:distance,r:0});
   const game=activate(initial);
   rejected(game,attack(target),/^Target must be in the same room$/);
   expect(game.evocationActivation?.movesRemaining).toBe(2);cubesConserved(game);
  });

  it('moves two adjacent steps into the enemy room, then attacks with no movement left',()=>{
   const initial=fixture(phase);targetPosition(initial,target,{q:2,r:0});
   let game=activate(initial);const mageBefore=structuredClone(game.players[0]);
   rejected(game,attack(target),/^Target must be in the same room$/);
   rejected(game,step({q:2,r:0}),/adjacent/);
   game=applyAction(game,step({q:1,r:0}));
   rejected(game,attack(target),/^Target must be in the same room$/);
   game=applyAction(game,step({q:2,r:0}));
   expect(game.evocationActivation?.movesRemaining).toBe(0);expect(game.players[0]).toEqual(mageBefore);
   rejected(game,step({q:1,r:0}),/No evocation movement remaining/);
   game=applyAction(game,attack(target));expect(game.evocationActivation).toBeNull();
   expect(game.evocations[0].position).toEqual({q:2,r:0});cubesConserved(game);
  });

  it.each([1,2])('accepts distinct same-room hexes at distance %i without changing movement rules',distance=>{
   const initial=fixture(phase),position={q:distance,r:0};sharedRoom(initial,position);targetPosition(initial,target,position);
   let game=activate(initial);
   if(distance===2)rejected(game,step(position),/adjacent/);
  game=applyAction(game,attack(target));expect(game.evocationActivation).toMatchObject({attackUsed:true,movesRemaining:2});
  game=applyAction(game,{type:'END_EVOCATION_MOVEMENT',playerId:'p1'});expect(game.evocationActivation).toBeNull();
   const victim=target==='mage'?game.players[1].wizard:game.evocations.find(e=>e.id==='victim')!;
   expect(victim.damageCubes).toBe(2);cubesConserved(game);
  });

  it('preserves starting-room protection before the same-room check for every protected room',()=>{
   const initial=fixture(phase);
   for(const start of initial.board.rooms.filter(r=>r.startingFor)) {
    for(const sameRoom of [false,true]) {
     const game=structuredClone(initial);targetPosition(game,target,start.tiles[0]);
     // Even a forged attacker sharing the protected room must not bypass protection.
     if(sameRoom)game.evocations[0].position={...start.tiles[0]};
     rejected(activate(game),attack(target),/^Cannot target a model in its starting room$/);
    }
   }
  });

   it.each([0,1,25])('preserves base Cadaver damage when wounded with %i available cubes and attributes only supplied cubes',available=>{
     const initial=fixture(phase),owner=initial.players[0];
     initial.evocations[0].damageCubes=1;initial.evocations[0].damageByPlayer={p2:1};
     initial.players[1].cubes.available--;initial.players[1].cubes.onEvocations++;
     owner.cubes.available=available;owner.cubes.onBoard=25-available;
     let remaining=owner.cubes.onBoard;
     for(const room of initial.board.rooms.filter(r=>!r.startingFor)) {
        const placed=Math.min(remaining,room.instabilityLimit);
        room.instability=placed;if(placed)room.cubesByPlayer={p1:placed};remaining-=placed;
     }
     expect(remaining).toBe(0);cubesConserved(initial);
     const result=applyAction(activate(initial),attack(target));
     const victim=target==='mage'?result.players[1].wizard:result.evocations.find(e=>e.id==='victim')!;
   expect(victim.damageCubes).toBe(2);
   expect(victim.damageByPlayer).toEqual(available?{p1:Math.min(2,available)}:{});
   expect(result.players[0].cubes.available).toBe(Math.max(0,available-2));
   expect(result.players[0].cubes[target==='mage'?'onWizard':'onEvocations']).toBe(Math.min(2,available));
     cubesConserved(result);
    });

    it('caps overkill to remaining health and returns all victim contributor cubes without disturbing other wounds',()=>{
   const initial=fixture(phase),[owner,,contributor]=initial.players;
   initial.evocations[0].damageCubes=1;initial.evocations[0].damageByPlayer={p2:1};
   initial.players[1].cubes.available--;initial.players[1].cubes.onEvocations++;
   owner.quest={id:'kill',name:'Kill',description:'Defeat a mage',kind:'KILL',amount:1,reward:3};
   if(target==='mage') {
    initial.players[1].wizard.damageCubes=9;initial.players[1].wizard.damageByPlayer={p3:9};
    contributor.cubes.onWizard=9;
   } else {
    const victim=initial.evocations.find(e=>e.id==='victim')!;
    victim.health=2;victim.damageCubes=1;victim.damageByPlayer={p3:1};contributor.cubes.onEvocations=1;
   }
   contributor.cubes.available-=target==='mage'?9:1;cubesConserved(initial);
   const result=applyAction(activate(initial),attack(target));
   expect(result.evocations[0].damageCubes).toBe(1);expect(result.players[1].cubes.onEvocations).toBe(1);
   expect(result.players[2].cubes).toEqual({available:25,onWizard:0,onEvocations:0,onBoard:0});
   expect(result.players[0].cubes).toEqual({available:25,onWizard:0,onEvocations:0,onBoard:0});
   expect(result.players[0]).toMatchObject(target==='mage'?{kills:1,questsCompleted:1,victoryPoints:5}:{kills:0,questsCompleted:0,victoryPoints:0});
   if(target==='mage') {
    expect(result.players[1].wizard).toMatchObject({damageCubes:0,damageByPlayer:{},position:{q:-3,r:2}});
    expect(result.players[0].quest).toBeNull();expect(result.questDiscard.map(q=>q.id)).toContain('kill');
   } else {
    expect(result.evocations.some(e=>e.id==='victim')).toBe(false);expect(result.players[0].quest?.id).toBe('kill');
   }
   expect(result.log.some(line=>line.includes('suffers 1 damage'))).toBe(true);cubesConserved(result);
  });
 });

 it('accepts a wizard ID as well as a player ID',()=>{
  const game=activate(fixture(phase));
  const result=applyAction(game,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2-wizard'});
  expect(result.players[1].wizard.damageByPlayer).toEqual({p1:2});cubesConserved(result);
 });

 it('validates all friendly targets before either protection or room range',()=>{
  for(const position of [origin,{q:2,r:0},{q:3,r:-2}]) {
   const initial=fixture(phase);initial.evocations.find(e=>e.id==='friendly')!.position={...position};
   // A mage may control a free model while protected; activate paid models before moving the fixture mage.
   const game=activate(initial);game.players[0].wizard.position={...position};
   for(const id of ['p1','p1-wizard','friendly','attacker']) {
    rejected(game,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:id},/^Evocations cannot damage their mage or friendly evocations$/);
   }
  }
 });

 it('defers a capped paid turn handoff until attack and movement finish; free activations alternate owners',()=>{
  const initial=fixture(phase);
  if(phase==='ACTION')initial.activation!.actionsUsed=1;
  let game=activate(initial);expect(game.currentPlayerId).toBe('p1');
  game=applyAction(game,attack('mage'));
  expect(game.currentPlayerId).toBe('p1');
  game=applyAction(game,{type:'END_EVOCATION_MOVEMENT',playerId:'p1'});
  expect(game.currentPlayerId).toBe('p2');expect(game.evocationActivation).toBeNull();
  expect(game.activation?.actionsUsed).toBe(phase==='ACTION'?0:undefined);cubesConserved(game);
 });
});