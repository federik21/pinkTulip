import { describe, expect, it } from 'vitest';
import { applyAction, createGame, moment } from '../src';
import type { GameState } from '../src';

function fixture(instability?: boolean): GameState {
 const s = createGame(2); s.phase = 'ACTION'; s.round = 1; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false, spellsCast: 0, discardedExit: false, roomEffectUsed: false };
 for (const p of s.players) p.wizard.position = { q: 0, r: 0 };
 const deck = s.library[0], index = deck.cards.findIndex(c => c.name === 'Peak of Agony');
 const card = deck.cards.splice(index, 1)[0];
 card.moments = [moment.damage(1)]; card.target = 'ROOM'; card.range = 2;
 if (instability !== undefined) card.instability = instability;
 s.players[0].prepared.rapid = { card, used: false };
 return s;
}
const room = (s: GameState, id: string) => s.board.rooms.find(r => r.id === id)!;

describe('Card.instability', () => {
 it('places 1 cube in the caster room before the main effect when true', () => {
  const s = fixture(true), target = s.board.rooms.find(r => r.id !== 'room-0,0' && !r.startingFor && r.tiles.some(h => Math.abs(h.q) + Math.abs(h.r) <= 1))!;
  const result = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', roomId: target.id });
  expect(room(result, 'room-0,0').instability).toBe(1);
  expect(room(result, target.id).instability).toBe(0);
  const placed = result.log.findIndex(l => l.includes('places 1 instability in'));
  const main = result.log.findIndex(l => l.includes('Moment 1/1'));
  expect(placed).toBeGreaterThan(-1); expect(main).toBeGreaterThan(placed);
  expect(result.players[0].cubes.onBoard).toBe(1);
 });
 it.each([false, undefined])('adds nothing when %s', flag => {
  const s = fixture(flag), target = s.board.rooms.find(r => r.id !== 'room-0,0' && !r.startingFor && r.tiles.some(h => Math.abs(h.q) + Math.abs(h.r) <= 1))!;
  const result = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', roomId: target.id });
  expect(room(result, 'room-0,0').instability).toBe(0);
  expect(result.log.some(l => l.startsWith('Instability ·'))).toBe(false);
 });
});
