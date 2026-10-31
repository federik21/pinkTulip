import { moment, momentTotal } from '../src/cards';
import { describe, expect, it, vi } from 'vitest';
import { applyAction, createGame, GameState, Card, Quest, RoomEffect, ROOM_COLORS, hexDistance, MAGE_DRAFT_POOL } from '../src';

const advance=(g:GameState)=>applyAction(g,{type:'ADVANCE_PHASE',playerId:'p1',expectedPhase:g.phase,expectedRound:g.round});

function readyGame(count=2) {
 let g=createGame(count);
 for(const p of g.players) p.connected=true;
 // Legacy movement/effect fixtures deliberately use the full board; default sizing has dedicated tests.
 g=applyAction(g,{type:'SET_ROOM_COUNT',playerId:'p1',roomsPerColor:3});
 for(const p of g.players)g=applyAction(g,{type:'SET_READY',playerId:p.id,ready:true});
 expect(g.phase).toBe('LOBBY');expect(g.round).toBe(0); // Only the server auto-starts after readiness.
 return g;
}
function studyGame(count=2) {
 let g=applyAction(readyGame(count),{type:'START_GAME',playerId:'p1'});
 for(const [index,id] of g.setupOrder!.entries())g=applyAction(g,{type:'DRAFT_SCHOOL',playerId:id,schoolId:g.library[index].id});
 for(const [index,id] of [...g.setupOrder!].reverse().entries())g=applyAction(g,{type:'DRAFT_MAGE',playerId:id,mageId:MAGE_DRAFT_POOL[index].id});
 return advance(g);
}
function actionGame(g=studyGame(),p1Cards?:string[]) {
 for(const id of ['p1','p2']) {
  g=applyAction(g,{type:'DRAW_STUDY',playerId:id,deckId:g.library[0].id});
  g=applyAction(g,{type:'DISCARD_STUDY',playerId:id,cardIds:g.players.find(p=>p.id===id)!.studyCardIds!.filter(cardId=>id!=='p1'||!p1Cards?.includes(cardId)).slice(0,2)});
 }
 for(const id of ['p1','p2']) {
  const p=g.players.find(p=>p.id===id)!,overflow=p.hand.length-p.cardLimit;
  if(overflow>0)g=applyAction(g,{type:'DISCARD_HAND_LIMIT',playerId:id,cardIds:p.hand.filter(c=>!c.powerful && !(id==='p1'&&p1Cards?.includes(c.id))).slice(0,overflow).map(c=>c.id)});
  const ids=id==='p1' && p1Cards?p1Cards:g.players.find(p=>p.id===id)!.hand.filter(c=>!c.powerful).slice(0,4).map(c=>c.id);
  g=applyAction(g,{type:'PREPARE_CARDS',playerId:id,rapidCardId:ids[3],preparedCardIds:ids.slice(0,3)});
 }
 return g;
}
const spell=(changes:Partial<Card>={}):Card=>({id:'test-spell',name:'Test spell',kind:'SPELL',moments:[moment.instability(2)],range:4,target:'ROOM',...changes});
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
// Resume p1 through a real opposing action, preserving round tokens and every card.
function opponentTurn(g:GameState) {
 expect(g.currentPlayerId).toBe('p2');const p=g.players[1];
 if(p.actionTokens>0) {
  g=applyAction(g,{type:'EXPLORE',playerId:'p2'});
  if(g.board.rooms.some(r=>r.startingFor && hexDistance(r.tiles[0],p.wizard.position)===0)) {
   const destination=g.board.rooms.find(r=>!r.startingFor && hexDistance(r.tiles[0],p.wizard.position)===1)!.tiles[0];
   g=applyAction(g,{type:'EXPLORE_STEP',playerId:'p2',destination});
  }
  g=applyAction(g,{type:'END_EXPLORE',playerId:'p2'});
 } else {
  const slot=(['slot1','slot2','slot3','rapid'] as const).find(key=>p.prepared[key]&&!p.prepared[key]!.used)!;
  expect(slot).toBeDefined();const card=p.prepared[slot]!.card;
  const roomId=g.board.rooms.find(r=>r.tiles.some(h=>hexDistance(h,p.wizard.position)===0))!.id;
  g=applyAction(g,{type:'CAST_SPELL',playerId:'p2',slot,roomId,...(card.target==='MODEL'?{dummy:true}:{})});
 }
 if(g.currentPlayerId==='p2')g=applyAction(g,{type:'END_ACTIVATION',playerId:'p2'});
 expect(g.currentPlayerId).toBe('p1');expect(g.activation?.actionsUsed).toBe(0);return g;
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
// and next-Pink-Tulip routing, not legal passing or scoring. No cards are spent, moved or copied.
function cleanupBoundaryFixture(g:GameState) {
 g=structuredClone(g);g.phase='CLEANUP';g.currentPlayerId=null;g.activation=null;g.evocationActivation=null;
 return g;
}
// Used preparations reference discarded, removed or active cards, not extra physical cards.
const physicalCards=(g:GameState)=>[...g.powerfulDeck,...g.removedCards,...g.library.flatMap(d=>[...d.cards,...d.discard]),...[...g.readiedSpells??[],...g.ongoingSpells??[]].map(a=>a.card),...g.players.flatMap(p=>[...p.personalDeck,...p.hand,...p.discard,...Object.values(p.prepared).filter(c=>c&&!c.used).map(c=>c!.card)])];
function expectConserved(g:GameState,ids:string[]) {
 const cards=physicalCards(g);expect(cards).toHaveLength(120);expect(new Set(cards.map(c=>c.id)).size).toBe(cards.length);
 expect(cards.filter(c=>!c.powerful)).toHaveLength(108);expect(cards.filter(c=>c.powerful)).toHaveLength(12);
 for(const schoolId of g.library.map(deck=>deck.id))expect(cards.filter(c=>c.schoolId===schoolId)).toHaveLength(36);
 expect(cards.map(c=>c.id).sort()).toEqual([...ids].sort());
}

describe('lobby and decks',()=>{
 it('randomly assigns protected starting rooms around 19 playable rooms',()=>{
  const g=createGame();const starts=g.board.rooms.filter(r=>r.startingFor);
  expect(starts.map(r=>r.tiles[0])).toEqual(expect.arrayContaining([{q:-1,r:-2},{q:3,r:-2},{q:-3,r:2},{q:1,r:2}]));
  expect(starts).toHaveLength(4);expect(g.board.rooms.filter(r=>!r.startingFor)).toHaveLength(19);
  expect(g.board.tiles).toHaveLength(23);expect(new Set(g.board.tiles.map(h=>`${h.q},${h.r}`)).size).toBe(23);
  expect(g.board.tiles).not.toContainEqual({q:-2,r:3});
  expect(new Set(g.players.map(p=>p.wizard.startingRoomId)).size).toBe(g.players.length);
  for(const p of g.players)expect(g.board.rooms.find(room=>room.startingFor===p.id)?.tiles[0]).toEqual(p.wizard.position);
  expect(starts.every(r=>r.color===null && r.effect===null)).toBe(true);
  for(const start of starts)expect(g.board.rooms.some(r=>!r.startingFor && hexDistance(start.tiles[0],r.tiles[0])===1)).toBe(true);
 });
});