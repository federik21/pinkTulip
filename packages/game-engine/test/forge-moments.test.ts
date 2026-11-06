import { mainEffects } from '../src/cards';
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src';
import type { Card, GameState } from '../src';

function fixture(): GameState {
 const s = createGame(2); s.phase = 'ACTION'; s.round = 1; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false, spellsCast: 0, discardedExit: false, roomEffectUsed: false };
 for (const p of s.players) p.connected = true;
 return s;
}

describe('Forge rebuilt room resolves each step as its own interruptible moment', () => {
 it('finishes a defeat (respawn) between steps and then resumes the remaining moves', () => {
  const s = fixture();
  const forge = s.board.rooms.find(r => r.color === 'crimson' && !r.startingFor)!;
  forge.reconstructed = true; forge.rebuiltEffect = 'FORGE_REBUILT';
  const [p1, p2] = s.players;
  p1.wizard.position = { ...forge.tiles[0] };
  // One more entry-triggered hit is lethal for p1.
  p1.wizard.damageCubes = 9; p1.wizard.damageByPlayer = { p2: 9 };
  p2.cubes.onWizard = 0; p2.cubes.onBoard = 0; p2.cubes.onEvocations = 0; p2.cubes.onWizard = 0;
  p2.cubes.available -= 9; p2.cubes.onWizard = 9;
  const prick: Card = {
   id: 'prick', name: 'Prick', kind: 'SPELL', effects: mainEffects([]), range: 1, target: 'MAGE',
   ongoing: { trigger: { event: 'ENTER_ROOM', relation: 'ENEMY', scope: 'ANY' }, effects: [{ effect: 'DAMAGE', amount: 1, target: 'EVENT_ACTOR' }] },
  };
  s.ongoingSpells = [{ id: 'prick-active', playerId: 'p2', targetPlayerId: 'p2', card: prick }];
  s.activeSpellOrder = ['prick-active'];

  let after = applyAction(applyAction(s, { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'ATTACK' }), { type: 'ACTIVATE_ROOM', playerId: 'p1' });
  while (after.pendingDecision?.kind === 'CHOICE') {
   const decision = after.pendingDecision;
   after = applyAction(after, { type: 'RESPOND_CHOICE', playerId: decision.playerId, key: decision.key, choiceId: decision.options[0].id });
  }
  expect((after.feedbackEvents ?? []).filter(e => e.kind === 'MAGE_DEFEATED')).toHaveLength(1);
  // Defeated after the first move, p1 respawned and the Forge kept going out of the starting cell.
  const room = after.board.rooms.find(r => r.tiles.some(t => t.q === after.players[0].wizard.position.q && t.r === after.players[0].wizard.position.r));
  expect(room?.startingFor).toBeUndefined();
  expect(after.players[0].wizard.alive).toBe(true);
 });

 it('reports the state at the end of every moment, only for completed actions', () => {
  const s = fixture();
  const forge = s.board.rooms.find(r => r.color === 'crimson' && !r.startingFor)!;
  forge.reconstructed = true; forge.rebuiltEffect = 'FORGE_REBUILT';
  s.players[0].wizard.position = { ...forge.tiles[0] };
  const begun = applyAction(s, { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'ATTACK' });

  // Without an observer nothing is collected; with one, each moment is a distinct, growing snapshot.
  const frames: GameState[] = [];
  const paused = applyAction(begun, { type: 'ACTIVATE_ROOM', playerId: 'p1' }, frames);
  let after = paused;
  while (after.pendingDecision?.kind === 'CHOICE') {
   // A paused decision reverts to the pre-action state and reports no frames yet.
   expect(frames).toHaveLength(0);
   const decision = after.pendingDecision;
   after = applyAction(after, { type: 'RESPOND_CHOICE', playerId: decision.playerId, key: decision.key, choiceId: decision.options[0].id }, frames);
  }
  expect(frames.length).toBeGreaterThan(1);
  const lengths = frames.map(f => f.log.length);
  expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
  expect(frames.every((f, i) => i === 0 || JSON.stringify(f) !== JSON.stringify(frames[i - 1]))).toBe(true);
  expect(frames.every(f => !f.pendingDecision)).toBe(true);
  expect(after.log.length).toBeGreaterThanOrEqual(lengths[lengths.length - 1]);
 });
});
