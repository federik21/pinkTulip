import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getDarkSide, getRevealedElements, getSpellForSide, isEnhanced, moment } from '../src';
import { unstableEffects } from '../src/cards';
import type { GameState, SpellSide } from '../src';

function fixture(side?: SpellSide): GameState {
 const s = createGame(2); s.phase = 'ACTION'; s.round = 1; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false, spellsCast: 0, discardedExit: false, roomEffectUsed: false };
 for (const p of s.players) p.wizard.position = { q: 0, r: 0 };
 const deck = s.library[0], index = deck.cards.findIndex(c => c.name === 'Peak of Agony');
 const card = deck.cards.splice(index, 1)[0];
 card.effects = unstableEffects([moment.damage(1)]); card.target = 'MAGE'; card.range = 2;
 delete card.darkSide; // Exercise the placeholder; real Agony dark sides are covered in agony-dark-sides.test.ts.
 s.players[0].prepared.rapid = { card, used: false, ...(side ? { side } : {}) };
 return s;
}

function preparation(): GameState {
 const s = createGame(2); s.phase = 'PREPARATION'; s.round = 1;
 for (const p of s.players) {
  p.preparationDone = false;
  p.hand = s.library[0].cards.splice(0, 3);
 }
 return s;
}

describe('spell dark side', () => {
 it('falls back to a placeholder that shares only the name and instability', () => {
  const s = fixture(), card = s.players[0].prepared.rapid!.card;
  const dark = getSpellForSide(s, s.players[0], card, 'DARK');
  expect(dark.name).toBe(card.name);
  expect(dark.effects.map(e => e.kind)).toEqual(['PLACE']);
  expect(getDarkSide(card).moments).toEqual([]);
  expect(getSpellForSide(s, s.players[0], card, 'LIGHT').target).toBe('MAGE');
 });
 it('resolves only the instability when the spell was prepared as its dark side', () => {
  const s = fixture('DARK');
  const result = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid' });
  expect(result.board.rooms.find(r => r.id === 'room-0,0')!.instability).toBe(1);
  expect(result.players[1].wizard.damageCubes).toBe(s.players[1].wizard.damageCubes);
  expect(result.log.some(l => l.includes('casts the dark side of Peak of Agony'))).toBe(true);
  expect(result.players[0].prepared.rapid?.used).toBe(true);
 });
 it('resolves the light side by default and when prepared as light', () => {
  for (const side of [undefined, 'LIGHT' as const]) {
   const result = applyAction(fixture(side), { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p2' });
   expect(result.players[1].wizard.damageCubes).toBeGreaterThan(0);
  }
 });
 it('uses only the chosen face element for spell effects, enhancement symbols and elemental quests', () => {
  const s=fixture('DARK'),caster=s.players[0],prepared=caster.prepared.rapid!,card=prepared.card;
  card.element='fire';
  card.darkSide={...getDarkSide(card),moments:[moment.damage(1)],range:2,target:'MAGE',element:'earth'};
  const previous={...card,id:'previous-side-card'};
  caster.prepared.slot1={card:previous,used:true,side:'DARK'};
  const current={...card,id:'current-side-card',enhancement:{requires:['fire'],moments:[moment.heal(1)],text:'Fire enhancement'}};
  expect(getRevealedElements(s,caster,current)).toEqual(['earth']);
  expect(isEnhanced(s,caster,current)).toBe(false);
  caster.prepared.slot1.side='LIGHT';
  expect(getRevealedElements(s,caster,current)).toEqual(['fire']);
  expect(isEnhanced(s,caster,current)).toBe(true);

  caster.prepared.slot1.side='DARK';
  caster.quest={id:'fire-quest',name:'Fire only',description:'Fire only',kind:'SPELL_EFFECT',amount:1,reward:1,progress:0,
   trigger:{event:'SPELL_EFFECT',spellType:'COMBAT',elementGroup:['fire'],minimumElements:1}};
  const result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
  expect(result.players[0].quest?.progress).toBe(0);
    expect(result.players[0].quest?.completed).toBeFalsy();
  expect(getSpellForSide(s,caster,card,'DARK')).toMatchObject({spellType:'CONTINGENCY',element:'earth'});
 });
 it('cannot target a model with a spell prepared as its dark side', () => {
  expect(() => applyAction(fixture('DARK'), { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p2' })).toThrow();
 });
 it('rejects choosing a side when casting', () => {
  expect(() => applyAction(fixture(), { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', side: 'DARK' } as never)).toThrow();
 });
 it('stores the side chosen during preparation and defaults the others to light', () => {
  const s = preparation(), [a, b, c] = s.players[0].hand;
  const result = applyAction(s, { type: 'PREPARE_CARDS', playerId: 'p1', preparedCardIds: [a.id, b.id], rapidCardId: c.id, sides: { [b.id]: 'DARK', [c.id]: 'DARK' } });
  const prepared = result.players[0].prepared;
  expect(prepared.slot1?.side).toBeUndefined();
  expect(prepared.slot2?.side).toBe('DARK');
  expect(prepared.rapid?.side).toBe('DARK');
 });
 it('rejects a side for a card that is not being prepared or an invalid side', () => {
  const s = preparation(), [a, b, c] = s.players[0].hand;
  expect(() => applyAction(s, { type: 'PREPARE_CARDS', playerId: 'p1', preparedCardIds: [a.id, b.id], sides: { [c.id]: 'DARK' } })).toThrow();
  expect(() => applyAction(s, { type: 'PREPARE_CARDS', playerId: 'p1', preparedCardIds: [a.id, b.id], sides: { [a.id]: 'SHADOW' as never } })).toThrow();
 });
});
