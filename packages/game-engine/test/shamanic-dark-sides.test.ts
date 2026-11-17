import { describe, expect, it } from 'vitest';
import { createGame, createShamanicDeck, getDarkSide, getSpellForSide, upgradeLegacyCards } from '../src';
import type { Card, GameState } from '../src';

const NAMES = ['Binding Totem', 'Astral Path', 'Earth Totem', 'Wind Spirit', 'Valor Totem', 'River Spirit',
 'Dominion Totem', 'Channeling Energy', 'Rain Totem', 'Steppe Spirit', 'Pyre Spirit', 'Source of Life'];

function fixture(): GameState {
 const s = createGame(2); s.round = 1; s.phase = 'ACTION'; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, spellsCast: 0, sequencedSpellUsed: false, discardedExit: false, roomEffectUsed: false };
 for (const p of s.players) { p.connected = true; p.wizard.position = { q: 0, r: 0 }; p.wizard.health = 30; }
 return s;
}

const school = (s: GameState) => s.library.find(d => d.id === 'shamanic')!;
function catalog(s: GameState, name: string): Card {
 const deck = school(s), index = deck.cards.findIndex(c => c.name === name);
 expect(index).toBeGreaterThanOrEqual(0);
 return deck.cards.splice(index, 1)[0];
}

describe('Shamanic dark sides', () => {
 it('gives every Shamanic card a distinct dark side with its own name, element and type', () => {
  const s = fixture();
  for (const name of NAMES) {
   const card = catalog(s, name), dark = getDarkSide(card);
   expect(card.darkSide).toBeDefined();
   const face = getSpellForSide(s, s.players[0], card, 'DARK');
   expect(face.name).toBe(name);
   expect(face.element).toBe(dark.element);
   expect(face.spellType).toBe(dark.spellType);
  }
 });

 it('restores dark sides on saved Shamanic cards', () => {
  const s = fixture(), card = catalog(s, 'Astral Path');
  delete card.darkSide;
  upgradeLegacyCards(card);
  expect(card.darkSide).toMatchObject({ target: 'SELF', spellType: 'CONTINGENCY' });
 });

 it('includes the requested dark-side rules text for the twelve shamanic cards', () => {
  const cards = createShamanicDeck('shamanic', 'shamanic');
  expect(cards.map(c => c.name)).toHaveLength(36);
  expect(new Set(cards.map(c => c.name))).toEqual(new Set([
   'Binding Totem','Astral Path','Earth Totem','Wind Spirit','Valor Totem','River Spirit',
   'Dominion Totem','Channeling Energy','Rain Totem','Steppe Spirit','Pyre Spirit','Source of Life',
  ]));
  const dark = (name: string) => cards.find(c => c.name === name)!.darkSide!;
  expect(dark('Binding Totem')).toMatchObject({ target: 'EVOCATION', targetFilter: { kind: 'TOTEM' }, moments: [{ effect: 'LOSE_VP', area: { range: 1 } }, { effect: 'GAIN_VP' }, { effect: 'REMOVE_EVOCATION' }] });
  expect(dark('Astral Path').moments).toEqual([{ effect: 'DRAW_QUESTS_KEEP', draw: 3, keep: 1 }]);
  expect(dark('Earth Totem')).toMatchObject({ spellType: 'PROTECTION', trigger: { spellTypes: ['TRAP'] } });
  expect(dark('Wind Spirit').moments).toEqual([{ effect: 'LOOK_LIBRARY', cards: 3 }]);
  expect(dark('Valor Totem').moments).toEqual([{ effect: 'DRAW_QUEST' }, { effect: 'REMOVE_TOTEMS', max: 3, vpIfAll: 4 }]);
  expect(dark('River Spirit').moments).toEqual([{ effect: 'DRAW_EVENT' }, { effect: 'DRAW_QUEST' }, { effect: 'GAIN_VP', amount: 2 }]);
  expect(dark('Dominion Totem').moments.filter(m => m.effect === 'ACTIVATE_CHOICE')).toHaveLength(2);
  expect(dark('Channeling Energy').ongoing?.effects[0]).toMatchObject({ effect: 'BLACK_ROSE_ALTAR_TITHE', placeCube: { range: 1 } });
  expect(dark('Rain Totem').moments.every(m => m.when === 'TARGET_IS_TOTEM')).toBe(true);
  expect(dark('Steppe Spirit').ongoing?.trigger).toMatchObject({ event: 'ENTER_ROOM', scope: 'BOUND_MODEL' });
  expect(dark('Pyre Spirit').moments.filter(m => m.effect === 'MOVE_ALTAR')).toHaveLength(3);
  expect(dark('Source of Life').moments).toEqual([{ effect: 'HEAL', amount: 3 }, { effect: 'INSTABILITY', amount: 2 }]);
 });
});
