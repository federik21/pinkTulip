import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
 addPlayerToLobby, applyAction, BLACK_ROSE_ID, canStartGame, createEnchantmentDeck,
 createEvents, createGame, createSpellDeck, getSpellType, MAGE_COLOR_NAMES,
 ROOM_EFFECT_LABELS, STARTING_SCHOOL_CARDS,
} from '../src';
import type { GameAction, GameState, Player, SpellType } from '../src';

const select=(s:GameState,playerId='p1',schoolId='cantrip')=>applyAction(s,{type:'SELECT_STARTING_SCHOOL',playerId,schoolId});
const ready=(s:GameState,playerId='p1')=>applyAction(s,{type:'SET_READY',playerId,ready:true});
const start=(s:GameState)=>applyAction(s,{type:'START_GAME',playerId:s.hostId});
const advance=(s:GameState)=>applyAction(s,{type:'ADVANCE_PHASE',playerId:s.hostId,expectedPhase:s.phase,expectedRound:s.round});
function lobby(count=2) {
 const s=createGame(count);
 for(const p of s.players)p.connected=true;
 s.eventDeck=[{id:'quiet',name:'Quiet',description:'No effect',kind:'INSTABILITY',amount:0,rooms:0}];
 return s;
}
function readyLobby(schools=['cantrip','cantrip']) {
 let s=lobby(schools.length);
 for(const [i,school] of schools.entries())s=ready(select(s,`p${i+1}`,school),`p${i+1}`);
 return s;
}
function reject(s:GameState,action:GameAction,error:RegExp) {
 const before=structuredClone(s);
 expect(()=>applyAction(s,action)).toThrow(error);
 expect(s).toEqual(before);
}
function physicalCards(s:GameState) {
 return [
  ...s.library.flatMap(d=>[...d.cards,...d.discard]),...s.powerfulDeck,...s.removedCards,
  ...[...s.readiedSpells??[],...s.ongoingSpells??[]].map(a=>a.card),
  ...s.players.flatMap(p=>[...p.personalDeck,...p.hand,...p.discard,...Object.values(p.prepared).filter(c=>c&&!c.used).map(c=>c!.card)]),
 ];
}

describe('explicit starting-school lobby contract',()=>{
 it('exports the setup count, stable color names and legacy-optional public choice',()=>{
  expect(STARTING_SCHOOL_CARDS).toBe(7);
  expect(MAGE_COLOR_NAMES).toEqual({p1:'Rose',p2:'Blue',p3:'Amber',p4:'Green'});
  expectTypeOf<Player['startingSchoolId']>().toEqualTypeOf<string|null|undefined>();
  expectTypeOf<Extract<GameAction,{type:'SELECT_STARTING_SCHOOL'}>>().toEqualTypeOf<{type:'SELECT_STARTING_SCHOOL';playerId:string;schoolId:string}>();
  expectTypeOf<SpellType>().toEqualTypeOf<'COMBAT'|'CONTINGENCY'|'TRAP'|'PROTECTION'>();
 });
 it.each([1,2,3,4])('gates %i seats on connection, an explicit school, readiness and the minimum roster',count=>{
  let s=createGame(count);
  expect(s.players.every(p=>p.startingSchoolId===null && p.hand.length===0 && p.personalDeck.length===0 && p.discard.length===0)).toBe(true);
  expect(canStartGame(s)).toBe(false);
  for(const p of s.players)p.connected=true;
  for(const p of s.players) {
   expect(canStartGame(s)).toBe(false);
   reject(s,{type:'SET_READY',playerId:p.id,ready:true},/valid starting school/);
   s=select(s,p.id);expect(canStartGame(s)).toBe(false);
   s=ready(s,p.id);
  }
  expect(canStartGame(s)).toBe(count>=2);
  if(count===1)reject(s,{type:'START_GAME',playerId:'p1'},/At least 2/);
  else {
   for(const p of s.players) {
    const disconnected=structuredClone(s);disconnected.players.find(t=>t.id===p.id)!.connected=false;
    expect(canStartGame(disconnected)).toBe(false);
    reject(disconnected,{type:'START_GAME',playerId:'p1'},/must join/);
    const notReady=applyAction(s,{type:'SET_READY',playerId:p.id,ready:false});
    expect(canStartGame(notReady)).toBe(false);
   }
  expect(start(s).players.every(p=>p.hand.length===0 && p.personalDeck.length===6 && p.discard.length===1)).toBe(true);
  }
 });
 it.each(['','unknown','school-1','Cantrip','powerful'])('rejects invalid school %j without altering readiness, choices or cards',schoolId=>{
  const s=readyLobby();reject(s,{type:'SELECT_STARTING_SCHOOL',playerId:'p1',schoolId},/School not found/);
 });
 it.each([undefined,null,7,{}])('rejects malformed/missing school %j atomically',schoolId=>{
  const s=readyLobby();
  reject(s,{type:'SELECT_STARTING_SCHOOL',playerId:'p1',schoolId} as GameAction,/School not found/);
 });
 it('rejects unknown players and requires connection before selection/readiness',()=>{
  const s=createGame();
  reject(s,{type:'SELECT_STARTING_SCHOOL',playerId:'unknown',schoolId:'cantrip'},/Player not found/);
  reject(s,{type:'SELECT_STARTING_SCHOOL',playerId:'p1',schoolId:'cantrip'},/Join the room first/);
  reject(s,{type:'SET_READY',playerId:'p1',ready:true},/Join the room first/);
 });
 it.each([undefined,null,'removed-school'])('treats legacy/missing/invalid choice %j as unselected, never silently defaulting',choice=>{
  let s=readyLobby();
  if(choice===undefined)delete s.players[0].startingSchoolId;else s.players[0].startingSchoolId=choice;
  expect(canStartGame(s)).toBe(false);
  reject(s,{type:'START_GAME',playerId:'p1'},/valid starting school/);
  reject(s,{type:'SET_READY',playerId:'p1',ready:true},/valid starting school/);
  s=applyAction(s,{type:'SET_READY',playerId:'p1',ready:false});
  s=ready(select(s));expect(canStartGame(s)).toBe(true);
 });
 it('publishes choices without dealing, resets only the changed mage, and never redraws on switching',()=>{
  let s=readyLobby();const before=structuredClone(s);
  s=select(s,'p1','enchantment');
  expect(before.players[0]).toMatchObject({startingSchoolId:'cantrip',ready:true});
  expect(s.players[0]).toMatchObject({startingSchoolId:'enchantment',ready:false,hand:[]});
  expect(s.players[1]).toEqual(before.players[1]);
  expect(s.library).toEqual(before.library);expect(s.powerfulDeck).toEqual(before.powerfulDeck);
  for(const schoolId of ['transmutation','cantrip','enchantment','cantrip'])s=select(s,'p1',schoolId);
  expect(s.players[0].hand).toEqual([]);expect(s.library).toEqual(before.library);
  s=ready(s);const unchanged=select(s);
  expect(unchanged.players[0].ready).toBe(true);
  expect(JSON.parse(JSON.stringify(unchanged)).players.map((p:Player)=>p.startingSchoolId)).toEqual(['cantrip','cantrip']);
  const started=start(unchanged).players[0];
  expect(started.hand).toEqual([]);
  expect(started.personalDeck).toEqual(before.library[0].cards.slice(0,6));
  expect(started.discard).toEqual(before.library[0].cards.slice(6,7));
 });
 it('checks aggregated choices on a change, including an existing disconnected seat, and allows switching away',()=>{
  let s=readyLobby(['cantrip','transmutation']);
  s.library[0].discard.push(...s.library[0].cards.splice(7));
  // Preserve physical cards outside the available school supply.
  s.players[1].hand.push(...s.library[0].discard.splice(0));
  s.players[0].connected=false;
  reject(s,{type:'SELECT_STARTING_SCHOOL',playerId:'p2',schoolId:'cantrip'},/school supply/);
  s.players[0].connected=true;
  s=select(s,'p1','enchantment');
  s=select(s,'p2','cantrip');expect(s.players[1].ready).toBe(false);
 });
 it.each([0,6])('rejects selection when only %i cards remain even with other schools and personal decks stocked',available=>{
  const s=lobby();s.players[1].hand.push(...s.library[0].cards.splice(available));
  reject(s,{type:'SELECT_STARTING_SCHOOL',playerId:'p1',schoolId:'cantrip'},/school supply/);
  expect(s.players[0]).toMatchObject({startingSchoolId:null,ready:false,hand:[]});
 });
 it('initializes new lobby seats unselected and keeps a reconnecting seat choice without dealing',()=>{
  let s=readyLobby(['enchantment']);
  const joined=addPlayerToLobby(s);
  expect(joined.players[1]).toMatchObject({startingSchoolId:null,ready:false,hand:[]});
  expect(joined.players[0]).toEqual(s.players[0]);expect(canStartGame(joined)).toBe(false);
  s=joined;s.players[0].connected=false;expect(canStartGame(s)).toBe(false);
    s=JSON.parse(JSON.stringify(s));s.players[0].connected=true;s.players[1].connected=true;
  s=ready(select(s,'p2','transmutation'),'p2');
  expect(s.players[0].startingSchoolId).toBe('enchantment');
  expect(s.players.every(p=>p.hand.length===0)).toBe(true);expect(canStartGame(s)).toBe(true);
 });
 it.each(['BLACK_ROSE','STUDY','PREPARATION','ACTION','EVOCATION','CLEANUP','GAME_OVER'] as const)('rejects selection outside the lobby in %s',phase=>{
  const s=readyLobby();s.phase=phase;
  reject(s,{type:'SELECT_STARTING_SCHOOL',playerId:'p1',schoolId:'transmutation'},phase==='GAME_OVER'?/game is over/:/Action unavailable/);
 });
});

describe('atomic physical starting-school grimoire allocation',()=>{
 it('allocates 28 distinct physical shared cards to four personal grimoires and leaves exactly eight in their school',()=>{
  const s=readyLobby(['cantrip','cantrip','cantrip','cantrip']),before=structuredClone(s),stock=s.library[0].cards;
  const result=start(s);expect(s).toEqual(before);
  const grimoires=result.players.flatMap(p=>[...p.personalDeck,...p.discard]);
  expect(grimoires).toHaveLength(28);expect(new Set(grimoires.map(c=>c.id)).size).toBe(28);
  for(const [i,p] of result.players.entries()) {
  expect(p.hand).toEqual([]);
  expect(p.personalDeck).toEqual(stock.slice(i*7,i*7+6));
  expect(p.discard).toEqual(stock.slice(i*7+6,(i+1)*7));
  expect([...p.personalDeck,...p.discard].every(c=>c.schoolId==='cantrip')).toBe(true);
  expect(p.quest).toBeNull();
  }
  expect(result.library[0].cards).toEqual(stock.slice(28));expect(result.library[0].cards).toHaveLength(8);
  expect(result.library.slice(1)).toEqual(s.library.slice(1));
  expect(physicalCards(result).map(c=>c.id).sort()).toEqual(physicalCards(s).map(c=>c.id).sort());
  expect(new Set(physicalCards(result).map(c=>c.id)).size).toBe(120);
  expect(result).toMatchObject({phase:'BLACK_ROSE',round:1,firstPlayerId:'p1'});
 });
 it('deals seven from each chosen school without touching unchosen supplies or creating IDs',()=>{
  const s=readyLobby(['enchantment','transmutation','cantrip','enchantment']),before=structuredClone(s);
  const result=start(s);
  for(const school of s.library) {
   const selected=result.players.filter(p=>p.startingSchoolId===school.id);
  for(const [i,p] of selected.entries()) {
   expect(p.hand).toEqual([]);
   expect(p.personalDeck).toEqual(school.cards.slice(i*7,i*7+6));
   expect(p.discard).toEqual(school.cards.slice(i*7+6,(i+1)*7));
  }
   expect(result.library.find(d=>d.id===school.id)!.cards).toEqual(school.cards.slice(selected.length*7));
  }
  expect(result.powerfulDeck).toEqual(s.powerfulDeck);expect(s).toEqual(before);
  expect(physicalCards(result).map(c=>c.id).sort()).toEqual(physicalCards(s).map(c=>c.id).sort());
 });
 it.each([0,1,6,7,13])('revalidates a %i-card shared shortage at start without partially dealing or resolving the event',available=>{
  const s=readyLobby(['enchantment','cantrip','cantrip']);
  // Move excess to a real holding zone after readiness, leaving earlier seats drawable.
  s.players[0].hand.push(...s.library[0].cards.splice(available));
  expect(canStartGame(s)).toBe(false);
  reject(s,{type:'START_GAME',playerId:'p1'},/school supply/);
  expect(s.round).toBe(0);expect(s.usedEvent).toBeNull();expect(s.firstPlayerId).toBeNull();
 });
 it('counts only draw/discard supply and reshuffles the same physical school cards when necessary',()=>{
  let s=readyLobby();const stock=s.library[0].cards;
  s.library[0].discard.push(...stock.splice(3));
  const before=structuredClone(s),result=start(s);
  expect(s).toEqual(before);expect(result.players[0].personalDeck.slice(0,3)).toEqual(before.library[0].cards);
  expect(result.library[0].discard).toEqual([]);expect(result.library[0].cards).toHaveLength(22);
  expect(new Set(result.players.flatMap(p=>[...p.personalDeck,...p.discard].map(c=>c.id))).size).toBe(14);
  expect(physicalCards(result).map(c=>c.id).sort()).toEqual(physicalCards(s).map(c=>c.id).sort());
  s=readyLobby();s.players[0].personalDeck.push(...s.library[0].cards.splice(13));
  expect(canStartGame(s)).toBe(false);reject(s,{type:'START_GAME',playerId:'p1'},/school supply/);
 });
 it('rejects a non-host start and never deals again in subsequent phases or later rounds',()=>{
  const s=readyLobby();reject(s,{type:'START_GAME',playerId:'p2'},/Only the creator/);
  let result=start(s);const grimoires=result.players.map(p=>structuredClone({deck:p.personalDeck,discard:p.discard})),library=structuredClone(result.library);
  reject(result,{type:'START_GAME',playerId:'p1'},/Action unavailable/);
  result=advance(result);
  expect(result.players.every(p=>p.hand.length===2 && p.personalDeck.length===4 && p.discard.length===1 && !!p.quest)).toBe(true);
  for(const [i,p] of result.players.entries()) {
   expect(p.hand).toEqual(grimoires[i].deck.slice(0,2));
   expect(p.personalDeck).toEqual(grimoires[i].deck.slice(2));expect(p.discard).toEqual(grimoires[i].discard);
  }
  expect(result.library).toEqual(library);
  reject(result,{type:'START_GAME',playerId:'p1'},/Action unavailable/);
  // Isolate a later round boundary; normal round setup must not repeat the deal.
  result.phase='CLEANUP';result.currentPlayerId=null;result.activation=null;
  const before=structuredClone(result);result=advance(result);
  expect(result.round).toBe(2);expect(result.players.map(p=>p.hand)).toEqual(before.players.map(p=>p.hand));
  expect(result.library).toEqual(before.library);expect(canStartGame(result)).toBe(false);
 });
 it('draws into the empty hand normally and retains the one setup discard with ordinary routing unchanged',()=>{
  let s=start(readyLobby(['transmutation','enchantment']));
  const before=structuredClone(s);s=advance(s);
  expect(before.players[0].hand).toEqual([]);
  expect(s.players[0].hand).toEqual(before.players[0].personalDeck.slice(0,2));
  expect(s.players[0].personalDeck).toEqual(before.players[0].personalDeck.slice(2));
  const starting=[...s.players[0].hand],stock=s.library[0].cards;
  s=applyAction(s,{type:'DRAW_STUDY',playerId:'p1',deckId:'cantrip'});
  expect(s.players[0].hand).toHaveLength(6);expect(s.players[0].hand.slice(-4)).toEqual(stock.slice(0,4));
  reject(s,{type:'DISCARD_STUDY',playerId:'p1',cardIds:[starting[0].id,stock[0].id]},/this Study/);
  s=applyAction(s,{type:'DISCARD_STUDY',playerId:'p1',cardIds:stock.slice(0,2).map(c=>c.id)});
  expect(s.players[0].hand).toHaveLength(4);expect(s.players[0].discard).toEqual(before.players[0].discard);
  expect(s.players[0].personalDeck).toHaveLength(4);
  expect(s.players[0].hand).toEqual([...starting,...stock.slice(2,4)]);
  expect(s.library.find(d=>d.id==='transmutation')!.discard).toEqual([]);
  expect(s.library.find(d=>d.id==='cantrip')!.discard).toEqual(stock.slice(0,2));
  expect(physicalCards(s).map(c=>c.id).sort()).toEqual(physicalCards(before).map(c=>c.id).sort());
 });
 it('builds rooms before dealing, then deals before event resolution consumes randomness',()=>{
  const s=readyLobby(),stock=[...s.library[0].cards];
  s.library[0].discard.push(...s.library[0].cards.splice(0));
  // The first random choice swaps the deck's endpoints; subsequent choices
  // leave their positions untouched. An event-first shuffle would consume it.
  // The 22-name board shuffle consumes 21 choices before any card allocation.
  let choices=0;
  const random=vi.spyOn(Math,'random').mockImplementation(()=>++choices===22?0:0.999999);
  try {
   const result=start(s),shuffled=[...stock];
   [shuffled[0],shuffled[35]]=[shuffled[35],shuffled[0]];
  expect(result.players[0].personalDeck).toEqual(shuffled.slice(0,6));
  expect(result.players[0].discard).toEqual(shuffled.slice(6,7));
  expect(result.players[1].personalDeck).toEqual(shuffled.slice(7,13));
  expect(result.players[1].discard).toEqual(shuffled.slice(13,14));
  expect(result.players.every(p=>p.hand.length===0)).toBe(true);
   expect(result.library[0].cards).toEqual(shuffled.slice(14));expect(result.library[0].discard).toEqual([]);
   expect(result.usedEvent?.id).toBe('quiet');
  } finally {random.mockRestore();}
 });
});

describe('public room and spell glossary',()=>{
 it('names all four protected cells from the exported seat colors, retaining seat coordinates and unique room names',()=>{
  const s=createGame(4),positions=[{q:3,r:-2},{q:-3,r:2},{q:-1,r:-2},{q:1,r:2}];
  for(const [i,p] of s.players.entries()) {
   const cell=s.board.rooms.find(r=>r.startingFor===p.id)!;
   expect(cell.name).toBe(`${MAGE_COLOR_NAMES[p.id]} Mage cell`);
   expect(cell.tiles).toEqual([positions[i]]);expect(p.wizard.startingRoomId).toBe(cell.id);
  }
  expect(new Set(s.board.rooms.map(r=>r.name)).size).toBe(23);
  expect(s.board.rooms.find(r=>r.id==='room-0,0')!.name).toBe('Pink Tulip Chamber');
 });
 it('uses COMBAT, secret activation, forgotten spells and the renamed central competitor in public strings',()=>{
  expect(createSpellDeck('legacy').every(c=>getSpellType(c)==='COMBAT')).toBe(true);
  const hidden=createEnchantmentDeck().filter(c=>['TRAP','PROTECTION'].includes(getSpellType(c)));
  expect(new Set(hidden.map(c=>c.name)).size).toBe(8);
  expect(hidden.every(c=>c.rulesText?.startsWith('Activate secretly'))).toBe(true);
  expect(ROOM_EFFECT_LABELS.DRAW_POWERFUL).toMatch(/forgotten spell/);
  const s=readyLobby();s.eventDeck=createEvents();s.players[0].wizard.damageCubes=9;s.players[0].wizard.blackDamage=9;
  s.eventDeck.sort((a,b)=>Number(b.kind==='BLACK_DAMAGE')-Number(a.kind==='BLACK_DAMAGE'));
  const result=start(s),visible=[...result.log,...result.board.rooms.map(r=>r.name),...s.eventDeck.flatMap(e=>[e.name,e.description])].join('\n');
  expect(visible).toContain('Pink Tulip receives kill credit');
  expect(visible).not.toMatch(/black\s*rose|\(not\)/i);
  expect(BLACK_ROSE_ID).toBe('black-rose');
 });
});