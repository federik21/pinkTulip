import { describe, expect, it } from 'vitest';
import { applyAction, createGame, moment } from '../src';
import type { Card, GameState, PendingDecision } from '../src';

const ward: Card = {
 id: 'ward', name: 'Ward', kind: 'SPELL', spellType: 'PROTECTION', target: 'SELF', range: 0, moments: [moment.heal(1)],
 trigger: { event: 'DAMAGE_TAKEN', relation: 'ENEMY', scope: 'BOUND_MODEL' },
};

function fixture(specialUsed: boolean): GameState {
 const s = createGame(2);
 s.phase = 'ACTION'; s.round = 1; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false, spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };
 const room = s.board.rooms.find(r => r.effect === 'DRAW_DISCARD' && !r.startingFor)!;
 room.reconstructed = true; room.specialUsed = specialUsed;
 for (const p of s.players) { p.connected = true; p.wizard.position = { ...room.tiles[0] }; }
 const active = { id: 'ward-1', playerId: 'p2', card: ward, targetPlayerId: 'p2' };
 s.readiedSpells!.push(active); s.activeSpellOrder!.push(active.id);
 return s;
}
const punch = { type: 'PUNCH', playerId: 'p1', targetId: 'p2', roomEffect: 'END' } as const;

describe('PUNCH with an end-of-action room effect and an interrupt', () => {
 it('rejects an unusable reconstructed room before any damage or interrupt', () => {
  const s = fixture(true), before = structuredClone(s);
  expect(() => applyAction(s, punch)).toThrow(/already used/);
  expect(s).toEqual(before);
 });

 it('pauses for the interrupt, then resolves the punch and the room effect', () => {
  const paused = applyAction(fixture(false), punch);
  const decision = paused.pendingDecision as Extract<PendingDecision, { kind: 'REACTIVE_SPELL' }>;
  expect(decision.kind).toBe('REACTIVE_SPELL');
  const done = applyAction(paused, { type: 'RESPOND_REACTIVE_SPELL', playerId: 'p2', key: decision.key });
  expect(done.pendingDecision).toBeUndefined();
  expect(done.board.rooms.find(r => r.effect === 'DRAW_DISCARD' && !r.startingFor)!.specialUsed).toBe(true);
 });

 it('does not strand the interrupt when the room became unusable meanwhile', () => {
  const paused = applyAction(fixture(false), punch);
  const decision = paused.pendingDecision as Extract<PendingDecision, { kind: 'REACTIVE_SPELL' }>;
  // Also covers saved games paused before the up-front validation existed.
  paused.board.rooms.find(r => r.effect === 'DRAW_DISCARD' && !r.startingFor)!.specialUsed = true;
  const done = applyAction(paused, { type: 'RESPOND_REACTIVE_SPELL', playerId: 'p2', key: decision.key });
  expect(done.pendingDecision).toBeUndefined();
  expect(done.log.join(' ')).toMatch(/room effect can no longer be activated/);
 });
});
