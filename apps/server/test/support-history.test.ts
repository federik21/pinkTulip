import { describe, expect, it } from 'vitest';
import { BLACK_ROSE_ID, createGame } from '@brw/game-engine';
import type { Card, Evocation, GameAction, GameState } from '@brw/game-engine';
import { ActionHistory } from '../src/action-history';
import { publicState } from '../src/public-state';

type Cast = Extract<GameAction, { type:'CAST_SPELL' }>;
type Selection = Omit<Cast, 'type' | 'playerId' | 'slot'>;
const disabled = { canUndo:false, canRedo:false };
const room = (game: GameState) => game.board.rooms.find(r => r.id === 'room-0,0')!;
function take(game: GameState, name: string): Card {
 for (const deck of game.library) {
  const index = deck.cards.findIndex(card => card.name === name);
  if (index >= 0) return deck.cards.splice(index, 1)[0];
 }
 const index = game.powerfulDeck.findIndex(card => card.name === name);
 expect(index).toBeGreaterThanOrEqual(0);
 return game.powerfulDeck.splice(index, 1)[0];
}
function syncCubes(game: GameState) {
 for (const p of game.players) {
  p.cubes.onWizard = game.players.reduce((n, victim) => n + (victim.wizard.damageByPlayer[p.id] ?? 0), 0);
  p.cubes.onEvocations = game.evocations.reduce((n, victim) => n + (victim.damageByPlayer[p.id] ?? 0), 0);
  p.cubes.onBoard = game.board.rooms.filter(r => !r.scored).reduce((n, r) => n + (r.cubesByPlayer[p.id] ?? 0), 0);
  p.cubes.available = 25 - p.cubes.onWizard - p.cubes.onEvocations - p.cubes.onBoard;
 }
}
function conserved(game: GameState) {
 const expected = structuredClone(game); syncCubes(expected);
 for (const [i, p] of game.players.entries()) {
  expect(p.cubes).toEqual(expected.players[i].cubes);
  expect(Object.values(p.cubes).every(n => Number.isInteger(n) && n >= 0)).toBe(true);
  expect(Object.values(p.cubes).reduce((n, value) => n + value, 0)).toBe(25);
 }
}
function physicalCards(game: GameState) {
 return [...game.library.flatMap(d => [...d.cards, ...d.discard]), ...game.powerfulDeck, ...game.removedCards,
   ...[...game.readiedSpells ?? [], ...game.ongoingSpells ?? []].map(active => active.card),
  ...game.players.flatMap(p => [...p.personalDeck, ...p.hand, ...p.discard,
   ...Object.values(p.prepared).flatMap(slot => slot && !slot.used ? [slot.card] : [])])].map(c => c.id).sort();
}
function fixture(name: string) {
 const game = createGame(4);
 game.phase = 'ACTION'; game.round = 1; game.currentPlayerId = 'p1';
 game.activation = { playerId:'p1', actionsUsed:0, exploring:0, sequencedSpellUsed:false,
  spellsCast:0, discardedExit:false, roomEffectUsed:false };
 // Reserve the named canonical card before random Cantrip hand allocation can
 // exhaust all three of its finite physical copies.
 const card = take(game, name);
 for (const p of game.players) {
  p.connected = true; p.wizard.position = { q:0, r:0 };
  p.quest = game.questDeck.shift()!;
  p.personalDeck.push(...game.library[0].cards.splice(0, 2));
  p.hand.push(p.personalDeck.shift()!);
 }
 Object.assign(game.players[0].wizard, { damageCubes:6, blackDamage:1,
  damageByPlayer:{ p2:2, p3:1, [BLACK_ROSE_ID]:1 } }); // Plus one unattributed wound.
 Object.assign(game.players[1].wizard, { damageCubes:5, blackDamage:1, damageByPlayer:{ p3:3 } });
 game.evocations = ['p1', 'p2'].map((playerId, i): Evocation => ({
  id:`support-model-${i}`, playerId, number:1, name:'Cadaver', archetype:'UNDEAD', movement:2, attack:2,
  health:2, passive:'WOUNDED_FURY', position:{ q:0, r:0 }, damageCubes:1,
  damageByPlayer:{ [i === 0 ? 'p2' : 'p3']:1 }, activated:false,
 }));
 Object.assign(room(game), { instability:5, cubesByPlayer:{ p2:2, p3:1, [BLACK_ROSE_ID]:2 } });
 game.players[0].prepared.slot1 = { card, used:false };
 game.players[0].prepared.rapid = { card:take(game, 'Mending Light'), used:false };
 game.players[1].prepared.slot1 = { card:take(game, 'Reclaimed Servant'), used:false };
 game.players[1].hand.push(take(game, 'Renewing Word'));
 syncCubes(game); conserved(game);
 return { game, card };
}
const hidden = (index: number): Card => ({ id:`hidden-${index}`, name:'Hidden spell', kind:'SPELL',
 damage:0, instability:0, range:0, target:'MODEL' });
function privacy(game: GameState, history: ActionHistory, ownHistory: NonNullable<GameState['history']>) {
 const authoritative = structuredClone(game);
 const futureIds = [...game.library.flatMap(d => d.cards), ...game.powerfulDeck, ...game.eventDeck,
  ...game.questDeck, ...game.players.flatMap(p => p.personalDeck)].map(c => c.id);
 for (const viewer of ['p1', 'p2', null]) {
  const visible = publicState(game, viewer, history);
  expect(visible.history).toEqual(viewer === 'p1' ? ownHistory : disabled);
  expect(Object.keys(visible.history!).every(key => ['canUndo', 'canRedo', 'undoLabel', 'redoLabel'].includes(key))).toBe(true);
  expect(visible.eventDeck).toEqual([]); expect(visible.questDeck).toEqual([]);
  for (const deck of visible.library) expect(deck.cards).toEqual(deck.cards.map((_, i) => hidden(i)));
  expect(visible.powerfulDeck).toEqual(visible.powerfulDeck.map((_, i) => hidden(i)));
  for (const p of visible.players) {
   expect(p.personalDeck).toEqual(p.personalDeck.map((_, i) => hidden(i)));
   if (p.id === viewer) continue;
   expect(p.hand).toEqual(p.hand.map((_, i) => hidden(i)));
   expect(p.quest).toBeNull(); expect(p.additionalQuests).toEqual([]);
   for (const slot of Object.values(p.prepared)) if (slot) expect(slot.card).toEqual(hidden(0));
  }
  const json = JSON.stringify(visible);
  for (const id of futureIds) expect(json).not.toContain(`"${id}"`);
  for (const p of game.players.filter(p => p.id !== viewer)) {
   for (const card of p.hand) expect(json).not.toContain(`"${card.id}"`);
    if (p.quest) expect(json).not.toContain(`"${p.quest.id}"`);
   for (const slot of Object.values(p.prepared).filter(slot => slot && !slot.used)) {
    expect(json).not.toContain(`"${slot!.card.id}"`);
   }
  }
  for (const key of ['before', 'after', 'snapshots', 'undoStack', 'redoStack', 'owner']) expect(json).not.toContain(`"${key}":`);
 }
 expect(game).toEqual(authoritative); expect(game.history).toBeUndefined();
 expect(JSON.stringify(history)).toBe('{}');
}
function wounded(game: GameState, index: number, damageCubes: number, damageByPlayer: Record<string, number>, blackDamage: number) {
 expect(game.players[index].wizard).toMatchObject({ damageCubes, damageByPlayer, blackDamage });
}
type Case = { name:string; selection:Selection; check:(game:GameState) => void };
const ownConversionLedgers: { owners:string; ledger:Record<string, number> }[] = [
 { owners:'caster', ledger:{ p1:1 } }, { owners:'p2', ledger:{ p2:1 } },
 { owners:'p3', ledger:{ p3:1 } }, { owners:'p4', ledger:{ p4:1 } },
 { owners:'Black Rose', ledger:{ [BLACK_ROSE_ID]:1 } },
 { owners:'mixed', ledger:{ p1:1, p2:1, p3:1, [BLACK_ROSE_ID]:1 } },
];
const ownConversionCases = (['MAGE', 'EVOCATION'] as const).flatMap(kind =>
 ownConversionLedgers.flatMap(({ owners, ledger }) => [0, 1, 20].map(supply => ({ kind, owners, ledger, supply }))));
const cases: Case[] = [
 { name:'Mending Light', selection:{}, check:g => wounded(g, 0, 3, { [BLACK_ROSE_ID]:1 }, 1) },
 { name:'Vital Thread', selection:{ targetEvocationId:'support-model-0' }, check:g => {
  expect(g.evocations[0]).toMatchObject({ damageCubes:0, damageByPlayer:{} });
 } },
 { name:"Summoner's Balm", selection:{ targetEvocationId:'support-model-1' }, check:g => {
  expect(g.evocations[1]).toMatchObject({ damageCubes:0, damageByPlayer:{} });
 } },
 { name:'Renewing Word', selection:{ targetPlayerId:'p2-wizard' }, check:g => wounded(g, 1, 2, {}, 1) },
 { name:'Sanctuary', selection:{ roomId:'room-0,0' }, check:g => {
  wounded(g, 0, 4, { p3:1, [BLACK_ROSE_ID]:1 }, 1); wounded(g, 1, 3, { p3:1 }, 1);
  expect(g.evocations.every(e => e.damageCubes === 0 && Object.keys(e.damageByPlayer).length === 0)).toBe(true);
  expect(room(g).cubesByPlayer).toEqual({ p2:2, p3:1, [BLACK_ROSE_ID]:2 });
 } },
 { name:'Restorative Tide', selection:{ roomId:'room-0,0' }, check:g => {
  wounded(g, 0, 5, { p2:1, p3:1, [BLACK_ROSE_ID]:1 }, 1); wounded(g, 1, 4, { p3:2 }, 1);
  expect(g.evocations.every(e => e.damageCubes === 0)).toBe(true);
  expect(room(g)).toMatchObject({ instability:6, cubesByPlayer:{ p1:1, p2:2, p3:1, [BLACK_ROSE_ID]:2 } });
 } },
 { name:'Stolen Sigil', selection:{ targetPlayerId:'p2' }, check:g => wounded(g, 1, 5, { p1:2, p3:1 }, 1) },
 { name:'Stolen Sigil', selection:{ targetPlayerId:'p1' }, check:g => wounded(g, 0, 6, { p2:2, p3:1, [BLACK_ROSE_ID]:1 }, 1) },
 { name:'Stolen Sigil', selection:{ targetEvocationId:'support-model-0' }, check:g => {
  expect(g.evocations[0]).toMatchObject({ damageCubes:1, damageByPlayer:{ p2:1 } });
 } },
 { name:"Mage's Due", selection:{ targetPlayerId:'p2' }, check:g => wounded(g, 1, 5, { p1:3 }, 1) },
 { name:"Mage's Due", selection:{ targetPlayerId:'p1-wizard' }, check:g => wounded(g, 0, 6, { p2:2, p3:1, [BLACK_ROSE_ID]:1 }, 1) },
 { name:'Reclaimed Servant', selection:{ targetEvocationId:'support-model-1' }, check:g => {
  expect(g.evocations[1]).toMatchObject({ damageCubes:1, damageByPlayer:{ p1:1 } });
 } },
 { name:'Reclaimed Servant', selection:{ targetEvocationId:'support-model-0' }, check:g => {
  expect(g.evocations[0]).toMatchObject({ damageCubes:1, damageByPlayer:{ p2:1 } });
 } },
 { name:'Rewrite the Lodge', selection:{ roomId:'room-0,0' }, check:g => {
  expect(room(g)).toMatchObject({ instability:5, cubesByPlayer:{ p1:3, [BLACK_ROSE_ID]:2 }, reconstructed:false, scored:false });
 } },
 { name:"Alchemist's Refuge", selection:{ targetPlayerId:'p1' }, check:g => wounded(g, 0, 4, { p3:1, [BLACK_ROSE_ID]:1 }, 1) },
 { name:'Transmuting Surge', selection:{ targetPlayerId:'p1' }, check:g => {
  wounded(g, 0, 6, { p2:2, p3:1, [BLACK_ROSE_ID]:1 }, 1); // Both friendly conversion and damage are ignored.
 } },
 { name:'Transmuting Surge', selection:{ targetPlayerId:'p2' }, check:g => wounded(g, 1, 6, { p1:2, p3:2 }, 1) },
 { name:'Transmuting Surge', selection:{ targetEvocationId:'support-model-0' }, check:g => {
  expect(g.evocations[0]).toMatchObject({ damageCubes:1, damageByPlayer:{ p2:1 } }); // No conversion or friendly destruction.
 } },
 { name:'Transmuting Surge', selection:{ targetEvocationId:'support-model-1' }, check:g => {
  expect(g.evocations.map(e => e.id)).toEqual(['support-model-0']);
  expect(g.players[0].cubes.onEvocations).toBe(0);
 } },
];

describe('actual Transmutation spell snapshots and projection', () => {
 it.each(cases)('undoes/redoes $name with $selection and exact physical cube ledgers', ({ name, selection, check }) => {
  const history = new ActionHistory(), { game:initial, card } = fixture(name);
  const cards = physicalCards(initial), original = structuredClone(initial);
  privacy(initial, history, disabled);
  let game = history.apply(initial, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', ...selection }, 'p1');
  const after = structuredClone(game);
  check(game); conserved(game);
  expect(initial).toEqual(original);
  expect(game.activation).toMatchObject({ actionsUsed:1, spellsCast:1, sequencedSpellUsed:true });
  expect(game.players[0].actionTokens).toBe(2);
  expect(game.players[0].prepared.slot1).toEqual({ card, used:true });
  expect(game.library[1].discard).toEqual([card]); expect(game.library[0]).toEqual(initial.library[0]);
  expect(physicalCards(game)).toEqual(cards);
  const ownTarget = card.target === 'SELF' || selection.targetPlayerId === 'p1' || selection.targetPlayerId === 'p1-wizard' || selection.targetEvocationId === 'support-model-0';
  if (card.convert && ownTarget) {
   expect((game.feedbackEvents ?? []).some(event => event.kind === 'CONVERT')).toBe(false);
   expect(game.board).toEqual(initial.board);
   if (card.heal) {
    expect((game.feedbackEvents ?? []).map(event => event.kind)).toEqual(['HEAL']);
   } else {
    expect(game.players.map(p => p.wizard)).toEqual(initial.players.map(p => p.wizard));
    expect(game.evocations).toEqual(initial.evocations);
    expect(game.players.map(p => p.cubes)).toEqual(initial.players.map(p => p.cubes));
    expect(game.feedbackEvents).toEqual(initial.feedbackEvents);
   }
  }
  expect(game.players.map(p => [p.kills, p.victoryPoints, p.questsCompleted])).toEqual(initial.players.map(p => [p.kills, p.victoryPoints, p.questsCompleted]));
  expect(game.blackRose).toEqual(initial.blackRose);
  privacy(game, history, { canUndo:true, canRedo:false, undoLabel:'Cast spell' });
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1');
  expect(game).toEqual(initial); conserved(game); expect(physicalCards(game)).toEqual(cards);
  privacy(game, history, { canUndo:false, canRedo:true, redoLabel:'Cast spell' });
  const saved = structuredClone(game);
  // Dummy support is legal; mixing it with a real model remains invalid for
  // every target category and must not destroy the saved redo branch.
  expect(() => history.apply(game, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', dummy:true,
   roomId:'room-0,0', targetPlayerId:'p2' }, 'p1')).toThrow(/Dummy|either a room\/dummy or a model/);
  expect(game).toEqual(saved); expect(history.status(game, 'p1').canRedo).toBe(true);
  game = history.apply(game, { type:'REDO_ACTION', playerId:'p1' }, 'p1');
  expect(game).toEqual(after); conserved(game); expect(physicalCards(game)).toEqual(cards);
  privacy(game, history, { canUndo:true, canRedo:false, undoLabel:'Cast spell' });
 });

 it.each(ownConversionCases)('keeps own $kind conversion a legal no-op with $owners cubes and $supply supply across handoff/undo/redo', ({ kind, ledger, supply }) => {
  const history = new ActionHistory(), { game:initial, card } = fixture(kind === 'MAGE' ? "Mage's Due" : 'Reclaimed Servant');
  const target = kind === 'MAGE' ? initial.players[0].wizard : initial.evocations[0];
  target.health = 8; target.damageByPlayer = { ...ledger };
  target.damageCubes = Object.values(ledger).reduce((n, cubes) => n + cubes, 0) + 1;
  if (kind === 'MAGE') {
   initial.players[0].wizard.blackDamage = 1; target.damageCubes++; // Separate neutral and unattributed wounds.
  }
  syncCubes(initial);
  let remaining = initial.players[0].cubes.available - supply;
  for (const chamber of initial.board.rooms.filter(r => !r.startingFor)) {
   const cubes = Math.min(remaining, chamber.instabilityLimit - chamber.instability);
   if (cubes) { chamber.instability += cubes; chamber.cubesByPlayer.p1 = (chamber.cubesByPlayer.p1 ?? 0) + cubes; }
   remaining -= cubes;
  }
  expect(remaining).toBe(0); syncCubes(initial); conserved(initial);
  expect(initial.players[0].cubes.available).toBe(supply);
  initial.activation!.actionsUsed = 1;
  const before = structuredClone(initial), cards = physicalCards(initial);
  let game = history.apply(initial, { type:'CAST_SPELL', playerId:'p1', slot:'slot1',
   ...(kind === 'MAGE' ? { targetPlayerId:'p1-wizard' } : { targetEvocationId:target.id }) }, 'p1');
  const after = structuredClone(game);
  expect(initial).toEqual(before); expect(game.currentPlayerId).toBe('p2');
  expect(game.players.map(p => p.wizard)).toEqual(before.players.map(p => p.wizard));
  expect(game.evocations).toEqual(before.evocations);
  expect(game.players.map(p => p.cubes)).toEqual(before.players.map(p => p.cubes));
  expect(game.board).toEqual(before.board); expect(game.feedbackEvents).toEqual(before.feedbackEvents);
  expect(game.readiedSpells).toEqual(before.readiedSpells); expect(game.ongoingSpells).toEqual(before.ongoingSpells);
  expect(game.activeSpellOrder).toEqual(before.activeSpellOrder);
  expect(game.players[0].prepared.slot1).toEqual({ card, used:true });
  expect(game.players[0].actionTokens).toBe(before.players[0].actionTokens);
  expect(game.library[1].discard).toEqual([card]); expect(physicalCards(game)).toEqual(cards);
  expect(game.players.map(p => [p.kills, p.victoryPoints, p.questsCompleted])).toEqual(before.players.map(p => [p.kills, p.victoryPoints, p.questsCompleted]));
  expect(game.blackRose).toEqual(before.blackRose);
  conserved(game); privacy(game, history, { canUndo:true, canRedo:false, undoLabel:'Cast spell' });
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1');
  expect(game).toEqual(before); conserved(game);
  game = history.apply(game, { type:'REDO_ACTION', playerId:'p1' }, 'p1');
  expect(game).toEqual(after); conserved(game); expect(physicalCards(game)).toEqual(cards);
  privacy(game, history, { canUndo:true, canRedo:false, undoLabel:'Cast spell' });
 });

 it.each(['MAGE', 'EVOCATION'] as const)('still places printed room instability when own %s conversion/damage instructions are ignored', kind => {
  const history = new ActionHistory(), { game:initial, card } = fixture('Transmuting Surge');
  // Reuse one real physical card to isolate a mixed instruction combination;
  // no extra spell or cube supply is introduced by the fixture.
  card.instability = 2;
  const cards = physicalCards(initial), before = structuredClone(initial);
  let game = history.apply(initial, { type:'CAST_SPELL', playerId:'p1', slot:'slot1',
   ...(kind === 'MAGE' ? { targetPlayerId:'p1' } : { targetEvocationId:'support-model-0' }) }, 'p1');
  const after = structuredClone(game);
  expect(initial).toEqual(before);
  expect(game.players.map(p => p.wizard)).toEqual(before.players.map(p => p.wizard));
  expect(game.evocations).toEqual(before.evocations);
  expect(room(game)).toMatchObject({ instability:7, cubesByPlayer:{ p1:2, p2:2, p3:1, [BLACK_ROSE_ID]:2 } });
  expect(game.players[0].cubes).toEqual({ ...before.players[0].cubes, available:23, onBoard:2 });
  expect(game.players.slice(1).map(p => p.cubes)).toEqual(before.players.slice(1).map(p => p.cubes));
  expect(game.feedbackEvents).toEqual(before.feedbackEvents);
  expect(game.players[0].prepared.slot1).toEqual({ card, used:true });
  expect(game.library[1].discard).toEqual([card]); expect(game.activation).toMatchObject({ actionsUsed:1, spellsCast:1 });
  conserved(game); expect(physicalCards(game)).toEqual(cards);
  privacy(game, history, { canUndo:true, canRedo:false, undoLabel:'Cast spell' });
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(before); conserved(game);
  game = history.apply(game, { type:'REDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(after); conserved(game);
 });

 it('restores a full-room conversion across automatic handoff, without claiming completion or clearing history', () => {
  const history = new ActionHistory(), { game:initial } = fixture('Rewrite the Lodge');
  initial.activation!.actionsUsed = 1;
  Object.assign(room(initial), { instability:10, cubesByPlayer:{ p2:7, [BLACK_ROSE_ID]:3 } }); syncCubes(initial);
  let game = history.apply(initial, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', roomId:'room-0,0' }, 'p1');
  const after = structuredClone(game);
  expect(game.currentPlayerId).toBe('p2');
  expect(room(game)).toMatchObject({ instability:10, cubesByPlayer:{ p1:3, p2:4, [BLACK_ROSE_ID]:3 }, scored:false, reconstructed:false });
  conserved(game); privacy(game, history, { canUndo:true, canRedo:false, undoLabel:'Cast spell' });
  expect(() => history.apply(game, { type:'UNDO_ACTION', playerId:'p2' }, 'p2')).toThrow(/No action available/);
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(initial);
  game = history.apply(game, { type:'REDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(after); conserved(game);
 });

 it.each(['Mending Light', "Alchemist's Refuge", "Mage's Due"])('restores actual (not) Black Rose and unattributed mage wounds after %s', name => {
  const history = new ActionHistory(), { game:initial } = fixture(name);
  const index = name === "Mage's Due" ? 1 : 0;
  Object.assign(initial.players[index].wizard, { damageCubes:5, blackDamage:2, damageByPlayer:{ [BLACK_ROSE_ID]:1 } });
  syncCubes(initial);
  const selection = index === 0 ? {} : { targetPlayerId:'p2' };
  let game = history.apply(initial, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', ...selection }, 'p1');
  const after = structuredClone(game);
  if (name === 'Mending Light') wounded(game, index, 2, {}, 0);
  else if (name === "Mage's Due") wounded(game, index, 5, { p1:3 }, 0);
  else wounded(game, index, 3, {}, 1);
  conserved(game); privacy(game, history, { canUndo:true, canRedo:false, undoLabel:'Cast spell' });
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(initial); conserved(game);
  game = history.apply(game, { type:'REDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(after); conserved(game);
 });
});

// Reuse the wounded physical-card fixture and its strict foreign/spectator
// projection checks; isolate dummy effects from random quest completion.
function dummyFixture(name:string) {
 const result = fixture(name);
 for (const p of result.game.players) if (p.quest) {
  result.game.questDeck.push(p.quest); p.quest = null;
 }
 return result;
}
function noDummyModelEffects(before:GameState, after:GameState) {
 expect(after.players.map(p => p.wizard)).toEqual(before.players.map(p => p.wizard));
 expect(after.evocations).toEqual(before.evocations);
 expect(after.feedbackEvents).toEqual(before.feedbackEvents);
 expect(after.readiedSpells).toEqual(before.readiedSpells);
 expect(after.ongoingSpells).toEqual(before.ongoingSpells);
 expect(after.activeSpellOrder).toEqual(before.activeSpellOrder);
 expect(after.players.map(p => [p.kills, p.victoryPoints, p.questsCompleted])).toEqual(before.players.map(p => [p.kills, p.victoryPoints, p.questsCompleted]));
 expect(after.blackRose).toEqual(before.blackRose);
}
const dummyNames = ['Renewing Word', "Mage's Due", "Summoner's Balm", 'Reclaimed Servant',
 'Mending Ward', "Servant's Safeguard", 'Thorned Path', 'Runic Remedy', 'Arcane Feedback',
 'Vital Thread', 'Stolen Sigil', 'Transmuting Surge', 'Splinter Hex', 'Arcane Bolt'];
const dummyCases = dummyNames.flatMap(name => [0, 2].flatMap(instability => [0, 1].map(actionsUsed => ({ name, instability, actionsUsed }))));
describe('dummy support/reactive casts retain exact server history and foreign projection', () => {
 it.each(dummyCases)('$name with $instability printed instability at turn action $actionsUsed is exactly reversible', ({ name, instability, actionsUsed }) => {
  const history = new ActionHistory(), { game:initial, card } = dummyFixture(name);
  card.instability = instability; initial.activation!.actionsUsed = actionsUsed; initial.players[0].actionTokens = 0;
  const before = structuredClone(initial), cards = physicalCards(initial);
  privacy(initial, history, disabled);
  let game = history.apply(initial, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', dummy:true, roomId:'room-0,0' }, 'p1');
  const after = structuredClone(game);
  expect(initial).toEqual(before); noDummyModelEffects(before, game); conserved(game);
  expect(game.currentPlayerId).toBe(actionsUsed === 1 ? 'p2' : 'p1');
  if (!actionsUsed) expect(game.activation).toMatchObject({ actionsUsed:1, spellsCast:1, sequencedSpellUsed:true });
  expect(game.players[0].actionTokens).toBe(0); expect(game.players[0].prepared.slot1).toEqual({ card, used:true });
  expect(game.library.find(d => d.id === card.schoolId)!.discard).toEqual([card]);
  expect(room(game)).toEqual({ ...room(before), instability:5 + instability,
   cubesByPlayer:{ ...room(before).cubesByPlayer, ...(instability ? { p1:instability } : {}) } });
  expect(game.players[0].cubes).toEqual({ ...before.players[0].cubes, available:25 - instability, onBoard:instability });
  expect(game.players.slice(1).map(p => p.cubes)).toEqual(before.players.slice(1).map(p => p.cubes));
  expect(game.log.join('\n')).toContain(`${name} on a dummy (no model effects)`);
  expect(game.log.join('\n')).not.toMatch(/activates a hidden spell|\(no damage\)/);
  expect(physicalCards(game)).toEqual(cards); expect(cards).toHaveLength(120); expect(new Set(cards).size).toBe(120);
  privacy(game, history, { canUndo:true, canRedo:false, undoLabel:'Cast spell' });
  const projections = ['p1', 'p2', null].map(viewer => publicState(game, viewer, history));
  for (const visible of projections) expect(visible.library.find(d => d.id === card.schoolId)!.discard).toEqual([card]);
  expect(() => history.apply(game, { type:'UNDO_ACTION', playerId:'p2' }, 'p2')).toThrow(/No action available/);
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(before);
  privacy(game, history, { canUndo:false, canRedo:true, redoLabel:'Cast spell' });
  // Neither mixed payloads nor foreign ownership may replace the redo branch.
  for (const selection of [{ dummy:true }, { dummy:true, roomId:'missing' },
   { dummy:true, roomId:'room-0,0', targetPlayerId:'p2' },
   { dummy:true, roomId:'room-0,0', targetEvocationId:'support-model-1' }]) {
   expect(() => history.apply(game, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', ...selection }, 'p1')).toThrow(/Select a room|Room not found|either/);
   expect(game).toEqual(before); expect(history.status(game, 'p1')).toEqual({ canUndo:false, canRedo:true, redoLabel:'Cast spell' });
  }
  expect(() => history.apply(game, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', dummy:true, roomId:'room-0,0' }, 'p2')).toThrow(/another player/);
  game = history.apply(game, { type:'REDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(after);
  expect(['p1', 'p2', null].map(viewer => publicState(game, viewer, history))).toEqual(projections);
  conserved(game); expect(physicalCards(game)).toEqual(cards);
 });

 it.each(['MAGE', 'EVOCATION', 'MODEL'] as const)('removes a powerful %s dummy without hidden/ongoing bindings and restores the exact zones', target => {
  const history = new ActionHistory(), { game:initial, card } = dummyFixture('Sovereign Wrath');
  const trigger = { event:'SPELL_CAST', relation:'ANY', scope:'BOUND_MODEL' } as const;
  Object.assign(card, { target, spellType:'PROTECTION', trigger, heal:3, convert:3,
   ongoing:{ trigger, effects:[{ effect:'DAMAGE', amount:9, target:'BOUND_MODEL' }] } });
  initial.activation!.actionsUsed = 1;
  const before = structuredClone(initial), cards = physicalCards(initial);
  let game = history.apply(initial, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', dummy:true, roomId:'room-0,0' }, 'p1');
  const after = structuredClone(game);
  noDummyModelEffects(before, game); expect(game.currentPlayerId).toBe('p2');
  expect(game.removedCards).toEqual([card]); expect(game.library).toEqual(before.library);
  expect(game.players.map(p => p.discard)).toEqual(before.players.map(p => p.discard));
  expect(room(game).instability).toBe(6); conserved(game); expect(physicalCards(game)).toEqual(cards);
  privacy(game, history, { canUndo:true, canRedo:false, undoLabel:'Cast spell' });
  for (const viewer of ['p1', 'p2', null]) expect(publicState(game, viewer, history).removedCards).toEqual([card]);
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(before);
  game = history.apply(game, { type:'REDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(after); conserved(game);
 });

 it.each(['MAGE', 'EVOCATION', 'MODEL'] as const)('%s dummy full-room completion changes no models and restores exact pre/post ledgers across handoff', target => {
  const history = new ActionHistory(), { game:initial, card } = dummyFixture('Transmuting Surge');
  Object.assign(card, { target, instability:3, heal:4, convert:4, damage:5 });
  Object.assign(room(initial), { instability:9, cubesByPlayer:{ p2:9 } }); syncCubes(initial);
  initial.activation!.actionsUsed = 1;
  const before = structuredClone(initial), cards = physicalCards(initial);
  let game = history.apply(initial, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', dummy:true, roomId:'room-0,0' }, 'p1');
  const after = structuredClone(game); noDummyModelEffects(before, game);
  expect(game.currentPlayerId).toBe('p2');
  expect(room(game)).toMatchObject({ instability:10, cubesByPlayer:{ p1:1, p2:9 }, scored:false, reconstructed:false });
  expect(game.players[0].cubes).toEqual({ available:24, onWizard:0, onEvocations:0, onBoard:1 });
  conserved(game); expect(physicalCards(game)).toEqual(cards);
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(before);
  game = history.apply(game, { type:'REDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(after);
  privacy(game, history, { canUndo:true, canRedo:false, undoLabel:'Cast spell' });
 });

 it.each((['MAGE', 'EVOCATION', 'MODEL'] as const).flatMap(target =>
  ['zero supply', 'full room', 'rebuilt room'].map(condition => ({ target, condition }))))(
  '$target dummy remains an exactly reversible card/action cost with $condition', ({ target, condition }) => {
   const history = new ActionHistory(), { game:initial, card } = dummyFixture('Transmuting Surge');
   Object.assign(card, { target, instability:2, damage:5, heal:4, convert:3 });
   initial.players[0].actionTokens = 0; initial.activation!.actionsUsed = 1;
   if (condition !== 'zero supply') Object.assign(room(initial), { instability:10, cubesByPlayer:{ p2:10 },
    reconstructed:condition === 'rebuilt room', scored:condition === 'rebuilt room' });
   if (condition === 'zero supply') {
    let remaining = 25;
    for (const chamber of initial.board.rooms.filter(r => !r.startingFor && r.id !== 'room-0,0')) {
     const n = Math.min(remaining, chamber.instabilityLimit - chamber.instability);
     if (n) { chamber.instability += n; chamber.cubesByPlayer.p1 = n; remaining -= n; }
    }
    expect(remaining).toBe(0);
   }
   syncCubes(initial); conserved(initial);
   const before = structuredClone(initial), cards = physicalCards(initial);
   let game = history.apply(initial, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', dummy:true, roomId:'room-0,0' }, 'p1');
   const after = structuredClone(game);
   noDummyModelEffects(before, game); expect(game.board).toEqual(before.board);
   expect(game.players.map(p => p.cubes)).toEqual(before.players.map(p => p.cubes));
   expect(game.currentPlayerId).toBe('p2'); expect(game.players[0].actionTokens).toBe(0);
   expect(game.players[0].prepared.slot1).toEqual({ card, used:true });
   expect(game.library[1].discard).toEqual([card]); conserved(game); expect(physicalCards(game)).toEqual(cards);
   privacy(game, history, { canUndo:true, canRedo:false, undoLabel:'Cast spell' });
   game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(before);
   game = history.apply(game, { type:'REDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(after);
   conserved(game); expect(physicalCards(game)).toEqual(cards);
  });

 it('retires the dummy caster’s history only after a successful foreign action, not a rejected one', () => {
  const history = new ActionHistory(), { game:initial } = dummyFixture("Summoner's Balm");
  initial.activation!.actionsUsed = 1;
  let game = history.apply(initial, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', dummy:true, roomId:'room-0,0' }, 'p1');
  const afterDummy = structuredClone(game), cards = physicalCards(game);
  expect(() => history.apply(game, { type:'CAST_SPELL', playerId:'p2', slot:'slot1',
   targetPlayerId:'p1' }, 'p2')).toThrow(/category/);
  expect(game).toEqual(afterDummy); expect(history.status(game, 'p1').canUndo).toBe(true);
  game = history.apply(game, { type:'BEGIN_PHYSICAL_ACTION', playerId:'p2', kind:'EXPLORE' }, 'p2');
  expect(history.status(game, 'p1')).toEqual(disabled);
  expect(publicState(game, 'p2', history).history).toEqual({ canUndo:true, canRedo:false, undoLabel:'Begin physical action' });
  expect(() => history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1')).toThrow(/No action available/);
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p2' }, 'p2'); expect(game).toEqual(afterDummy);
  expect(history.status(game, 'p1')).toEqual(disabled); conserved(game); expect(physicalCards(game)).toEqual(cards);
 });

 it.each(['Mending Light', 'Sanctuary', 'Thorn Retort', 'Hearth Ward'])(
  '%s SELF/ROOM rejection leaves a previous private redo branch intact', name => {
   const history = new ActionHistory(), { game:initial } = dummyFixture(name);
   let game = history.apply(initial, { type:'BEGIN_PHYSICAL_ACTION', playerId:'p1', kind:'EXPLORE' }, 'p1');
   game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1');
   const before = structuredClone(game);
   expect(() => history.apply(game, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', dummy:true, roomId:'room-0,0' }, 'p1')).toThrow(/Dummy targeting requires/);
   expect(game).toEqual(before); privacy(game, history, { canUndo:false, canRedo:true, redoLabel:'Begin physical action' });
  });
});

function armExisting(game:GameState, history:ActionHistory, name:string, playerId:string, selection:Selection) {
 game.currentPlayerId = playerId;
 game.activation = { playerId, actionsUsed:0, exploring:0, sequencedSpellUsed:false,
  spellsCast:0, discardedExit:false, roomEffectUsed:false };
 const p = game.players.find(p => p.id === playerId)!;
 if (p.prepared.rapid && !p.prepared.rapid.used) p.hand.push(p.prepared.rapid.card);
 p.prepared.rapid = { card:take(game, name), used:false };
 return history.apply(game, { type:'CAST_SPELL', playerId, slot:'rapid', ...selection }, playerId);
}
describe('dummy casts respect existing reaction privacy barriers', () => {
 it('cannot undo Spell Leech disclosure, still fires persistent Arcane Feedback and emits only real reaction outcomes', () => {
  const history = new ActionHistory(); let { game, card } = dummyFixture("Summoner's Balm");
  game.players[0].wizard.health = 20;
  game = armExisting(game, history, 'Arcane Feedback', 'p3', { targetPlayerId:'p1' });
  game = armExisting(game, history, 'Spell Leech', 'p2', { roomId:'room-0,0' });
  game.currentPlayerId = 'p1'; game.activation = { playerId:'p1', actionsUsed:0, exploring:0,
   sequencedSpellUsed:false, spellsCast:0, discardedExit:false, roomEffectUsed:false };
  const before = structuredClone(game), cards = physicalCards(game), hiddenId = game.readiedSpells![0].id;
  const foreign = publicState(game, 'p1', history).readiedSpells![0];
  expect(foreign).toEqual({ id:hiddenId, playerId:'p2', card:{ ...hidden(0), spellType:'TRAP' } });
  game = history.apply(game, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', dummy:true, roomId:'room-1,0' }, 'p1');
  expect(game.players[0].wizard.damageCubes).toBe(before.players[0].wizard.damageCubes + 3);
  expect(game.players[0].prepared.slot1).toEqual({ card, used:true });
  expect(game.board).toEqual(before.board); expect(game.evocations).toEqual(before.evocations);
  expect(game.ongoingSpells).toEqual(before.ongoingSpells); expect(game.readiedSpells).toEqual([]);
  const events = game.feedbackEvents!.slice(before.feedbackEvents!.length);
  expect(events.map(e => e.kind)).toEqual(['SPELL_TRIGGERED', 'DAMAGE', 'SPELL_TRIGGERED', 'DAMAGE']);
  expect(events.filter(e => e.kind === 'SPELL_TRIGGERED').map(e => [e.cardName, e.trigger, e.roomId]))
   .toEqual([['Spell Leech', 'SPELL_CAST', 'room-0,0'], ['Arcane Feedback', 'SPELL_CAST', 'room-0,0']]);
  expect(events.filter(e => e.kind === 'DAMAGE').map(e => [e.sourceId, e.target.id, e.amount])).toEqual([['p2', 'p1', 2], ['p3', 'p1', 1]]);
  privacy(game, history, disabled); conserved(game); expect(physicalCards(game)).toEqual(cards);
  for (const viewer of ['p1', 'p2', null]) {
   const visible = publicState(game, viewer, history);
   expect(visible.readiedSpells).toEqual([]);
   expect(visible.library.find(d => d.id === 'enchantment')!.discard.map(c => c.name)).toContain('Spell Leech');
   expect(visible.feedbackEvents).toEqual(game.feedbackEvents);
  }
  for (const playerId of ['p1', 'p2']) for (const type of ['UNDO_ACTION', 'REDO_ACTION'] as const)
   expect(() => history.apply(game, { type, playerId }, playerId)).toThrow(/No action available/);
 });
 it('replays persistent reaction UUIDs exactly when no hidden spell is revealed', () => {
  const history = new ActionHistory(); let { game } = dummyFixture('Renewing Word');
  game = armExisting(game, history, 'Arcane Feedback', 'p3', { targetPlayerId:'p1' });
  game.currentPlayerId = 'p1'; game.activation = { playerId:'p1', actionsUsed:1, exploring:0,
   sequencedSpellUsed:false, spellsCast:0, discardedExit:false, roomEffectUsed:false };
  const before = structuredClone(game), cards = physicalCards(game);
  game = history.apply(game, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', dummy:true, roomId:'room-0,0' }, 'p1');
  const after = structuredClone(game);
  expect(game.feedbackEvents!.slice(before.feedbackEvents!.length).map(e => e.kind)).toEqual(['SPELL_TRIGGERED', 'DAMAGE']);
  expect(game.ongoingSpells).toEqual(before.ongoingSpells); expect(game.currentPlayerId).toBe('p2');
  privacy(game, history, { canUndo:true, canRedo:false, undoLabel:'Cast spell' });
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(before);
  game = history.apply(game, { type:'REDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(after);
  conserved(game); expect(physicalCards(game)).toEqual(cards);
 });
 it('keeps unrelated hidden bindings private and unchanged through dummy cast, undo and redo', () => {
  const history = new ActionHistory(); let { game } = dummyFixture("Summoner's Balm");
  game = armExisting(game, history, 'Mending Ward', 'p2', { targetPlayerId:'p1' });
  game = armExisting(game, history, 'Thorned Path', 'p3', { targetPlayerId:'p2' });
  game.currentPlayerId = 'p1'; game.activation = { playerId:'p1', actionsUsed:0, exploring:0,
   sequencedSpellUsed:false, spellsCast:0, discardedExit:false, roomEffectUsed:false };
  const before = structuredClone(game), projections = ['p1', 'p2', null].map(viewer => publicState(game, viewer, history).readiedSpells);
  game = history.apply(game, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', dummy:true, roomId:'room-0,0' }, 'p1');
  const after = structuredClone(game); noDummyModelEffects(before, game);
  expect(['p1', 'p2', null].map(viewer => publicState(game, viewer, history).readiedSpells)).toEqual(projections);
  expect(projections[0]![0]).toEqual({ id:before.readiedSpells![0].id, playerId:'p2', card:{ ...hidden(0), spellType:'PROTECTION' } });
  privacy(game, history, { canUndo:true, canRedo:false, undoLabel:'Cast spell' });
  game = history.apply(game, { type:'UNDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(before);
  game = history.apply(game, { type:'REDO_ACTION', playerId:'p1' }, 'p1'); expect(game).toEqual(after); conserved(game);
 });
});