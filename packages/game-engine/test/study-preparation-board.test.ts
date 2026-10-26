import { describe, expect, it, vi } from 'vitest';
import { addPlayerToLobby, applyAction, canPlayerAct, createGame, getDefaultRoomsPerColor, getRoomRewards, hexDistance, hexKey, ROOM_COLORS } from '../src';
import type { GameAction, GameState, RoomColor, RoomEffect } from '../src';

const player=(s:GameState,id='p1')=>s.players.find(p=>p.id===id)!;
const advance=(s:GameState)=>applyAction(s,{type:'ADVANCE_PHASE',playerId:s.hostId,expectedPhase:s.phase,expectedRound:s.round});
function reject(s:GameState,action:unknown,error:RegExp) {
 const before=structuredClone(s);expect(()=>applyAction(s,action as GameAction)).toThrow(error);expect(s).toEqual(before);
}
function cardIds(s:GameState) {
 return [...s.library.flatMap(d=>[...d.cards,...d.discard]),...s.powerfulDeck,...s.removedCards,
  ...[...s.readiedSpells??[],...s.ongoingSpells??[]].map(a=>a.card),
  ...s.players.flatMap(p=>[...p.hand,...p.personalDeck,...p.discard,...Object.values(p.prepared).flatMap(c=>c&&!c.used?[c.card]:[])])].map(c=>c.id).sort();
}
function conserved(s:GameState,ids:string[]) {
 expect(cardIds(s)).toEqual(ids);expect(ids).toHaveLength(120);expect(new Set(cardIds(s)).size).toBe(120);
}
function lobby(count=2) {
 const s=createGame(count);for(const p of s.players)p.connected=true;
 s.eventDeck=[{id:'quiet',name:'Quiet',description:'No effect',kind:'INSTABILITY',amount:0,rooms:0}];return s;
}
function ready(s:GameState) {
 for(const p of s.players) {
  s=applyAction(s,{type:'SELECT_STARTING_SCHOOL',playerId:p.id,schoolId:'cantrip'});
  s=applyAction(s,{type:'SET_READY',playerId:p.id,ready:true});
 }
 return s;
}
function study() {
 return advance(applyAction(ready(lobby()),{type:'START_GAME',playerId:'p1'}));
}

describe('blind four-card mixed-school Study and private provenance',()=>{
 it('initializes tracking without drawing/dealing and resets it at a later round boundary',()=>{
  expect(createGame().players.every(p=>Array.isArray(p.studyCardIds)&&!p.studyCardIds!.length)).toBe(true);
  let s=study();expect(player(s).studyCardIds).toEqual([]);
  s=applyAction(s,{type:'DRAW_STUDY',playerId:'p1',deckIds:['cantrip','transmutation','enchantment','cantrip']});
  const drawn=[...player(s).studyCardIds!],hand=[...player(s).hand];expect(drawn).toHaveLength(4);
  s.phase='CLEANUP';s=advance(s);
  expect(player(s).studyCardIds).toEqual([]);expect(player(s).hand).toEqual(hand);expect(player(s).studyDrawn).toBe(false);
  expect(JSON.stringify(s)).not.toContain('instructionContexts');
 });
 it.each([
  ['cantrip','cantrip','cantrip','cantrip'],['cantrip','transmutation','enchantment','cantrip'],
  ['enchantment','transmutation','transmutation','enchantment'],['transmutation','cantrip','enchantment','enchantment'],
 ])('draws precisely the requested school sequence %j without accepting future card identities',(...deckIds)=>{
  const s=study(),ids=cardIds(s),before=structuredClone(s),positions=new Map<string,number>();
  const expected=deckIds.map(id=>{const index=positions.get(id)??0;positions.set(id,index+1);return s.library.find(d=>d.id===id)!.cards[index];});
  const result=applyAction(s,{type:'DRAW_STUDY',playerId:'p1',deckIds});
  expect(s).toEqual(before);expect(player(result).hand).toEqual([...player(s).hand,...expected]);
  expect(player(result).studyCardIds).toEqual(expected.map(c=>c.id));expect(new Set(player(result).studyCardIds).size).toBe(4);
  expect(player(result,'p2')).toEqual(player(s,'p2'));expect(result.powerfulDeck).toEqual(s.powerfulDeck);
  expect(player(result).personalDeck).toEqual(player(s).personalDeck);expect(player(result).discard).toEqual(player(s).discard);
  conserved(result,ids);
 });
 it('keeps the legacy deckId branch exactly equivalent to four school entries',()=>{
  const s=study(),a=applyAction(s,{type:'DRAW_STUDY',playerId:'p1',deckId:'transmutation'});
  const b=applyAction(s,{type:'DRAW_STUDY',playerId:'p1',deckIds:Array<string>(4).fill('transmutation')});
  expect(a).toEqual(b);conserved(a,cardIds(s));
 });
 it.each([
  {},{deckId:'cantrip',deckIds:['cantrip','cantrip','cantrip','cantrip']},{deckId:'cantrip',deckIds:undefined},
  {deckId:null},{deckId:1},{deckIds:null},{deckIds:'cantrip'},{deckIds:[]},{deckIds:Array<string>(4)},{deckIds:['cantrip']},
  {deckIds:['cantrip','cantrip','cantrip']},{deckIds:Array(5).fill('cantrip')},
  {deckIds:['cantrip','transmutation','enchantment',null]},
  {deckIds:['cantrip','transmutation','enchantment','absent']},
  {deckIds:['cantrip-1','cantrip-2','cantrip-3','cantrip-4']},
  {deckId:'cantrip',cardIds:['cantrip-1','cantrip-2','cantrip-3','cantrip-4']},
 ])('rejects malformed, ambiguous or identity-based Study selection %j atomically',payload=>{
  reject(study(),{type:'DRAW_STUDY',playerId:'p1',...payload},/either deckId|4 school entries|School not found|hidden card IDs/);
 });
 it.each([0,1,2,3])('validates repeated-school combined demand with only %i available, before any draw or shuffle',available=>{
  const s=study(),ids=cardIds(s),deck=s.library[1];
  player(s,'p2').hand.push(...deck.cards.splice(available));deck.discard.push(...deck.cards.splice(0));
  // The first request would reshuffle a different school if validation were incremental.
  s.library[0].discard.push(...s.library[0].cards.splice(0));
  const random=vi.spyOn(Math,'random');
  try {
   const deckIds=available===3?['transmutation','transmutation','transmutation','transmutation']:['cantrip','transmutation','transmutation','transmutation'];
   if(available===3)reject(s,{type:'DRAW_STUDY',playerId:'p1',deckIds},/fewer than 4/);
   else reject(s,{type:'DRAW_STUDY',playerId:'p1',deckIds},/fewer than 3/);
   expect(random).not.toHaveBeenCalled();conserved(s,ids);
  } finally {random.mockRestore();}
 });
 it('combines live stock and its own discard independently for every selected school',()=>{
  const s=study(),ids=cardIds(s);
  for(const deck of s.library)deck.discard.push(...deck.cards.splice(1));
  const result=applyAction(s,{type:'DRAW_STUDY',playerId:'p1',deckIds:['cantrip','transmutation','cantrip','enchantment']});
  const drawn=player(result).hand.slice(-4);
  expect(drawn[0]).toEqual(s.library[0].cards[0]);expect(drawn[1]).toEqual(s.library[1].cards[0]);
  expect(s.library[0].discard).toContainEqual(drawn[2]);expect(drawn[3]).toEqual(s.library[2].cards[0]);
  expect(result.library[0].discard).toEqual([]);expect(result.library[1].discard).toEqual(s.library[1].discard);
  conserved(result,ids);
 });
 it('discards exactly two tracked cards to their own schools, retaining both personal draws and old hand',()=>{
  let s=study();const old=s.library[2].cards.shift()!;player(s).hand.unshift(old);
  const personal=[...player(s).hand],ids=cardIds(s);
  s=applyAction(s,{type:'DRAW_STUDY',playerId:'p1',deckIds:['transmutation','enchantment','cantrip','transmutation']});
  const tracking=[...player(s).studyCardIds!];
  for(const p of personal)reject(s,{type:'DISCARD_STUDY',playerId:'p1',cardIds:[p.id,tracking[0]]},/this Study/);
  for(const cardIds of [[],[tracking[0]],[tracking[0],tracking[0]],tracking.slice(0,3),[tracking[0],'missing']])
   reject(s,{type:'DISCARD_STUDY',playerId:'p1',cardIds},/exactly 2|not in hand/);
  const selected=[tracking[0],tracking[1]],before=structuredClone(s);
  s=applyAction(s,{type:'DISCARD_STUDY',playerId:'p1',cardIds:selected});
  expect(player(s).hand).toEqual(player(before).hand.filter(c=>!selected.includes(c.id)));
  expect(player(s).hand.slice(0,3)).toEqual(personal);expect(player(s).studyCardIds).toEqual(tracking);
  for(const id of selected) {
   const card=player(before).hand.find(c=>c.id===id)!;expect(s.library.find(d=>d.id===card.schoolId)!.discard).toContainEqual(card);
  }
  expect(player(s).discard).toEqual(player(before).discard);expect(player(s).studyDone).toBe(true);
  reject(s,{type:'DISCARD_STUDY',playerId:'p1',cardIds:tracking.slice(2)},/before discarding/);
  reject(s,{type:'DRAW_STUDY',playerId:'p1',deckId:'cantrip'},/Already drew/);conserved(s,ids);
 });
 it.each([{tracking:undefined},{tracking:[]},{tracking:['missing']},{tracking:Array<string>(4).fill('duplicate')}])('never falls back to the whole hand with missing/invalid tracking %j',({tracking})=>{
  let s=study();s=applyAction(s,{type:'DRAW_STUDY',playerId:'p1',deckId:'cantrip'});
  const cardIds=player(s).studyCardIds!.slice(0,2);
  if(tracking===undefined)delete player(s).studyCardIds;else player(s).studyCardIds=tracking;
  reject(s,{type:'DISCARD_STUDY',playerId:'p1',cardIds},/this Study/);
 });
});

describe('two to four unique prepared spells with optional flexible slot',()=>{
 function preparation() {
  const s=createGame();s.phase='PREPARATION';player(s).hand.push(...s.library[0].cards.splice(0,6));return s;
 }
 function supportAction(numbered:readonly (number|null)[],quick?:number) {
  let s=createGame();s.phase='PREPARATION';s.round=1;
  const deck=s.library.find(d=>d.id==='transmutation')!;
  // Reserve canonical, harmless support cards before any random hand allocation.
  const cards=deck.cards.filter(c=>c.name==='Renewing Word');
  const opponent=deck.cards.filter(c=>c.name==='Mending Light').slice(0,2);
  expect(cards).toHaveLength(3);expect(opponent).toHaveLength(2);
  const selected=new Set([...cards,...opponent].map(c=>c.id));deck.cards=deck.cards.filter(c=>!selected.has(c.id));
  player(s).hand.push(...cards);player(s,'p2').hand.push(...opponent);
  for(const p of s.players)p.wizard.position={q:0,r:0};
  s=applyAction(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:numbered.map(i=>i===null?null:cards[i].id),...(quick===undefined?{}:{rapidCardId:cards[quick].id})});
  s=applyAction(s,{type:'PREPARE_CARDS',playerId:'p2',preparedCardIds:opponent.map(c=>c.id)});
  expect(s.phase).toBe('ACTION');return {s,cards};
 }
 it.each([[2,false],[3,false],[1,true],[2,true],[3,true]] as const)('prepares %i ordered spells with flexible=%s in selection order', (ordered,flexible)=>{
  const s=preparation(),ids=cardIds(s),cards=player(s).hand;
  const preparedCardIds=cards.slice(0,ordered).reverse().map(c=>c.id),rapidCardId=flexible?cards[ordered].id:undefined;
  const result=applyAction(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds,...(flexible?{rapidCardId}:{})});
  const p=player(result);
  for(const [i,slot] of (['slot1','slot2','slot3'] as const).entries())expect(p.prepared[slot]).toEqual(i<ordered?{card:cards.find(c=>c.id===preparedCardIds[i]),used:false}:null);
  expect(p.prepared.rapid).toEqual(flexible?{card:cards[ordered],used:false}:null);
  expect(p.hand).toEqual(cards.filter(c=>!preparedCardIds.includes(c.id)&&c.id!==rapidCardId));
  expect(p.preparationDone).toBe(true);expect(result.phase).toBe('PREPARATION');
  reject(result,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds},/Already prepared/);conserved(result,ids);
 });
 it.each([
  ['1+2',[4,2,null],false],['1+3',[4,null,0],false],['2+3',[null,2,0],false],
  ['1+Quick',[4,null,null],true],['2+Quick',[null,2,null],true],['3+Quick',[null,null,0],true],
  ['1+2+3',[4,2,0],false],['1+2+Quick',[4,2,null],true],
  ['1+3+Quick',[4,null,0],true],['2+3+Quick',[null,2,0],true],['1+2+3+Quick',[4,2,0],true],
 ] as const)('preserves exact explicit occupancy %s, full physical cards and unselected hand order',(label,numbered,quick)=>{
  const s=preparation(),before=structuredClone(s),ids=cardIds(s),cards=player(s).hand;
  const preparedCardIds=numbered.map(i=>i===null?null:cards[i].id),rapidCardId=quick?cards[3].id:undefined;
  // Quick may be selected first; its presence must never compact numbered destinations.
  const result=applyAction(s,{type:'PREPARE_CARDS',playerId:'p1',...(quick?{rapidCardId}:{}),preparedCardIds});
  const expected=numbered.map(i=>i===null?null:{card:cards[i],used:false});
  expect(player(result).prepared).toEqual({slot1:expected[0],slot2:expected[1],slot3:expected[2],rapid:quick?{card:cards[3],used:false}:null});
  expect(player(result).hand).toEqual(cards.filter(c=>!preparedCardIds.includes(c.id)&&c.id!==rapidCardId));
  expect(player(result).preparationDone).toBe(true);expect(result.phase).toBe('PREPARATION');
  expect(player(result,'p2')).toEqual(player(s,'p2'));expect(result.library).toEqual(s.library);
  expect(result.powerfulDeck).toEqual(s.powerfulDeck);expect(player(result).personalDeck).toEqual(player(s).personalDeck);
  expect(player(result).discard).toEqual(player(s).discard);expect(s).toEqual(before);conserved(result,ids);
 });
 it.each([[2,false],[3,false],[1,true],[2,true],[3,true]] as const)('keeps legacy prefix preparation %i/Quick=%s identical to explicit trailing empty slots',(ordered,quick)=>{
  const s=preparation(),before=structuredClone(s),cards=player(s).hand;
  const preparedCardIds=cards.slice(0,ordered).reverse().map(c=>c.id);
  const legacy=applyAction(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds,...(quick?{rapidCardId:cards[ordered].id}:{})});
  const explicit=applyAction(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:[...preparedCardIds,...Array<null>(3-ordered).fill(null)],rapidCardId:quick?cards[ordered].id:undefined});
  expect(explicit).toEqual(legacy);expect(s).toEqual(before);conserved(explicit,cardIds(s));
 });
 it('allows a short numbered array with a leading gap and treats omitted trailing slots as empty',()=>{
  const s=preparation(),cards=player(s).hand,ids=cardIds(s);
  const short=applyAction(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:[null,cards[2].id],rapidCardId:cards[0].id});
  const padded=applyAction(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:[null,cards[2].id,null],rapidCardId:cards[0].id});
  expect(short).toEqual(padded);
  expect(player(short).prepared).toEqual({slot1:null,slot2:{card:cards[2],used:false},slot3:null,rapid:{card:cards[0],used:false}});
  expect(player(short).hand).toEqual([cards[1],...cards.slice(3)]);conserved(short,ids);
 });
 it('rejects duplicates across separated numbered slots and between either numbered destination and Quick atomically',()=>{
  const s=preparation(),[a,b]=player(s).hand,ids=cardIds(s);
  for(const payload of [
   {preparedCardIds:[a.id,null,a.id]},
   {preparedCardIds:[null,null,a.id],rapidCardId:a.id},
   {preparedCardIds:[a.id,null,b.id],rapidCardId:a.id},
   {preparedCardIds:[a.id,null,b.id],rapidCardId:b.id},
  ])reject(s,{type:'PREPARE_CARDS',playerId:'p1',...payload},/Choose 2 to 4 different spells, at most 3 numbered and 1 Quick/);
  conserved(s,ids);
 });
 it('rejects missing, empty, foreign and other-zone card IDs in numbered or Quick slots before moving any card',()=>{
  const s=preparation(),[a]=player(s).hand,deck=s.library[1];
  const foreign=deck.cards.shift()!,personal=deck.cards.shift()!,discarded=deck.cards.shift()!;
  player(s,'p2').hand.push(foreign);player(s).personalDeck.push(personal);player(s).discard.push(discarded);
  const ids=cardIds(s);
  for(const id of ['', 'missing',foreign.id,personal.id,discarded.id,deck.cards[0].id,s.powerfulDeck[0].id]) {
   reject(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:[a.id,null,id]},/Spell not in hand/);
   reject(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:[null,null,a.id],rapidCardId:id},/Spell not in hand/);
  }
  conserved(s,ids);
 });
 it('rejects missing or non-array numbered selections atomically',()=>{
  const s=preparation(),[a,b]=player(s).hand,ids=cardIds(s);
  for(const payload of [{},{preparedCardIds:undefined},{preparedCardIds:null},{preparedCardIds:a.id},{preparedCardIds:{}},{preparedCardIds:{0:a.id,1:b.id,length:2}}])
   reject(s,{type:'PREPARE_CARDS',playerId:'p1',...payload},/Choose ordered spells/);
  conserved(s,ids);
 });
 it('rejects malformed numbered IDs rather than treating them as empty slots atomically',()=>{
  const s=preparation(),[a,b]=player(s).hand,ids=cardIds(s);
  for(const id of [undefined,0,false,{},[],[b.id],{id:b.id}])
   reject(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:[a.id,null,id]},/Ordered spells must be card IDs or empty slots/);
  conserved(s,ids);
 });
 it('rejects null and other malformed Quick IDs atomically instead of treating Quick as omitted',()=>{
  const s=preparation(),[a,b]=player(s).hand,ids=cardIds(s);
  for(const rapidCardId of [null,0,false,{},[],[b.id],{id:b.id}])
   reject(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:[null,null,a.id],rapidCardId},/Quick spell must be a card ID/);
  conserved(s,ids);
 });
 it('counts actual cards, never null placeholders, toward the two-spell minimum atomically',()=>{
  const s=preparation(),[a,b]=player(s).hand,ids=cardIds(s);
  for(const preparedCardIds of [[],[null],[null,null],[null,null,null],[a.id],[a.id,null,null],[null,a.id,null],[null,null,a.id]])
   reject(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds},/Choose 2 to 4 different spells, at most 3 numbered and 1 Quick/);
  for(const preparedCardIds of [[],[null],[null,null],[null,null,null]])
   reject(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds,rapidCardId:b.id},/Choose 2 to 4 different spells, at most 3 numbered and 1 Quick/);
  conserved(s,ids);
 });
 it('rejects more than three numbered entries even when extra entries are null and actual count is valid',()=>{
  const s=preparation(),[a,b,c,d,e]=player(s).hand,ids=cardIds(s);
  for(const payload of [
   {preparedCardIds:[a.id,b.id,null,null]}, {preparedCardIds:[null,null,a.id,b.id]},
   {preparedCardIds:[null,null,null,null],rapidCardId:a.id},
   {preparedCardIds:[a.id,b.id,null,null],rapidCardId:c.id},
   {preparedCardIds:[a.id,b.id,c.id,d.id]}, {preparedCardIds:[a.id,b.id,c.id,d.id],rapidCardId:e.id},
  ])reject(s,{type:'PREPARE_CARDS',playerId:'p1',...payload},/Choose 2 to 4 different spells, at most 3 numbered and 1 Quick/);
  conserved(s,ids);
 });
 it('rejects sparse JS arrays with leading, internal, trailing or entirely missing entries atomically',()=>{
  const s=preparation(),[a,b]=player(s).hand,ids=cardIds(s);
  const leading=Array<string|null>(3);leading[1]=a.id;leading[2]=b.id;
  const internal=Array<string|null>(3);internal[0]=a.id;internal[2]=b.id;
  const trailing=Array<string|null>(3);trailing[0]=a.id;trailing[1]=b.id;
  for(const preparedCardIds of [leading,internal,trailing,Array<string|null>(3),Array<string|null>(1)]) {
   const before=structuredClone(preparedCardIds);
   for(const quick of [false,true])
    reject(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds,...(quick?{rapidCardId:player(s).hand[2].id}:{})},/Ordered spells must be card IDs or empty slots/);
   expect(preparedCardIds).toEqual(before);
  }
  conserved(s,ids);
 });
 it.each([
  ['Quick then slot 3',2,'rapid'],['slot 3 then Quick',2,'slot3'],['slot 2 then Quick',1,'slot2'],
 ] as const)('casts the first populated numbered slot with zero physical tokens: %s',(label,index,first)=>{
  const numberedSlot=index===2?'slot3':'slot2';
  const {s:initial,cards}=supportAction(index===2?[null,null,0]:[null,0,null],1);
  player(initial).actionTokens=0;const ids=cardIds(initial),before=structuredClone(initial);
  expect(canPlayerAct(initial,player(initial))).toBe(true);
  reject(initial,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',targetPlayerId:'p1'},/Spell unavailable/);
  reject(initial,{type:'CAST_SPELL',playerId:'p1',slot:index===2?'slot2':'slot3',targetPlayerId:'p1'},/Spell unavailable/);
  let s=applyAction(initial,{type:'CAST_SPELL',playerId:'p1',slot:first,targetPlayerId:'p1'});
  expect(initial).toEqual(before);expect(s.currentPlayerId).toBe('p1');
  expect(s.activation).toMatchObject({actionsUsed:1,spellsCast:1,sequencedSpellUsed:first!=='rapid'});
  expect(player(s).prepared[first]!.used).toBe(true);expect(player(s).actionTokens).toBe(0);
  reject(s,{type:'CAST_SPELL',playerId:'p1',slot:first,targetPlayerId:'p1'},/Spell unavailable/);
  conserved(s,ids);
  const second=first==='rapid'?numberedSlot:'rapid';
  s=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:second,targetPlayerId:'p1'});
  expect(s.currentPlayerId).toBe('p2');expect(s.activation).toMatchObject({playerId:'p2',actionsUsed:0,spellsCast:0,sequencedSpellUsed:false});
  expect(player(s).prepared).toEqual({slot1:null,slot2:index===1?{card:cards[0],used:true}:null,slot3:index===2?{card:cards[0],used:true}:null,rapid:{card:cards[1],used:true}});
  expect(player(s).hand).toEqual([cards[2]]);expect(player(s).actionTokens).toBe(0);
  expect(s.library.find(d=>d.id==='transmutation')!.discard).toEqual(first==='rapid'?[cards[1],cards[0]]:[cards[0],cards[1]]);
  expect(s.players.map(p=>p.wizard)).toEqual(initial.players.map(p=>p.wizard));expect(s.players.map(p=>p.cubes)).toEqual(initial.players.map(p=>p.cubes));
  expect(s.board).toEqual(initial.board);expect(s.feedbackEvents).toEqual(initial.feedbackEvents);
  reject(s,{type:'CAST_SPELL',playerId:'p1',slot:numberedSlot,targetPlayerId:'p1'},/Not your turn/);conserved(s,ids);
 });
 it('keeps numbered order and per-turn quota across an internal gap while Quick uses the other shared action',()=>{
  const {s:initial,cards}=supportAction([0,null,1],2),ids=cardIds(initial),tokens=initial.players.map(p=>p.actionTokens);
  reject(initial,{type:'CAST_SPELL',playerId:'p1',slot:'slot3',targetPlayerId:'p1'},/Cast numbered spells in order/);
  let s=applyAction(initial,{type:'CAST_SPELL',playerId:'p1',slot:'slot1',targetPlayerId:'p1'});
  expect(s.activation).toMatchObject({actionsUsed:1,spellsCast:1,sequencedSpellUsed:true});
  reject(s,{type:'CAST_SPELL',playerId:'p1',slot:'slot3',targetPlayerId:'p1'},/Only one sequenced spell per turn/);
  expect(player(s).prepared.slot2).toBeNull();expect(player(s).prepared.slot3).toEqual({card:cards[1],used:false});conserved(s,ids);
  s=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p1'});
  expect(s.currentPlayerId).toBe('p2');expect(player(s).prepared.slot3!.used).toBe(false);
  reject(s,{type:'CAST_SPELL',playerId:'p1',slot:'slot3',targetPlayerId:'p1'},/Not your turn/);
  s=applyAction(s,{type:'CAST_SPELL',playerId:'p2',slot:'slot1'});
  expect(s.activation).toMatchObject({playerId:'p2',actionsUsed:1,spellsCast:1,sequencedSpellUsed:true});
  s=applyAction(s,{type:'END_ACTIVATION',playerId:'p2'});
  expect(s.currentPlayerId).toBe('p1');expect(s.activation).toMatchObject({actionsUsed:0,spellsCast:0,sequencedSpellUsed:false});
  reject(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p1'},/Spell unavailable/);
  s=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'slot3',targetPlayerId:'p1'});
  expect(s.activation).toMatchObject({playerId:'p1',actionsUsed:1,spellsCast:1,sequencedSpellUsed:true});
  expect(player(s).prepared).toEqual({slot1:{card:cards[0],used:true},slot2:null,slot3:{card:cards[1],used:true},rapid:{card:cards[2],used:true}});
  expect(s.library.find(d=>d.id==='transmutation')!.discard.filter(c=>cards.some(own=>own.id===c.id))).toEqual([cards[0],cards[2],cards[1]]);
  expect(s.players.map(p=>p.actionTokens)).toEqual(tokens);expect(s.players.map(p=>p.wizard)).toEqual(initial.players.map(p=>p.wizard));
  expect(s.board).toEqual(initial.board);expect(s.feedbackEvents).toEqual(initial.feedbackEvents);conserved(s,ids);
 });
 it.each([[0,false],[1,false],[0,true],[4,false],[4,true],[5,false]] as const)('rejects invalid %i ordered spells with flexible=%s atomically',(ordered,flexible)=>{
  const s=preparation();reject(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:player(s).hand.slice(0,ordered).map(c=>c.id),...(flexible?{rapidCardId:player(s).hand[ordered].id}:{})},/2 to 4/);
 });
 it('rejects duplicate, absent and malformed selections and still enforces the hand limit first',()=>{
  const s=preparation(),[a,b]=player(s).hand;
  for(const payload of [{preparedCardIds:[a.id,a.id]},{preparedCardIds:[a.id,b.id],rapidCardId:a.id},{preparedCardIds:[a.id,'absent']},{preparedCardIds:null},{preparedCardIds:[a.id,b.id],rapidCardId:null}])
   reject(s,{type:'PREPARE_CARDS',playerId:'p1',...payload},/different spells|not in hand|ordered spells|card ID/);
  player(s).hand.push(...s.library[1].cards.splice(0,2));
  reject(s,{type:'PREPARE_CARDS',playerId:'p1',preparedCardIds:[a.id,b.id]},/hand limit/);
 });
 it('starts Action after all players prepare only two numbered spells and preserves unselected hand cards',()=>{
  let s=preparation();player(s,'p2').hand.push(...s.library[1].cards.splice(0,2));const ids=cardIds(s);
  for(const p of s.players)s=applyAction(s,{type:'PREPARE_CARDS',playerId:p.id,preparedCardIds:p.hand.slice(0,2).map(c=>c.id)});
  expect(s.phase).toBe('ACTION');expect(s.currentPlayerId).toBe('p1');expect(player(s).hand).toHaveLength(4);
  expect(s.players.every(p=>p.prepared.rapid===null&&p.prepared.slot3===null)).toBe(true);conserved(s,ids);
 });
});

describe('host room-count configuration and atomic roster-scaled startup',()=>{
 it.each([[1,1],[2,1],[3,2],[4,3]])('exports the %i-player default/preview of %i rooms per color',(count,expected)=>expect(getDefaultRoomsPerColor(count)).toBe(expected));
 it.each([0,5,-1,2.5,NaN,Infinity])('rejects unsupported default roster %s',count=>expect(()=>getDefaultRoomsPerColor(count)).toThrow(/1 and 4/));
 it('requires a connected host in Lobby, rejects invalid values and players, and leaves the board/cards untouched',()=>{
  const s=ready(lobby());
  reject(s,{type:'SET_ROOM_COUNT',playerId:'p2',roomsPerColor:1},/Only the creator/);
  reject(s,{type:'SET_ROOM_COUNT',playerId:'absent',roomsPerColor:1},/Player not found/);
  const disconnected=structuredClone(s);player(disconnected).connected=false;
  reject(disconnected,{type:'SET_ROOM_COUNT',playerId:'p1',roomsPerColor:1},/Join/);
  for(const roomsPerColor of [undefined,0,4,-1,1.5,'1',true,NaN,Infinity,{}])reject(s,{type:'SET_ROOM_COUNT',playerId:'p1',roomsPerColor},/rooms per color/);
  const configured=applyAction(s,{type:'SET_ROOM_COUNT',playerId:'p1',roomsPerColor:1});
  expect(configured.roomsPerColor).toBe(1);expect(configured.players.every(p=>!p.ready)).toBe(true);
  expect(configured.board).toEqual(s.board);expect(configured.library).toEqual(s.library);expect(configured.powerfulDeck).toEqual(s.powerfulDeck);
 });
 it('clears ALL readiness only on an actual override change, including reset to automatic with the same effective size',()=>{
  let s=ready(lobby());expect(s).not.toHaveProperty('roomsPerColor');
  s=applyAction(s,{type:'SET_ROOM_COUNT',playerId:'p1',roomsPerColor:null});expect(s.players.every(p=>p.ready)).toBe(true);
  s=applyAction(s,{type:'SET_ROOM_COUNT',playerId:'p1',roomsPerColor:1});expect(s.players.every(p=>!p.ready)).toBe(true);
  s=ready(s);s=applyAction(s,{type:'SET_ROOM_COUNT',playerId:'p1',roomsPerColor:1});expect(s.players.every(p=>p.ready)).toBe(true);
  s=applyAction(s,{type:'SET_ROOM_COUNT',playerId:'p1',roomsPerColor:null});expect(s).not.toHaveProperty('roomsPerColor');expect(s.players.every(p=>!p.ready)).toBe(true);
 });
 it('honors a migrated host and also clears disconnected opponents’ readiness',()=>{
  let s=ready(lobby(3));s.hostId='p2';player(s,'p3').connected=false;
  reject(s,{type:'SET_ROOM_COUNT',playerId:'p1',roomsPerColor:2},/Only the creator/);
  s=applyAction(s,{type:'SET_ROOM_COUNT',playerId:'p2',roomsPerColor:2});
  expect(s.roomsPerColor).toBe(2);expect(s.players.every(p=>!p.ready)).toBe(true);expect(player(s,'p3').connected).toBe(false);
 });
 it.each(['BLACK_ROSE','STUDY','PREPARATION','ACTION','EVOCATION','CLEANUP','GAME_OVER'] as const)('never configures a running %s game',phase=>{
  const s=ready(lobby());s.phase=phase;reject(s,{type:'SET_ROOM_COUNT',playerId:'p1',roomsPerColor:3},/unavailable|game is over/);
 });
 for(const count of [2,3,4])for(const override of [null,1,2,3] as const) {
  it(`starts ${count} mages with ${override??'automatic'} rooms per color, connected playable rooms and legal protected exits`,()=>{
   let s=lobby(count);s=applyAction(s,{type:'SET_ROOM_COUNT',playerId:'p1',roomsPerColor:override});s=ready(s);
   const before=structuredClone(s),ids=cardIds(s),size=override??getDefaultRoomsPerColor(count);
   s=applyAction(s,{type:'START_GAME',playerId:'p1'});
   expect(before.board.rooms).toHaveLength(23);expect(s.board.rooms).toHaveLength(6*size+5);
   expect(s.board.tiles).toHaveLength(6*size+5);expect(new Set(s.board.tiles.map(hexKey)).size).toBe(6*size+5);
   expect(new Set(s.board.rooms.map(r=>r.name)).size).toBe(s.board.rooms.length);
   const effects:Record<RoomColor,RoomEffect>={crimson:'ROOM_DAMAGE',azure:'DRAW_DISCARD',emerald:'INSTABILITY',amber:'DRAW_QUEST',violet:'DRAW_GRIMOIRE',grey:'SUMMON_CADAVER'};
   for(const color of ROOM_COLORS) {
    const rooms=s.board.rooms.filter(r=>r.color===color);expect(rooms).toHaveLength(size);
    for(const r of rooms) {
     expect(r.effect).toBe(effects[color]);expect(r.instabilityLimit).toBe(color==='grey'?6:color==='violet'?4:5);
     expect(r.rewards).toEqual(getRoomRewards(r.instabilityLimit));expect(r.startingFor).toBeUndefined();
    }
   }
   for(const r of s.board.rooms)expect(r.id).toBe(`room-${hexKey(r.tiles[0])}`);
   const center=s.board.rooms.find(r=>r.id==='room-0,0')!;
   expect(center).toMatchObject({color:null,effect:'DRAW_POWERFUL',instabilityLimit:10,rewards:[6,3,1]});
   const playable=s.board.rooms.filter(r=>!r.startingFor),visited=new Set([center.id]),pending=[center];
   while(pending.length) {
    const current=pending.pop()!;
    for(const r of playable)if(!visited.has(r.id)&&hexDistance(current.tiles[0],r.tiles[0])===1){visited.add(r.id);pending.push(r);}
   }
   expect(visited.size).toBe(playable.length);
   const starts=s.board.rooms.filter(r=>r.startingFor);expect(starts).toHaveLength(4);
   for(const start of starts) {
    expect(start).toMatchObject({color:null,effect:null});
    expect(playable.some(r=>hexDistance(r.tiles[0],start.tiles[0])===1)).toBe(true);
   }
   for(const p of s.players) {
    const start=starts.find(r=>r.startingFor===p.id)!;
    expect(p.wizard.startingRoomId).toBe(start.id);expect(p.wizard.position).toEqual(start.tiles[0]);
    expect(p.hand).toEqual([]);expect(p.personalDeck).toHaveLength(6);expect(p.discard).toHaveLength(1);
    const branch=structuredClone(s);branch.phase='ACTION';branch.currentPlayerId=p.id;
    branch.activation={playerId:p.id,actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
    const exit=playable.find(r=>hexDistance(r.tiles[0],start.tiles[0])===1)!;
    const moving=applyAction(applyAction(branch,{type:'EXPLORE',playerId:p.id}),{type:'EXPLORE_STEP',playerId:p.id,destination:exit.tiles[0]});
    expect(player(moving,p.id).wizard.position).toEqual(exit.tiles[0]);
    reject(moving,{type:'EXPLORE_STEP',playerId:p.id,destination:start.tiles[0]},/starting rooms/);
   }
   expect(s.library[0].cards).toEqual(before.library[0].cards.slice(count*7));expect(s.library.slice(1)).toEqual(before.library.slice(1));
   expect(s.powerfulDeck).toEqual(before.powerfulDeck);conserved(s,ids);
  const board=structuredClone(s.board);s=advance(s);expect(s.board).toEqual(board);
  // Isolate the next round boundary: sizing is not reapplied at Pink Tulip.
  s.phase='CLEANUP';s=advance(s);expect(s.board).toEqual(board);
  });
 }
 it('calculates automatic size from the final roster, not from createGame or an earlier configuration',()=>{
  let s=lobby(2);s=addPlayerToLobby(s);s=addPlayerToLobby(s);for(const p of s.players)p.connected=true;
  s=applyAction(ready(s),{type:'START_GAME',playerId:'p1'});expect(s.board.rooms.filter(r=>r.color==='grey')).toHaveLength(3);
 });
 it('rolls back board, wizard starts, school allocation and events together when startup supply is invalid',()=>{
  const s=ready(lobby(3));s.roomsPerColor=1;player(s,'p3').hand.push(...s.library[0].cards.splice(20));
  reject(s,{type:'START_GAME',playerId:'p1'},/school supply/);expect(s.board.rooms).toHaveLength(23);expect(s.round).toBe(0);expect(s.usedEvent).toBeNull();
 });
 it('rebuilds wizard starts before a lethal opening event records its respawn room',()=>{
  let s=ready(lobby());player(s).wizard.damageCubes=9;player(s).wizard.blackDamage=9;
  s.eventDeck=[{id:'lethal-opening',name:'Thorns',description:'Damage',kind:'BLACK_DAMAGE',amount:1,rooms:0}];
  s=applyAction(s,{type:'START_GAME',playerId:'p1'});
  const defeat=s.feedbackEvents!.find(e=>e.kind==='MAGE_DEFEATED')!;
  expect(defeat).toMatchObject({kind:'MAGE_DEFEATED',respawnRoomId:'room-2,-1',target:{id:'p1',roomId:'room-2,-1'}});
  expect(player(s).wizard.position).toEqual({q:2,r:-1});
 });
});