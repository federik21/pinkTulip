import { describe, expect, it } from 'vitest';
import { applyAction, createGame, createLibrary, createPowerfulDeck, getSpellType, isWithinSpellRange } from '../src';
import { moment, momentTotal, upgradeLegacyCards } from '../src/cards';
import type { ActiveSpell, Card, Evocation, GameState, Moment, SpellTarget } from '../src';

const origin = { q: 0, r: 0 };
const spell = (moments: Moment[], target: SpellTarget = 'MODEL'): Card =>
 ({ id: 'moments-spell', name: 'Moments spell', kind: 'SPELL', moments, range: 2, target });

function fixture(): GameState {
 const s = createGame(4); s.phase = 'ACTION'; s.round = 1; s.currentPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false, spellsCast: 0, discardedExit: false, roomEffectUsed: false };
 for (const p of s.players) p.wizard.position = { ...origin };
 s.evocations = [];
 return s;
}
const wound = (s: GameState, index: number, ledger: Record<string, number>) => {
 const wizard = s.players[index].wizard;
 wizard.damageByPlayer = { ...ledger }; wizard.damageCubes = Object.values(ledger).reduce((a, b) => a + b, 0);
 const owner = s.players.find(p => ledger[p.id]);
 for (const p of s.players) { p.cubes.onWizard = s.players.reduce((n, t) => n + (t.wizard.damageByPlayer[p.id] ?? 0), 0); p.cubes.available = 25 - p.cubes.onWizard - p.cubes.onBoard - p.cubes.onEvocations; }
 return owner;
};
function cast(s: GameState, card: Card, extra: { targetPlayerId?: string; roomId?: string } = { targetPlayerId: 'p2' }) {
 s.players[0].prepared.rapid = { card, used: false };
 return applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', ...extra });
}
const hits = (s: GameState, name: string) => (s.feedbackEvents ?? []).filter(e => e.kind === 'DAMAGE' && e.target.id === name).map(e => (e as { amount: number }).amount);
const kinds = (s: GameState) => (s.feedbackEvents ?? []).map(e => e.kind);

describe('moments are an ordered, repeatable list of effect steps', () => {
 it('resolves the same moment twice, each time as its own damage event', () => {
  const after = cast(fixture(), spell([moment.damage(1), moment.damage(1)]));
  expect(after.players[1].wizard.damageCubes).toBe(2);
  expect(after.players[1].wizard.damageByPlayer).toEqual({ p1: 2 });
  expect(hits(after, 'p2')).toEqual([1, 1]);
 });

 it('resolves repeated moments of different amounts in card order', () => {
  const after = cast(fixture(), spell([moment.damage(1), moment.damage(3)]));
  expect(hits(after, 'p2')).toEqual([1, 3]);
  expect(after.players[1].wizard.damageCubes).toBe(4);
 });

 it('lets the card decide the sequence: heal before damage differs from damage before heal', () => {
  const healFirst = fixture(); wound(healFirst, 1, { p3: 5 });
  const a = cast(healFirst, spell([moment.heal(3), moment.damage(5)]));
  expect(a.players[1].wizard.damageCubes).toBe(7);
  expect(a.players[1].wizard.damageByPlayer).toEqual({ p3: 2, p1: 5 });

  const damageFirst = fixture(); wound(damageFirst, 1, { p3: 5 });
  const b = cast(damageFirst, spell([moment.damage(5), moment.heal(3)]));
  // The mage is defeated by the first moment, so the later heal finds nothing to heal.
  expect(kinds(b)).toContain('MAGE_DEFEATED');
  expect(kinds(b)).not.toContain('HEAL');
  expect(b.players[1].wizard.damageCubes).toBe(0);
 });

 it('places instability at the point of the card where it is written', () => {
  const s = fixture(); const room = s.board.rooms.find(r => r.id === 'room-0,0')!;
  const before = room.instability;
  const after = cast(s, spell([moment.instability(1), moment.damage(1), moment.instability(1)], 'ROOM'), { roomId: 'room-0,0' });
  expect(after.board.rooms.find(r => r.id === 'room-0,0')!.instability).toBe(before + 2);
  expect(after.players[1].wizard.damageCubes).toBe(1);
 });

 it('inflicts black pain on the mage resolving the effect', () => {
  const after = cast(fixture(), spell([moment.pain(2), moment.damage(1)], 'MODEL'), { targetPlayerId: 'p2' });
  expect(after.players[0].wizard.blackDamage).toBe(2);
  expect(after.players[0].wizard.damageCubes).toBe(2);
  expect(after.players[1].wizard.damageCubes).toBe(1);
  expect(after.feedbackEvents?.some(e => e.kind === 'DAMAGE' && e.target.id === 'p1' && e.sourceId === 'black-rose')).toBe(true);
 });

 it('triggers a bound Pain Mark on each damage moment the mage deals', () => {
  const s = fixture();
  const mark: Card = {
    id: 'pain-mark', name: 'Pain Mark', kind: 'SPELL', moments: [], range: 1, target: 'SELF',
    ongoing: { trigger: { event: 'DAMAGE_DEALT', relation: 'ANY', scope: 'BOUND_MODEL' }, effects: [{ effect: 'DAMAGE', amount: 2, target: 'EVENT_ACTOR' }] },
  };
  s.players[0].prepared.rapid = { card: mark, used: false };
  const marked = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p1' });
  const after = cast(marked, spell([moment.damage(3)], 'MODEL'), { targetPlayerId: 'p3' });
  expect(after.players[0].wizard.damageCubes).toBe(2);
  expect(after.players[0].wizard.damageByPlayer.p1).toBe(2);
 });

 it('converts the most recently taken damage cubes to Pink Tulip color', () => {
  const s = fixture();
  s.players[0].wizard.damageByPlayer = { p3: 2, p2: 1 };
  s.players[0].wizard.damageCubes = 3;
  s.players[0].wizard.damageOrder = ['p3', 'p2', 'p3'];
  const after = cast(s, spell([moment.blackRoseConvert(2)], 'SELF'), {});
  expect(after.players[0].wizard.damageByPlayer).toEqual({ p3: 1 });
  expect(after.players[0].wizard.blackDamage).toBe(2);
  expect(after.players[0].wizard.damageOrder).toEqual(['p3', 'black-rose', 'black-rose']);
 });

 it('summons and activates a Succubus as a card moment', () => {
  const after = cast(fixture(), spell([moment.summon('SUCCUBUS')], 'SELF'), {});
  expect(after.evocations).toHaveLength(1);
  expect(after.evocations[0]).toMatchObject({ playerId: 'p1', name: 'Succubus', activated: true });
  expect(after.evocations[0].position).toEqual(after.players[0].wizard.position);
 });

 it('allows infinite spell range without line-of-sight and blocks starting-room targets', () => {
  const s = fixture();
  s.players[1].wizard.position = { q: 8, r: 9 };
  expect(isWithinSpellRange({ q: 0, r: 0 }, { q: 8, r: 9 }, Number.POSITIVE_INFINITY)).toBe(true);

  const startingRoom = s.board.rooms.find(r => r.startingFor === 'p2')!;
  s.players[1].wizard.position = { ...startingRoom.tiles[0] };
  expect(() => cast(s, { ...spell([moment.damage(1)], 'MODEL'), range: Number.POSITIVE_INFINITY }, { targetPlayerId: 'p2' })).toThrow(/starting room/i);
 });

 it('deals a single-step death splash to nearby mages when a damage moment defeats its target', () => {
  const s = fixture();
  s.players[1].wizard.position = { q: 2, r: 0 };
  s.players[1].wizard.health = 2;
  s.players[1].wizard.damageCubes = 0;
  s.players[2].wizard.position = { q: 3, r: 0 };
  s.players[3].wizard.position = { q: 6, r: 0 };
  const after = cast(s, spell([moment.damage(2, { range: 1, when: 'AFTER_DEFEAT' })], 'MODEL'), { targetPlayerId: 'p2' });
  expect(after.players[1].wizard.damageCubes).toBe(0);
  expect(after.players[2].wizard.damageCubes).toBe(2);
  expect(after.players[3].wizard.damageCubes).toBe(0);
 });
});

describe('moment resolution is interrupted by a mage defeat and then resumes', () => {
 it('finishes the defeat (scoring, respawn) before the next moment and skips the defeated mage afterwards', () => {
  const s = fixture(); wound(s, 1, { p3: 9 });
  const after = cast(s, spell([moment.damage(1), moment.damage(1)]));
  expect(kinds(after).filter(k => k === 'DAMAGE')).toHaveLength(1);
  expect(kinds(after).filter(k => k === 'MAGE_DEFEATED')).toHaveLength(1);
  expect(after.players[1].wizard.damageCubes).toBe(0);
  expect(after.players[1].wizard.damageByPlayer).toEqual({});
 });

 it('keeps resolving the remaining moments on the other models of a room', () => {
  const s = fixture(); wound(s, 1, { p3: 9 });
  const after = cast(s, spell([moment.damage(1), moment.damage(1)], 'ROOM'), { roomId: 'room-0,0' });
  // p2 falls to the first moment; p3 and p4 take both hits.
  expect(hits(after, 'p2')).toEqual([1]);
  expect(hits(after, 'p3')).toEqual([1, 1]);
  expect(hits(after, 'p4')).toEqual([1, 1]);
  expect(after.players[1].wizard.damageCubes).toBe(0);
  expect(after.players[2].wizard.damageCubes).toBe(2);
  const events = after.feedbackEvents ?? [];
  const defeat = events.findIndex(e => e.kind === 'MAGE_DEFEATED');
  const secondP3Hit = events.findIndex((e, i) => e.kind === 'DAMAGE' && e.target.id === 'p3' && events.findIndex(x => x.kind === 'DAMAGE' && x.target.id === 'p3') !== i);
  expect(defeat).toBeGreaterThan(-1);
  expect(secondP3Hit).toBeGreaterThan(defeat);
 });

 it('resumes the next moment after a reactive spell interrupts the first one', () => {
  const s = fixture();
  const ward: Card = {
   id: 'ward', name: 'Ward', kind: 'SPELL', moments: [], range: 0, target: 'SELF', spellType: 'PROTECTION',
   trigger: { event: 'DAMAGE_TAKEN', relation: 'ENEMY', scope: 'BOUND_MODEL' },
   triggerEffects: [{ effect: 'HEAL', amount: 1, target: 'BOUND_MODEL' }],
  };
  const active: ActiveSpell = { id: 'active-ward', playerId: 'p2', card: ward, targetPlayerId: 'p2' };
  s.readiedSpells = [active]; s.activeSpellOrder = [active.id];
  const paused = cast(s, spell([moment.damage(1), moment.damage(1)]));
  expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL');
  const after = applyAction(paused, {type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:paused.pendingDecision!.key,activeSpellId:active.id,targetId:'p2'});
  // damage, interrupt (the ward heals), then the second damage resumes; the one-shot ward is spent.
  expect(kinds(after)).toEqual(['DAMAGE', 'SPELL_TRIGGERED', 'HEAL', 'DAMAGE']);
  expect(after.players[1].wizard.damageCubes).toBe(1);
 });

 it('resolves a destroyed evocation once and not again', () => {
  const s = fixture();
  const evocation: Evocation = { id: 'evo', playerId: 'p2', name: 'Cadaver', archetype: 'UNDEAD', movement: 2, attack: 2, health: 1, passive: 'WOUNDED_FURY', position: { ...origin }, damageCubes: 0, damageByPlayer: {}, activated: false };
  s.evocations = [evocation];
  const after = cast(s, spell([moment.damage(1), moment.damage(1)], 'EVOCATION'), { targetEvocationId: 'evo' } as never);
  expect(after.evocations).toHaveLength(0);
  expect(hits(after, 'evo')).toEqual([1]);
 });
});

describe('card catalog and legacy saves', () => {
 it('prints every card as a moments list without flat effect fields', () => {
  const cards = [...createLibrary().flatMap(d => d.cards), ...createPowerfulDeck()];
  for (const card of cards) {
   expect(Array.isArray(card.moments)).toBe(true);
   for (const flat of ['damage', 'instability', 'heal', 'convert']) expect(card).not.toHaveProperty(flat);
  for (const m of card.moments) {
   if('amount' in m)expect(m.amount).toBeGreaterThan(0);
  else {expect(['SUMMON','ACTIVATE_EVOCATION']).toContain(m.effect);expect(m).toMatchObject({kind:'SUCCUBUS'});}
  }
  }
  const cross = createLibrary().flatMap(d => d.cards).find(c => c.name === 'Cross and Delight')!;
  expect([momentTotal(cross, 'DAMAGE'), momentTotal(cross, 'INSTABILITY'), getSpellType(cross)]).toEqual([0, 0, 'COMBAT']);
 });

 it('upgrades flat cards in saved games in the old resolution order, once', () => {
  const save = { library: [{ cards: [{ id: 'old', name: 'Old', kind: 'SPELL', damage: 2, instability: 1, heal: 0, convert: 3, range: 1, target: 'MODEL' }] }], kind: 'GAME' };
  upgradeLegacyCards(save);
  const card = save.library[0].cards[0] as unknown as Card;
  expect(card.moments).toEqual([moment.instability(1), moment.convert(3), moment.damage(2)]);
  for (const flat of ['damage', 'instability', 'heal', 'convert']) expect(card).not.toHaveProperty(flat);
  const copy = structuredClone(save); upgradeLegacyCards(copy); expect(copy).toEqual(save);
 });
});
