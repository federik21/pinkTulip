import { describe, expect, it } from 'vitest';
import { applyAction, BLACK_ROSE_ID, canPlayerAct, canUseSpellDummy, createGame } from '../src';
import { momentTotal } from '../src/cards';
import { setPrinted, withMoments } from './flat-effects';
import type { Card, Evocation, GameAction, GameState, SpellTarget, SpellType } from '../src';

type Cast = Extract<GameAction, { type:'CAST_SPELL' }>;
type Selection = Omit<Cast, 'type' | 'playerId' | 'slot'>;
const center = 'room-0,0', east = 'room-1,0';
const eligible = ['MAGE', 'EVOCATION', 'MODEL'] as const;
const types:SpellType[] = ['COMBAT', 'CONTINGENCY', 'TRAP', 'PROTECTION'];
const trigger = { event:'SPELL_CAST', scope:'BOUND_MODEL', relation:'ANY' } as const;
const room = (s:GameState, id = center) => s.board.rooms.find(r => r.id === id)!;
function turn(s:GameState, playerId = 'p1') {
 s.phase = 'ACTION'; s.currentPlayerId = playerId; s.evocationActivation = null;
 s.activation = { playerId, actionsUsed:0, exploring:0, sequencedSpellUsed:false,
  spellsCast:0, discardedExit:false, roomEffectUsed:false };
}
function take(s:GameState, name:string):Card {
 for (const deck of s.library) {
  const index = deck.cards.findIndex(c => c.name === name);
  if (index >= 0) return deck.cards.splice(index, 1)[0];
 }
 const index = s.powerfulDeck.findIndex(c => c.name === name);
 expect(index).toBeGreaterThanOrEqual(0); return s.powerfulDeck.splice(index, 1)[0];
}
function prepare(s:GameState, name:string, slot:Cast['slot'] = 'rapid', playerId = 'p1') {
 const card = take(s, name);
 s.players.find(p => p.id === playerId)!.prepared[slot] = { card, used:false }; return card;
}
function syncCubes(s:GameState) {
 for (const p of s.players) {
  p.cubes.onWizard = s.players.reduce((n, t) => n + (t.wizard.damageByPlayer[p.id] ?? 0), 0);
  p.cubes.onEvocations = s.evocations.reduce((n, t) => n + (t.damageByPlayer[p.id] ?? 0), 0);
  p.cubes.onBoard = s.board.rooms.filter(r => !r.scored).reduce((n, r) => n + (r.cubesByPlayer[p.id] ?? 0), 0);
  p.cubes.available = 25 - p.cubes.onWizard - p.cubes.onEvocations - p.cubes.onBoard;
 }
}
function conserved(s:GameState) {
 const expected = structuredClone(s); syncCubes(expected);
 for (const [i, p] of s.players.entries()) {
  expect(p.cubes).toEqual(expected.players[i].cubes);
  expect(Object.values(p.cubes).every(n => Number.isInteger(n) && n >= 0)).toBe(true);
  expect(Object.values(p.cubes).reduce((a, b) => a + b, 0)).toBe(25);
 }
}
function cards(s:GameState) {
 return [...s.library.flatMap(d => [...d.cards, ...d.discard]), ...s.powerfulDeck, ...s.removedCards,
  ...[...s.readiedSpells ?? [], ...s.ongoingSpells ?? []].map(a => a.card),
  ...s.players.flatMap(p => [...p.personalDeck, ...p.hand, ...p.discard,
   ...Object.values(p.prepared).flatMap(slot => slot && !slot.used ? [slot.card] : [])])].map(c => c.id).sort();
}
function fixture(name = 'Vital Thread') {
 const s = createGame(4); s.round = 1; s.firstPlayerId = 'p1'; turn(s);
 for (const p of s.players) {
  p.connected = true; p.wizard.position = { q:0, r:0 };
  Object.assign(p.wizard, { damageCubes:4, blackDamage:1, damageByPlayer:{ p3:1, [BLACK_ROSE_ID]:1 } });
 }
 s.evocations = s.players.map((p, i):Evocation => ({ id:`dummy-evoc-${i}`, playerId:p.id,
  number:1, name:'Cadaver', archetype:'UNDEAD', movement:2, attack:2, health:8,
  passive:'WOUNDED_FURY', position:{ q:0, r:0 }, damageCubes:3,
  damageByPlayer:{ p2:1, [BLACK_ROSE_ID]:1 }, activated:false }));
 Object.assign(room(s), { instability:2, cubesByPlayer:{ p2:1, [BLACK_ROSE_ID]:1 } });
 syncCubes(s); const card = prepare(s, name); return { s, card };
}
const cast = (s:GameState, selection:Selection = { dummy:true, roomId:center }, slot:Cast['slot'] = 'rapid') =>
 applyAction(s, { type:'CAST_SPELL', playerId:'p1', slot, ...selection });
function reject(s:GameState, selection:Selection, error:RegExp, slot:Cast['slot'] = 'rapid') {
 const before = structuredClone(s); expect(() => cast(s, selection, slot)).toThrow(error); expect(s).toEqual(before);
}
function noModelEffects(before:GameState, after:GameState) {
 expect(after.players.map(p => p.wizard)).toEqual(before.players.map(p => p.wizard));
 expect(after.evocations).toEqual(before.evocations);
 expect(after.feedbackEvents).toEqual(before.feedbackEvents);
 expect(after.players.map(p => [p.kills, p.victoryPoints, p.questsCompleted])).toEqual(before.players.map(p => [p.kills, p.victoryPoints, p.questsCompleted]));
 expect(after.blackRose).toEqual(before.blackRose);
 expect(after.readiedSpells).toEqual(before.readiedSpells);
 expect(after.ongoingSpells).toEqual(before.ongoingSpells);
 expect(after.activeSpellOrder).toEqual(before.activeSpellOrder);
}
function consumed(before:GameState, after:GameState, card:Card, slot:Cast['slot'] = 'rapid') {
 expect(after.players[0].prepared[slot]).toEqual({ card, used:true });
 expect(after.players.map(p => p.actionTokens)).toEqual(before.players.map(p => p.actionTokens));
 if (card.powerful) {
  expect(after.removedCards).toEqual([...before.removedCards, card]);
  expect(after.library).toEqual(before.library);
 } else expect(after.library.find(d => d.id === card.schoolId)!.discard).toEqual([
  ...before.library.find(d => d.id === card.schoolId)!.discard, card,
 ]);
 expect(cards(after)).toEqual(cards(before)); expect(cards(after)).toHaveLength(120);
 expect(new Set(cards(after)).size).toBe(120); conserved(after);
 expect(after.log.join('\n')).toContain(`${card.name} on a dummy (no model effects)`);
 expect(after.log.join('\n')).not.toContain('(no damage)');
}

describe('dummy target category is independent of printed effects, type and ongoing metadata', () => {
 it.each<SpellTarget>(['SELF', 'ROOM', ...eligible])('%s helper is exact and immutable', target => {
  for (const spellType of types) for (const effects of [{}, { heal:2 }, { convert:2 }, { damage:3, heal:2, convert:2 }]) {
   for (const ongoing of [undefined, { trigger, effects:[] }]) {
    const card:Card = { id:'helper', name:'Helper', kind:'SPELL', range:2,
     target, spellType, trigger, ongoing, ...withMoments({ instability:1, ...effects }) };
    const before = structuredClone(card);
    expect(canUseSpellDummy(card)).toBe(target === 'MAGE' || target === 'EVOCATION' || target === 'MODEL');
    expect(card).toEqual(before);
   }
  }
 });
});

const canonical = ['Renewing Word', "Mage's Due", "Summoner's Balm", 'Reclaimed Servant',
 'Mending Ward', "Servant's Safeguard", 'Thorned Path', 'Runic Remedy', 'Arcane Feedback',
 'Vital Thread', 'Stolen Sigil', 'Transmuting Surge', 'Splinter Hex', 'Arcane Bolt'];
describe.each(canonical)('%s canonical dummy cast', name => {
 it.each([false, true].flatMap(occupied => [false, true].map(printedInstability => ({ occupied, printedInstability }))))(
  'uses only printed instability (occupied=$occupied, synthetic printed instability=$printedInstability)', ({ occupied, printedInstability }) => {
   const { s, card } = fixture(name); if (printedInstability) setPrinted(card, { instability:2 });
   const id = occupied ? center : east, before = structuredClone(s);
   const after = cast(s, { dummy:true, roomId:id });
   expect(s).toEqual(before); noModelEffects(before, after); consumed(before, after, card);
   expect(after.activation).toMatchObject({ actionsUsed:1, spellsCast:1, sequencedSpellUsed:false });
   const expected = structuredClone(before.board), selected = expected.rooms.find(r => r.id === id)!;
   selected.instability += momentTotal(card, 'INSTABILITY');
   if (momentTotal(card, 'INSTABILITY')) selected.cubesByPlayer.p1 = momentTotal(card, 'INSTABILITY');
   expect(after.board).toEqual(expected);
   expect(after.players[0].cubes).toEqual({ ...before.players[0].cubes,
    available:before.players[0].cubes.available - momentTotal(card, 'INSTABILITY'), onBoard:momentTotal(card, 'INSTABILITY') });
   expect(after.players.slice(1).map(p => p.cubes)).toEqual(before.players.slice(1).map(p => p.cubes));
  });
});

describe('mixed dummy effects, hidden cards and binding suppression', () => {
 it.each(eligible.flatMap(target => types.map(spellType => ({ target, spellType }))))(
  '$target $spellType with mixed immediate/triggered/ongoing effects creates no model or room binding', ({ target, spellType }) => {
   const { s, card } = fixture();
   Object.assign(card, { target, spellType, ...withMoments({ damage:6, heal:5, convert:4, instability:2 }), trigger,
    triggerEffects:[{ effect:'DAMAGE', amount:9, target:'EVENT_ACTOR' }],
    ongoing:{ trigger, effects:[{ effect:'CONVERT', amount:9, target:'EVENT_ROOM' }] } });
   const before = structuredClone(s), after = cast(s);
   noModelEffects(before, after); consumed(before, after, card);
   expect(room(after)).toMatchObject({ instability:4, cubesByPlayer:{ p1:2, p2:1, [BLACK_ROSE_ID]:1 } });
   expect(after.log.some(line => /activates a hidden spell|Interrupt|Healing|converts|suffers/.test(line))).toBe(false);
  });
 it.each(eligible.flatMap(target => (['TRAP', 'PROTECTION'] as const).map(spellType => ({ target, spellType }))))(
  '$target $spellType still requires its trigger before consuming a dummy cast', ({ target, spellType }) => {
   const { s, card } = fixture(); Object.assign(card, { target, spellType }); delete card.trigger;
   s.players[0].actionTokens = 0;
   expect(canUseSpellDummy(card)).toBe(true); expect(canPlayerAct(s, s.players[0])).toBe(false);
   reject(s, { dummy:true, roomId:center }, /require a trigger/);
  });
 it.each(['Mending Light', "Alchemist's Refuge", 'Sanctuary', 'Restorative Tide', 'Thorn Retort',
  'Hearth Ward', "Pilgrim's Mark", 'Threshold Snare'])('%s SELF/ROOM cannot dummy even with support/reactive metadata', name => {
  const { s, card } = fixture(name); expect(canUseSpellDummy(card)).toBe(false);
  reject(s, { dummy:true, roomId:center }, /Dummy targeting requires/);
 });
 it.each(eligible)('%s powerful dummy goes to removedCards rather than any discard or active zone', target => {
  const { s, card } = fixture('Sovereign Wrath');
  Object.assign(card, { target, spellType:'PROTECTION', trigger, ...withMoments({ damage:8, instability:1, heal:4, convert:3 }),
   ongoing:{ trigger, effects:[{ effect:'DAMAGE', amount:9, target:'BOUND_MODEL' }] } });
  const before = structuredClone(s), after = cast(s);
  noModelEffects(before, after); consumed(before, after, card);
  expect(after.players.map(p => p.discard)).toEqual(before.players.map(p => p.discard));
 });
});

describe('dummy selection retains authoritative targeting and action guards', () => {
 it.each(eligible)('%s requires only a real non-start room and rejects mixed/forged payloads atomically', target => {
  const { s, card } = fixture(); card.target = target; card.range = 1;
  for (const selection of [{ dummy:true }, { dummy:true, roomId:'missing' }, { roomId:center },
   { dummy:true, roomId:center, targetPlayerId:'p2' }, { dummy:true, roomId:center, targetPlayerId:'p2-wizard' },
   { dummy:true, roomId:center, targetEvocationId:'dummy-evoc-1' },
   { dummy:true, roomId:center, targetPlayerId:'missing', targetEvocationId:'missing' }])
   reject(s, selection, /Select a room|Room not found|cannot target a room|either a room\/dummy or a model/);
  for (const id of ['room-1,1', 'room-2,0']) reject(s, { dummy:true, roomId:id }, /out of range/);
  card.range = 99;
  for (const start of s.board.rooms.filter(r => r.startingFor)) {
   reject(s, { dummy:true, roomId:start.id }, /Starting rooms cannot be targeted/);
   s.players[0].wizard.position = { ...start.tiles[0] };
   reject(s, { dummy:true, roomId:center }, /Leave the starting room/);
   s.players[0].wizard.position = { q:0, r:0 };
  }
 });
 it.each(eligible.flatMap(target => (['EXPLORE', 'BEGIN_PHYSICAL_ACTION', 'ACTIVATE_EVOCATION'] as const).map(pending => ({ target, pending }))))(
  '$target dummy cannot interrupt $pending', ({ target, pending }) => {
   const { s, card } = fixture(); card.target = target;
   const action:GameAction = pending === 'EXPLORE' ? { type:pending, playerId:'p1' }
    : pending === 'BEGIN_PHYSICAL_ACTION' ? { type:pending, playerId:'p1', kind:'EXPLORE' }
    : { type:pending, playerId:'p1', evocationId:'dummy-evoc-0' };
   const state = applyAction(s, action); reject(state, { dummy:true, roomId:center }, /exploring|pending|active evocation/);
  });
 it.each(eligible)('%s dummy cannot bypass phase, turn, used-card, action-cap or numbered ordering/readiness', target => {
  const { s, card } = fixture(); card.target = target;
  const selection = { dummy:true, roomId:center };
  s.phase = 'PREPARATION'; reject(s, selection, /unavailable in PREPARATION/); s.phase = 'ACTION';
  s.currentPlayerId = 'p2'; reject(s, selection, /Not your turn/); s.currentPlayerId = 'p1';
  s.activation!.actionsUsed = 2; reject(s, selection, /both turn actions/); s.activation!.actionsUsed = 0;
  s.players[0].prepared.rapid!.used = true; reject(s, selection, /Spell unavailable/); s.players[0].prepared.rapid!.used = false;
  prepare(s, 'Splinter Hex', 'slot1'); prepare(s, 'Renewing Word', 'slot2');
  reject(s, selection, /in order/, 'slot2'); s.activation!.sequencedSpellUsed = true;
  reject(s, selection, /one sequenced/, 'slot1');
 });
 it('shares two turn actions, skips empty numbered slots, spends no tokens and hands off after Quick', () => {
  const { s, card } = fixture("Summoner's Balm"); s.players[0].actionTokens = 0;
  s.players[0].prepared.slot2 = s.players[0].prepared.rapid; s.players[0].prepared.rapid = null;
  const rapid = prepare(s, 'Mending Ward'), later = prepare(s, 'Renewing Word', 'slot3');
  expect(canPlayerAct(s, s.players[0])).toBe(true);
  const one = cast(s, undefined, 'slot2');
  expect(one.activation).toMatchObject({ actionsUsed:1, spellsCast:1, sequencedSpellUsed:true });
  expect(one.players[0].prepared.slot2).toEqual({ card, used:true });
  reject(one, { dummy:true, roomId:center }, /one sequenced/, 'slot3');
  const two = cast(one); expect(two.currentPlayerId).toBe('p2');
  expect(two.players[0].actionTokens).toBe(0); expect(two.players[0].prepared.rapid).toEqual({ card:rapid, used:true });
  expect(two.players[0].prepared.slot3).toEqual({ card:later, used:false });
  reject(two, { dummy:true, roomId:center }, /Not your turn/, 'slot3');
  noModelEffects(s, two); expect(cards(two)).toEqual(cards(s)); conserved(two);
 });
 it.each(eligible)('%s finds an in-range secondary tile of a multihex dummy room', target => {
  const { s, card } = fixture(); card.target = target; card.range = 1; setPrinted(card, { instability:1 });
  s.players[0].wizard.position = { q:2, r:0 };
  s.board.rooms = s.board.rooms.filter(r => r.id !== east); room(s).tiles.push({ q:1, r:0 });
  const before = structuredClone(s), after = cast(s);
  noModelEffects(before, after); expect(room(after).instability).toBe(3); conserved(after);
 });
});

describe('dummy exhaustion, supply and room capacity', () => {
 it.each(eligible.flatMap(target => ['offense', 'heal', 'convert', 'protection', 'ongoing'].map(mode => ({ target, mode }))))(
  '$target $mode remains actionable at zero tokens without any evocations or reachable enemy mages', ({ target, mode }) => {
   const { s, card } = fixture(); s.evocations = []; s.players[0].actionTokens = 0;
   for (const p of s.players.slice(1)) p.wizard.position = { q:1, r:1 };
   Object.assign(card, { target, range:0 }); setPrinted(card, { heal:0, damage:mode === 'offense' ? 1 : 0 });
   if (mode === 'heal') setPrinted(card, { heal:2 });
   if (mode === 'convert') setPrinted(card, { convert:2 });
   if (mode === 'protection') Object.assign(card, { spellType:'PROTECTION', trigger });
   if (mode === 'ongoing') card.ongoing = { trigger, effects:[] };
   syncCubes(s); expect(canPlayerAct(s, s.players[0])).toBe(true);
   const before = structuredClone(s), after = cast(s);
   noModelEffects(before, after); consumed(before, after, card); expect(after.currentPlayerId).toBe('p2');
   expect(canPlayerAct(after, after.players[0])).toBe(false);
  });
 const roomCases = [
  { label:'zero supply', supply:0, instability:2, reconstructed:false, scored:false, placed:0 },
  { label:'one supply', supply:1, instability:2, reconstructed:false, scored:false, placed:1 },
  { label:'one free space', supply:25, instability:9, reconstructed:false, scored:false, placed:1 },
  { label:'full pending Cleanup', supply:25, instability:10, reconstructed:false, scored:false, placed:0 },
  { label:'rebuilt unscored legacy', supply:25, instability:10, reconstructed:true, scored:false, placed:0 },
  { label:'rebuilt scored history', supply:25, instability:10, reconstructed:true, scored:true, placed:0 },
 ];
 it.each(eligible.flatMap(target => roomCases.map(c => ({ target, ...c }))))(
  '$target with $label uses actual instability only and never converts room or model cubes', ({ target, supply, instability, reconstructed, scored, placed }) => {
   const { s, card } = fixture(); Object.assign(card, { target, ...withMoments({ damage:7, heal:6, convert:5, instability:3 }) });
   Object.assign(room(s), { instability, reconstructed, scored, cubesByPlayer:{ p2:instability } });
   syncCubes(s);
   let remaining = s.players[0].cubes.available - supply;
   for (const r of s.board.rooms.filter(r => !r.startingFor && r.id !== center)) {
    const n = Math.max(0, Math.min(remaining, r.instabilityLimit - r.instability));
    if (n) { r.instability += n; r.cubesByPlayer.p1 = n; remaining -= n; }
   }
   if (supply < 25) expect(remaining).toBe(0);
   syncCubes(s); const before = structuredClone(s), after = cast(s);
   noModelEffects(before, after); consumed(before, after, card);
   expect(room(after)).toEqual({ ...room(before), instability:instability + placed,
    cubesByPlayer:{ p2:instability, ...(placed ? { p1:placed } : {}) } });
   expect(after.players[0].cubes).toEqual({ ...before.players[0].cubes,
    available:before.players[0].cubes.available - placed, onBoard:before.players[0].cubes.onBoard + placed });
   expect(after.players.slice(1).map(p => p.cubes)).toEqual(before.players.slice(1).map(p => p.cubes));
  });
});

describe('dummy SPELL_CAST events still resolve existing reactions', () => {
 it('reveals existing Spell Leech and preserves ongoing Arcane Feedback without adding a dummy binding', () => {
  let { s } = fixture("Summoner's Balm");
  turn(s, 'p3'); prepare(s, 'Arcane Feedback', 'rapid', 'p3');
  s = applyAction(s, { type:'CAST_SPELL', playerId:'p3', slot:'rapid', targetPlayerId:'p1' });
  turn(s, 'p2'); prepare(s, 'Spell Leech', 'rapid', 'p2');
  s = applyAction(s, { type:'CAST_SPELL', playerId:'p2', slot:'rapid', roomId:center });
  turn(s); const before = structuredClone(s), after = cast(s, { dummy:true, roomId:east });
  expect(after.players[0].wizard.damageCubes).toBe(before.players[0].wizard.damageCubes + 3);
  expect(after.players.slice(1).map(p => p.wizard)).toEqual(before.players.slice(1).map(p => p.wizard));
  expect(after.evocations).toEqual(before.evocations); expect(after.board).toEqual(before.board);
  expect(after.readiedSpells).toEqual([]); expect(after.ongoingSpells).toEqual(before.ongoingSpells);
  expect(after.activeSpellOrder).toEqual(before.ongoingSpells!.map(a => a.id));
  const events = after.feedbackEvents!.slice(before.feedbackEvents!.length);
  expect(events.map(e => e.kind)).toEqual(['SPELL_TRIGGERED', 'DAMAGE', 'SPELL_TRIGGERED', 'DAMAGE']);
  expect(events.filter(e => e.kind === 'SPELL_TRIGGERED').map(e => [e.cardName, e.trigger, e.roomId, e.ongoing]))
   .toEqual([['Spell Leech', 'SPELL_CAST', center, false], ['Arcane Feedback', 'SPELL_CAST', center, true]]);
  expect(events.filter(e => e.kind === 'DAMAGE').map(e => [e.sourceId, e.target.id, e.amount])).toEqual([['p2', 'p1', 2], ['p3', 'p1', 1]]);
  expect(after.activation).toMatchObject({ actionsUsed:1, spellsCast:1 });
  expect(cards(after)).toEqual(cards(before)); conserved(after);
 });
 it('retains unrelated readied/ongoing bindings and their exact chronological order', () => {
  let { s } = fixture('Renewing Word');
  turn(s, 'p2'); prepare(s, 'Mending Ward', 'rapid', 'p2');
  s = applyAction(s, { type:'CAST_SPELL', playerId:'p2', slot:'rapid', targetPlayerId:'p1' });
  turn(s, 'p3'); prepare(s, 'Thorned Path', 'rapid', 'p3');
  s = applyAction(s, { type:'CAST_SPELL', playerId:'p3', slot:'rapid', targetPlayerId:'p2' });
  turn(s); const before = structuredClone(s), after = cast(s);
  noModelEffects(before, after); expect(cards(after)).toEqual(cards(before)); conserved(after);
 });
});