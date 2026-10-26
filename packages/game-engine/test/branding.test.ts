import { describe, expect, it } from 'vitest';
import { applyAction, BLACK_ROSE_ID, createEvents, createGame } from '../src';
import type { GameState } from '../src';

const oldBrand = /black\s*rose|\(not\)/i;

function readyGame(): GameState {
 let game = createGame(2);
 game.players.forEach(player => { player.connected = true; });
 const schoolId = game.library[0].id;
 for (const player of game.players) {
  game = applyAction(game, { type: 'SELECT_STARTING_SCHOOL', playerId: player.id, schoolId });
  game = applyAction(game, { type: 'SET_READY', playerId: player.id, ready: true });
 }
 return game;
}

describe('Pink Tulip display branding', () => {
 it('renames the central chamber and event text without changing room or competitor IDs', () => {
  const game = createGame(2);
  expect(game.board.rooms.find(room => room.id === 'room-0,0')?.name).toBe('Pink Tulip Chamber');
  expect(BLACK_ROSE_ID).toBe('black-rose');
  const events = createEvents();
  expect(events.filter(event => event.kind === 'BLACK_DAMAGE').every(event => event.name === 'Thorns of the Pink Tulip')).toBe(true);
  expect(events.filter(event => event.kind === 'INSTABILITY').every(event => event.description.includes('Pink Tulip'))).toBe(true);
  expect([...game.board.rooms.map(room => room.name), ...events.flatMap(event => [event.name, event.description])].join('\n')).not.toMatch(oldBrand);
 });

 it.each(['INSTABILITY', 'BLACK_DAMAGE'] as const)('uses the new name in %s round logs and quest errors, retaining the phase ID', kind => {
  const game = readyGame();
  game.eventDeck = createEvents().filter(event => event.kind === kind);
  const started = applyAction(game, { type: 'START_GAME', playerId: game.hostId });
  expect(started.phase).toBe('BLACK_ROSE');
  expect(started.log.join('\n')).toContain('Round 1 · Pink Tulip —');
  expect(started.log.join('\n')).not.toMatch(oldBrand);
  expect(() => applyAction(started, { type: 'DISCARD_QUESTS', playerId: 'p1', questIds: [] })).toThrow('Resolve Pink Tulip before discarding quests');
 });

 it('names neutral defeat rewards in logs while preserving scoring and feedback IDs', () => {
  const game = readyGame();
  game.eventDeck = createEvents().filter(event => event.kind === 'BLACK_DAMAGE');
  Object.assign(game.players[0].wizard, { damageCubes: 9, blackDamage: 9 });
  const started = applyAction(game, { type: 'START_GAME', playerId: game.hostId });
  expect(started.log.join('\n')).toContain('Pink Tulip: +4 VP');
  expect(started.log.join('\n')).toContain('gains +2 VP for being defeated by Pink Tulip.');
  expect(started.log.join('\n')).not.toMatch(oldBrand);
  expect(started.blackRose).toEqual({ victoryPoints: 4, kills: 1 });
  expect(started.feedbackEvents).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'MAGE_DEFEATED', sourceId: BLACK_ROSE_ID })]));
 });
});