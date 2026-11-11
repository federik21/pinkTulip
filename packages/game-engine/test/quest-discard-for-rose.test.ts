import { describe, expect, it } from 'vitest';
import { applyAction, createGame, GameState, MAGE_DRAFT_POOL } from '../src';

function started() {
 let g = createGame(2);
 for (const p of g.players) p.connected = true;
 for (const p of g.players) g = applyAction(g, { type: 'SET_READY', playerId: p.id, ready: true });
 g = applyAction(g, { type: 'START_GAME', playerId: 'p1' });
 for (const [index, id] of g.setupOrder!.entries()) g = applyAction(g, { type: 'DRAFT_SCHOOL', playerId: id, schoolId: g.library[index].id });
 for (const [index, id] of [...g.setupOrder!].reverse().entries()) g = applyAction(g, { type: 'DRAFT_MAGE', playerId: id, mageId: MAGE_DRAFT_POOL[index].id });
 return g;
}

const withQuest = (g: GameState) => {
 g = structuredClone(g);
 g.phase = 'BLACK_ROSE'; g.blackRoseResolved = false; g.roseQuestDiscards = [];
 g.players[0].quest = { ...g.questDeck[0], completed: false, claimed: false } as never;
 return g;
};

describe('discarding a quest for the Black Rose', () => {
 it('gives the Black Rose 1 VP, once per round, before quests are drawn', () => {
  const g = withQuest(started());
  const p = g.players[0], before = g.blackRose.victoryPoints, questId = p.quest!.id, discardSize = g.questDiscard.length;
  const next = applyAction(g, { type: 'DISCARD_QUEST_FOR_ROSE', playerId: p.id, questId });
  expect(next.blackRose.victoryPoints).toBe(before + 1);
  expect(next.players[0].quest).toBeNull();
  expect(next.questDiscard).toHaveLength(discardSize + 1);
  expect(() => applyAction(next, { type: 'DISCARD_QUEST_FOR_ROSE', playerId: p.id, questId })).toThrow();
  const resolved = applyAction(next, { type: 'ADVANCE_PHASE', playerId: g.hostId, expectedPhase: 'BLACK_ROSE', expectedRound: next.round });
  expect(resolved.players[0].quest).not.toBeNull();
 });

 it('is rejected once quests are drawn or for unknown quests', () => {
  const g = withQuest(started());
  expect(() => applyAction(g, { type: 'DISCARD_QUEST_FOR_ROSE', playerId: g.players[0].id, questId: 'nope' })).toThrow();
  const resolved = structuredClone(g); resolved.blackRoseResolved = true;
  expect(() => applyAction(resolved, { type: 'DISCARD_QUEST_FOR_ROSE', playerId: g.players[0].id, questId: g.players[0].quest!.id })).toThrow();
 });
});
