import { describe, expect, it } from 'vitest';
import { applyAction, BLACK_ROSE_ID, canPlayerAct, canUseSpellDummy, createGame, getSpellType } from '../src';
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
 applyAction(s, { type:'CAST_SPELL', playerId:'p1', slot, ...(['TRAP', 'PROTECTION'].includes(getSpellType(s.players.find(p => p.id === 'p1')!.prepared[slot]!.card)) ? {} : selection) });
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