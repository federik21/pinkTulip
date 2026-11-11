import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getDarkSide, getSpellForSide, moment, summonEvocation, upgradeLegacyCards } from '../src';
import { mainEffects } from '../src/cards';
import type { Card, GameState } from '../src';

const AGONY_NAMES = ['Shared Torture', 'Grim Torment', 'Cross and Delight', 'Torment', 'Visceral Fire', 'Peak of Agony',
 'Pain Mark', 'Master of Pleasure', 'Liquefy the Pain', 'Submission', 'Ineluctable Pain', 'Hearth of Ice'];

function fixture(): GameState {
 const s = createGame(3); s.round = 1; s.phase = 'ACTION'; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, spellsCast: 0, sequencedSpellUsed: false, discardedExit: false, roomEffectUsed: false };
 for (const p of s.players) { p.connected = true; p.wizard.position = { q: 0, r: 0 }; p.wizard.health = 30; }
 return s;
}
function catalog(s: GameState, name: string): Card {
 const index = s.library[0].cards.findIndex(c => c.name === name);
 expect(index).toBeGreaterThanOrEqual(0);
 return s.library[0].cards.splice(index, 1)[0];
}
function wound(s: GameState, index: number, history: string[]) {
 const w = s.players[index].wizard;
 w.damageOrder = [...history]; w.damageCubes = history.length; w.blackDamage = history.filter(id => id === 'black-rose').length; w.damageByPlayer = {};
 for (const id of history) if (id !== 'black-rose') {
  w.damageByPlayer[id] = (w.damageByPlayer[id] ?? 0) + 1;
  const owner = s.players.find(p => p.id === id)!; owner.cubes.available--; owner.cubes.onWizard++;
 }
}
function cast(s: GameState, name: string, target: { targetPlayerId?: string; targetEvocationId?: string; roomId?: string }) {
 s.players[0].prepared.rapid = { used: false, card: catalog(s, name), side: 'DARK' };
 return applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', ...target });
}
const instability = (s: GameState, roomId: string) => s.board.rooms.find(r => r.id === roomId)!.instability;

describe('Agony dark sides', () => {
 it('gives every Agony card a distinct, playable dark side', () => {
  const s = fixture();
  for (const name of AGONY_NAMES) {
   const card = catalog(s, name), dark = getDarkSide(card);
   expect(dark.rulesText).not.toBe('No effect yet.');
   const face = getSpellForSide(s, s.players[0], card, 'DARK');
   expect(face.name).toBe(name);
   expect(face.spellType).toBe(dark.spellType);
  }
 });

 it('Shared Torture inflicts 1 damage per 2 BR damage on the caster', () => {
  const s = fixture(); wound(s, 0, ['black-rose', 'black-rose', 'black-rose', 'black-rose', 'p3']);
  expect(cast(s, 'Shared Torture', { targetPlayerId: 'p2' }).players[1].wizard.damageCubes).toBe(2);
 });

 it('Visceral Fire inflicts 1 damage per BR damage on the caster, up to 5', () => {
  for (const [black, expected] of [[3, 3], [7, 5]] as const) {
   const s = fixture(); wound(s, 0, Array<string>(black).fill('black-rose'));
   expect(cast(s, 'Visceral Fire', { roomId: 'room-0,0' }).players[1].wizard.damageCubes).toBe(expected);
  }
 });

 it('Grim Torment first takes 1 Pain, then scales its damage on the caster’s damage', () => {
  const s = fixture(); wound(s, 0, ['p2', 'p3', 'p3']);
  const after = cast(s, 'Grim Torment', { roomId: 'room-0,0' });
  expect(after.players[0].wizard.damageCubes).toBe(4);
  expect(after.players[1].wizard.damageCubes).toBe(2);
 });

 it('Hearth of Ice places 1 instability per BR damage on the caster, up to 4', () => {
  const s = fixture(); wound(s, 0, Array<string>(6).fill('black-rose'));
  const before = instability(s, 'room-1,0');
  expect(instability(cast(s, 'Hearth of Ice', { roomId: 'room-1,0' }), 'room-1,0') - before).toBe(4);
 });

 it('Submission places instability for BR damage on the models it damaged', () => {
  const plain = fixture(), marked = fixture();
  wound(marked, 1, ['black-rose', 'black-rose']);
  const base = instability(cast(plain, 'Submission', { roomId: 'room-0,0' }), 'room-0,0');
  expect(instability(cast(marked, 'Submission', { roomId: 'room-0,0' }), 'room-0,0') - base).toBe(2);
 });

 it('Cross and Delight damages every model in a demon’s room, scaled by its damage, then removes it', () => {
  const s = fixture(); s.players[1].wizard.position = { q: 1, r: 0 };
  const demon = summonEvocation(s, s.players[0], 'SUCCUBUS', { q: 1, r: 0 })!;
  demon.damageCubes = 1;
  const after = cast(s, 'Cross and Delight', { targetEvocationId: demon.id });
  expect(after.players[1].wizard.damageCubes).toBe(3);
  expect(after.evocations.some(e => e.id === demon.id)).toBe(false);
 });

 it('Torment answers damage a mage inflicts on you with that damage +1', () => {
  const s = fixture(), torment = catalog(s, 'Torment'), p2 = s.players[1];
  s.readiedSpells!.push({ id: 'torment', playerId: 'p2', card: getSpellForSide(s, p2, torment, 'DARK'), printed: torment, side: 'DARK' });
  s.activeSpellOrder!.push('torment');
  const hit: Card = { id: s.library[0].cards.shift()!.id, name: 'Test hit', kind: 'SPELL', spellType: 'COMBAT', effects: mainEffects([moment.damage(2)]), target: 'MAGE', range: Infinity };
  s.players[0].prepared.rapid = { used: false, card: hit };
  const paused = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p2' });
  expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL');
  const after = applyAction(paused, { type: 'RESPOND_REACTIVE_SPELL', playerId: 'p2', key: paused.pendingDecision!.key, activeSpellId: 'torment' });
  expect(after.players[0].wizard.damageCubes).toBe(3);
 });

 it('Ineluctable Pain grants 1 VP when BR damages the owner', () => {
  const s = fixture(), pain = catalog(s, 'Ineluctable Pain');
  s.players[0].prepared.rapid = { used: false, card: pain, side: 'DARK' };
  const active = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid' });
  expect(active.ongoingSpells?.some(o => o.card.name === 'Ineluctable Pain' && o.playerId === 'p1')).toBe(true);
  const peak: Card = { id: active.library[0].cards.shift()!.id, name: 'Self harm', kind: 'SPELL', spellType: 'COMBAT', effects: mainEffects([moment.pain(2)]), target: 'SELF', range: 0 };
  active.players[0].prepared.slot1 = { used: false, card: peak };
  const before = active.players[0].victoryPoints;
  const after = applyAction(active, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1' });
  expect(after.players[0].victoryPoints - before).toBe(1);
 });

 it('Pain Mark transfers wounds without inflicting them again', () => {
  const take = (g: GameState, n: string) => g.library[0].cards.splice(g.library[0].cards.findIndex(c => c.name === n), 1)[0];
 const s = createGame(3); s.round = 1; s.phase = 'ACTION'; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, spellsCast: 0, sequencedSpellUsed: false, discardedExit: false, roomEffectUsed: false };
 for (const p of s.players) { p.connected = true; p.wizard.position = { q: 0, r: 0 }; p.wizard.health = 30; }
 s.players[0].prepared.rapid = { used: false, card: take(s, 'Pain Mark'), side: 'DARK' };
 let st = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid' });
 st.currentPlayerId = 'p3'; st.activation = { ...st.activation!, playerId: 'p3', spellsCast: 0, sequencedSpellUsed: false };
 st.players[2].prepared.rapid = { used: false, card: take(st, 'Pain Mark') };
 st = applyAction(st, { type: 'CAST_SPELL', playerId: 'p3', slot: 'rapid', targetPlayerId: 'p2' });
 const ev = summonEvocation(st, st.players[0], 'CADAVER', { q: 0, r: 0 })!;
 st.currentPlayerId = 'p2'; st.activation = { ...st.activation!, playerId: 'p2', spellsCast: 0, sequencedSpellUsed: false };
 const hit: Card = { id: st.library[0].cards.shift()!.id, name: 'Test hit', kind: 'SPELL', spellType: 'COMBAT', effects: mainEffects([moment.damage(1)]), target: 'MAGE', range: Infinity };
 st.players[1].prepared.rapid = { used: false, card: hit };
 const p = applyAction(st, { type: 'CAST_SPELL', playerId: 'p2', slot: 'rapid', targetPlayerId: 'p1' });
 const d: any = p.pendingDecision; 
 const after = applyAction(p, { type: 'RESPOND_CHOICE', playerId: 'p1', key: d.key, choiceId: ev.id });
 expect(after.players[1].wizard.damageCubes).toBe(2);
 expect(after.log.filter((l: string) => l.includes('Pain Mark remains') === false && l.includes('Interrupt DAMAGE_DEALT')).length).toBe(1);
 expect(after.log.some((l: string) => l.includes('Cadaver suffers 1 black damage'))).toBe(true);
 });

 it('restores a saved dark side’s infinite range and migrates saved Agony cards without one', () => {
  const s = fixture(), card = catalog(s, 'Cross and Delight');
  const saved = JSON.parse(JSON.stringify(card)); expect(saved.darkSide.range).toBeNull();
  upgradeLegacyCards(saved); expect(saved.darkSide.range).toBe(Infinity);
  delete saved.darkSide; upgradeLegacyCards(saved);
  expect(saved.darkSide.targetFilter).toEqual({ own: true, archetype: 'DEMON' });
 });
});
