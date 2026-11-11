import { describe, expect, it } from 'vitest';
import { applyAction, canPlayerAct, createGame, getDarkSide, getSpellForSide, moment, summonEvocation, upgradeLegacyCards } from '../src';
import { mainEffects } from '../src/cards';
import type { Card, Element, GameState } from '../src';

const ALCHEMY_NAMES = ['Azoth Bomb', 'Viatorium Spagyricum', 'Deflagrate', 'Athanor Eruption', 'Marbling', 'Stone Phoenix',
 'Soul Transfer', 'Liquid Fire', 'Fountain of the Three', 'Purifying Aludel', 'Albify', 'Silver of the Sages'];

function fixture(): GameState {
 const s = createGame(3); s.round = 1; s.phase = 'ACTION'; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, spellsCast: 0, sequencedSpellUsed: false, discardedExit: false, roomEffectUsed: false };
 for (const p of s.players) { p.connected = true; p.wizard.position = { q: 0, r: 0 }; p.wizard.health = 30; }
 return s;
}
const school = (s: GameState) => s.library.find(d => d.id === 'alchemy')!;
function catalog(s: GameState, name: string): Card {
 const deck = school(s), index = deck.cards.findIndex(c => c.name === name);
 expect(index).toBeGreaterThanOrEqual(0);
 return deck.cards.splice(index, 1)[0];
}
let serial = 0;
// Other revealed spells that show the given symbols on the caster's mage sheet.
function reveal(s: GameState, ...elements: Element[]) {
 const slots = ['slot1', 'slot2', 'slot3'] as const;
 elements.forEach((element, index) => {
  s.players[0].prepared[slots[index]] = { used: true, card: { id: `shown-${serial++}`, name: 'Shown', kind: 'SPELL', effects: [], target: 'SELF', range: 0, element } };
 });
}
function cast(s: GameState, name: string, target: { targetPlayerId?: string; targetEvocationId?: string; roomId?: string } = {}, side: 'LIGHT' | 'DARK' = 'DARK') {
 s.players[0].prepared.rapid = { used: false, card: catalog(s, name), side };
 return applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', ...target });
}
const wounds = (s: GameState, index: number) => s.players[index].wizard.damageCubes;
const instability = (s: GameState, roomId: string) => s.board.rooms.find(r => r.id === roomId)!.instability;
function ready(s: GameState, name: string, playerIndex = 0) {
 const card = catalog(s, name), player = s.players[playerIndex], id = `ready-${name}`;
 s.readiedSpells!.push({ id, playerId: player.id, card: getSpellForSide(s, player, card, 'DARK'), printed: card, side: 'DARK' });
 s.activeSpellOrder!.push(id);
 return id;
}
function hit(s: GameState, target: 'MAGE' | 'EVOCATION', amount: number): Card {
 return { id: school(s).cards.shift()!.id, name: 'Test hit', kind: 'SPELL', spellType: 'COMBAT', effects: mainEffects([moment.damage(amount)]), target, range: Infinity };
}

describe('Alchemy dark sides', () => {
 it('gives every Alchemy card a distinct dark side that keeps only the shared name and instability', () => {
  const s = fixture();
  for (const name of ALCHEMY_NAMES) {
   const card = catalog(s, name), dark = getDarkSide(card);
   expect(card.darkSide).toBeDefined();
   const face = getSpellForSide(s, s.players[0], card, 'DARK');
   expect(face.name).toBe(name);
   expect(face.element).toBe(dark.element);
   expect(face.spellType).toBe(dark.spellType);
   expect(face.effects.filter(e => e.kind === 'PLACE')).toEqual(card.effects.filter(e => e.kind === 'PLACE'));
  }
 });

 it('Azoth Bomb inflicts 1 extra damage per revealed earth symbol once enhanced', () => {
  const plain = fixture(), enhanced = fixture();
  plain.players[1].wizard.position = { q: 1, r: 0 }; enhanced.players[1].wizard.position = { q: 1, r: 0 };
  reveal(enhanced, 'earth', 'earth');
  expect(wounds(cast(plain, 'Azoth Bomb', { roomId: 'room-1,0' }), 1)).toBe(2);
  expect(wounds(cast(enhanced, 'Azoth Bomb', { roomId: 'room-1,0' }), 1)).toBe(4);
 });

 it('Azoth Bomb counts wild symbols as earth for scaling', () => {
  const s = fixture(); s.players[1].wizard.position = { q: 1, r: 0 };
  reveal(s, 'wild', 'earth');
  expect(wounds(cast(s, 'Azoth Bomb', { roomId: 'room-1,0' }), 1)).toBe(4);
 });

 it('Azoth Bomb is not enhanced by symbols other than earth', () => {
  const s = fixture(); s.players[1].wizard.position = { q: 1, r: 0 };
  reveal(s, 'water', 'water');
  expect(wounds(cast(s, 'Azoth Bomb', { roomId: 'room-1,0' }), 1)).toBe(2);
 });

 it('Viatorium Spagyricum inflicts 2 extra damage when enhanced by water', () => {
  const s = fixture(); reveal(s, 'water');
  expect(wounds(cast(s, 'Viatorium Spagyricum', { targetPlayerId: 'p2' }), 1)).toBe(4);
  const noWater = fixture(); reveal(noWater, 'earth', 'earth');
  expect(wounds(cast(noWater, 'Viatorium Spagyricum', { targetPlayerId: 'p2' }), 1)).toBe(2);
 });

 it('Deflagrate inflicts 1 and places 2 instability, with 1 extra damage when enhanced by fire', () => {
  const s = fixture(), before = instability(s, 'room-0,0');
  const after = cast(s, 'Deflagrate', { roomId: 'room-0,0' });
  expect(wounds(after, 1)).toBe(1);
  expect(instability(after, 'room-0,0') - before).toBe(2);
  const fire = fixture(); reveal(fire, 'fire');
  expect(wounds(cast(fire, 'Deflagrate', { roomId: 'room-0,0' }), 1)).toBe(2);
 });

 it('Athanor Eruption places 1 instability per revealed air symbol in the target’s room when enhanced', () => {
  const s = fixture(); s.players[1].wizard.position = { q: 1, r: 0 }; reveal(s, 'air', 'air');
  const before = instability(s, 'room-1,0');
  const after = cast(s, 'Athanor Eruption', { targetPlayerId: 'p2' });
  expect(wounds(after, 1)).toBe(2);
  expect(instability(after, 'room-1,0') - before).toBe(2);
 });

 it('Marbling places 2 instability before its damage when enhanced by water', () => {
  const plain = fixture(), enhanced = fixture(); reveal(enhanced, 'water');
  const before = instability(plain, 'room-0,0');
  const first = cast(plain, 'Marbling', { roomId: 'room-0,0' }), second = cast(enhanced, 'Marbling', { roomId: 'room-0,0' });
  expect(wounds(first, 1)).toBe(1);
  expect(instability(first, 'room-0,0')).toBe(before);
  expect(wounds(second, 1)).toBe(1);
  expect(instability(second, 'room-0,0') - before).toBe(2);
 });

 it('Stone Phoenix brings back any lost evocation for its owner and activates it', () => {
  const s = fixture(), id = ready(s, 'Stone Phoenix');
  const enemy = summonEvocation(s, s.players[2], 'CADAVER', { q: 0, r: 0 })!;
  s.players[1].prepared.rapid = { used: false, card: hit(s, 'EVOCATION', 5) };
  s.currentPlayerId = 'p2'; s.activation = { ...s.activation!, playerId: 'p2' };
  const paused = applyAction(s, { type: 'CAST_SPELL', playerId: 'p2', slot: 'rapid', targetEvocationId: enemy.id });
  expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL');
  const after = applyAction(paused, { type: 'RESPOND_REACTIVE_SPELL', playerId: 'p1', key: paused.pendingDecision!.key, activeSpellId: id });
  const revived = after.evocations.filter(e => e.playerId === 'p1');
  expect(after.evocations.some(e => e.id === enemy.id)).toBe(false);
  expect(revived).toHaveLength(1);
  expect(revived[0].name).toBe('Cadaver');
  expect(after.evocationActivation?.evocationId).toBe(revived[0].id);
  expect(after.evocationActivation?.playerId).toBe('p1');
 });

 it('Soul Transfer swaps one of your constructs for any evocation with at most 3 health', () => {
  const s = fixture(); s.players[1].wizard.position = { q: 1, r: 0 };
  const nigredo = summonEvocation(s, s.players[0], 'NIGREDO', { q: 1, r: 0 })!;
  const paused = cast(s, 'Soul Transfer', { roomId: 'room-1,0' });
  expect(paused.pendingDecision?.kind).toBe('CHOICE');
  const choice = applyAction(paused, { type: 'RESPOND_CHOICE', playerId: 'p1', key: paused.pendingDecision!.key, choiceId: nigredo.id });
  expect(choice.pendingDecision?.kind).toBe('CHOICE');
  const ids = (choice.pendingDecision as { options: { id: string }[] }).options.map(o => o.id);
  expect(ids).toContain('CADAVER');
  expect(ids).not.toContain('COLOSSUS');
  expect(ids).not.toContain('UMBRA');
  const after = applyAction(choice, { type: 'RESPOND_CHOICE', playerId: 'p1', key: choice.pendingDecision!.key, choiceId: 'CADAVER' });
  const mine = after.evocations.filter(e => e.playerId === 'p1');
  expect(mine.map(e => e.name)).toEqual(['Cadaver']);
  expect(mine[0].position).toEqual({ q: 1, r: 0 });
 });

 it('Soul Transfer summons nothing when no construct is removed', () => {
  const s = fixture();
  const after = cast(s, 'Soul Transfer', { roomId: 'room-0,0' });
  expect(after.pendingDecision).toBeUndefined();
  expect(after.evocations).toHaveLength(0);
 });

 it('Liquid Fire damages the room and summons a Nigredo; water adds a construct activation with +1 movement', () => {
  const plain = fixture();
  const first = cast(plain, 'Liquid Fire', { roomId: 'room-0,0' });
  expect(wounds(first, 1)).toBe(1);
  expect(first.evocations.filter(e => e.playerId === 'p1').map(e => e.name)).toEqual(['Nigredo']);
  expect(first.evocationActivation).toBeFalsy();

  const s = fixture(); reveal(s, 'water');
  const nigredo = summonEvocation(s, s.players[0], 'NIGREDO', { q: 0, r: 0 })!;
  let after = cast(s, 'Liquid Fire', { roomId: 'room-0,0' });
  if (after.pendingDecision?.kind === 'CHOICE') after = applyAction(after, { type: 'RESPOND_CHOICE', playerId: 'p1', key: after.pendingDecision.key, choiceId: nigredo.id });
  expect(after.evocationActivation?.evocationId).toBe(nigredo.id);
  expect(after.evocationActivation?.movesRemaining).toBe(3);
 });

 it('Purifying Aludel activates any evocation under your control', () => {
  const s = fixture(), enemy = summonEvocation(s, s.players[1], 'CADAVER', { q: 0, r: 0 })!;
  const after = cast(s, 'Purifying Aludel', { targetEvocationId: enemy.id });
  expect(after.evocationActivation?.evocationId).toBe(enemy.id);
  expect(after.evocationActivation?.playerId).toBe('p1');
 });

 it('Albify converts damage on every model in the target room, with 1 extra damage when enhanced by fire', () => {
  const s = fixture();
  for (const index of [1, 2]) {
   const w = s.players[index].wizard;
   w.damageOrder = ['p3', 'p3', 'p3', 'p3']; w.damageCubes = 4; w.damageByPlayer = { p3: 4 };
  }
  s.players[2].cubes.available -= 8; s.players[2].cubes.onWizard += 8;
  let after = cast(s, 'Albify', { roomId: 'room-0,0' });
  while (after.pendingDecision?.kind === 'CHOICE') after = applyAction(after, { type: 'RESPOND_CHOICE', playerId: 'p1', key: after.pendingDecision.key, choiceId: (after.pendingDecision as { options: { id: string }[] }).options[0].id });
  expect(after.players[1].wizard.damageByPlayer.p1 ?? 0).toBe(3);
  expect(after.players[1].wizard.damageCubes).toBe(4);
 });

 it('Silver of the Sages lets a defeated mage choose between activating a construct and gaining VP with a Nigredo', () => {
  const s = fixture(), id = ready(s, 'Silver of the Sages');
  s.players[0].wizard.health = 2;
  s.players[1].prepared.rapid = { used: false, card: hit(s, 'MAGE', 5) };
  s.currentPlayerId = 'p2'; s.activation = { ...s.activation!, playerId: 'p2' };
  const paused = applyAction(s, { type: 'CAST_SPELL', playerId: 'p2', slot: 'rapid', targetPlayerId: 'p1' });
  expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL');
  const picking = applyAction(paused, { type: 'RESPOND_REACTIVE_SPELL', playerId: 'p1', key: paused.pendingDecision!.key, activeSpellId: id });
  expect(picking.pendingDecision?.kind).toBe('CHOICE');
  const options = (picking.pendingDecision as { options: { id: string; label: string }[] }).options;
  expect(options.map(o => o.id).sort()).toEqual(['activate', 'summon']);
  const before = picking.players[0].victoryPoints;
  const after = applyAction(picking, { type: 'RESPOND_CHOICE', playerId: 'p1', key: picking.pendingDecision!.key, choiceId: 'summon' });
  expect(after.players[0].victoryPoints - before).toBeGreaterThanOrEqual(1);
  expect(after.evocations.some(e => e.playerId === 'p1' && e.name === 'Nigredo')).toBe(true);
 });

 it('Fountain of the Three has no trigger yet, so it can be neither cast nor counted as a playable spell', () => {
  const s = fixture();
  s.players[0].prepared.rapid = { used: false, card: catalog(s, 'Fountain of the Three'), side: 'DARK' };
  expect(() => applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid' })).toThrow();
  s.players[0].actionTokens = 0; s.activation!.discardedExit = true;
  for (const slot of ['slot1', 'slot2', 'slot3'] as const) s.players[0].prepared[slot] = null;
  expect(canPlayerAct(s, s.players[0])).toBe(false);
 });

 it('migrates saved Alchemy cards without a dark side and restores infinite range', () => {
  const s = fixture(), card = catalog(s, 'Purifying Aludel');
  const saved = JSON.parse(JSON.stringify(card)); expect(saved.darkSide.range).toBeNull();
  upgradeLegacyCards(saved); expect(saved.darkSide.range).toBe(Infinity);
  delete saved.darkSide; upgradeLegacyCards(saved);
  expect(saved.darkSide.moments).toEqual([{ effect: 'ACTIVATE_TARGET' }]);
 });
});
