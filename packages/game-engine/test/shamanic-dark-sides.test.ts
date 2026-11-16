import { describe, expect, it } from 'vitest';
import { createGame, createShamanicDeck, getDarkSide, getSpellForSide, upgradeLegacyCards } from '../src';
import type { Card, GameState } from '../src';

const NAMES = ['Binding Totem', 'Astral Path', 'Earth Totem', 'Wind Spirit', 'Valor Totem', 'River Spirit',
 'Dominion Token', 'Channeling Energy', 'Rain Totem', 'Steppe Spirit', 'Pyre Spirit', 'Source of Life'];

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
   'Dominion Token','Channeling Energy','Rain Totem','Steppe Spirit','Pyre Spirit','Source of Life',
  ]));
  expect(cards.find(c => c.name === 'Binding Totem')?.darkSide?.rulesText).toContain('lose 1 VP');
  expect(cards.find(c => c.name === 'Astral Path')?.darkSide?.rulesText).toContain('draw 3');
  expect(cards.find(c => c.name === 'Earth Totem')?.darkSide?.rulesText).toContain('Ignore');
  expect(cards.find(c => c.name === 'Wind Spirit')?.darkSide?.rulesText).toContain('draw 3');
  expect(cards.find(c => c.name === 'Valor Totem')?.darkSide?.rulesText).toContain('remove up to 3');
  expect(cards.find(c => c.name === 'River Spirit')?.darkSide?.rulesText).toContain('draw 1 event');
  expect(cards.find(c => c.name === 'Dominion Token')?.darkSide?.rulesText).toContain('within 2');
  expect(cards.find(c => c.name === 'Channeling Energy')?.darkSide?.rulesText).toContain('Ongoing');
  expect(cards.find(c => c.name === 'Rain Totem')?.darkSide?.rulesText).toContain('activate');
  expect(cards.find(c => c.name === 'Steppe Spirit')?.darkSide?.rulesText).toContain('when the target enters');
  expect(cards.find(c => c.name === 'Pyre Spirit')?.darkSide?.rulesText).toContain('Discard 1 event');
  expect(cards.find(c => c.name === 'Source of Life')?.darkSide?.rulesText).toContain('Heal 3');
 });
});
