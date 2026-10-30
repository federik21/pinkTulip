import { describe, expect, it, vi } from 'vitest';
import { applyAction, BLACK_ROSE_ID, createGame } from '@brw/game-engine';
import type { Card, Evocation, GameAction, GameState, Player } from '@brw/game-engine';
import { ActionHistory } from '../src/action-history';
import { publicState } from '../src/public-state';

type Cast = Extract<GameAction, { type:'CAST_SPELL' }>;
type Selection = Omit<Cast, 'type' | 'playerId' | 'slot'>;
const center = 'room-0,0', east = 'room-1,0';
const disabled = { canUndo:false, canRedo:false };
const player = (game: GameState, id = 'p1') => game.players.find(p => p.id === id)!;
const room = (game: GameState, id = center) => game.board.rooms.find(r => r.id === id)!;
const hidden = (index: number): Card => ({ id:`hidden-${index}`, name:'Hidden spell', kind:'SPELL',
 moments:[], range:0, target:'MODEL' });

// Turn setup is used only before a history sequence begins, never between its snapshots.
function turn(game: GameState, id = 'p1') {
 game.phase = 'ACTION'; game.currentPlayerId = id; game.evocationActivation = null;
 game.activation = { playerId:id, actionsUsed:0, exploring:0, sequencedSpellUsed:false,
  spellsCast:0, discardedExit:false, roomEffectUsed:false };
}
function fixture() {
 const game = createGame(); game.round = 1; game.firstPlayerId = 'p1'; turn(game);
 for (const p of game.players) { p.connected = true; p.wizard.position = { q:0, r:0 }; }
 return game;
}
function take(game: GameState, name: string): Card {
 for (const deck of game.library) {
  const index = deck.cards.findIndex(card => card.name === name);
  if (index >= 0) return deck.cards.splice(index, 1)[0];
 }
 throw new Error(`Missing physical spell: ${name}`);
}
function prepare(game: GameState, name: string, owner = 'p1', slot: keyof Player['prepared'] = 'rapid') {
 const card = take(game, name); player(game, owner).prepared[slot] = { card, used:false }; return card;
}
function arm(game: GameState, name: string, owner: string, selection: Selection) {
 turn(game, owner); prepare(game, name, owner);
 return applyAction(game, { type:'CAST_SPELL', playerId:owner, slot:'rapid', ...selection });
}
function evoc(game: GameState, owner = 'p2', health = 4): Evocation {
 const model: Evocation = { id:`${owner}-servant`, playerId:owner, number:1, name:'Cadaver',
  archetype:'UNDEAD', movement:2, attack:2, health, passive:'WOUNDED_FURY', position:{ q:0, r:0 },
  damageCubes:0, damageByPlayer:{}, activated:false };
 game.evocations.push(model); return model;
}
function syncCubes(game: GameState) {
 for (const p of game.players) {
  p.cubes.onWizard = game.players.reduce((n, victim) => n + (victim.wizard.damageByPlayer[p.id] ?? 0), 0);
  p.cubes.onEvocations = game.evocations.reduce((n, victim) => n + (victim.damageByPlayer[p.id] ?? 0), 0);
  p.cubes.onBoard = game.board.rooms.filter(r => !r.scored).reduce((n, r) => n + (r.cubesByPlayer[p.id] ?? 0), 0);
  p.cubes.available = 25 - p.cubes.onWizard - p.cubes.onEvocations - p.cubes.onBoard;
 }
}
function physicalCards(game: GameState) {
 return [...game.library.flatMap(deck => [...deck.cards, ...deck.discard]), ...game.powerfulDeck,
  ...game.removedCards, ...[...game.readiedSpells ?? [], ...game.ongoingSpells ?? []].map(active => active.card),
  ...game.players.flatMap(p => [...p.personalDeck, ...p.hand, ...p.discard,
   ...Object.values(p.prepared).flatMap(slot => slot && !slot.used ? [slot.card] : [])])].map(card => card.id).sort();
}
function conserved(game: GameState, cards: string[]) {
 expect(cards).toHaveLength(120);
 expect(new Set(cards).size).toBe(cards.length); expect(physicalCards(game)).toEqual(cards);
 const expected = structuredClone(game); syncCubes(expected);
 for (const [i, p] of game.players.entries()) {
  expect(p.cubes).toEqual(expected.players[i].cubes);
  expect(Object.values(p.cubes).every(n => Number.isInteger(n) && n >= 0)).toBe(true);
  expect(Object.values(p.cubes).reduce((n, value) => n + value, 0)).toBe(25);
 }
}
function apply(history: ActionHistory, game: GameState, action: GameAction) {
 return history.apply(game, action, action.playerId);
}
function undo(history: ActionHistory, game: GameState, id = 'p1') {
 return apply(history, game, { type:'UNDO_ACTION', playerId:id });
}
function redo(history: ActionHistory, game: GameState, id = 'p1') {
 return apply(history, game, { type:'REDO_ACTION', playerId:id });
}
function privacy(game: GameState, history: ActionHistory) {
 const authoritative = structuredClone(game);
 for (const viewer of ['p1', 'p2', null]) {
  // Inspect the actual wire representation, including arbitrary nested fields.
  const visible = JSON.parse(JSON.stringify(publicState(game, viewer, history))) as GameState;
  expect(visible.history).toEqual(history.status(game, viewer));
  expect(Object.keys(visible.history!).every(key => ['canUndo', 'canRedo', 'undoLabel', 'redoLabel'].includes(key))).toBe(true);
  expect(visible.readiedSpells).toEqual(game.readiedSpells?.map((active, i) => active.playerId === viewer
    ? active : { id:active.id, playerId:active.playerId, card:{ ...hidden(i), spellType:active.card.spellType } }));
  expect(visible.ongoingSpells).toEqual(game.ongoingSpells);
  expect(visible.activeSpellOrder).toEqual(game.activeSpellOrder);
  expect(visible.log).toEqual(game.log);
  expect(visible.eventDeck).toEqual([]); expect(visible.questDeck).toEqual([]);
  expect(visible.powerfulDeck).toEqual(game.powerfulDeck.map((_, i) => hidden(i)));
  for (const [i, deck] of visible.library.entries()) {
   expect(deck.cards).toEqual(game.library[i].cards.map((_, j) => hidden(j)));
   expect(deck.discard).toEqual(game.library[i].discard);
  }
  const json = JSON.stringify(visible);
  const future = [...game.eventDeck, ...game.questDeck, ...game.powerfulDeck,
   ...game.library.flatMap(deck => deck.cards), ...game.players.flatMap(p => p.personalDeck)];
  for (const card of future) expect(json).not.toContain(`"${card.id}"`);
  for (const active of game.readiedSpells ?? []) if (active.playerId !== viewer) {
   expect(json).not.toContain(`"${active.card.id}"`);
   expect(game.log.join('\n')).not.toContain(active.card.name);
  }
  for (const [i, p] of visible.players.entries()) {
   const actual = game.players[i];
   expect(p.personalDeck).toEqual(actual.personalDeck.map((_, j) => hidden(j)));
   expect(p.discard).toEqual(actual.discard);
   if (p.id === viewer) {
    expect(p.hand).toEqual(actual.hand); expect(p.prepared).toEqual(actual.prepared);
    expect(p.studyCardIds).toEqual(actual.studyCardIds);
    expect(p.quest).toEqual(actual.quest); expect(p.additionalQuests).toEqual(actual.additionalQuests);
   } else {
    expect(p.hand).toEqual(actual.hand.map((_, j) => hidden(j)));
    expect(p).not.toHaveProperty('studyCardIds');
    expect(p.quest).toBeNull(); expect(p.additionalQuests).toEqual([]);
    for (const slot of ['rapid', 'slot1', 'slot2', 'slot3'] as const) expect(p.prepared[slot]).toEqual(
     actual.prepared[slot] ? { card:hidden(0), used:actual.prepared[slot]!.used } : null);
   }
  }
  for (const key of ['before', 'after', 'snapshots', 'undoStack', 'redoStack']) expect(json).not.toContain(`"${key}":`);
 }
 expect(game).toEqual(authoritative); expect(game.history).toBeUndefined(); expect(JSON.stringify(history)).toBe('{}');
}
function barrier(game: GameState, history: ActionHistory) {
 for (const viewer of ['p1', 'p2', null]) expect(history.status(game, viewer)).toEqual(disabled);
 const before = structuredClone(game);
 for (const id of ['p1', 'p2']) for (const type of ['UNDO_ACTION', 'REDO_ACTION'] as const) {
  expect(() => apply(history, game, { type, playerId:id })).toThrow(/No action available/);
  expect(game).toEqual(before);
 }
 privacy(game, history);
}
function pendingAttack(history: ActionHistory, game: GameState, id = 'p1') {
 game = apply(history, game, { type:'BEGIN_PHYSICAL_ACTION', playerId:id, kind:'ATTACK' });
 game = apply(history, game, { type:'SKIP_PHYSICAL_EFFECTS', playerId:id });
 game = undo(history, game, id);
 expect(history.status(game, id)).toMatchObject({ canUndo:true, canRedo:true });
 return game;
}

describe('readied-spell wire privacy', () => {

 it('preserves absent legacy active zones instead of adding projection-only state', () => {
  const game = fixture(), history = new ActionHistory();
  delete game.readiedSpells; delete game.ongoingSpells; delete game.activeSpellOrder;
  privacy(game, history);
  for (const viewer of ['p1', 'p2', null]) {
   const visible = publicState(game, viewer, history);
   for (const key of ['readiedSpells', 'ongoingSpells', 'activeSpellOrder']) expect(Object.hasOwn(visible, key)).toBe(false);
  }
 });
});

const readiness: { name:string; selection:Selection }[] = [
 { name:'Threshold Snare', selection:{ roomId:east } },
 { name:'Thorn Retort', selection:{} },
 { name:'Mending Ward', selection:{ targetPlayerId:'p2-wizard' } },
 { name:"Servant's Safeguard", selection:{ targetEvocationId:'p2-servant' } },
];