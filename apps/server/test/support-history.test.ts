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
 const deck = game.library.find(d => d.id === 'transmutation')!;
 const index = deck.cards.findIndex(card => card.name === name);
 expect(index).toBeGreaterThanOrEqual(0);
 return deck.cards.splice(index, 1)[0];
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
 const card = take(game, name);
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
  expect(() => history.apply(game, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', dummy:true, roomId:'room-0,0' }, 'p1')).toThrow(/Dummy/);
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