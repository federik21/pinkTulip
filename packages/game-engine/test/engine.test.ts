import { describe, expect, it, vi } from 'vitest';
import { applyAction, createGame, createSpellDeck, GameState, Card, Quest, RoomEffect, ROOM_COLORS, hexDistance } from '../src';

const advance=(g:GameState)=>applyAction(g,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:g.phase,expectedRound:g.round});

function readyGame() {
 let g=createGame();
 for(const p of g.players) p.connected=true;
 for(const p of g.players) g=applyAction(g,{type:'SET_READY',playerId:p.id,ready:true});
 return g;
}
function studyGame() {
 let g=readyGame(); g=applyAction(g,{type:'START_GAME',playerId:'p1'});
 return advance(g);
}
function actionGame(g=studyGame(),p1Cards?:string[]) {
 for(const id of ['p1','p2']) {
  g=applyAction(g,{type:'DRAW_STUDY',playerId:id,deckId:'school-1'});
  g=applyAction(g,{type:'DISCARD_STUDY',playerId:id,cardIds:g.players.find(p=>p.id===id)!.hand.filter(c=>!c.powerful).slice(0,2).map(c=>c.id)});
 }
 for(const id of ['p1','p2']) {
  const ids=id==='p1' && p1Cards?p1Cards:g.players.find(p=>p.id===id)!.hand.filter(c=>!c.powerful).slice(0,4).map(c=>c.id);
  g=applyAction(g,{type:'PREPARE_CARDS',playerId:id,rapidCardId:ids[3],preparedCardIds:ids.slice(0,3)});
 }
 return g;
}
const spell=(changes:Partial<Card>={}):Card=>({id:'test-spell',name:'Test spell',kind:'SPELL',damage:0,instability:2,range:4,target:'ROOM',...changes});
function giveSpell(g:GameState,card:Card) {g.players[0].prepared.slot1={card,used:false};return g;}
const quest=(id:string,kind:Quest['kind'],reward=3,amount=1):Quest=>({id,name:id,description:id,kind,amount,reward});
function roomGame(effect:RoomEffect) {
 const g=actionGame();
 for(const p of g.players){p.quest=null;p.additionalQuests=[];p.wizard.damageCubes=0;p.wizard.blackDamage=0;}
 for(const room of g.board.rooms){room.instability=0;room.cubesByPlayer={};}
 const room=g.board.rooms.find(r=>r.effect===effect)!;
 g.players[0].wizard.position={...room.tiles[0]};
 return {g,room};
}
function holdPowerful(g:GameState,target:Card['target']='ROOM',playerId='p1') {
 const index=g.powerfulDeck.findIndex(c=>c.target===target);expect(index).toBeGreaterThanOrEqual(0);
 const [card]=g.powerfulDeck.splice(index,1);g.players.find(p=>p.id===playerId)!.hand.push(card);return card;
}
// TEST FIXTURE ONLY: legacy phase/scoring tests do not exercise how spells/tokens are spent.
// Exhaust ordinary preparations into their real discard piles (used slots are only references),
// preserving every physical card. Powers must instead be cast or use the persistence fixture below.
function passExhaustedFixture(g:GameState,playerId:string) {
 g=structuredClone(g);const p=g.players.find(p=>p.id===playerId)!;
 expect(p.hand.some(c=>c.powerful)).toBe(false);
 p.actionTokens=0;
 for(const prepared of Object.values(p.prepared)) {
  if(!prepared || prepared.used)continue;
  expect(prepared.card.powerful).not.toBe(true);
  const school=g.library.find(d=>d.id===prepared.card.schoolId || prepared.card.id.startsWith(`${d.id}-`));
  (school?school.discard:p.discard).push(prepared.card);prepared.used=true;
 }
 return applyAction(g,{type:'PASS_ROUND',playerId});
}
// TEST FIXTURE ONLY: intentionally jump to a phase boundary to test *uncast* card persistence
// and next-Black-Rose routing, not legal passing or scoring. No cards are spent, moved or copied.
function cleanupBoundaryFixture(g:GameState) {
 g=structuredClone(g);g.phase='CLEANUP';g.currentPlayerId=null;g.activation=null;g.evocationActivation=null;
 return g;
}
// Used preparations are references to cards already in a discard or removedCards, not extra physical cards.
const physicalCards=(g:GameState)=>[...g.powerfulDeck,...g.removedCards,...g.library.flatMap(d=>[...d.cards,...d.discard]),...g.players.flatMap(p=>[...p.personalDeck,...p.hand,...p.discard,...Object.values(p.prepared).filter(c=>c&&!c.used).map(c=>c!.card)])];
function expectConserved(g:GameState,ids:string[]) {
 const cards=physicalCards(g);expect(cards).toHaveLength(252);expect(new Set(cards.map(c=>c.id)).size).toBe(252);
 expect(cards.map(c=>c.id).sort()).toEqual([...ids].sort());
}

describe('lobby and decks',()=>{
 it('places four protected starting rooms at the requested coordinates around 19 playable rooms',()=>{
  const g=createGame();const starts=g.board.rooms.filter(r=>r.startingFor);
  expect(starts.map(r=>r.tiles[0])).toEqual(expect.arrayContaining([{q:-1,r:-2},{q:3,r:-2},{q:-3,r:2},{q:1,r:2}]));
  expect(starts).toHaveLength(4);expect(g.board.rooms.filter(r=>!r.startingFor)).toHaveLength(19);
  expect(g.board.tiles).toHaveLength(23);expect(new Set(g.board.tiles.map(h=>`${h.q},${h.r}`)).size).toBe(23);
  expect(g.board.tiles).not.toContainEqual({q:-2,r:3});
  expect(g.players.map(p=>p.wizard.position)).toEqual([{q:3,r:-2},{q:-3,r:2}]);
  expect(starts.every(r=>r.color===null && r.effect===null)).toBe(true);
  for(const start of starts)expect(g.board.rooms.some(r=>!r.startingFor && hexDistance(start.tiles[0],r.tiles[0])===1)).toBe(true);
 });
 it('creates six identical 36-card schools with globally unique cards and bounded effects',()=>{
  const g=createGame(); expect(g.phase).toBe('LOBBY'); expect(g.library).toHaveLength(6);
  const all=g.library.flatMap(d=>d.cards); expect(all).toHaveLength(216);expect(new Set(all.map(c=>c.id)).size).toBe(216);
  for(const c of all){expect(c.damage).toBeLessThanOrEqual(4);expect(c.instability).toBeLessThanOrEqual(2);}
  expect(createSpellDeck('a').map(({id,...c})=>c)).toEqual(createSpellDeck('b').map(({id,...c})=>c));
 });
 it('requires both players connected and ready, and only the host may start',()=>{
  const g=createGame();expect(()=>applyAction(g,{type:'START_GAME',playerId:'p1'})).toThrow();
  const r=readyGame();r.players[1].ready=false;expect(()=>applyAction(r,{type:'START_GAME',playerId:'p1'})).toThrow();
  expect(()=>applyAction(readyGame(),{type:'START_GAME',playerId:'p2'})).toThrow();
  expect(applyAction(readyGame(),{type:'START_GAME',playerId:'p1'}).phase).toBe('BLACK_ROSE');
 });
 it('does not mutate the input state',()=>{
  const g=readyGame();const snapshot=structuredClone(g);applyAction(g,{type:'START_GAME',playerId:'p1'});expect(g).toEqual(snapshot);
 });
});

describe('Black Rose, study and preparation',()=>{
 it('resolves black damage events without awarding kill points and respawns defeated mages',()=>{
  const g=readyGame();g.eventDeck=[{id:'black',name:'Black thorns',description:'damage',kind:'BLACK_DAMAGE',amount:2,rooms:0}];g.players[0].wizard.damageCubes=9;
  const n=applyAction(g,{type:'START_GAME',playerId:'p1'});expect(n.players[0].wizard.damageCubes).toBe(0);expect(n.players[1].wizard.blackDamage).toBe(2);expect(n.players.every(p=>p.victoryPoints===0)).toBe(true);
 });
 it('places neutral event instability only on unfinished non-starting rooms',()=>{
  const g=readyGame();g.eventDeck=[{id:'quake',name:'Quake',description:'instability',kind:'INSTABILITY',amount:2,rooms:2}];
  const n=applyAction(g,{type:'START_GAME',playerId:'p1'});expect(n.board.rooms.reduce((a,r)=>a+r.instability,0)).toBe(4);expect(n.board.rooms.filter(r=>r.startingFor).every(r=>r.instability===0)).toBe(true);
 });
 it('deals one personal quest and two grimoire cards, then four school cards and discards two',()=>{
  let g=studyGame();expect(g.players.every(p=>p.quest && p.hand.length===2)).toBe(true);
  g=applyAction(g,{type:'DRAW_STUDY',playerId:'p1',deckId:'school-2'});expect(g.players[0].hand).toHaveLength(6);expect(g.library[1].cards).toHaveLength(32);
  const ids=g.players[0].hand.slice(0,2).map(c=>c.id);
  expect(()=>applyAction(g,{type:'DISCARD_STUDY',playerId:'p1',cardIds:[ids[0],ids[0]]})).toThrow();
  g=applyAction(g,{type:'DISCARD_STUDY',playerId:'p1',cardIds:ids});expect(g.players[0].hand).toHaveLength(4);expect(g.phase).toBe('STUDY');
  expect(()=>applyAction(g,{type:'DRAW_STUDY',playerId:'p1',deckId:'school-1'})).toThrow();
 });
 it('waits for both preparations, then starts the first activation automatically',()=>{
  const g=actionGame();expect(g.phase).toBe('ACTION');expect(g.activation?.playerId).toBe('p1');
  expect(g.players.every(p=>p.preparationDone && Object.values(p.prepared).filter(Boolean).length===4)).toBe(true);
  expect(()=>advance(g)).toThrow();
 });
 it('rejects a repeated phase command rather than skipping the next event',()=>{
  let g=actionGame();g=passExhaustedFixture(g,'p1');g=passExhaustedFixture(g,'p2');
  const command={type:'ADVANCE_PHASE' as const,playerId:'p1',expectedPhase:g.phase,expectedRound:g.round};
  g=applyAction(g,command);expect(g.phase).toBe('BLACK_ROSE');
  expect(()=>applyAction(g,command)).toThrow(/Stale/);
 });
 it('reshuffles each school discard without taking held or prepared spells or duplicating cards',()=>{
  let g=readyGame();g=applyAction(g,{type:'START_GAME',playerId:'p1'});
  for(const deck of g.library)deck.discard.push(...deck.cards.splice(0));
  g=advance(g);expect(g.library.every(deck=>deck.discard.length===36)).toBe(true);
  g=applyAction(g,{type:'DRAW_STUDY',playerId:'p1',deckId:'school-1'});
  expect(g.players[0].hand).toHaveLength(6);expect(g.library[0].cards).toHaveLength(32);
  const all=physicalCards(g);
  expect(all).toHaveLength(252);expect(new Set(all.map(c=>c.id)).size).toBe(252);expect(all.filter(c=>!c.powerful)).toHaveLength(240);
 });
 it('plays 30 rounds without exhausting the library or duplicating physical cards',()=>{
  let g=applyAction(readyGame(),{type:'START_GAME',playerId:'p1'});
  for(let round=1;round<=30;round++) {
   g=advance(g);
   for(const id of ['p1','p2']) {
    const school=g.library.find(d=>d.cards.length+d.discard.length>=4);
    expect(school,`No drawable school in round ${round}`).toBeDefined();
    g=applyAction(g,{type:'DRAW_STUDY',playerId:id,deckId:school!.id});
    g=applyAction(g,{type:'DISCARD_STUDY',playerId:id,cardIds:g.players.find(p=>p.id===id)!.hand.slice(0,2).map(c=>c.id)});
   }
   for(const id of ['p1','p2']) {
    const hand=g.players.find(p=>p.id===id)!.hand;
    g=applyAction(g,{type:'PREPARE_CARDS',playerId:id,rapidCardId:hand[3].id,preparedCardIds:hand.slice(0,3).map(c=>c.id)});
   }
  g=passExhaustedFixture(g,'p1');g=passExhaustedFixture(g,'p2');
  const all=physicalCards(g);
  expect(all).toHaveLength(252);expect(new Set(all.map(c=>c.id)).size).toBe(252);expect(all.filter(c=>!c.powerful)).toHaveLength(240);
   expect(g.phase).toBe('CLEANUP');if(round<30)g=advance(g);
  }
 });
});

describe('actions and spells',()=>{
 it('Explore consumes one token and one physical action, preserving free casts after two physical actions',()=>{
  let g=actionGame();g=applyAction(g,{type:'EXPLORE',playerId:'p1'});
  expect(g.players[0].actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);
  expect(()=>applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:{q:0,r:0}})).toThrow();
  g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:{q:2,r:-2}});
  expect(g.activation?.exploring).toBe(1);
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  g=applyAction(g,{type:'EXPLORE',playerId:'p1'});
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expect(g.currentPlayerId).toBe('p1');expect(g.activation?.actionsUsed).toBe(2);
  expect(()=>applyAction(g,{type:'EXPLORE',playerId:'p1'})).toThrow(/physical/);
  g=applyAction(g,{type:'END_ACTIVATION',playerId:'p1'});expect(g.currentPlayerId).toBe('p2');
 });
 it('allows one action then end turn without passing out of the round',()=>{
  let g=actionGame();expect(()=>applyAction(g,{type:'END_ACTIVATION',playerId:'p1'})).toThrow();
  g=applyAction(g,{type:'EXPLORE',playerId:'p1'});g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  g=applyAction(g,{type:'END_ACTIVATION',playerId:'p1'});expect(g.currentPlayerId).toBe('p2');expect(g.players[0].passed).toBe(false);
 });
 it('enforces numbered spell order but permits the flexible spell at any time without tokens',()=>{
  let g=actionGame();g.players[0].actionTokens=0;g.players[0].wizard.position={q:0,r:0};
  for(const [i,key] of (['slot1','slot2','slot3','rapid'] as const).entries())g.players[0].prepared[key]={card:spell({id:`spell-${i}`}),used:false};
  expect(()=>applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot2',roomId:'room-0,0'})).toThrow(/order/);
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
  expect(g.activation?.actionsUsed).toBe(0);
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0'});
  // No other legal action remains this turn, so it hands off automatically.
  expect(g.currentPlayerId).toBe('p2');expect(g.players[0].actionTokens).toBe(0);
 });
 it('damages every opposing model in a room, but never the caster',()=>{
  let g=giveSpell(actionGame(),spell({damage:4,instability:0,range:0}));
  for(const p of g.players)p.wizard.position={q:0,r:0};
  const before=g.players.map(p=>p.wizard.damageCubes);
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0'});
  expect(g.players[0].wizard.damageCubes).toBe(before[0]);expect(g.players[1].wizard.damageCubes).toBe(before[1]+4);
 });
 it('rejects out-of-range targets, self targeting and protected starting rooms',()=>{
  let g=giveSpell(actionGame(),spell({range:0}));g.players[0].wizard.position={q:1,r:0};
  expect(()=>applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0'})).toThrow(/range/);
  expect(()=>applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-3,-2'})).toThrow(/Starting/);
  g=giveSpell(g,spell({target:'MODEL'}));
  expect(()=>applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',targetPlayerId:'p1'})).toThrow();
  expect(()=>applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',targetPlayerId:'p2'})).toThrow(/starting/);
 });
 it('awards kill points and a personal kill quest, using the original target room for instability',()=>{
  let g=giveSpell(actionGame(),spell({target:'MODEL',damage:4,range:4}));g.players[0].wizard.position={q:0,r:0};g.players[1].wizard.position={q:1,r:0};g.players[1].wizard.damageCubes=9;
  g.players[0].quest={id:'kill',name:'Kill',description:'Kill',kind:'KILL',amount:1,reward:3};
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',targetPlayerId:'p2'});
  expect(g.players[0].victoryPoints).toBe(7);expect(g.players[0].quest).toBeNull();expect(g.board.rooms.find(r=>r.id==='room-1,0')!.instability).toBeGreaterThanOrEqual(2);
 });
 it('completes an instability quest from the cubes actually placed by one spell',()=>{
  let g=giveSpell(actionGame(),spell());g.players[0].wizard.position={q:1,r:0};g.players[0].quest={id:'instability',name:'Fracture',description:'Place 2',kind:'INSTABILITY',amount:2,reward:2};
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0'});
  expect(g.players[0].victoryPoints).toBe(2);expect(g.players[0].questsCompleted).toBe(1);expect(g.players[0].quest).toBeNull();
 });
});

describe('damage cubes and defeat contributions',()=>{
 function combatGame() {
  const g=actionGame();
  for(const p of g.players) {
   p.quest=null;p.wizard.damageCubes=0;p.wizard.blackDamage=0;
   p.wizard.position=p.id==='p1'?{q:0,r:0}:{q:1,r:0};
  }
  return g;
 }
 function prepareHit(g:GameState,id:string,amount:number) {
  const p=g.players.find(p=>p.id===id)!;
  p.prepared={rapid:{card:spell({id:`${id}-hit`,target:'MODEL',damage:amount,instability:0}),used:false},slot1:null,slot2:null,slot3:null};
 }
 function addAttacker(g:GameState,id:string,amount:number) {
  const p=structuredClone(g.players[0]);p.id=id;p.name=id;p.wizard.id=`${id}-wizard`;p.wizard.playerId=id;
  g.players.push(p);prepareHit(g,id,amount);
 }
 function hit(g:GameState,id:string) {
  return applyAction(g,{type:'CAST_SPELL',playerId:id,slot:'rapid',targetPlayerId:'p2'});
 }

 it('places attacker-owned cubes for spell and punch damage, without changing the input',()=>{
  let g=combatGame();prepareHit(g,'p1',3);const before=structuredClone(g);
  let n=hit(g,'p1');expect(g).toEqual(before);
  expect(n.players[0].cubes).toEqual({available:22,onWizard:3,onBoard:0,onEvocations:0});
  expect(n.players[1].wizard.damageByPlayer).toEqual({p1:3});expect(n.players[1].wizard.damageCubes).toBe(3);
  n=applyAction(n,{type:'PUNCH',playerId:'p1',targetId:'p2'});
  expect(n.players[0].cubes.onWizard).toBe(4);expect(n.players[0].cubes.available).toBe(21);
  expect(n.players[1].wizard.damageByPlayer).toEqual({p1:4});
 });
 it('caps cube placement at the available supply without reducing the damage dealt',()=>{
  let g=combatGame();prepareHit(g,'p1',4);g.players[0].cubes.available=2;g.players[0].cubes.onBoard=23;
  g=hit(g,'p1');expect(g.players[1].wizard.damageCubes).toBe(4);expect(g.players[1].wizard.damageByPlayer).toEqual({p1:2});
  expect(g.players[0].cubes).toEqual({available:0,onWizard:2,onBoard:23,onEvocations:0});
  g=applyAction(g,{type:'PUNCH',playerId:'p1',targetId:'p2'});
  expect(g.players[1].wizard.damageCubes).toBe(5);expect(g.players[1].wizard.damageByPlayer).toEqual({p1:2});
 });
 it('shares the cube supply across room-wide damage without placing cubes on the caster',()=>{
  let g=combatGame();addAttacker(g,'p3',1);
  for(const p of g.players)p.wizard.position={q:0,r:0};
  g.players[0].cubes.available=5;g.players[0].cubes.onBoard=20;
  g=giveSpell(g,spell({damage:4,instability:0,range:0}));
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0'});
  expect(g.players[0].wizard.damageCubes).toBe(0);expect(g.players[0].wizard.damageByPlayer).toEqual({});
  expect(g.players[1].wizard.damageByPlayer).toEqual({p1:4});expect(g.players[2].wizard.damageByPlayer).toEqual({p1:1});
  expect(g.players[1].wizard.damageCubes).toBe(4);expect(g.players[2].wizard.damageCubes).toBe(4);
  expect(g.players[0].cubes).toEqual({available:0,onWizard:5,onBoard:20,onEvocations:0});
 });
 it('does not award contribution points for a finishing hit with no available cubes',()=>{
  let g=combatGame();prepareHit(g,'p1',4);g.players[1].wizard.health=1;
  g.players[0].cubes.available=0;g.players[0].cubes.onBoard=25;
  g=hit(g,'p1');expect(g.players[0].kills).toBe(1);expect(g.players[0].victoryPoints).toBe(0);
  expect(g.players[0].cubes).toEqual({available:0,onWizard:0,onBoard:25,onEvocations:0});expect(g.players[1].wizard.damageByPlayer).toEqual({});
 });
 it('scores four real attackers 4/2/1/1, not the final hitter alone, and returns every cube',()=>{
  let g=combatGame();g.players[1].passed=true;prepareHit(g,'p1',4);
  addAttacker(g,'p3',3);addAttacker(g,'p4',2);addAttacker(g,'p5',1);
  for(const id of ['p1','p3','p4']) {g=hit(g,id);g=applyAction(g,{type:'END_ACTIVATION',playerId:id});}
  g=hit(g,'p5');
  expect(g.players.map(p=>p.victoryPoints)).toEqual([4,0,2,1,1]);
  expect(g.players.map(p=>p.kills)).toEqual([0,0,0,0,1]);
  for(const p of g.players)expect(p.cubes).toEqual({available:25,onWizard:0,onBoard:0,onEvocations:0});
  expect(g.players[1].wizard.damageByPlayer).toEqual({});expect(g.players[1].wizard.damageCubes).toBe(0);
  expect(g.players[1].wizard.position).toEqual({q:-3,r:2});
 });
 it('awards equal contributors the same rank and does not give points to noncontributors',()=>{
  let g=combatGame();g.players[1].passed=true;prepareHit(g,'p1',4);addAttacker(g,'p3',4);addAttacker(g,'p4',2);addAttacker(g,'p5',1);
  for(const id of ['p1','p3']) {g=hit(g,id);g=applyAction(g,{type:'END_ACTIVATION',playerId:id});}
  g=hit(g,'p4');
  expect(g.players.map(p=>p.victoryPoints)).toEqual([4,0,4,1,0]);
 });
 it('keeps black damage neutral but settles existing damage cubes when an event defeats a mage',()=>{
  let g=combatGame();prepareHit(g,'p1',4);g=hit(g,'p1');
  g.players[0].prepared.rapid={card:spell({id:'second-hit',target:'MODEL',damage:4,instability:0}),used:false};
  g=hit(g,'p1');g=passExhaustedFixture(g,'p1');g=passExhaustedFixture(g,'p2');
  g.eventDeck=[{id:'black-finisher',name:'Thorns',description:'Black damage',kind:'BLACK_DAMAGE',amount:2,rooms:0}];
  g=advance(g);
  expect(g.players[0].victoryPoints).toBe(4);expect(g.players[0].kills).toBe(0);
  expect(g.players[0].cubes).toEqual({available:25,onWizard:0,onBoard:0,onEvocations:0});
  expect(g.players[1].wizard.damageByPlayer).toEqual({});expect(g.players[1].wizard.blackDamage).toBe(0);
 });
 it('limits overkill cubes to actual remaining health and only returns cubes on the defeated mage',()=>{
  let g=combatGame();addAttacker(g,'p3',1);prepareHit(g,'p1',4);
  g.players[1].wizard.health=3;
  g.players[0].cubes.available=23;g.players[0].cubes.onWizard=2;
  g.players[2].wizard.damageCubes=2;g.players[2].wizard.damageByPlayer={p1:2};
  g=hit(g,'p1');
  expect(g.log.some(line=>line.includes('places 3 damage cubes'))).toBe(true);
  expect(g.players[0].victoryPoints).toBe(4);expect(g.players[0].cubes).toEqual({available:23,onWizard:2,onBoard:0,onEvocations:0});
  expect(g.players[2].wizard.damageByPlayer).toEqual({p1:2});expect(g.players[2].wizard.damageCubes).toBe(2);
 });
});

describe('rebuilt rooms, passing and victory',()=>{
 it('caps cubes at room capacity, completes a rebuilding quest, and locks the room',()=>{
  let g=giveSpell(actionGame(),spell());const room=g.board.rooms.find(r=>r.id==='room-0,0')!;room.instability=9;room.cubesByPlayer={'black-rose':9};g.players[0].wizard.position={q:0,r:0};
  g.players[0].quest={id:'rebuild',name:'Rebuild',description:'Rebuild',kind:'REBUILD',amount:1,reward:3};
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:room.id});
  expect(g.board.rooms.find(r=>r.id===room.id)!.instability).toBe(10);expect(g.players[0].cubes.available).toBe(24);expect(g.players[0].victoryPoints).toBe(3);
    g.players[0].prepared.rapid={card:spell({id:'flexible'}),used:false};
    const n=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:room.id});
  expect(n.board.rooms.find(r=>r.id===room.id)!.instability).toBe(10);
 });
 it('scores central first/second as 6/3, excludes neutral cubes, and scores only once',()=>{
  let g=actionGame();const r=g.board.rooms.find(r=>r.id==='room-0,0')!;r.instability=10;r.reconstructed=true;r.cubesByPlayer={p1:6,p2:3,'black-rose':1};
  g.players[0].cubes.onBoard=6;g.players[1].cubes.onBoard=3;
  g=passExhaustedFixture(g,'p1');g=passExhaustedFixture(g,'p2');
  expect(g.phase).toBe('CLEANUP');expect(g.players.map(p=>p.victoryPoints)).toEqual([6,3]);
  g=advance(g);expect(g.round).toBe(2);expect(g.players.every(p=>p.actionTokens===2)).toBe(true);
  expect(g.board.rooms.find(x=>x.id===r.id)!.scored).toBe(true);
  g=advance(g);
  for(const id of ['p1','p2']) {
   g=applyAction(g,{type:'DRAW_STUDY',playerId:id,deckId:'school-1'});
   g=applyAction(g,{type:'DISCARD_STUDY',playerId:id,cardIds:g.players.find(p=>p.id===id)!.hand.slice(0,2).map(c=>c.id)});
  }
  for(const id of ['p1','p2']) {
   const hand=g.players.find(p=>p.id===id)!.hand;
   g=applyAction(g,{type:'PREPARE_CARDS',playerId:id,rapidCardId:hand[3].id,preparedCardIds:hand.slice(0,3).map(c=>c.id)});
  }
  g=passExhaustedFixture(g,'p1');g=passExhaustedFixture(g,'p2');
  expect(g.phase).toBe('CLEANUP');expect(g.players.map(p=>p.victoryPoints)).toEqual([6,3]);
  expect(g.players.map(p=>p.cubes.onBoard)).toEqual([0,0]);
 });
 it('skips exhausted players but allows remaining spells with zero tokens',()=>{
  let g=actionGame();g.players[0].actionTokens=0;g.players[0].prepared={rapid:null,slot1:null,slot2:null,slot3:null};
  g=applyAction(g,{type:'PASS_ROUND',playerId:'p1'});
  g=applyAction(g,{type:'EXPLORE',playerId:'p2'});g=applyAction(g,{type:'END_EXPLORE',playerId:'p2'});g=applyAction(g,{type:'END_ACTIVATION',playerId:'p2'});
  expect(g.phase).toBe('ACTION');expect(g.currentPlayerId).toBe('p2');
 });
 it('automatically skips exhausted players, schedules a zero-token legal spell, then cleans up without passes',()=>{
  let g=actionGame();g.players[0].actionTokens=1;g.players[0].prepared={rapid:null,slot1:null,slot2:null,slot3:null};
  g.players[1].actionTokens=0;g.players[1].prepared={rapid:null,slot1:{card:spell(),used:false},slot2:null,slot3:null};
  g.players[1].wizard.position={q:0,r:1};
  g=applyAction(g,{type:'EXPLORE',playerId:'p1'});g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expect(g.currentPlayerId).toBe('p2');expect(g.phase).toBe('ACTION');
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p2',slot:'slot1',roomId:'room-0,0'});
  expect(g.phase).toBe('CLEANUP');expect(g.players.every(p=>!p.passed)).toBe(true);
 });
 it('lets a zero-token mage leave their starting room by discarding a prepared card',()=>{
  let g=actionGame();g.players[0].actionTokens=1;g.players[0].prepared={rapid:null,slot1:null,slot2:null,slot3:null};
  g.players[1].actionTokens=0;g.players[1].prepared={rapid:null,slot1:{card:spell({target:'MODEL',range:0}),used:false},slot2:null,slot3:null};
  g=applyAction(g,{type:'EXPLORE',playerId:'p1'});g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expect(g.phase).toBe('ACTION');expect(g.currentPlayerId).toBe('p2');
  const cardId=g.players[1].prepared.slot1!.card.id;
  g=applyAction(g,{type:'DISCARD_EXIT',playerId:'p2',cardId,destination:{q:-2,r:2}});
  expect(g.phase).toBe('CLEANUP');expect(g.players[1].wizard.position).toEqual({q:-2,r:2});
 });
 it('ends only at cleanup when a player reaches 30, choosing the highest score',()=>{
  let g=actionGame();g.players[0].victoryPoints=30;g.players[1].victoryPoints=32;
  g=passExhaustedFixture(g,'p1');expect(g.phase).toBe('ACTION');g=passExhaustedFixture(g,'p2');
  expect(g.phase).toBe('GAME_OVER');expect(g.winner).toBe('p2');expect(()=>advance(g)).toThrow();
 });
});

describe('free spells, starting rooms and colored chamber effects',()=>{
 it('casts one ordered spell plus the flexible spell for free, but never a second ordered spell in a turn',()=>{
  let g=actionGame();g.players[0].wizard.position={q:0,r:0};
  for(const [i,key] of (['slot1','slot2','slot3','rapid'] as const).entries())g.players[0].prepared[key]={card:spell({id:`free-${i}`,instability:0}),used:false};
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0'});
  expect(g.activation?.actionsUsed).toBe(0);expect(g.players[0].actionTokens).toBe(2);
  expect(()=>applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot2',roomId:'room-0,0'})).toThrow(/one sequenced/);
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
  expect(g.activation?.actionsUsed).toBe(0);expect(g.activation?.spellsCast).toBe(2);
  g=applyAction(g,{type:'END_ACTIVATION',playerId:'p1'});g=passExhaustedFixture(g,'p2');
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot2',roomId:'room-0,0'});
  expect(g.players[0].prepared.slot2!.used).toBe(true);expect(g.activation?.actionsUsed).toBe(0);
 });
 it('blocks spells and punches in a starting room and prevents voluntary reentry',()=>{
  let g=actionGame();g.players[1].wizard.position={q:2,r:-2};
  expect(()=>applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0',dummy:true})).toThrow(/Leave the starting/);
  expect(()=>applyAction(g,{type:'PUNCH',playerId:'p1',targetId:'p2'})).toThrow(/Leave the starting/);
  g=applyAction(g,{type:'EXPLORE',playerId:'p1'});g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:{q:2,r:-2}});
  expect(()=>applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:{q:3,r:-2}})).toThrow(/reenter/);
 });
 it('discards a held school card to exit one step without a token, routing it directly to its school',()=>{
  let g=actionGame();const card=g.library[2].cards.pop()!;g.players[0].hand.push(card);g.players[0].actionTokens=0;
  expect(()=>applyAction(g,{type:'DISCARD_EXIT',playerId:'p1',cardId:card.id,destination:{q:0,r:0}})).toThrow(/adjacent/);
  g=applyAction(g,{type:'DISCARD_EXIT',playerId:'p1',cardId:card.id,destination:{q:2,r:-2}});
  expect(g.library[2].discard.map(c=>c.id)).toContain(card.id);expect(g.players[0].discard.map(c=>c.id)).not.toContain(card.id);
  expect(g.activation?.actionsUsed).toBe(0);expect(g.players[0].actionTokens).toBe(0);
  expect(()=>applyAction(g,{type:'DISCARD_EXIT',playerId:'p1',cardId:card.id,destination:{q:1,r:-2}})).toThrow(/only available/);
 });
 it('maps all six colors to three rooms each, with a separate powerful center and protected starts',()=>{
  const g=createGame();const effects={crimson:'ROOM_DAMAGE',azure:'DRAW_DISCARD',emerald:'INSTABILITY',amber:'DRAW_QUEST',violet:'DRAW_GRIMOIRE',grey:'SUMMON_CADAVER'};
  expect(ROOM_COLORS).toEqual(['crimson','azure','emerald','amber','violet','grey']);
  expect(g.board.rooms.map(r=>r.color)).not.toContain('ivory');expect(g.board.rooms.map(r=>r.effect)).not.toContain('DRAW_LIBRARY');
  for(const color of ROOM_COLORS){const rooms=g.board.rooms.filter(r=>r.color===color);expect(rooms).toHaveLength(3);expect(rooms.every(r=>!r.startingFor && r.effect===effects[color])).toBe(true);}
  expect(g.board.rooms.filter(r=>r.effect==='DRAW_POWERFUL').map(r=>r.id)).toEqual(['room-0,0']);
  expect(g.board.rooms.filter(r=>r.color===null)).toHaveLength(5);
  expect(g.board.rooms.filter(r=>r.startingFor).every(r=>r.effect===null)).toBe(true);
 });
 it('protects all four starting rooms from voluntary entry and spells, including unoccupied starts',()=>{
  const initial=actionGame();
  for(const start of initial.board.rooms.filter(r=>r.startingFor)) {
   let g=structuredClone(initial);
   g.players[0].wizard.position={...g.board.rooms.find(r=>!r.startingFor && hexDistance(r.tiles[0],start.tiles[0])===1)!.tiles[0]};
   g.players[0].prepared.slot1={card:spell(),used:false};
   expect(()=>applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:start.id})).toThrow(/Starting rooms/);
   g=applyAction(g,{type:'EXPLORE',playerId:'p1'});
   expect(()=>applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:start.tiles[0]})).toThrow(/reenter/);
  }
 });
 it('activates each color effect for free at Explore start, no more than once per physical action',()=>{
  for(const color of ROOM_COLORS) {
   const effect=createGame().board.rooms.find(r=>r.color===color)!.effect!;
   let {g,room}=roomGame(effect);g.players[1].wizard.position={...room.tiles[0]};
   g.players[0].wizard.damageCubes=1;g.players[0].wizard.blackDamage=1;
  g.players[0].personalDeck.push(...g.players[0].discard.splice(0));
   g.players[0].discard.push(g.players[0].personalDeck.pop()!);
   const before=structuredClone(g);const p=before.players[0];
   g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  expect(g.activation?.actionsUsed).toBe(1);expect(g.activation?.roomEffectUsed).toBe(true);expect(g.players[0].actionTokens).toBe(1);
   expect(g.players[0].wizard).toEqual(p.wizard);expect(g.players[0].victoryPoints).toBe(p.victoryPoints);
   switch(room.effect) {
    case 'ROOM_DAMAGE':expect(g.players[1].wizard.damageByPlayer).toEqual({p1:1});expect(g.players[0].cubes.onWizard).toBe(1);break;
    case 'DRAW_DISCARD':expect(g.players[0].hand).toEqual([...p.hand,p.discard[0]]);expect(g.players[0].discard).toEqual([]);break;
    case 'INSTABILITY':expect(g.board.rooms.find(r=>r.id===room.id)!.cubesByPlayer).toEqual({p1:1});expect(g.players[0].cubes.onBoard).toBe(1);break;
    case 'DRAW_QUEST':expect(g.players[0].quest).toEqual(before.questDeck[0]);expect(g.questDeck).toEqual(before.questDeck.slice(1));break;
    case 'DRAW_GRIMOIRE':expect(g.players[0].hand).toEqual([...p.hand,p.personalDeck[0]]);expect(g.players[0].personalDeck).toEqual(p.personalDeck.slice(1));break;
    case 'SUMMON_CADAVER':expect(g.evocations).toHaveLength(1);expect(g.evocations[0]).toMatchObject({playerId:'p1',name:'Cadaver',position:p.wizard.position});expect(g.players[0].hand).toEqual(p.hand);expect(g.library).toEqual(before.library);break;
    default:throw new Error(`Unexpected color effect: ${room.effect}`);
   }
   expect(()=>applyAction(g,{type:'END_EXPLORE',playerId:'p1',activateRoomAtEnd:true})).toThrow(/already used/);
   g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});expect(g.activation?.actionsUsed).toBe(1);
   g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  expect(g.activation?.actionsUsed).toBe(2);expect(g.activation?.roomEffectUsed).toBe(true);expect(g.players[0].actionTokens).toBe(0);
  }
 });
 it('resolves Emerald at the final Explore position, either on the last step or when finishing early',()=>{
  for(const finishEarly of [false,true]) {
   let {g,room:destination}=roomGame('INSTABILITY');
   const middle=g.board.rooms.find(r=>!r.startingFor && r.id!==destination.id && hexDistance(r.tiles[0],destination.tiles[0])===1)!;
   const origin=g.board.rooms.find(r=>!r.startingFor && r.id!==destination.id && hexDistance(r.tiles[0],middle.tiles[0])===1)!;
  const target=g.board.rooms.find(r=>!r.startingFor && hexDistance(r.tiles[0],destination.tiles[0])===1 && hexDistance(r.tiles[0],middle.tiles[0])>1 && hexDistance(r.tiles[0],origin.tiles[0])>1)!;
   g.players[0].wizard.position={...(finishEarly?middle:origin).tiles[0]};
   g=applyAction(g,{type:'EXPLORE',playerId:'p1'});
   if(!finishEarly) {
    g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:middle.tiles[0],activateRoomAtEnd:true,roomTargetId:'missing-room'});
    expect(g.activation?.exploring).toBe(1);expect(g.activation?.roomEffectUsed).toBe(false);
    expect(g.board.rooms.every(r=>r.instability===0)).toBe(true);
   }
  g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p1',destination:destination.tiles[0],activateRoomAtEnd:!finishEarly,roomTargetId:target.id});
  if(finishEarly)g=applyAction(g,{type:'END_EXPLORE',playerId:'p1',activateRoomAtEnd:true,roomTargetId:target.id});
   expect(g.players[0].wizard.position).toEqual(destination.tiles[0]);expect(g.activation?.exploring).toBe(0);
  expect(g.board.rooms.find(r=>r.id===target.id)!.cubesByPlayer).toEqual({p1:1});
  expect(g.board.rooms.filter(r=>r.id!==target.id).every(r=>r.instability===0)).toBe(true);
  expect(g.activation?.actionsUsed).toBe(1);expect(g.players[0].actionTokens).toBe(1);
  }
 });
 it('adds Crimson damage and two owned cubes around a punch at START or END for one physical action',()=>{
  for(const timing of ['START','END'] as const) {
   let {g,room}=roomGame('ROOM_DAMAGE');
   for(const p of g.players)p.wizard.position={...room.tiles[0]};
   g=applyAction(g,{type:'PUNCH',playerId:'p1',targetId:'p2',roomEffect:timing});
  expect(g.activation?.actionsUsed).toBe(1);expect(g.activation?.roomEffectUsed).toBe(true);expect(g.players[0].actionTokens).toBe(1);
   expect(g.players[1].wizard.damageCubes).toBe(2);expect(g.players[1].wizard.damageByPlayer).toEqual({p1:2});
  expect(g.players[0].cubes).toEqual({available:23,onWizard:2,onBoard:0,onEvocations:0});expect(g.players[0].victoryPoints).toBe(0);
  }
 });
 it('Crimson damages every enemy in its room, never self or outsiders, and does not heal existing cubes',()=>{
  let {g,room}=roomGame('ROOM_DAMAGE');g.players[1].wizard.position={...room.tiles[0]};
  for(const id of ['p3','p4']) {
   const p=structuredClone(g.players[1]);p.id=id;p.wizard.id=`${id}-wizard`;p.wizard.playerId=id;
   if(id==='p4')p.wizard.position={q:0,r:0};g.players.push(p);
  }
  g.players[0].wizard.damageCubes=1;g.players[0].wizard.blackDamage=0;g.players[0].wizard.damageByPlayer={p2:1};
  g.players[1].cubes.available=24;g.players[1].cubes.onWizard=1;
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  expect(g.players.map(p=>p.wizard.damageCubes)).toEqual([1,1,1,0]);
  expect(g.players.map(p=>p.wizard.damageByPlayer)).toEqual([{p2:1},{p1:1},{p1:1},{}]);
  expect(g.players[0].cubes).toEqual({available:23,onWizard:2,onBoard:0,onEvocations:0});
  expect(g.players[1].cubes).toEqual({available:24,onWizard:1,onBoard:0,onEvocations:0});expect(g.players.every(p=>p.wizard.blackDamage===0)).toBe(true);
 });
 it('casts a model spell on a dummy, applying instability but no damage or damage cubes',()=>{
  let g=giveSpell(actionGame(),spell({damage:4,target:'MODEL'}));for(const p of g.players)p.wizard.position={q:0,r:0};
  const before=g.players.map(p=>p.wizard.damageCubes);const room=g.board.rooms.find(r=>r.id==='room-0,0')!;
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',dummy:true,roomId:room.id});
  expect(g.players.map(p=>p.wizard.damageCubes)).toEqual(before);expect(g.players.every(p=>p.cubes.onWizard===0)).toBe(true);
  expect(g.board.rooms.find(r=>r.id===room.id)!.instability).toBe(room.instability+2);expect(g.activation?.actionsUsed).toBe(0);
 });
 it('routes Study, cast, and uncast shared-library cards to their own school discards',()=>{
  let g=studyGame();g=applyAction(g,{type:'DRAW_STUDY',playerId:'p1',deckId:'school-3'});
  const cards=g.players[0].hand.filter(c=>c.schoolId==='school-3').slice(0,2);
  g=applyAction(g,{type:'DISCARD_STUDY',playerId:'p1',cardIds:cards.map(c=>c.id)});
  expect(g.library[2].discard.map(c=>c.id)).toEqual(cards.map(c=>c.id));expect(g.players[0].discard).toHaveLength(0);
  g=actionGame();g.players[0].wizard.position={q:0,r:0};const prepared=g.players[0].prepared.slot1!.card;
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0',...(prepared.target==='MODEL'?{dummy:true}:{})});
  expect(g.library[0].discard.map(c=>c.id)).toContain(prepared.id);expect(g.players[0].discard.map(c=>c.id)).not.toContain(prepared.id);
  const uncast=Object.values(g.players[0].prepared).filter(c=>c&&!c.used).map(c=>c!.card.id);
  g=advance(cleanupBoundaryFixture(g));
  for(const id of uncast)expect(g.library[0].discard.map(c=>c.id)).toContain(id);
 });
});

describe('room effect regressions',()=>{
 it('credits Crimson defeats and kill quests without punching a respawn after a START finishing blow',()=>{
  for(const action of ['EXPLORE','PUNCH'] as const) {
   let {g,room}=roomGame('ROOM_DAMAGE');g.players[1].wizard.position={...room.tiles[0]};
   g.players[1].wizard.damageCubes=9;g.players[1].wizard.blackDamage=9;
   const kill=quest('crimson-kill','KILL');g.players[0].quest=kill;
   g=action==='EXPLORE'?applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true}):applyAction(g,{type:'PUNCH',playerId:'p1',targetId:'p2',roomEffect:'START'});
   expect(g.players[1].wizard.position).toEqual(g.board.rooms.find(r=>r.startingFor==='p2')!.tiles[0]);
   expect(g.players[1].wizard.damageCubes).toBe(0);expect(g.players[1].wizard.blackDamage).toBe(0);expect(g.players[1].wizard.damageByPlayer).toEqual({});
  expect(g.players[0].cubes).toEqual({available:25,onWizard:0,onBoard:0,onEvocations:0});
   expect(g.players[0].kills).toBe(1);expect(g.players[0].victoryPoints).toBe(7);expect(g.players[0].questsCompleted).toBe(1);
   expect(g.players[0].quest).toBeNull();expect(g.questDiscard).toEqual([kill]);
  expect(g.activation?.actionsUsed).toBe(1);expect(g.players[0].actionTokens).toBe(1);
  }
 });
 it('Azure splices a random first, middle or last personal discard without accessing any other pile',()=>{
  for(const [random,index] of [[0,0],[0.5,1],[0.999,2]]) {
   let {g}=roomGame('DRAW_DISCARD');const p=g.players[0];
   p.personalDeck.push(...p.discard.splice(0));p.discard=p.personalDeck.splice(0,3);
   g.library[2].discard.push(g.library[2].cards.pop()!);
   const before=structuredClone(g);const spy=vi.spyOn(Math,'random').mockReturnValue(random);
   try {
    g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
    expect(spy).toHaveBeenCalledTimes(1);
    expect(g.players[0].hand).toEqual([...before.players[0].hand,before.players[0].discard[index]]);
    expect(g.players[0].discard).toEqual(before.players[0].discard.filter((_,i)=>i!==index));
    expect(g.players[0].personalDeck).toEqual(before.players[0].personalDeck);expect(g.players[0].prepared).toEqual(before.players[0].prepared);
    expect(g.players[1]).toEqual(before.players[1]);expect(g.library).toEqual(before.library);expect(g.powerfulDeck).toEqual(before.powerfulDeck);expect(g.removedCards).toEqual(before.removedCards);
   } finally {spy.mockRestore();}
  }
 });
 it('Azure with an empty personal discard is a no-op even when other personal and school piles have cards',()=>{
  let {g}=roomGame('DRAW_DISCARD');g.players[0].personalDeck.push(...g.players[0].discard.splice(0));
  g.library[0].discard.push(g.library[0].cards.pop()!);g.players[1].discard.push(g.players[1].personalDeck.pop()!);
  const before=structuredClone(g);
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  expect(g.players[0].hand).toEqual(before.players[0].hand);expect(g.players[0].discard).toEqual([]);
  expect(g.players[0].personalDeck).toEqual(before.players[0].personalDeck);expect(g.library).toEqual(before.library);expect(g.players[1]).toEqual(before.players[1]);
  expect(g.activation?.roomEffectUsed).toBe(true);expect(g.activation?.actionsUsed).toBe(1);expect(g.players[0].actionTokens).toBe(1);
 });
 it('Emerald defaults to its own room, accepts adjacent targets including on Punch, and rejects distant or starting rooms',()=>{
  const initial=roomGame('INSTABILITY');const room=initial.room;
  const adjacent=initial.g.board.rooms.find(r=>!r.startingFor && hexDistance(r.tiles[0],room.tiles[0])===1)!;
  for(const roomTargetId of [undefined,room.id,adjacent.id]) {
   let g=applyAction(initial.g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true,roomTargetId});
   const target=roomTargetId??room.id;
   expect(g.board.rooms.find(r=>r.id===target)!.cubesByPlayer).toEqual({p1:1});
   expect(g.board.rooms.filter(r=>r.id!==target).every(r=>r.instability===0)).toBe(true);
  expect(g.players[0].cubes).toEqual({available:24,onWizard:0,onBoard:1,onEvocations:0});
   g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});expect(g.activation?.actionsUsed).toBe(1);
  }
  for(const timing of ['START','END'] as const) {
   const g=structuredClone(initial.g);g.players[1].wizard.position={...room.tiles[0]};
   const n=applyAction(g,{type:'PUNCH',playerId:'p1',targetId:'p2',roomEffect:timing,roomTargetId:adjacent.id});
   expect(n.board.rooms.find(r=>r.id===adjacent.id)!.cubesByPlayer).toEqual({p1:1});
  expect(n.players[0].cubes).toEqual({available:23,onWizard:1,onBoard:1,onEvocations:0});expect(n.players[0].actionTokens).toBe(1);
  }
  const distant=initial.g.board.rooms.find(r=>!r.startingFor && hexDistance(r.tiles[0],room.tiles[0])>1)!;
  for(const target of [...initial.g.board.rooms.filter(r=>r.startingFor).map(r=>({id:r.id,error:/Starting/})),{id:distant.id,error:/range/},{id:'missing-room',error:/not found/}]) {
   const before=structuredClone(initial.g);
   expect(()=>applyAction(initial.g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true,roomTargetId:target.id})).toThrow(target.error);
   expect(initial.g).toEqual(before);
   const exploring=applyAction(initial.g,{type:'EXPLORE',playerId:'p1'});
   expect(()=>applyAction(exploring,{type:'END_EXPLORE',playerId:'p1',activateRoomAtEnd:true,roomTargetId:target.id})).toThrow(target.error);
  }
  const azure=roomGame('DRAW_DISCARD').g;
  expect(()=>applyAction(azure,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true,roomTargetId:adjacent.id})).toThrow(/Only Emerald/);
 });
 it('Amber retains the primary quest, completes all matching additional quests and promotes the remaining quest',()=>{
  let {g,room}=roomGame('DRAW_QUEST');const primary=quest('primary-kill','KILL'),extra=quest('extra-kill','KILL',4),remaining=quest('remaining','INSTABILITY',2,2);
  g.players[0].quest=primary;g.players[0].additionalQuests=[remaining];g.questDeck=[extra];
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  expect(g.players[0].quest).toEqual(primary);expect(g.players[0].additionalQuests).toEqual([remaining,extra]);expect(g.questDeck).toEqual([]);
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  g.players[1].wizard.position={...room.tiles[0]};g.players[1].wizard.health=4;
  g=giveSpell(g,spell({damage:4,instability:0}));g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:room.id});
  expect(g.players[0].victoryPoints).toBe(11);expect(g.players[0].questsCompleted).toBe(2);expect(g.players[0].kills).toBe(1);
  expect(g.players[0].quest).toEqual(remaining);expect(g.players[0].additionalQuests).toEqual([]);expect(g.questDiscard).toEqual([primary,extra]);
  g.players[0].prepared.rapid={card:spell({id:'finish-promoted'}),used:false};
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:room.id});
  expect(g.players[0].quest).toBeNull();expect(g.players[0].additionalQuests).toEqual([]);expect(g.players[0].questsCompleted).toBe(3);
  expect(g.players[0].victoryPoints).toBe(13);expect(g.questDiscard).toEqual([primary,extra,remaining]);
 });
 it('Amber recycles only completed quests and leaves held quests unchanged when both quest piles are exhausted',()=>{
  for(const hasPrimary of [false,true]) {
   let {g}=roomGame('DRAW_QUEST');const held=quest('held','KILL'),recycled=quest('recycled','REBUILD');
   g.players[0].quest=hasPrimary?held:null;g.questDeck=[];g.questDiscard=[recycled];
   g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
   expect(g.players[0].quest).toEqual(hasPrimary?held:recycled);expect(g.players[0].additionalQuests).toEqual(hasPrimary?[recycled]:[]);
   expect(g.questDeck).toEqual([]);expect(g.questDiscard).toEqual([]);
   g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});const before=structuredClone(g.players[0]);
   g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
   expect(g.players[0].quest).toEqual(before.quest);expect(g.players[0].additionalQuests).toEqual(before.additionalQuests);
   expect(g.players[0].questsCompleted).toBe(0);expect(g.players[0].victoryPoints).toBe(0);expect(g.questDeck).toEqual([]);expect(g.questDiscard).toEqual([]);
  }
 });
 it('Violet draws an ordinary grimoire card, recycling only personal discard without refunding a token',()=>{
  for(const mode of ['deck','recycle','empty']) {
  let {g}=roomGame('DRAW_GRIMOIRE');const p=g.players[0];
   if(mode!=='deck')p.discard.push(...p.personalDeck.splice(0));
   if(mode==='empty')p.hand.push(...p.discard.splice(0));
   const before=structuredClone(g);const available=[...p.personalDeck,...p.discard];
   g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
  expect(g.players[0].actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);
   expect(g.players[0].hand).toHaveLength(before.players[0].hand.length+(mode==='empty'?0:1));
   if(mode!=='empty'){expect(available).toContainEqual(g.players[0].hand.at(-1));expect(g.players[0].hand.at(-1)?.powerful).not.toBe(true);}
   if(mode==='deck')expect(g.players[0].hand.at(-1)).toEqual(before.players[0].personalDeck[0]);
   if(mode==='recycle')expect(g.players[0].discard).toEqual([]);
   expect(g.players[0].personalDeck.length+g.players[0].discard.length).toBe(available.length-(mode==='empty'?0:1));
   expect(g.library).toEqual(before.library);expect(g.powerfulDeck).toEqual(before.powerfulDeck);expect(g.players[1]).toEqual(before.players[1]);
  }
 });
 it('Grey summons instead of drawing or recycling any school, including a stocked, discarded or exhausted School 6',()=>{
  for(const mode of ['deck','recycle','empty']) {
   let {g}=roomGame('SUMMON_CADAVER');const school=g.library[5];
   if(mode!=='deck')school.discard.push(...school.cards.splice(0));
   if(mode==='empty')g.players[1].hand.push(...school.discard.splice(0));
   const before=structuredClone(g);const ids=physicalCards(g).map(c=>c.id);
   g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});
   expect(g.evocations).toHaveLength(1);expect(g.evocations[0]).toMatchObject({playerId:'p1',position:before.players[0].wizard.position});
   expect(g.players[0].hand).toEqual(before.players[0].hand);expect(g.library).toEqual(before.library);
   expect(g.players[0].personalDeck).toEqual(before.players[0].personalDeck);expect(g.players[0].prepared).toEqual(before.players[0].prepared);
   expect(g.players[0].discard).toEqual(before.players[0].discard);expect(g.players[1]).toEqual(before.players[1]);expect(g.powerfulDeck).toEqual(before.powerfulDeck);
   expect(g.removedCards).toEqual(before.removedCards);expectConserved(g,ids);
   expect(g.players[0].actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);expect(g.evocationActivation).toBeNull();
  }
 });
});

describe('finite powerful spells',()=>{
 it('creates twelve globally unique powerful cards, four of each printed pattern, separate from ordinary spells',()=>{
  const g=createGame();expect(g.powerfulDeck).toHaveLength(12);expect(g.removedCards).toEqual([]);
  for(const pattern of [[6,3,3,'ROOM'],[8,1,4,'MODEL'],[4,4,2,'ROOM']]) {
   expect(g.powerfulDeck.filter(c=>JSON.stringify([c.damage,c.instability,c.range,c.target])===JSON.stringify(pattern))).toHaveLength(4);
  }
  expect(g.powerfulDeck.every(c=>c.kind==='SPELL' && c.powerful===true && !c.schoolId)).toBe(true);
  expect(physicalCards(g).filter(c=>!c.powerful)).toHaveLength(240);expect(g.players.every(p=>p.additionalQuests.length===0)).toBe(true);
  expectConserved(g,physicalCards(g).map(c=>c.id));
 });
 it('Center gives one held spell at Explore START or END, castable immediately after Explore but never during it',()=>{
  for(const timing of ['START','END']) {
   let {g}=roomGame('DRAW_POWERFUL');const card=g.powerfulDeck[0],beforeHand=[...g.players[0].hand];
   const cast={type:'CAST_POWERFUL_SPELL' as const,playerId:'p1',cardId:card.id,roomId:'room-0,0',...(card.target==='MODEL'?{dummy:true}:{})};
   g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:timing==='START'});
   if(timing==='START') {
    expect(g.players[0].hand).toEqual([...beforeHand,card]);expect(()=>applyAction(g,cast)).toThrow(/Finish exploring/);
    expect(()=>applyAction(g,{type:'END_EXPLORE',playerId:'p1',activateRoomAtEnd:true})).toThrow(/already used/);
   }
   g=applyAction(g,{type:'END_EXPLORE',playerId:'p1',activateRoomAtEnd:timing==='END'});
   expect(g.players[0].hand).toEqual([...beforeHand,card]);expect(g.powerfulDeck).toHaveLength(11);
   expect(Object.values(g.players[0].prepared).some(p=>p?.card.id===card.id)).toBe(false);
   const prepared=structuredClone(g.players[0].prepared);g=applyAction(g,cast);
   expect(g.players[0].hand).toEqual(beforeHand);expect(g.players[0].prepared).toEqual(prepared);expect(g.removedCards).toEqual([card]);
  expect(g.players[0].wizard.damageCubes).toBe(0);expect(g.players[0].actionTokens).toBe(1);expect(g.activation?.actionsUsed).toBe(1);
   expect(g.activation?.spellsCast).toBe(1);expect(g.activation?.sequencedSpellUsed).toBe(false);expect(()=>applyAction(g,cast)).toThrow(/unavailable/);
  }
 });
 it('casts multiple held powers with zero tokens before or after a numbered spell without consuming its quota',()=>{
  for(const powersFirst of [true,false]) {
   let {g}=roomGame('DRAW_POWERFUL');const powers=[holdPowerful(g),holdPowerful(g)];g.players[0].actionTokens=0;
   const numbered={type:'CAST_SPELL' as const,playerId:'p1',slot:'slot1' as const,roomId:'room-0,0',...(g.players[0].prepared.slot1!.card.target==='MODEL'?{dummy:true}:{})};
   if(!powersFirst)g=applyAction(g,numbered);
   for(const card of powers)g=applyAction(g,{type:'CAST_POWERFUL_SPELL',playerId:'p1',cardId:card.id,roomId:'room-0,0'});
   if(powersFirst){expect(g.activation?.sequencedSpellUsed).toBe(false);g=applyAction(g,numbered);}
   expect(g.currentPlayerId).toBe('p1');expect(g.activation?.actionsUsed).toBe(0);expect(g.players[0].actionTokens).toBe(0);
   expect(g.activation?.spellsCast).toBe(3);expect(g.activation?.sequencedSpellUsed).toBe(true);expect(g.removedCards).toEqual(powers);
   expect(()=>applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot2',roomId:'room-0,0',dummy:true})).toThrow(/one sequenced/);
  }
 });
 it('schedules a zero-token mage with only a held model power for a dummy cast, but skips one trapped in a start',()=>{
  for(const inStart of [false,true]) {
   let {g}=roomGame('DRAW_POWERFUL');g.players[0].actionTokens=1;g.players[0].prepared={rapid:null,slot1:null,slot2:null,slot3:null};g.players[0].hand=[];
   g.players[1].actionTokens=0;g.players[1].prepared={rapid:null,slot1:null,slot2:null,slot3:null};g.players[1].hand=[];
   if(!inStart)g.players[1].wizard.position={q:0,r:0};const card=holdPowerful(g,'MODEL','p2');
   g=applyAction(g,{type:'EXPLORE',playerId:'p1'});g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
   if(inStart){expect(g.phase).toBe('CLEANUP');expect(g.players[1].hand).toEqual([card]);expect(g.removedCards).toEqual([]);continue;}
   expect(g.currentPlayerId).toBe('p2');expect(g.phase).toBe('ACTION');const damage=g.players.map(p=>p.wizard.damageCubes);
   g=applyAction(g,{type:'CAST_POWERFUL_SPELL',playerId:'p2',cardId:card.id,dummy:true,roomId:'room-0,0'});
   expect(g.players.map(p=>p.wizard.damageCubes)).toEqual(damage);expect(g.players.every(p=>p.cubes.onWizard===0)).toBe(true);
  expect(g.board.rooms.find(r=>r.id==='room-0,0')!.cubesByPlayer).toEqual({p2:1});expect(g.players[1].cubes).toEqual({available:24,onWizard:0,onBoard:1,onEvocations:0});
   expect(g.players[1].hand).toEqual([]);expect(g.removedCards).toEqual([card]);expect(g.phase).toBe('CLEANUP');expect(g.players.every(p=>!p.passed)).toBe(true);
  }
 });
 it('prepares powers through the normal API and applies slot order and numbered quota, removing each cast exactly once',()=>{
  let g=studyGame();const ids=physicalCards(g).map(c=>c.id),ordered=holdPowerful(g,'MODEL'),rapid=holdPowerful(g);
  const ordinary=g.library[0].cards.slice(0,2);g=actionGame(g,[ordinary[0].id,ordered.id,ordinary[1].id,rapid.id]);
  g.players[0].wizard.position={q:0,r:0};
  expect(g.players[0].prepared.slot2?.card).toEqual(ordered);expect(g.players[0].prepared.rapid?.card).toEqual(rapid);
  expect(g.players[0].hand.some(c=>c.powerful)).toBe(false);expectConserved(g,ids);
  expect(()=>applyAction(g,{type:'CAST_POWERFUL_SPELL',playerId:'p1',cardId:ordered.id,dummy:true,roomId:'room-0,0'})).toThrow(/unavailable/);
  expect(()=>applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot2',dummy:true,roomId:'room-0,0'})).toThrow(/order/);
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});expect(g.activation?.sequencedSpellUsed).toBe(false);
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',roomId:'room-0,0',...(ordinary[0].target==='MODEL'?{dummy:true}:{})});
  expect(()=>applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot2',dummy:true,roomId:'room-0,0'})).toThrow(/one sequenced/);
  g=applyAction(g,{type:'END_ACTIVATION',playerId:'p1'});g=passExhaustedFixture(g,'p2');
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot2',dummy:true,roomId:'room-0,0'});
  expect(g.players[0].prepared.slot2?.used).toBe(true);expect(g.players[0].prepared.rapid?.used).toBe(true);expect(g.removedCards).toEqual([rapid,ordered]);
  expect(g.activation?.sequencedSpellUsed).toBe(true);expect(g.activation?.actionsUsed).toBe(0);
  expect(()=>applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'slot2',dummy:true,roomId:'room-0,0'})).toThrow(/unavailable/);expectConserved(g,ids);
 });
 it('keeps held powers through cleanup, returns unused powerful preparations next Black Rose and conserves cards across rounds',()=>{
  let g=studyGame();const ids=physicalCards(g).map(c=>c.id),unused=holdPowerful(g),cast=holdPowerful(g),held=holdPowerful(g,'MODEL');
  const ordinary=g.library[0].cards.slice(0,2);g=actionGame(g,[unused.id,ordinary[0].id,ordinary[1].id,cast.id]);
  g.players[0].wizard.position={q:0,r:0};g=applyAction(g,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});expectConserved(g,ids);
  for(let round=1;round<=2;round++) {
    expect(()=>applyAction(g,{type:'PASS_ROUND',playerId:'p1'})).toThrow(/no physical tokens and no unused spells/);
    g=cleanupBoundaryFixture(g);
   expect(g.phase).toBe('CLEANUP');expect(g.players[0].hand).toContainEqual(held);expect(g.removedCards).toEqual([cast]);expectConserved(g,ids);
   if(round===1){expect(g.players[0].prepared.slot1?.card).toEqual(unused);expect(g.players[0].hand).not.toContainEqual(unused);}
   g=advance(g);expect(g.phase).toBe('BLACK_ROSE');expect(g.players[0].prepared).toEqual({rapid:null,slot1:null,slot2:null,slot3:null});
   expect(g.players[0].hand.filter(c=>c.id===unused.id)).toEqual([unused]);expect(g.players[0].hand.filter(c=>c.id===held.id)).toEqual([held]);
   expect(g.players.flatMap(p=>p.discard).some(c=>c.powerful)).toBe(false);expect(g.library.flatMap(d=>d.discard).some(c=>c.powerful)).toBe(false);
   expect(g.powerfulDeck).toHaveLength(9);expect(g.removedCards).toEqual([cast]);expectConserved(g,ids);
   if(round===1){g=actionGame(advance(g));expect(g.players[0].hand.filter(c=>c.powerful)).toEqual(expect.arrayContaining([held,unused]));expectConserved(g,ids);}
  }
 });
 it('rejects powerful discards in Study and both held and prepared discard exits without changing the input',()=>{
  let g=studyGame();const card=holdPowerful(g);g=applyAction(g,{type:'DRAW_STUDY',playerId:'p1',deckId:'school-1'});
  const before=structuredClone(g),ordinary=g.players[0].hand.find(c=>!c.powerful)!;
  for(const cardIds of [[ordinary.id,card.id],[card.id,ordinary.id]]) {
   expect(()=>applyAction(g,{type:'DISCARD_STUDY',playerId:'p1',cardIds})).toThrow(/Powerful spells cannot be discarded/);expect(g).toEqual(before);
  }
  expect(()=>applyAction(g,{type:'CAST_POWERFUL_SPELL',playerId:'p1',cardId:card.id,roomId:'room-0,0'})).toThrow(/unavailable in STUDY/);
  for(const prepared of [false,true]) {
   g=actionGame();const power=holdPowerful(g);g.players[0].actionTokens=0;
   if(prepared){g.players[0].hand.push(g.players[0].prepared.slot1!.card);g.players[0].prepared.slot1={card:power,used:false};g.players[0].hand=g.players[0].hand.filter(c=>c.id!==power.id);}
   const snapshot=structuredClone(g);
   expect(()=>applyAction(g,{type:'DISCARD_EXIT',playerId:'p1',cardId:power.id,destination:{q:2,r:-2}})).toThrow(/Powerful spells cannot be discarded/);expect(g).toEqual(snapshot);
  }
 });
 it('validates powerful casts atomically against starts, range and invalid targets, then resolves printed damage and instability',()=>{
  for(const name of ['Rosefall','Sovereign Wrath','Worldbreaker']) {
   let {g}=roomGame('DRAW_POWERFUL');const [card]=g.powerfulDeck.splice(g.powerfulDeck.findIndex(c=>c.name===name),1);g.players[0].hand.push(card);
    const ordinary=g.players[0].personalDeck.pop()!;g.players[0].hand.push(ordinary);
   const cast={type:'CAST_POWERFUL_SPELL' as const,playerId:'p1',cardId:card.id};const before=structuredClone(g);
   g.players[0].wizard.position={q:3,r:-2};
    const inStart=structuredClone(g);
   expect(()=>applyAction(g,{...cast,roomId:'room-0,0',...(card.target==='MODEL'?{dummy:true}:{})})).toThrow(/Leave the starting/);
    expect(g).toEqual(inStart);g=structuredClone(before);
   for(const start of g.board.rooms.filter(r=>r.startingFor)) {
    expect(()=>applyAction(g,{...cast,roomId:start.id,...(card.target==='MODEL'?{dummy:true}:{})})).toThrow(/Starting rooms/);
   }
   if(card.target==='MODEL') {
    expect(()=>applyAction(g,{...cast,targetPlayerId:'p2'})).toThrow(/starting room/);
    expect(()=>applyAction(g,{...cast,targetPlayerId:'p1'})).toThrow(/another mage/);
    expect(()=>applyAction(g,{...cast,dummy:true,roomId:'room-0,0',targetPlayerId:'p2'})).toThrow(/either/);
   } else {
    expect(()=>applyAction(g,{...cast,dummy:true,roomId:'room-0,0'})).toThrow(/single-model/);
    g.players[0].wizard.position={q:-2,r:0};
    expect(()=>applyAction(g,{...cast,roomId:'room-2,0'})).toThrow(/range/);g.players[0].wizard.position={q:0,r:0};
   }
   expect(()=>applyAction(g,{...cast,cardId:'missing-card',roomId:'room-0,0'})).toThrow(/unavailable/);
   expect(()=>applyAction(g,{...cast,cardId:ordinary.id,roomId:'room-0,0'})).toThrow(/unavailable/);
   expect(g).toEqual(before);g.players[1].wizard.position={q:1,r:0};g.players[1].wizard.health=20;
   g=applyAction(g,{...cast,...(card.target==='MODEL'?{targetPlayerId:'p2'}:{roomId:'room-1,0'})});
   expect(g.players[1].wizard.damageCubes).toBe(card.damage);expect(g.players[1].wizard.damageByPlayer).toEqual({p1:card.damage});expect(g.players[0].wizard.damageCubes).toBe(0);
   expect(g.board.rooms.find(r=>r.id==='room-1,0')!.instability).toBe(card.instability);
  expect(g.players[0].cubes).toEqual({available:25-card.damage-card.instability,onWizard:card.damage,onBoard:card.instability,onEvocations:0});
  expect(g.removedCards).toEqual([card]);expect(g.players[0].actionTokens).toBe(2);expect(g.activation?.actionsUsed).toBe(0);
  }
 });
 it('exhausts all twelve powers permanently without recycling removed cards through Center, personal or school draws',()=>{
  let {g}=roomGame('DRAW_POWERFUL');const ids=physicalCards(g).map(c=>c.id);
  const last=g.powerfulDeck[0],powers=g.powerfulDeck.splice(1);g.players[0].hand.push(...powers);
  for(const card of powers) {
   g=applyAction(g,{type:'CAST_POWERFUL_SPELL',playerId:'p1',cardId:card.id,roomId:'room-0,0',...(card.target==='MODEL'?{dummy:true}:{})});expectConserved(g,ids);
  }
  expect(g.powerfulDeck).toEqual([last]);expect(g.removedCards).toEqual(powers);
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expect(g.players[0].hand).toContainEqual(last);expect(g.powerfulDeck).toEqual([]);
  g=applyAction(g,{type:'CAST_POWERFUL_SPELL',playerId:'p1',cardId:last.id,roomId:'room-0,0',...(last.target==='MODEL'?{dummy:true}:{})});
  const removed=structuredClone(g.removedCards),hand=structuredClone(g.players[0].hand);
  // The preceding powers rebuilt Center: its special cannot be repeated until cleanup.
  const locked=structuredClone(g);
  expect(()=>applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true})).toThrow(/special already used/);expect(g).toEqual(locked);
  g=applyAction(g,{type:'EXPLORE',playerId:'p1'});g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expect(g.players[0].hand).toEqual(hand);expect(g.powerfulDeck).toEqual([]);expect(g.removedCards).toEqual(removed);expect(removed).toHaveLength(12);expectConserved(g,ids);
  g=passExhaustedFixture(g,'p1');g=passExhaustedFixture(g,'p2');g=advance(g);
  for(const p of g.players)p.discard.push(...p.personalDeck.splice(0));
  for(const school of g.library)school.discard.push(...school.cards.splice(0));
  g=actionGame(advance(g));
  // The refreshed Center now resolves with an empty supply, rather than recycling exiled powers.
  const nextHand=structuredClone(g.players[0].hand);
  g=applyAction(g,{type:'EXPLORE',playerId:'p1',activateRoomAtStart:true});g=applyAction(g,{type:'END_EXPLORE',playerId:'p1'});
  expect(g.players[0].hand).toEqual(nextHand);
  expect(g.powerfulDeck).toEqual([]);expect(g.removedCards).toEqual(removed);
  expect(g.players.flatMap(p=>[...p.hand,...p.personalDeck,...p.discard,...Object.values(p.prepared).filter(Boolean).map(c=>c!.card)]).some(c=>c.powerful)).toBe(false);
  expect(g.library.flatMap(d=>[...d.cards,...d.discard]).some(c=>c.powerful)).toBe(false);expectConserved(g,ids);
 });
});