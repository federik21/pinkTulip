import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getDarkSide, getSpellForSide, hasSummonKeyword, summonEvocation, upgradeLegacyCards } from '../src';
import { mainEffects } from '../src/cards';
import type { Card, Evocation, GameState } from '../src';

const NAMES = ['Protean Genesis', 'Living Liquid', 'Acid Blood', 'Kinetic Infusion', 'Vigorous Infusion', 'Indoctrination',
 'Nefarious Evolution', 'Mutant Energies', 'Craft', 'Mechanical Archive', 'Draco\u2019s Skin', 'Necrotic Pheromones'];

function fixture(): GameState {
 const s = createGame(3); s.round = 1; s.phase = 'ACTION'; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, spellsCast: 0, sequencedSpellUsed: false, discardedExit: false, roomEffectUsed: false };
 for (const p of s.players) { p.connected = true; p.wizard.position = { q: 0, r: 0 }; p.wizard.health = 30; }
 return s;
}
const school = (s: GameState) => s.library.find(d => d.id === 'technomancy')!;
function catalog(s: GameState, name: string): Card {
 const deck = school(s), index = deck.cards.findIndex(c => c.name === name);
 expect(index).toBeGreaterThanOrEqual(0);
 return deck.cards.splice(index, 1)[0];
}
type Target = { targetPlayerId?: string; targetEvocationId?: string; roomId?: string };
function cast(s: GameState, name: string, target: Target = {}) {
 s.players[0].prepared.rapid = { used: false, card: catalog(s, name), side: 'DARK' };
 return applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', ...target });
}
const choice = (s: GameState) => { const d = s.pendingDecision; if (d?.kind !== 'CHOICE') throw new Error(`Expected a choice, got ${d?.kind}`); return d; };
const answer = (s: GameState, choiceId?: string) => { const d = choice(s); return applyAction(s, { type: 'RESPOND_CHOICE', playerId: d.playerId, key: d.key, ...(choiceId ? { choiceId } : {}) }); };
const room = (s: GameState, id: string) => s.board.rooms.find(r => r.id === id)!;
const roomOption = (s: GameState, roomId: string) => (choice(s).options as { id: string; roomId?: string }[]).find(o => o.roomId === roomId)!.id;
const wounds = (s: GameState, index: number) => s.players[index].wizard.damageCubes;
const evocation = (s: GameState, owner: number, kind: 'CADAVER' | 'COLOSSUS', position = { q: 0, r: 0 }): Evocation => summonEvocation(s, s.players[owner], kind, position)!;
function ready(s: GameState, name: string, playerIndex: number) {
 const card = catalog(s, name), player = s.players[playerIndex], id = `ready-${name}`;
 s.readiedSpells!.push({ id, playerId: player.id, card: getSpellForSide(s, player, card, 'DARK'), printed: card, side: 'DARK' });
 s.activeSpellOrder!.push(id);
 return id;
}
const react = (s: GameState, id: string, playerId: string, targetId: string) => {
 const d = s.pendingDecision as Extract<NonNullable<GameState['pendingDecision']>, { kind: 'REACTIVE_SPELL' }>;
 expect(d.kind).toBe('REACTIVE_SPELL');
 return applyAction(s, { type: 'RESPOND_REACTIVE_SPELL', playerId, key: d.key, activeSpellId: id, targetId });
};
const mover: Card = { id: 'mover', name: 'Mover', kind: 'SPELL', spellType: 'CONTINGENCY', target: 'SELF', range: 0, effects: mainEffects([{ effect: 'MOVE_TARGET', distance: 1 }]) };

describe('Technomancy dark sides', () => {
 it('gives every Technomancy card a dark side with its own name, element and type', () => {
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

 it('restores dark sides on saved Technomancy cards', () => {
  const s = fixture(), card = catalog(s, 'Craft');
  delete card.darkSide;
  upgradeLegacyCards(card);
  expect(card.darkSide).toMatchObject({ target: 'EVOCATION', spellType: 'CONTINGENCY' });
 });

 it('Protean Genesis loses 1 VP and summons a Colossus in the target room', () => {
  const s = fixture(); s.players[0].victoryPoints = 2;
  const after = cast(s, 'Protean Genesis', { roomId: 'room-1,0' });
  expect(after.players[0].victoryPoints).toBe(1);
  const colossus = after.evocations.find(e => e.kind === 'COLOSSUS')!;
  expect(colossus).toMatchObject({ playerId: 'p1' });
  expect(after.board.rooms.find(r => r.tiles.some(t => t.q === colossus.position.q && t.r === colossus.position.r))!.id).toBe('room-1,0');
 });

 it('Protean Genesis summons nothing when no VP could be lost', () => {
  const s = fixture(); s.players[0].victoryPoints = 0;
  const after = cast(s, 'Protean Genesis', { roomId: 'room-1,0' });
  expect(after.players[0].victoryPoints).toBe(0);
  expect(after.evocations).toHaveLength(0);
 });

 it('Living Liquid discards an upgrade, lowering health, and places 3 instability in the target room', () => {
  const s = fixture(), e = evocation(s, 1, 'CADAVER', { q: 1, r: 0 });
  e.upgrade = 'REINFORCED_DERMIS'; e.health = 5;
  const after = cast(s, 'Living Liquid', { targetEvocationId: e.id });
  const left = after.evocations.find(m => m.id === e.id)!;
  expect(left.upgrade).toBeUndefined();
  expect(left.health).toBe(2);
  expect(room(after, 'room-1,0').instability).toBe(3);
 });

 it('Living Liquid does nothing without an upgrade', () => {
  const s = fixture(), e = evocation(s, 1, 'CADAVER', { q: 1, r: 0 });
  const after = cast(s, 'Living Liquid', { targetEvocationId: e.id });
  expect(room(after, 'room-1,0').instability).toBe(0);
  expect(after.evocations.find(m => m.id === e.id)!.health).toBe(2);
 });

 it('Living Liquid destroys an evocation whose wounds exceed its reduced health', () => {
  const s = fixture(), e = evocation(s, 1, 'CADAVER', { q: 1, r: 0 });
  e.upgrade = 'REINFORCED_DERMIS'; e.health = 5; e.damageCubes = 3;
  const after = cast(s, 'Living Liquid', { targetEvocationId: e.id });
  expect(after.evocations.some(m => m.id === e.id)).toBe(false);
 });

 it('Acid Blood inflicts 3 damage and places 1 instability in the target room', () => {
  const s = fixture(); s.players[1].wizard.position = { q: 1, r: 0 };
  const after = cast(s, 'Acid Blood', { roomId: 'room-1,0' });
  expect(wounds(after, 1)).toBe(3);
  expect(room(after, 'room-1,0').instability).toBe(1);
 });

 it('Kinetic Infusion moves the caster three times, then activates the room it ends in', () => {
  const s = fixture(); room(s, 'room-1,0').effect = 'INSTABILITY';
  let after = cast(s, 'Kinetic Infusion');
  const targets = ['room-1,0', 'room-0,0', 'room-1,0'];
  for (const roomId of targets) { expect(choice(after).key).toMatch(/move-where/); after = answer(after, roomOption(after, roomId)); }
  expect(after.pendingDecision).toBeFalsy();
  expect(after.players[0].wizard.position).toEqual(room(after, 'room-1,0').tiles[0]);
  expect(room(after, 'room-1,0').instability).toBeGreaterThan(0);
 });

 it('Vigorous Infusion inflicts 1 damage then moves any model twice', () => {
  const s = fixture(); s.players[1].wizard.position = { q: 1, r: 0 };
  let after = cast(s, 'Vigorous Infusion', { targetPlayerId: 'p2' });
  after = answer(after, roomOption(after, 'room-0,0'));
  after = answer(after, roomOption(after, 'room-1,0'));
  expect(wounds(after, 1)).toBe(1);
  expect(after.pendingDecision).toBeFalsy();
  expect(after.players[1].wizard.position).toEqual(room(after, 'room-1,0').tiles[0]);
 });

 it('Indoctrination places instability equal to the damage actually healed', () => {
  const run = (cubes: number) => { const s = fixture(); s.players[0].wizard.damageCubes = cubes; const after = cast(s, 'Indoctrination'); return { after, instability: room(after, 'room-0,0').instability }; };
  const none = run(0), one = run(1), many = run(5);
  expect(many.after.players[0].wizard.damageCubes).toBe(3);
  expect(one.after.players[0].wizard.damageCubes).toBe(0);
  expect(one.instability - none.instability).toBe(1);
  expect(many.instability - none.instability).toBe(2);
 });

 it('Nefarious Evolution places 1 instability in the target room and activates it only when upgraded', () => {
  const plain = fixture(), a = evocation(plain, 1, 'CADAVER', { q: 1, r: 0 });
  const unupgraded = cast(plain, 'Nefarious Evolution', { targetEvocationId: a.id });
  expect(room(unupgraded, 'room-1,0').instability).toBe(1);
  expect(unupgraded.evocationActivation ?? null).toBeNull();
  const s = fixture(), e = evocation(s, 1, 'CADAVER', { q: 1, r: 0 });
  e.upgrade = 'TENDON_IMPLANT'; e.health = 3;
  const after = cast(s, 'Nefarious Evolution', { targetEvocationId: e.id });
  expect(room(after, 'room-1,0').instability).toBe(1);
  expect(after.evocationActivation).toMatchObject({ playerId: 'p1', evocationId: e.id });
 });

 it('Mutant Energies removes an evocation with 3 health or less and summons a Cadaver in its room', () => {
  const s = fixture(), e = evocation(s, 1, 'CADAVER', { q: 1, r: 0 });
  e.upgrade = 'MUSCULAR_IMPLANT'; e.health = 3;
  const after = cast(s, 'Mutant Energies', { targetEvocationId: e.id });
  expect(after.evocations.some(m => m.id === e.id)).toBe(false);
  const fresh = after.evocations.find(m => m.kind === 'CADAVER')!;
  expect(fresh).toMatchObject({ playerId: 'p1', position: { q: 1, r: 0 } });
 });

 it('Mutant Energies cannot target an evocation whose full health, upgrades included, is above 3', () => {
  const s = fixture(), e = evocation(s, 1, 'CADAVER', { q: 1, r: 0 });
  e.upgrade = 'REINFORCED_DERMIS'; e.health = 5;
  s.players[0].prepared.rapid = { used: false, card: catalog(s, 'Mutant Energies'), side: 'DARK' };
  expect(() => applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetEvocationId: e.id })).toThrow();
  const t = fixture(), c = evocation(t, 1, 'COLOSSUS', { q: 1, r: 0 });
  t.players[0].prepared.rapid = { used: false, card: catalog(t, 'Mutant Energies'), side: 'DARK' };
  expect(() => applyAction(t, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetEvocationId: c.id })).toThrow();
 });

 it('Craft lets the caster choose the upgrade assigned to the target', () => {
  const s = fixture(), e = evocation(s, 1, 'CADAVER', { q: 1, r: 0 });
  const paused = cast(s, 'Craft', { targetEvocationId: e.id });
  expect(choice(paused).playerId).toBe('p1');
  const after = answer(paused, 'TENDON_IMPLANT');
  expect(after.evocations.find(m => m.id === e.id)).toMatchObject({ upgrade: 'TENDON_IMPLANT', health: 3 });
 });

 it('Mechanical Archive gains 1 VP and draws a chosen Summon card from the grimoire', () => {
  const s = fixture(), p = s.players[0];
  const summons = school(s).cards.filter(hasSummonKeyword).slice(0, 2), plain = school(s).cards.find(c => !hasSummonKeyword(c))!;
  expect(summons).toHaveLength(2);
  p.personalDeck = [plain, ...summons]; p.hand = [];
  const paused = cast(s, 'Mechanical Archive');
  expect((choice(paused).options as { id: string }[]).map(o => o.id).sort()).toEqual(summons.map(c => c.id).sort());
  const after = answer(paused, summons[1].id);
  expect(after.players[0].victoryPoints).toBe(s.players[0].victoryPoints + 1);
  expect(after.players[0].hand.map(c => c.id)).toEqual([summons[1].id]);
  expect(after.players[0].personalDeck).toHaveLength(2);
 });

 it('Draco\u2019s Skin damages an enemy entering the owner\u2019s room and may move it', () => {
  const s = fixture(); s.players[0].wizard.position = { q: 1, r: 0 };
  const id = ready(s, 'Draco\u2019s Skin', 1);
  s.players[0].prepared.rapid = { used: false, card: mover };
  let after = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid' });
  after = answer(after, roomOption(after, 'room-0,0'));
  after = react(after, id, 'p2', 'p1');
  expect(choice(after)).toMatchObject({ playerId: 'p2' });
  after = answer(after, roomOption(after, 'room-1,0'));
  expect(wounds(after, 0)).toBe(3);
  expect(after.players[0].wizard.position).toEqual(room(after, 'room-1,0').tiles[0]);
 });

 it('Draco\u2019s Skin ignores models entering a different room', () => {
  const s = fixture(); s.players[0].wizard.position = { q: 1, r: 0 };
  ready(s, 'Draco\u2019s Skin', 1);
  s.players[0].prepared.rapid = { used: false, card: mover };
  let after = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid' });
  const other = (choice(after).options as { id: string; roomId?: string }[]).find(o => o.roomId && o.roomId !== 'room-0,0' && o.roomId !== 'room-1,0');
  if (!other) return;
  after = answer(after, other.id);
  expect(after.pendingDecision?.kind).not.toBe('REACTIVE_SPELL');
  expect(wounds(after, 0)).toBe(0);
 });

 it('Necrotic Pheromones activates two of the owner\u2019s evocations within range 2 after another mage uses a room', () => {
  let s = fixture(); room(s, 'room-0,0').effect = 'INSTABILITY';
  const first = evocation(s, 1, 'CADAVER'), second = evocation(s, 1, 'CADAVER');
  const id = ready(s, 'Necrotic Pheromones', 1);
  s = applyAction(s, { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
  s = applyAction(s, { type: 'ACTIVATE_ROOM', playerId: 'p1' });
  s = react(s, id, 'p2', 'p1');
  const activated: string[] = [];
  for (let guard = 0; guard < 10 && (s.pendingDecision || s.evocationActivation); guard++) {
   if (s.pendingDecision?.kind === 'CHOICE') { s = answer(s, (s.pendingDecision.options as { id: string }[])[0].id); continue; }
   if (s.evocationActivation) { activated.push(s.evocationActivation.evocationId); s = applyAction(s, { type: 'END_EVOCATION', playerId: s.evocationActivation.playerId }); continue; }
   break;
  }
  expect(activated).toHaveLength(2);
  expect([first.id, second.id]).toEqual(expect.arrayContaining(activated));
 });

 it('Necrotic Pheromones only reacts to a mage at range 2 or less', () => {
  const trigger = (actorAt: { q: number; r: number }) => {
   let s = fixture();
   s.players[0].wizard.position = actorAt; s.players[1].wizard.position = { q: -2, r: 1 };
   evocation(s, 1, 'CADAVER', { q: -2, r: 1 });
   ready(s, 'Necrotic Pheromones', 1);
   s = applyAction(s, { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
   return applyAction(s, { type: 'ACTIVATE_ROOM', playerId: 'p1' });
  };
  expect(trigger({ q: 0, r: -1 }).pendingDecision?.kind).toBe('REACTIVE_SPELL');
  expect(trigger({ q: 1, r: 0 }).pendingDecision?.kind).not.toBe('REACTIVE_SPELL');
 });
});
