import { describe, expect, expectTypeOf, it } from 'vitest';
import { applyAction, canPassActionPhase, canPlayerAct, createGame, hexDistance } from '../src';
import type { Activation, GameAction, GameState, PhysicalAction, Player, RoomEffect, Wizard } from '../src';

const player=(g:GameState,id='p1')=>g.players.find(p=>p.id===id)!;
const room=(g:GameState,id:string)=>g.board.rooms.find(r=>r.id===id)!;
const advance=(g:GameState)=>applyAction(g,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:g.phase,expectedRound:g.round});
const begin=(g:GameState,kind:PhysicalAction['kind']='EXPLORE',playerId='p1')=>applyAction(g,{type:'BEGIN_PHYSICAL_ACTION',playerId,kind});
const skip=(g:GameState,playerId='p1')=>applyAction(g,{type:'SKIP_PHYSICAL_EFFECTS',playerId});
const activateRoom=(g:GameState,roomTargetId?:string)=>applyAction(g,{type:'ACTIVATE_ROOM',playerId:'p1',roomTargetId});
const move=(g:GameState)=>applyAction(g,{type:'PERFORM_MOVEMENT',playerId:'p1'});
const attack=(g:GameState,targetId='p2')=>applyAction(g,{type:'INFLICT_ATTACK',playerId:'p1',targetId});
function rejected(g:GameState,action:GameAction,error?:RegExp) {
 const before=structuredClone(g);expect(()=>applyAction(g,action)).toThrow(error);expect(g).toEqual(before);
}
function actionFixture(effect:RoomEffect='DRAW_GRIMOIRE') {
 const g=createGame();g.phase='ACTION';g.round=1;g.currentPlayerId='p1';
 g.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false,physicalAction:null};
 const source=g.board.rooms.find(r=>r.effect===effect)!;
 for(const p of g.players)p.wizard.position={...source.tiles[0]};
 return g;
}
function preparationFixture(handSize=8) {
 const g=createGame();g.phase='PREPARATION';
 player(g).hand.push(...player(g).personalDeck.splice(0,handSize));return g;
}
function prepareAction(g:GameState,playerId='p1'):GameAction {
 const cards=player(g,playerId).hand;
 return {type:'PREPARE_CARDS',playerId,preparedCardIds:cards.slice(0,3).map(c=>c.id),rapidCardId:cards[3].id};
}
function blackRoseFixture(counts=[3,4]) {
 const g=createGame();g.phase='BLACK_ROSE';g.round=1;
 for(const [i,count] of counts.entries()) {
  const quests=g.questDeck.splice(0,count);g.players[i].quest=quests.shift()??null;g.players[i].additionalQuests=quests;
 }
 return g;
}
const heldQuests=(p:Player)=>p.quest?[p.quest,...p.additionalQuests]:p.additionalQuests;
function cards(g:GameState) {
 return [...g.powerfulDeck,...g.removedCards,...g.library.flatMap(d=>[...d.cards,...d.discard]),...g.players.flatMap(p=>[...p.hand,...p.discard,...p.personalDeck,...Object.values(p.prepared).filter(c=>c&&!c.used).map(c=>c!.card)])];
}
function conserved(g:GameState) {
 expect(cards(g)).toHaveLength(72);expect(new Set(cards(g).map(c=>c.id)).size).toBe(72);
 for(const p of g.players) {
  expect(p.cubes.available+p.cubes.onWizard+p.cubes.onBoard+p.cubes.onEvocations).toBe(25);
  expect(p.cubes.onWizard).toBe(g.players.reduce((sum,victim)=>sum+(victim.wizard.damageByPlayer[p.id]??0),0));
  expect(p.cubes.onEvocations).toBe(g.evocations.reduce((sum,victim)=>sum+(victim.damageByPlayer[p.id]??0),0));
 }
 const quests=[...g.questDeck,...g.questDiscard,...g.players.flatMap(heldQuests)];
 expect(new Set(quests.map(q=>q.id)).size).toBe(quests.length);
}

describe('agreed client interfaces and defaults',()=>{
 it('exposes exactly the agreed command payloads and required public stats',()=>{
  expectTypeOf<Extract<GameAction,{type:'BEGIN_PHYSICAL_ACTION'}>>().toEqualTypeOf<{type:'BEGIN_PHYSICAL_ACTION';playerId:string;kind:'EXPLORE'|'ATTACK'}>();
  expectTypeOf<Extract<GameAction,{type:'PERFORM_MOVEMENT'}>>().toEqualTypeOf<{type:'PERFORM_MOVEMENT';playerId:string}>();
  expectTypeOf<Extract<GameAction,{type:'ACTIVATE_ROOM'}>>().toEqualTypeOf<{type:'ACTIVATE_ROOM';playerId:string;roomTargetId?:string}>();
  expectTypeOf<Extract<GameAction,{type:'SKIP_PHYSICAL_EFFECTS'}>>().toEqualTypeOf<{type:'SKIP_PHYSICAL_EFFECTS';playerId:string}>();
  expectTypeOf<Extract<GameAction,{type:'INFLICT_ATTACK'}>>().toEqualTypeOf<{type:'INFLICT_ATTACK';playerId:string;targetId:string}>();
  expectTypeOf<Extract<GameAction,{type:'DISCARD_HAND_LIMIT'}>>().toEqualTypeOf<{type:'DISCARD_HAND_LIMIT';playerId:string;cardIds:string[]}>();
  expectTypeOf<Extract<GameAction,{type:'DISCARD_QUESTS'}>>().toEqualTypeOf<{type:'DISCARD_QUESTS';playerId:string;questIds:string[]}>();
  expectTypeOf<Activation['physicalAction']>().toEqualTypeOf<PhysicalAction|null|undefined>();
  expectTypeOf<Wizard['attack']>().toEqualTypeOf<number>();expectTypeOf<Wizard['movement']>().toEqualTypeOf<number>();
  expectTypeOf<Wizard['health']>().toEqualTypeOf<number>();
  expectTypeOf<Player['cardLimit']>().toEqualTypeOf<number>();expectTypeOf<Player['questLimit']>().toEqualTypeOf<number>();
  expectTypeOf<GameState['blackRoseResolved']>().toEqualTypeOf<boolean>();
  expectTypeOf<Extract<'maxHP',keyof Wizard>>().toBeNever();
  const g=createGame();expect(g.blackRoseResolved).toBe(false);
  for(const p of g.players) {
   expect(p.wizard).toMatchObject({attack:2,movement:2,health:10});
   expect(p).toMatchObject({cardLimit:7,questLimit:2});
  }
 });

 it('accepts old activation literals but initializes production activations with physicalAction null',()=>{
  let g=createGame();for(const p of g.players){p.connected=true;p.ready=true;}
  g=applyAction(g,{type:'START_GAME',playerId:'p1'});g=advance(g);
  expect(g.blackRoseResolved).toBe(true);
  for(const id of ['p1','p2']) {
    g=applyAction(g,{type:'DRAW_STUDY',playerId:id,deckId:'cantrip'});
   g=applyAction(g,{type:'DISCARD_STUDY',playerId:id,cardIds:player(g,id).hand.slice(0,2).map(c=>c.id)});
  }
  for(const id of ['p1','p2'])g=applyAction(g,prepareAction(g,id));
  expect(g.activation?.physicalAction).toBeNull();
  delete g.activation!.physicalAction;g=begin(g);expect(g.activation?.physicalAction?.kind).toBe('EXPLORE');
 });

 it('keeps menu/limit metadata JSON-safe and independent of private hand and quest identities',()=>{
  const g=begin(actionFixture(),'ATTACK');
  const publicMetadata={blackRoseResolved:g.blackRoseResolved,physicalAction:g.activation!.physicalAction,
   players:g.players.map(p=>({id:p.id,cardLimit:p.cardLimit,questLimit:p.questLimit,attack:p.wizard.attack,movement:p.wizard.movement,health:p.wizard.health}))};
  expect(JSON.parse(JSON.stringify(publicMetadata))).toEqual(publicMetadata);
  expect(g.activation!.physicalAction).toEqual({kind:'ATTACK',mainEffectUsed:false,movementStarted:false});
  // Existing viewer masking can remove opponent quest identities without changing these fields.
  const masked:GameState=structuredClone(g);player(masked,'p2').quest=null;player(masked,'p2').additionalQuests=[];
  expect(masked.players.map(p=>[p.cardLimit,p.questLimit])).toEqual([[7,2],[7,2]]);
  expect(masked.activation).toEqual(g.activation);expect(masked.blackRoseResolved).toBe(g.blackRoseResolved);
 });
});

describe('stateful physical menus',()=>{
 it.each(['EXPLORE','ATTACK'] as const)('begins %s with a single token/action charge, no automatic effect, and fresh effect flags',kind=>{
  const initial=actionFixture();initial.activation!.roomEffectUsed=true;const before=structuredClone(initial);
  const g=begin(initial,kind);expect(initial).toEqual(before);
  expect(player(g).actionTokens).toBe(1);expect(g.activation).toMatchObject({actionsUsed:1,exploring:0,roomEffectUsed:false,physicalAction:{kind,mainEffectUsed:false,movementStarted:false}});
  expect(player(g).hand).toEqual(before.players[0].hand);expect(player(g,'p2').wizard).toEqual(before.players[1].wizard);
  conserved(g);
 });

 it('allows Explore but forbids Attack from every protected starting hex',()=>{
  const initial=actionFixture();
  for(const start of initial.board.rooms.filter(r=>r.startingFor)) {
   const g=structuredClone(initial);player(g).wizard.position={...start.tiles[0]};
   rejected(g,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'ATTACK'},/starting room/);
   let exploring=begin(g);rejected(exploring,{type:'ACTIVATE_ROOM',playerId:'p1'},/starting room/);
   exploring=move(exploring);
   const destination=g.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],start.tiles[0])===1)!.tiles[0];
   exploring=applyAction(exploring,{type:'EXPLORE_STEP',playerId:'p1',destination});
   rejected(exploring,{type:'EXPLORE_STEP',playerId:'p1',destination:start.tiles[0]},/reenter/);
   exploring=applyAction(exploring,{type:'END_EXPLORE',playerId:'p1'});
   expect(exploring.activation?.physicalAction?.mainEffectUsed).toBe(true);
   exploring=activateRoom(exploring);expect(exploring.activation?.physicalAction).toBeNull();
  }
 });

 it.each([true,false])('resolves Explore room-first=%s exactly once each, without charging for effects',roomFirst=>{
  let g=actionFixture();const source=g.board.rooms.find(r=>r.effect==='DRAW_GRIMOIRE')!;
    const destination=g.board.rooms.find(r=>r.effect==='SUMMON_CADAVER'&&hexDistance(source.tiles[0],r.tiles[0])<=2)!;
  const middle=g.board.rooms.find(r=>!r.startingFor&&hexDistance(source.tiles[0],r.tiles[0])===1&&hexDistance(r.tiles[0],destination.tiles[0])===1)!;
  const initialHand=player(g).hand.length;g=begin(g);
  if(roomFirst) {
   g=activateRoom(g);expect(player(g).hand).toHaveLength(initialHand+1);
   rejected(g,{type:'ACTIVATE_ROOM',playerId:'p1'},/already used/);
  }
  g=move(g);expect(g.activation?.exploring).toBe(2);
  rejected(g,{type:'PERFORM_MOVEMENT',playerId:'p1'},/already started/);
  rejected(g,{type:'ACTIVATE_ROOM',playerId:'p1'},/Finish exploring/);
  g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:middle.tiles[0]});expect(g.activation?.exploring).toBe(1);
  g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:destination.tiles[0]});
  expect(player(g).wizard.position).toEqual(destination.tiles[0]);expect(g.activation?.exploring).toBe(0);
  if(!roomFirst) {
   expect(g.activation?.physicalAction?.mainEffectUsed).toBe(true);
   rejected(g,{type:'PERFORM_MOVEMENT',playerId:'p1'},/already started or resolved/);
   rejected(g,{type:'EXPLORE_STEP',playerId:'p1',destination:middle.tiles[0]},/Choose Explore/);
   g=activateRoom(g);
  }
    expect(g.activation?.physicalAction).toBeNull();expect(player(g).hand).toHaveLength(initialHand+(roomFirst?1:0));
    expect(g.evocations).toHaveLength(roomFirst?0:1);
    if(!roomFirst)expect(g.evocations[0].position).toEqual(destination.tiles[0]);
  expect(g.activation?.actionsUsed).toBe(1);expect(player(g).actionTokens).toBe(1);conserved(g);
  rejected(g,{type:'ACTIVATE_ROOM',playerId:'p1'},/Begin a physical action/);
 });

 it.each([true,false])('resolves Attack room-first=%s exactly once with base damage 2',roomFirst=>{
  let g=begin(actionFixture('ROOM_DAMAGE'),'ATTACK');
  if(roomFirst)g=activateRoom(g);
  g=attack(g,'p2-wizard');expect(player(g,'p2').wizard.damageCubes).toBe(roomFirst?3:2);
  if(!roomFirst) {
   rejected(g,{type:'INFLICT_ATTACK',playerId:'p1',targetId:'p2'},/already used/);
   expect(g.activation?.physicalAction?.mainEffectUsed).toBe(true);g=activateRoom(g);
  }
  expect(player(g,'p2').wizard.damageByPlayer).toEqual({p1:3});expect(g.activation?.physicalAction).toBeNull();
  expect(player(g).cubes.onWizard).toBe(3);expect(player(g).actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);conserved(g);
 });

 it('locks all ordinary mage actions and legacy bypasses at each stage of a pending physical action',()=>{
  const initial=actionFixture();const ordinary=player(initial).personalDeck.shift()!;player(initial).prepared.rapid={card:ordinary,used:false};
  const power=initial.powerfulDeck.shift()!;player(initial).hand.push(power);
  initial.evocations.push({id:'own',playerId:'p1',name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:2,passive:'WOUNDED_FURY',position:{...player(initial).wizard.position},damageCubes:0,damageByPlayer:{},activated:false});
  const commands:GameAction[]=[
   {type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'ATTACK'}, {type:'EXPLORE',playerId:'p1',activateRoomAtStart:true},
   {type:'PUNCH',playerId:'p1',targetId:'p2',roomEffect:'START'}, {type:'END_ACTIVATION',playerId:'p1'}, {type:'PASS_ROUND',playerId:'p1'},
   {type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'}, {type:'CAST_POWERFUL_SPELL',playerId:'p1',cardId:power.id,roomId:'room-0,0'},
   {type:'DISCARD_EXIT',playerId:'p1',cardId:ordinary.id,destination:{q:0,r:0}}, {type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'own'},
  ];
  const pending=begin(initial),moving=move(pending),ended=applyAction(moving,{type:'END_EXPLORE',playerId:'p1'});
  const attacking=begin(initial,'ATTACK');
  for(const g of [pending,moving,ended,activateRoom(pending),attacking,attack(attacking),activateRoom(attacking)]) {
   for(const command of commands)rejected(g,command,/pending physical action|Finish exploring/);
   expect(canPassActionPhase(g,player(g))).toBe(false);
   for(const command of [
    {type:'PERFORM_MOVEMENT',playerId:'p2'}, {type:'ACTIVATE_ROOM',playerId:'p2'},
    {type:'SKIP_PHYSICAL_EFFECTS',playerId:'p2'}, {type:'INFLICT_ATTACK',playerId:'p2',targetId:'p1'},
   ] as GameAction[])rejected(g,command,/Not your turn/);
   conserved(g);
  }
 });

 it('requires pending actions of the correct kind and rejects invalid command phases atomically',()=>{
  const initial=actionFixture();
  for(const command of [
   {type:'PERFORM_MOVEMENT',playerId:'p1'}, {type:'ACTIVATE_ROOM',playerId:'p1'},
   {type:'SKIP_PHYSICAL_EFFECTS',playerId:'p1'}, {type:'INFLICT_ATTACK',playerId:'p1',targetId:'p2'},
  ] as GameAction[]) {
   rejected(initial,command,/Begin a physical action/);rejected(createGame(),command,/LOBBY/);
  }
  rejected(begin(initial),{type:'INFLICT_ATTACK',playerId:'p1',targetId:'p2'},/pending Attack/);
  rejected(begin(initial,'ATTACK'),{type:'PERFORM_MOVEMENT',playerId:'p1'},/pending Explore/);
  const noTokens=structuredClone(initial);player(noTokens).actionTokens=0;
  rejected(noTokens,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'},/tokens/);
  // TEST FIXTURE ONLY: isolate rejection at an already-exhausted shared action budget.
  const quota=structuredClone(initial);quota.activation!.actionsUsed=2;
  rejected(quota,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'},/both turn actions/);
  const untrusted=JSON.parse('{"type":"BEGIN_PHYSICAL_ACTION","playerId":"p1","kind":"SPELL"}') as GameAction;
  rejected(initial,untrusted,/Unknown physical action kind/);
 });

 it('keeps pending primary/room effects alive with zero tokens until both resolve or are skipped',()=>{
  for(const finish of ['both','skip'] as const) {
   let g=skip(begin(actionFixture()));g=begin(g);expect(player(g).actionTokens).toBe(0);expect(g.activation?.actionsUsed).toBe(2);
   expect(canPlayerAct(g,player(g))).toBe(true);expect(canPassActionPhase(g,player(g))).toBe(false);expect(g.currentPlayerId).toBe('p1');
   g=move(g);g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
   expect(g.currentPlayerId).toBe('p1');expect(g.activation?.physicalAction?.mainEffectUsed).toBe(true);
   expect(canPlayerAct(g,player(g))).toBe(true);expect(canPassActionPhase(g,player(g))).toBe(false);
   g=finish==='both'?activateRoom(g):skip(g);
   expect(g.currentPlayerId).toBe('p2');expect(player(g).passed).toBe(false);expect(canPlayerAct(g,player(g))).toBe(false);
  }
 });

 it.each(['unstarted','moving','primary','room','attack'] as const)('skips remaining effects at %s, keeping spent costs and already resolved effects',stage=>{
  let g=begin(actionFixture(),stage==='attack'?'ATTACK':'EXPLORE');
  if(stage==='moving'||stage==='primary')g=move(g);
    if(stage==='moving') {
     const destination=g.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],player(g).wizard.position)===1)!.tiles[0];
     g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination});
    }
  if(stage==='primary')g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  if(stage==='room')g=activateRoom(g);
  if(stage==='attack')g=attack(g);
  const before=structuredClone(g);g=skip(g);
  expect(g.activation?.physicalAction).toBeNull();expect(g.activation?.exploring).toBe(0);
  expect(g.players).toEqual(before.players);expect(player(g).actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);
  g=begin(g);expect(g.activation?.roomEffectUsed).toBe(false);expect(g.activation?.physicalAction).toEqual({kind:'EXPLORE',mainEffectUsed:false,movementStarted:false});
  g=skip(g);expect(g.currentPlayerId).toBe('p2');expect(player(g).actionTokens).toBe(0);conserved(g);
 });

 it('retains a token-free spell after the first menu action and exhausts on its second shared action',()=>{
  let g=actionFixture();player(g).actionTokens=1;const card=player(g).personalDeck.shift()!;
  player(g).prepared.rapid={card,used:false};g=skip(begin(g));
  expect(g.currentPlayerId).toBe('p1');expect(g.activation?.physicalAction).toBeNull();expect(g.activation?.actionsUsed).toBe(1);
  const source=g.board.rooms.find(r=>r.tiles.some(h=>hexDistance(h,player(g).wizard.position)===0))!;
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:source.id,...(card.target==='MODEL'?{dummy:true}:{})});
  expect(g.currentPlayerId).toBe('p2');expect(player(g).prepared.rapid?.used).toBe(true);expect(player(g).actionTokens).toBe(0);conserved(g);
 });

 it('keeps canPass false during own legacy movement and paid/free evocation activation',()=>{
  let g=actionFixture();player(g).actionTokens=1;g=applyAction(g,{type:'EXPLORE',playerId:'p1'});
  expect(canPassActionPhase(g,player(g))).toBe(false);
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});expect(canPassActionPhase(g,player(g))).toBe(true);
  const model={id:'own',playerId:'p1',name:'Cadaver',archetype:'UNDEAD' as const,movement:2,attack:2,health:2,passive:'WOUNDED_FURY' as const,position:{q:0,r:0},damageCubes:0,damageByPlayer:{},activated:false};
  for(const phase of ['ACTION','EVOCATION'] as const) {
   let state=actionFixture();state.phase=phase;state.evocations=[model];player(state).actionTokens=phase==='ACTION'?1:0;
   state=applyAction(state,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:'own'});
   expect(player(state).actionTokens).toBe(0);expect(canPassActionPhase(state,player(state))).toBe(false);
   for(const command of [
    {type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'}, {type:'PERFORM_MOVEMENT',playerId:'p1'},
    {type:'ACTIVATE_ROOM',playerId:'p1'}, {type:'SKIP_PHYSICAL_EFFECTS',playerId:'p1'}, {type:'INFLICT_ATTACK',playerId:'p1',targetId:'p2'},
   ] as GameAction[])rejected(state,command,/active evocation|EVOCATION/);
  }
 });
});

describe('movement, attacks and authoritative health',()=>{
 it.each([0,1,3])('uses configurable movement=%s for new menus and legacy Explore',movement=>{
  const initial=actionFixture();player(initial).wizard.movement=movement;
  for(const legacy of [false,true]) {
   let g=legacy?applyAction(initial,{type:'EXPLORE',playerId:'p1'}):move(begin(initial));
   expect(g.activation?.exploring).toBe(movement);
   if(movement===0) {
    if(!legacy)expect(g.activation?.physicalAction?.mainEffectUsed).toBe(true);
   } else {
    for(let i=movement;i>0;i--) {
     const destination=g.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],player(g).wizard.position)===1)!.tiles[0];
     g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination});expect(g.activation?.exploring).toBe(i-1);
    }
    if(!legacy)expect(g.activation?.physicalAction?.mainEffectUsed).toBe(true);
   }
   if(!legacy) {
    expect(g.activation?.physicalAction).not.toBeNull();g=skip(g);expect(g.activation?.physicalAction).toBeNull();
   }
   expect(g.activation?.actionsUsed).toBe(1);expect(player(g).actionTokens).toBe(1);conserved(g);
  }
 });

 it('zero movement may complete immediately after a room-first effect, and early ending still leaves the room pending',()=>{
  let g=actionFixture();player(g).wizard.movement=0;g=move(activateRoom(begin(g)));
  expect(g.activation?.physicalAction).toBeNull();expect(g.activation?.exploring).toBe(0);
  g=actionFixture();player(g).wizard.movement=4;g=move(begin(g));
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expect(g.activation?.physicalAction).toMatchObject({mainEffectUsed:true,movementStarted:true});
  expect(g.activation?.roomEffectUsed).toBe(false);expect(g.activation?.exploring).toBe(0);
  rejected(g,{type:'END_EXPLORE',playerId:'p1'},/Not exploring/);
 });

 it('does not allow legacy room-timing flags to resolve room effects in the new flow',()=>{
  let g=move(begin(actionFixture()));
  rejected(g,{type:'END_EXPLORE',playerId:'p1',activateRoomAtEnd:true},/ACTIVATE_ROOM/);
  const destination=g.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],player(g).wizard.position)===1)!.tiles[0];
  g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination});
  const last=g.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],player(g).wizard.position)===1)!.tiles[0];
  rejected(g,{type:'EXPLORE_STEP',playerId:'p1',destination:last,activateRoomAtEnd:true},/ACTIVATE_ROOM/);
 });

 it.each([0,2,5])('uses configurable mage attack=%s for INFLICT_ATTACK and legacy PUNCH',strength=>{
  const initial=actionFixture();player(initial).wizard.attack=strength;
  for(const legacy of [false,true]) {
   const g=legacy?applyAction(initial,{type:'PUNCH',playerId:'p1',targetId:'p2'}):attack(begin(initial,'ATTACK'));
   expect(player(g,'p2').wizard.damageCubes).toBe(strength);expect(player(g).cubes.onWizard).toBe(strength);
   expect(player(g,'p2').wizard.health).toBe(10);expect(player(g).actionTokens).toBe(1);conserved(g);
  }
 });

 it('requires enemy models in exactly the same hex and protects all starting rooms for both mage attack APIs',()=>{
  const initial=actionFixture();initial.evocations.push({id:'own',playerId:'p1',name:'Cadaver',archetype:'UNDEAD',movement:2,attack:2,health:3,passive:'WOUNDED_FURY',position:{...player(initial).wizard.position},damageCubes:0,damageByPlayer:{},activated:false});
  initial.evocations.push({...structuredClone(initial.evocations[0]),id:'enemy',playerId:'p2'});
  for(const legacy of [false,true]) {
   const g=legacy?initial:begin(initial,'ATTACK');
   const command=(targetId:string):GameAction=>({type:legacy?'PUNCH':'INFLICT_ATTACK',playerId:'p1',targetId});
   for(const target of ['p1','p1-wizard','own'])rejected(g,command(target),/yourself|own/);
   rejected(g,command('missing'),/not found/);
   for(const model of ['p2','enemy']) {
    for(const distance of [1,2]) {
     const distant=structuredClone(g),destination=distant.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],player(g).wizard.position)===distance)!.tiles[0];
     if(model==='p2')player(distant,'p2').wizard.position={...destination};else distant.evocations[1].position={...destination};
     rejected(distant,command(model),/same hex/);
    }
    for(const start of g.board.rooms.filter(r=>r.startingFor)) {
     const protectedTarget=structuredClone(g);
     if(model==='p2')player(protectedTarget,'p2').wizard.position={...start.tiles[0]};else protectedTarget.evocations[1].position={...start.tiles[0]};
     rejected(protectedTarget,command(model),/starting room/);
    }
    const n=applyAction(g,command(model));
    if(model==='p2')expect(player(n,'p2').wizard.damageByPlayer).toEqual({p1:2});
    else expect(n.evocations[1].damageByPlayer).toEqual({p1:2});
    conserved(n);
   }
  }
 });

 it.each([3,14])('uses health=%s as maximum HP, caps overkill, settles cubes and leaves maximum unchanged',health=>{
  let g=actionFixture();player(g,'p2').wizard.health=health;
  player(g,'p2').wizard.damageCubes=health-1;player(g,'p2').wizard.damageByPlayer={p1:health-1};
  player(g).cubes.available-=health-1;player(g).cubes.onWizard=health-1;
  g=attack(begin(g,'ATTACK'));
  expect(player(g,'p2').wizard).toMatchObject({health,damageCubes:0,blackDamage:0,damageByPlayer:{},position:{q:-3,r:2}});
  expect(player(g).kills).toBe(1);expect(player(g).victoryPoints).toBe(5);expect(player(g).cubes.available).toBe(25);
  expect(g.log.some(line=>line.includes('places 1 damage cubes'))).toBe(true);conserved(g);
  // No automatic handoff while the room effect remains unresolved after a kill.
  expect(g.activation?.physicalAction?.mainEffectUsed).toBe(true);
 });

 it('uses more than ten health without premature defeat and deals full physical damage with insufficient cubes',()=>{
  let g=actionFixture();player(g,'p2').wizard.health=14;player(g,'p2').wizard.damageCubes=9;player(g,'p2').wizard.blackDamage=9;
  player(g).wizard.attack=4;player(g).cubes.available=1;player(g).cubes.onBoard=24;
  const source=g.board.rooms.find(r=>r.tiles.some(h=>hexDistance(h,player(g).wizard.position)===0))!;
  source.instabilityLimit=30;source.instability=24;source.cubesByPlayer={p1:24};
  g=attack(begin(g,'ATTACK'));expect(player(g,'p2').wizard.damageCubes).toBe(13);
  expect(player(g,'p2').wizard.damageByPlayer).toEqual({p1:1});expect(player(g).kills).toBe(0);conserved(g);
 });

 it('keeps a room-first Crimson finisher pending, never attacks the respawn, and permits skipping',()=>{
  let g=actionFixture('ROOM_DAMAGE');player(g,'p2').wizard.health=1;
  g=activateRoom(begin(g,'ATTACK'));expect(player(g).kills).toBe(1);
  rejected(g,{type:'INFLICT_ATTACK',playerId:'p1',targetId:'p2'},/starting room/);
  expect(g.activation?.physicalAction?.mainEffectUsed).toBe(false);g=skip(g);
  expect(player(g,'p2').wizard.damageCubes).toBe(0);expect(g.activation?.physicalAction).toBeNull();conserved(g);
 });

 it('validates Emerald room targets atomically and retains reconstructed once-per-phase locks',()=>{
  let g=actionFixture('INSTABILITY');const source=g.board.rooms.find(r=>r.effect==='INSTABILITY')!;room(g,source.id).reconstructed=true;
  g=begin(g,'ATTACK');
  const adjacent=g.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],source.tiles[0])===1)!;
  const far=g.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],source.tiles[0])>1)!;
  for(const target of [far.id,'missing',g.board.rooms.find(r=>r.startingFor)!.id])rejected(g,{type:'ACTIVATE_ROOM',playerId:'p1',roomTargetId:target});
  g=activateRoom(g,adjacent.id);expect(room(g,adjacent.id).cubesByPlayer).toEqual({p1:2});
  rejected(g,{type:'ACTIVATE_ROOM',playerId:'p1'},/already used/);g=skip(g);g=begin(g);
  rejected(g,{type:'ACTIVATE_ROOM',playerId:'p1'},/special already used/);g=skip(g);conserved(g);
 });

 it.each<RoomEffect>(['ROOM_DAMAGE','DRAW_DISCARD','INSTABILITY','DRAW_QUEST','DRAW_GRIMOIRE','SUMMON_CADAVER','DRAW_POWERFUL'])('resolves %s through ACTIVATE_ROOM with ordinary and reconstructed rewards',effect=>{
  for(const reconstructed of [false,true]) {
   let g=actionFixture(effect);const source=g.board.rooms.find(r=>r.effect===effect)!;
   source.reconstructed=reconstructed;
   player(g).discard.push(...player(g).personalDeck.splice(0,2));
  const emeraldTarget=g.board.rooms.find(r=>!r.startingFor&&hexDistance(r.tiles[0],source.tiles[0])===1)!;
   const before=structuredClone(g),reward=reconstructed?2:1;
  g=activateRoom(begin(g),effect==='INSTABILITY'?emeraldTarget.id:undefined);
   expect(g.activation?.physicalAction?.mainEffectUsed).toBe(false);expect(g.activation?.roomEffectUsed).toBe(true);
   expect(room(g,source.id).specialUsed).toBe(reconstructed);
   switch(effect) {
    case 'ROOM_DAMAGE':expect(player(g,'p2').wizard.damageByPlayer).toEqual({p1:reward});break;
    case 'DRAW_DISCARD':expect(player(g).hand).toHaveLength(reward);expect(player(g).hand.every(c=>before.players[0].discard.some(d=>d.id===c.id))).toBe(true);break;
    case 'INSTABILITY':expect(room(g,emeraldTarget.id).cubesByPlayer).toEqual({p1:reward});break;
    case 'DRAW_QUEST':expect(heldQuests(player(g))).toEqual(before.questDeck.slice(0,reward));break;
    case 'DRAW_GRIMOIRE':expect(player(g).hand).toEqual(before.players[0].personalDeck.slice(0,reward));break;
    case 'SUMMON_CADAVER':expect(g.evocations).toHaveLength(reward);expect(g.evocations.every(e=>hexDistance(e.position,source.tiles[0])===0)).toBe(true);break;
    case 'DRAW_POWERFUL':expect(player(g).hand).toEqual(before.powerfulDeck.slice(0,reward));break;
   }
   rejected(g,{type:'ACTIVATE_ROOM',playerId:'p1'},/already used/);
   g=move(g);g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});expect(g.activation?.physicalAction).toBeNull();
   expect(player(g).actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);conserved(g);
  }
 });
});

describe('mandatory preparation hand limits and the personal-discard exception',()=>{
 it('rejects preparation over seven before slot removal, then accepts exactly the limit',()=>{
  let g=preparationFixture();rejected(g,prepareAction(g),/hand limit/);expect(player(g).prepared.slot1).toBeNull();
  const card=player(g).hand[0];g=applyAction(g,{type:'DISCARD_HAND_LIMIT',playerId:'p1',cardIds:[card.id]});
  expect(player(g).hand).toHaveLength(7);expect(player(g).discard).toEqual([card]);
  g=applyAction(g,prepareAction(g));expect(player(g).hand).toHaveLength(3);expect(player(g).preparationDone).toBe(true);conserved(g);
 });

 it('honors a custom card limit and rejects wrong counts, duplicates, foreign cards, phases and prepared players',()=>{
  const g=preparationFixture(9);player(g).cardLimit=6;
  const ids=player(g).hand.map(c=>c.id),foreign=player(g,'p2').personalDeck[0].id;
  for(const cardIds of [[],ids.slice(0,2),ids.slice(0,4),[ids[0],ids[0],ids[1]],[ids[0],ids[1],foreign]])rejected(g,{type:'DISCARD_HAND_LIMIT',playerId:'p1',cardIds});
  const prepared=structuredClone(g);player(prepared).preparationDone=true;rejected(prepared,{type:'DISCARD_HAND_LIMIT',playerId:'p1',cardIds:ids.slice(0,3)},/Already prepared/);
  for(const phase of ['STUDY','ACTION','BLACK_ROSE'] as const) {
   const wrong=structuredClone(g);wrong.phase=phase;rejected(wrong,{type:'DISCARD_HAND_LIMIT',playerId:'p1',cardIds:ids.slice(0,3)},/unavailable/);
  }
  const n=applyAction(g,{type:'DISCARD_HAND_LIMIT',playerId:'p1',cardIds:ids.slice(0,3)});
  expect(player(n).hand).toHaveLength(6);rejected(n,{type:'DISCARD_HAND_LIMIT',playerId:'p1',cardIds:[]},/No cards/);
  expect(player(applyAction(n,prepareAction(n))).preparationDone).toBe(true);conserved(n);
 });

 it('routes personal, Cantrip and powerful overflow cards ALL to personal discard with flags and identities intact',()=>{
  let g=preparationFixture(7);const personal=player(g).hand[0],school=g.library[0].cards.shift()!,power=g.powerfulDeck.shift()!;
  player(g).hand.push(school,power,player(g).personalDeck.shift()!);const before=structuredClone(g);
  const selected=[personal,school,power];g=applyAction(g,{type:'DISCARD_HAND_LIMIT',playerId:'p1',cardIds:selected.map(c=>c.id)});
  expect(player(g).discard).toEqual(selected);expect(player(g).hand).toHaveLength(7);expect(g.library).toEqual(before.library);
  expect(g.removedCards).toEqual([]);expect(player(g).discard.find(c=>c.id===power.id)?.powerful).toBe(true);
  expect(player(g).discard.find(c=>c.id===school.id)?.schoolId).toBe(school.schoolId);conserved(g);
  // Azure retrieves these exact exceptions without changing future routing rules.
  g.phase='ACTION';g.currentPlayerId='p1';g.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false,physicalAction:null};
  const azure=g.board.rooms.find(r=>r.effect==='DRAW_DISCARD')!;player(g).wizard.position={...azure.tiles[0]};azure.reconstructed=true;
  // Leave only the power in discard; retain the other physical cards in hand.
  player(g).hand.push(...player(g).discard.splice(0,2));
  g=activateRoom(begin(g));expect(player(g).hand.find(c=>c.id===power.id)).toEqual(power);expect(player(g).discard).toEqual([]);
  g=skip(g);rejected(g,{type:'CAST_POWERFUL_SPELL',playerId:'p1',cardId:power.id,roomId:azure.id},/prepare.*later Preparation/);
  // Focused later-preparation fixture: move the retrieved physical card, never duplicate it.
  player(g).hand=player(g).hand.filter(c=>c.id!==power.id);player(g).prepared.slot1={card:power,used:false};
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:azure.id,...(power.target==='MODEL'?{dummy:true}:{})});
  expect(g.removedCards).toEqual([power]);expect(player(g).discard.some(c=>c.id===power.id)).toBe(false);conserved(g);
 });

 it('recycles forced school/powerful discards through grimoire draws, then uses normal cast routing',()=>{
  let g=preparationFixture(7);const school=g.library[0].cards.shift()!,power=g.powerfulDeck.shift()!;
  player(g).hand.push(school,power);g=applyAction(g,{type:'DISCARD_HAND_LIMIT',playerId:'p1',cardIds:[school.id,power.id]});
  // Legal round-boundary fixture: all undrawn personal cards are retained in hand.
  player(g).hand.push(...player(g).personalDeck.splice(0));g.phase='CLEANUP';g=advance(g);g=advance(g);
  expect(player(g).hand).toEqual(expect.arrayContaining([school,power]));expect(player(g).discard).toEqual([]);conserved(g);
  g.phase='ACTION';g.currentPlayerId='p1';g.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
  player(g).wizard.position={q:0,r:0};player(g).hand=player(g).hand.filter(c=>c.id!==school.id&&c.id!==power.id);
  player(g).prepared.rapid={card:school,used:false};player(g).prepared.slot1={card:power,used:false};
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0',...(school.target==='MODEL'?{dummy:true}:{})});
  expect(g.library[0].discard).toContainEqual(school);expect(player(g).discard).not.toContainEqual(school);
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0',...(power.target==='MODEL'?{dummy:true}:{})});
  expect(g.removedCards).toEqual([power]);conserved(g);
 });

 it('normal Study still routes Cantrip home and rejects powerful discards rather than applying the overflow exception',()=>{
  let g=createGame();g.phase='STUDY';const power=g.powerfulDeck.shift()!;player(g).hand.push(power);
  g=applyAction(g,{type:'DRAW_STUDY',playerId:'p1',deckId:'cantrip'});const selected=player(g).hand.filter(c=>c.schoolId==='cantrip').slice(0,2);
  rejected(g,{type:'DISCARD_STUDY',playerId:'p1',cardIds:[selected[0].id,power.id]},/Powerful spells cannot/);
  g=applyAction(g,{type:'DISCARD_STUDY',playerId:'p1',cardIds:selected.map(c=>c.id)});
  expect(g.library[0].discard).toEqual(selected);expect(player(g).discard).toEqual([]);expect(player(g).hand).toContainEqual(power);conserved(g);
 });
});

describe('one-shot Black Rose quest-limit gate',()=>{
 it('resolves quests once, blocks Study and all grimoire draws until every owner discards their exact overflow',()=>{
  let g=blackRoseFixture();const before=structuredClone(g),p1Quests=heldQuests(player(g)),p2Quests=heldQuests(player(g,'p2'));
  g=advance(g);expect(g.phase).toBe('BLACK_ROSE');expect(g.blackRoseResolved).toBe(true);
  expect(g.players.map(p=>p.hand.length)).toEqual([0,0]);expect(g.questDeck).toEqual(before.questDeck);
  rejected(g,{type:'DRAW_STUDY',playerId:'p1',deckId:'cantrip'},/BLACK_ROSE/);
  rejected(g,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:[],rapidCardId:'missing'},/BLACK_ROSE/);
  for(let i=0;i<3;i++)rejected(g,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:'BLACK_ROSE',expectedRound:1},/Waiting/);
  g=applyAction(g,{type:'DISCARD_QUESTS',playerId:'p1',questIds:[p1Quests[0].id]});
  expect(g.phase).toBe('BLACK_ROSE');expect(g.players.map(p=>p.hand.length)).toEqual([0,0]);
  expect(player(g).quest).toEqual(p1Quests[1]);expect(player(g).additionalQuests).toEqual([p1Quests[2]]);
  rejected(g,{type:'DISCARD_QUESTS',playerId:'p1',questIds:[]},/No quests/);
  g=applyAction(g,{type:'DISCARD_QUESTS',playerId:'p2',questIds:[p2Quests[1].id,p2Quests[3].id]});
  expect(g.phase).toBe('STUDY');expect(g.blackRoseResolved).toBe(true);expect(g.players.map(p=>p.hand.length)).toEqual([2,2]);
  expect(player(g,'p2').quest).toEqual(p2Quests[0]);expect(player(g,'p2').additionalQuests).toEqual([p2Quests[2]]);
  expect(g.questDiscard).toEqual([p1Quests[0],p2Quests[1],p2Quests[3]]);expect(g.players.map(p=>p.questsCompleted)).toEqual([0,0]);
  expect(g.players.map(p=>p.victoryPoints)).toEqual([0,0]);
  for(const [i,p] of g.players.entries())expect(p.hand).toEqual(before.players[i].personalDeck.slice(0,2));
  rejected(g,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:'BLACK_ROSE',expectedRound:1},/Stale/);conserved(g);
 });

 it('draws missing quests once even while another owner is over limit and never refills a deliberate zero-limit discard',()=>{
  let g=blackRoseFixture([3,0]);const drawn=g.questDeck[0];player(g,'p2').questLimit=0;
  g=advance(g);expect(player(g,'p2').quest).toEqual(drawn);expect(g.blackRoseResolved).toBe(true);
  const deck=structuredClone(g.questDeck);rejected(g,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:g.phase,expectedRound:g.round},/Waiting/);
  g=applyAction(g,{type:'DISCARD_QUESTS',playerId:'p2',questIds:[drawn.id]});expect(g.phase).toBe('BLACK_ROSE');expect(player(g,'p2').quest).toBeNull();
  g=applyAction(g,{type:'DISCARD_QUESTS',playerId:'p1',questIds:[player(g).additionalQuests[0].id]});
  expect(g.phase).toBe('STUDY');expect(player(g,'p2').quest).toBeNull();expect(g.questDeck).toEqual(deck);conserved(g);
 });

 it('rejects duplicate/wrong-count/unowned quest selections, unresolved Black Rose, and every other phase',()=>{
  const initial=blackRoseFixture();const quests=heldQuests(player(initial,'p2')),foreign=player(initial).quest!.id;
  rejected(initial,{type:'DISCARD_QUESTS',playerId:'p2',questIds:quests.slice(0,2).map(q=>q.id)},/Resolve Black Rose/);
  const g=advance(initial);
  for(const questIds of [[],[quests[0].id],quests.slice(0,3).map(q=>q.id),[quests[0].id,quests[0].id],[quests[0].id,foreign],[quests[0].id,'missing']])rejected(g,{type:'DISCARD_QUESTS',playerId:'p2',questIds});
  for(const phase of ['STUDY','PREPARATION','ACTION','CLEANUP'] as const) {
   const wrong=structuredClone(g);wrong.phase=phase;rejected(wrong,{type:'DISCARD_QUESTS',playerId:'p2',questIds:quests.slice(0,2).map(q=>q.id)},/unavailable/);
  }
  rejected(g,{type:'ADVANCE_PHASE',playerId:'p2',expectedPhase:g.phase,expectedRound:g.round},/creator/);
 });

 it('normalizes primary/additional quests, honors custom limits and skips the gate when all quests fit',()=>{
  let g=blackRoseFixture([3,0]);player(g).questLimit=3;
  const extra=g.questDeck.shift()!;player(g,'p2').additionalQuests=[extra];const deck=structuredClone(g.questDeck);
  g=advance(g);expect(g.phase).toBe('STUDY');expect(g.blackRoseResolved).toBe(true);
  expect(player(g,'p2').quest).toEqual(extra);expect(player(g,'p2').additionalQuests).toEqual([]);expect(g.questDeck).toEqual(deck);
  expect(g.players.map(p=>p.hand.length)).toEqual([2,2]);conserved(g);
 });

 it('draws no replacement when quest sources are empty and resets blackRoseResolved every new round',()=>{
  let g=blackRoseFixture([0,0]);g.questDiscard.push(...g.questDeck.splice(0));
  // Retain the physical quest supply with another owner rather than deleting it.
  player(g).questLimit=g.questDiscard.length;player(g).additionalQuests=g.questDiscard.splice(0);
  g=advance(g);expect(g.phase).toBe('STUDY');expect(player(g,'p2').quest).toBeNull();expect(g.blackRoseResolved).toBe(true);
  g.phase='CLEANUP';g=advance(g);expect(g.phase).toBe('BLACK_ROSE');expect(g.blackRoseResolved).toBe(false);
  g=advance(g);expect(g.phase).toBe('STUDY');expect(g.blackRoseResolved).toBe(true);conserved(g);
 });

 it('supports discarding every quest, normalizes to null/empty, and does not expose kept private identities in logs/errors',()=>{
  let g=blackRoseFixture([3,0]);const privateQuests=heldQuests(player(g));player(g).questLimit=0;
  g=advance(g);const logStart=g.log.length;
  const otherId=player(g,'p2').quest!.id;
  rejected(g,{type:'DISCARD_QUESTS',playerId:'p2',questIds:[privateQuests[0].id]},/No quests/);
  g=applyAction(g,{type:'DISCARD_QUESTS',playerId:'p1',questIds:privateQuests.map(q=>q.id)});
  expect(player(g).quest).toBeNull();expect(player(g).additionalQuests).toEqual([]);expect(g.phase).toBe('STUDY');
  const messages=g.log.slice(logStart).join('\n');
  for(const q of privateQuests){expect(messages).not.toContain(q.id);expect(messages).not.toContain(q.name);}
  expect(player(g,'p2').quest?.id).toBe(otherId);conserved(g);
 });
});