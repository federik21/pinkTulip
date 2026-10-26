import { describe, expect, it } from 'vitest';
import { createGame, type ActiveSpell, type Evocation, type GameState } from '../../../packages/game-engine/src/index';
import { getModelEffects } from '../src/ModelEffects';

type Binding = Pick<ActiveSpell, 'targetPlayerId' | 'targetEvocationId' | 'roomId'>;

function fixture() {
  const game = createGame(2);
  game.players.forEach(p => { p.wizard.position = { q: 0, r: 0 }; });
  game.evocations = ['p1', 'p2'].map((playerId): Evocation => ({
    id: `servant-${playerId}`, playerId, number: 1, name: 'Cadaver', archetype: 'UNDEAD',
    movement: 2, attack: 2, health: 2, passive: 'WOUNDED_FURY', position: { q: 0, r: 0 },
    damageCubes: 0, damageByPlayer: {}, activated: false,
  }));
  return game;
}

// Presentation-only bindings can exercise future model-bound traps without
// changing canonical card text, targeting rules or the finite physical pool.
function bind(game: GameState, name: string, playerId: string, binding: Binding, ongoing = false) {
  const deck = game.library.find(deck => deck.cards.some(card => card.name === name));
  if (!deck) throw new Error(`Missing canonical model-effect card: ${name}`);
  const card = deck.cards.splice(deck.cards.findIndex(card => card.name === name), 1)[0];
  const active: ActiveSpell = { id: `bound-${card.id}`, card, playerId, ...binding };
  (ongoing ? game.ongoingSpells ??= [] : game.readiedSpells ??= []).push(active);
  (game.activeSpellOrder ??= []).push(active.id);
  return active;
}

function expectPool(game: GameState) {
  const ids = [...game.library.flatMap(deck => [...deck.cards, ...deck.discard]),
    ...game.powerfulDeck, ...game.removedCards,
    ...[...game.readiedSpells ?? [], ...game.ongoingSpells ?? []].map(active => active.card)]
    .map(card => card.id);
  expect(ids).toHaveLength(120);
  expect(new Set(ids).size).toBe(120);
}

function counts(game: GameState, viewerId: string, modelId: string) {
  const effects = getModelEffects(game, viewerId, modelId);
  expect(new Set(effects.map(effect => effect.kind)).size).toBe(effects.length);
  for (const effect of effects) {
    expect(effect.count).toBeGreaterThan(0);
    expect(Number.isInteger(effect.count)).toBe(true);
    // Copy and pluralization are not part of the API; the category is.
    expect(effect.label).toMatch(new RegExp(effect.kind, 'i'));
  }
  return Object.fromEntries(effects.map(({ kind, count }) => [kind, count]));
}

describe('getModelEffects: explicit model bindings, visibility and current-state counts', () => {
  it('returns no indicators for empty/legacy zones or an unaffected model', () => {
    const game = fixture();
    delete game.readiedSpells; delete game.ongoingSpells;
    expect(getModelEffects(game, 'p1', 'p1')).toEqual([]);
    expect(getModelEffects(game, 'p1', 'servant-p1')).toEqual([]);
    expect(getModelEffects(game, 'p1', 'missing-model')).toEqual([]);
    bind(game, 'Mending Ward', 'p1', { targetPlayerId: 'p2' });
    expect(getModelEffects(game, 'p1', 'p1')).toEqual([]);
    expectPool(game);
  });

  it('aggregates Trap, Protection and public Ongoing stacks without mutating state', () => {
    const game = fixture();
    for (let index = 0; index < 2; index++) {
      bind(game, 'Threshold Snare', 'p1', { targetPlayerId: 'p1' });
      bind(game, 'Mending Ward', 'p1', { targetPlayerId: 'p1' });
    }
    bind(game, "Pilgrim's Mark", 'p1', { targetPlayerId: 'p1' }, true);
    bind(game, 'Thorned Path', 'p2', { targetPlayerId: 'p1' }, true);
    expectPool(game);
    const before = structuredClone(game);
    expect(counts(game, 'p1', 'p1')).toEqual({ TRAP: 2, PROTECTION: 2, ONGOING: 2 });
    expect(counts(game, 'p2', 'p1')).toEqual({ ONGOING: 2 });
    expect(counts(game, '', 'p1')).toEqual({ ONGOING: 2 });
    expect(game).toEqual(before);
  });

  it.each(['player ID', 'wizard ID'])('resolves an explicit %s binding to the same mage', alias => {
    const game = fixture(), owner = game.players[0];
    expect(owner.wizard.id).not.toBe(owner.id);
    const targetPlayerId = alias === 'player ID' ? owner.id : owner.wizard.id;
    bind(game, 'Mending Ward', 'p1', { targetPlayerId, roomId: 'room-1,0' });
    bind(game, 'Thorned Path', 'p2', { targetPlayerId }, true);
    expect(counts(game, 'p1', owner.id)).toEqual({ PROTECTION: 1, ONGOING: 1 });
    expect(getModelEffects(game, 'p1', 'p2')).toEqual([]);
    expectPool(game);
  });

  it('binds evocations by their exact ID, not their owner, room or another retinue model', () => {
    const game = fixture();
    bind(game, "Servant's Safeguard", 'p1', { targetEvocationId: 'servant-p2', roomId: 'room-0,0' });
    bind(game, 'Threshold Snare', 'p1', { targetEvocationId: 'servant-p2' });
    bind(game, 'Thorned Path', 'p2', { targetEvocationId: 'servant-p2' }, true);
    expect(counts(game, 'p1', 'servant-p2')).toEqual({ TRAP: 1, PROTECTION: 1, ONGOING: 1 });
    for (const id of ['p1', 'p2', 'servant-p1']) expect(getModelEffects(game, 'p1', id)).toEqual([]);
    expectPool(game);
  });

  it('never attaches room-only effects or implicit SELF cards to co-located mages/evocations', () => {
    const game = fixture();
    bind(game, 'Threshold Snare', 'p1', { roomId: 'room-0,0' });
    bind(game, 'Hearth Ward', 'p1', { roomId: 'room-0,0' });
    bind(game, "Pilgrim's Mark", 'p2', { roomId: 'room-0,0' }, true);
    bind(game, 'Thorn Retort', 'p1', {});
    for (const id of ['p1', 'p2', 'servant-p1', 'servant-p2']) {
      expect(getModelEffects(game, 'p1', id)).toEqual([]);
    }
    expectPool(game);
  });

  it('ignores deliberately unmasked foreign Trap/Protection bindings but shows foreign ongoing effects', () => {
    const game = fixture();
    for (const binding of [{ targetPlayerId: 'p1' }, { targetEvocationId: 'servant-p1' }]) {
      bind(game, 'Threshold Snare', 'p2', binding);
      bind(game, 'Mending Ward', 'p2', binding);
      bind(game, 'Thorned Path', 'p2', binding, true);
    }
    expectPool(game);
    for (const id of ['p1', 'servant-p1']) {
      expect(counts(game, 'p1', id)).toEqual({ ONGOING: 1 });
      expect(counts(game, 'p2', id)).toEqual({ TRAP: 1, PROTECTION: 1, ONGOING: 1 });
    }
    // Also accept the actual wire shape: foreign readied entries have no binding.
    game.readiedSpells = game.readiedSpells!.map(({ id, playerId, card }, index) => ({ id, playerId,
      card: { id: `hidden-${index}`, name: 'Hidden spell', kind: 'SPELL', moments:[], range: 0, target: 'MODEL', spellType: card.spellType } }));
    expect(counts(game, 'p1', 'p1')).toEqual({ ONGOING: 1 });
  });

  it('filters foreign ownership before reading either the card/type or any binding', () => {
    const game = fixture();
    const foreign = bind(game, 'Threshold Snare', 'p2', { targetPlayerId: 'p1' });
    bind(game, 'Mending Ward', 'p1', { targetPlayerId: 'p1' });
    expectPool(game);
    for (const property of ['card', 'targetPlayerId', 'targetEvocationId', 'roomId']) {
      Object.defineProperty(foreign, property, { get() {
        throw new Error(`Foreign secret was read: ${property}`);
      } });
    }
    expect(() => getModelEffects(game, 'p1', 'p1')).not.toThrow();
    expect(counts(game, 'p1', 'p1')).toEqual({ PROTECTION: 1 });
    expect(getModelEffects(game, 'p1', 'servant-p1')).toEqual([]);
    expect(getModelEffects(game, '', 'p1')).toEqual([]);
  });

  it('derives rebinding, stack removal, movement and restored snapshots from the supplied state', () => {
    const game = fixture();
    const first = bind(game, 'Mending Ward', 'p1', { targetPlayerId: 'p1' });
    const second = bind(game, 'Mending Ward', 'p1', { targetPlayerId: 'p1' });
    const ongoing = bind(game, 'Thorned Path', 'p2', { targetPlayerId: 'p1' }, true);
    const snapshot = structuredClone(game);
    expect(counts(game, 'p1', 'p1')).toEqual({ PROTECTION: 2, ONGOING: 1 });
    first.targetPlayerId = 'p2';
    game.players[0].wizard.position = { q: 1, r: 0 };
    expect(counts(game, 'p1', 'p1')).toEqual({ PROTECTION: 1, ONGOING: 1 });
    expect(counts(game, 'p1', 'p2')).toEqual({ PROTECTION: 1 });
    game.readiedSpells = game.readiedSpells!.filter(active => active.id !== second.id);
    game.ongoingSpells = [];
    game.library.find(deck => deck.id === 'enchantment')!.discard.push(second.card, ongoing.card);
    game.activeSpellOrder = [first.id];
    expect(getModelEffects(game, 'p1', 'p1')).toEqual([]);
    expect(counts(snapshot, 'p1', 'p1')).toEqual({ PROTECTION: 2, ONGOING: 1 });
    expect(counts(game, 'p1', 'p2')).toEqual({ PROTECTION: 1 });
    expectPool(game); expectPool(snapshot);
  });
});