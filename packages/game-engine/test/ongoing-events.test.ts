import { describe, expect, it } from 'vitest';
import { applyAction, createEvents, createGame, EVENT_BOARD_SIZE, EventCard, GameState, hexDistance, MAGE_DRAFT_POOL } from '../src';

const ongoing = (id: string, entryPoints: number, exitPoints: number): EventCard =>
 ({ id, name: id, description: id, kind: 'ONGOING', amount: 0, rooms: 0, ongoing: { entryPoints, exitPoints } });
const quiet = (id: string): EventCard => ({ id, name: id, description: id, kind: 'BLACK_DAMAGE', amount: 0, rooms: 0 });

function started(deck: EventCard[]) {
 let g = createGame(2);
 for (const p of g.players) p.connected = true;
 for (const p of g.players)g=applyAction(g,{type:'SET_READY',playerId:p.id,ready:true});
 g.eventDeck = deck;
 g=applyAction(g,{type:'START_GAME',playerId:'p1'});
 for(const [index,id] of g.setupOrder!.entries())g=applyAction(g,{type:'DRAFT_SCHOOL',playerId:id,schoolId:g.library[index].id});
 for(const [index,id] of [...g.setupOrder!].reverse().entries())g=applyAction(g,{type:'DRAFT_MAGE',playerId:id,mageId:MAGE_DRAFT_POOL[index].id});
 return g;
}
// Fixture: jump to Cleanup of an early round, then begin the next BR for real.
function nextRound(g: GameState, deck?: EventCard[]) {
 g = structuredClone(g);
 g.phase = 'CLEANUP'; g.round = 1; g.currentPlayerId = null; g.activation = null; g.evocationActivation = null;
 if (deck) g.eventDeck = deck;
 return applyAction(g, { type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: 'CLEANUP', expectedRound: 1 });
}
const ids = (g: GameState) => g.eventBoard!.map(e => e?.id ?? null);
const eventFor = (effect: NonNullable<EventCard['effect']>) => createEvents().find(event => event.effect === effect)!;
function resolveChoices(game: GameState, choose: (decision: Extract<NonNullable<GameState['pendingDecision']>, { kind: 'CHOICE' }>) => string | undefined = decision => decision.options[0]?.id): GameState {
 let current = game;
 while (current.pendingDecision) {
  const decision = current.pendingDecision;
  if (decision.kind !== 'CHOICE') throw new Error(`Unexpected decision: ${decision.kind}`);
  current = applyAction(current, { type: 'RESPOND_CHOICE', playerId: decision.playerId, key: decision.key, choiceId: choose(decision) });
 }
 return current;
}

describe('ongoing events', () => {
 it('start with an empty board of three places', () => {
  const g = createGame(2);
  expect(EVENT_BOARD_SIZE).toBe(3);
  expect(g.eventBoard).toEqual([null, null, null]);
 });

 it('deck contains ongoing events that never use instant fields', () => {
  const cards = createEvents().filter(e => e.kind === 'ONGOING');
  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) expect(card.ongoing).toBeDefined();
 });

 it('catalogs all thirteen requested events with their printed slot and crown metadata', () => {
  const cards = createEvents();
  expect(cards).toHaveLength(13);
  expect(new Set(cards.map(card => card.name)).size).toBe(13);
  expect(eventFor('GIFT_TO_FOOLS').boardSlot).toBe(0);
  for (const effect of ['REBIRTH_AT_NOON', 'REBIRTH_AT_DAWN', 'REBIRTH_AT_SUNSET', 'MIDNIGHT_REBIRTH'] as const) expect(eventFor(effect).boardSlot).toBe(1);
  expect(eventFor('PUPPETEER').boardSlot).toBe(2);
  expect(eventFor('UNDEAD_ARMY').boardSlot).toBe(2);
  for (const effect of ['BLACK_THORNS', 'PUPPETEER', 'BLACK_OVERLOAD', 'HIDDEN_RESOURCES'] as const) expect(eventFor(effect).crown).toBe(true);
 });

 it('resolves Awakening immediately and awards its entry point', () => {
  const g = started([eventFor('AWAKENING'), quiet('q')]);
  const central = g.board.rooms.find(room => room.effect === 'BR_STANDARD')!;
  expect(central.instability).toBe(5);
  expect(g.blackRose.victoryPoints).toBe(1);
  expect(g.eventDiscard.map(event => event.id)).toContain('event-awakening');
 });

 it('places rebirth cubes after the new event draw in every matching room', () => {
  const g = started([eventFor('REBIRTH_AT_NOON'), quiet('q')]);
  expect(g.eventBoard?.[1]?.effect).toBe('REBIRTH_AT_NOON');
  for (const room of g.board.rooms) {
   const shouldPlace = room.color === 'azure' || room.color === 'violet';
   expect(room.cubesByPlayer['black-rose'] ?? 0).toBe(shouldPlace ? 1 : 0);
  }
  expect(g.blackRose.victoryPoints).toBe(2);
 });

 it.each([
  { effect: 'REBIRTH_AT_DAWN' as const, colors: ['crimson', 'amber'] },
  { effect: 'REBIRTH_AT_SUNSET' as const, colors: ['emerald', 'grey'] },
 ])('%s places a Black Rose cube in each matching room', ({ effect, colors }) => {
  const g = started([eventFor(effect), quiet('q')]);
  for (const room of g.board.rooms) expect(room.cubesByPlayer['black-rose'] ?? 0).toBe(colors.includes(room.color ?? '') ? 1 : 0);
  expect(g.blackRose.victoryPoints).toBe(2);
 });

 it('Midnight Rebirth places two cubes in the Black Rose room each phase', () => {
  const g = started([eventFor('MIDNIGHT_REBIRTH'), quiet('q')]);
  const central = g.board.rooms.find(room => room.effect === 'BR_STANDARD')!;
  expect(central.cubesByPlayer['black-rose']).toBe(2);
  expect(g.blackRose.victoryPoints).toBe(3);
 });

 it('Black Thorns damages every mage and crowns the last player', () => {
  const g = started([eventFor('BLACK_THORNS'), quiet('q')]);
  expect(g.firstPlayerId).toBe(g.setupOrder?.[g.setupOrder.length - 1]);
  expect(g.players.every(player => player.wizard.damageCubes === 2)).toBe(true);
  expect(g.blackRose.victoryPoints).toBe(2);
 });

 it('Gift to Fools draws one shared-library card for each mage in player order', () => {
  const g = resolveChoices(started([eventFor('GIFT_TO_FOOLS'), quiet('q')]));
  expect(g.eventBoard?.[0]?.effect).toBe('GIFT_TO_FOOLS');
  expect(g.players.every(player => player.hand.length === 1)).toBe(true);
  expect(g.blackRose.victoryPoints).toBe(2);
 });

 it('Dislocation lets every mage choose a room in player order', () => {
  const g = resolveChoices(started([eventFor('DISLOCATION'), quiet('q')]));
  expect(g.players.every(player => g.board.rooms.some(room => room.tiles.some(tile => tile.q === player.wizard.position.q && tile.r === player.wizard.position.r)))).toBe(true);
  expect(g.blackRose.victoryPoints).toBe(2);
 });

 it('A Hard Lesson removes one VP and places each mage within one space of their cell', () => {
  const g = resolveChoices(started([eventFor('A_HARD_LESSON'), quiet('q')]));
  for (const player of g.players) {
   const start = g.board.rooms.find(room => room.id === player.wizard.startingRoomId)!.tiles[0];
   expect(player.victoryPoints).toBe(0);
   expect(g.board.rooms.some(room => !room.startingFor && room.tiles.some(tile => tile.q === player.wizard.position.q && tile.r === player.wizard.position.r && hexDistance(tile, start) <= 1))).toBe(true);
  }
  expect(g.blackRose.victoryPoints).toBe(1);
 });

 it('Undead Army offers one optional Cadaver summon per mage outside starting cells', () => {
  let g = started([quiet('q')]);
  const rooms = g.board.rooms.filter(room => !room.startingFor && room.color !== null);
  g.players.forEach((player, index) => { player.wizard.position = { ...rooms[index].tiles[0] }; });
  g.eventBoard = [eventFor('UNDEAD_ARMY'), null, null];
  g = resolveChoices(nextRound(g, [quiet('next')]));
  expect(g.evocations.filter(evocation => evocation.kind === 'CADAVER')).toHaveLength(g.players.length);
  expect(g.evocations.every(evocation => !g.board.rooms.some(room => room.startingFor && room.tiles.some(tile => tile.q === evocation.position.q && tile.r === evocation.position.r)))).toBe(true);
 });

 it('Black Overload adds a Black Rose cube after a mage places instability', () => {
  let g = started([quiet('q')]);
  const mage = g.players[0], room = g.board.rooms.find(candidate => candidate.color === 'emerald')!;
  room.effect = 'FORGE_STANDARD';
  g.phase = 'ACTION'; g.currentPlayerId = mage.id; g.eventBoard = [eventFor('BLACK_OVERLOAD'), null, null];
  mage.wizard.position = { ...room.tiles[0] }; mage.actionTokens = 1;
  g.activation = { playerId: mage.id, actionsUsed: 0, exploring: 0, sequencedSpellUsed: false, spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: { kind: 'EXPLORE', mainEffectUsed: true, movementStarted: true } };
  g = applyAction(g, { type: 'ACTIVATE_ROOM', playerId: mage.id });
  const placed = g.board.rooms.find(candidate => candidate.id === room.id)!;
  expect(placed.cubesByPlayer[mage.id]).toBe(1);
  expect(placed.cubesByPlayer['black-rose']).toBe(1);
 });

 it('Puppeteer places instability when an evocation is defeated during Action', () => {
  let g = started([quiet('q')]);
  const mage = g.players[0], target = g.players[1], room = g.board.rooms.find(candidate => candidate.color !== null)!;
  mage.wizard.position = { ...room.tiles[0] }; target.wizard.position = { ...room.tiles[0] };
  g.phase = 'ACTION'; g.currentPlayerId = mage.id; g.eventBoard = [null, null, eventFor('PUPPETEER')];
  mage.actionTokens = 1;
  g.evocations.push({ id: 'puppeteer-target', playerId: target.id, kind: 'CADAVER', name: 'Cadaver', archetype: 'UNDEAD', movement: 2, attack: 2, health: 2, position: { ...room.tiles[0] }, damageCubes: 0, damageByPlayer: {}, activated: false });
  g.activation = { playerId: mage.id, actionsUsed: 0, exploring: 0, sequencedSpellUsed: false, spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: { kind: 'ATTACK', mainEffectUsed: false, movementStarted: false } };
  g = applyAction(g, { type: 'INFLICT_ATTACK', playerId: mage.id, targetId: 'puppeteer-target' });
  const affected = g.board.rooms.find(candidate => candidate.id === room.id)!;
  expect(g.evocations.some(evocation => evocation.id === 'puppeteer-target')).toBe(false);
  expect(affected.cubesByPlayer['black-rose']).toBe(1);
 });

 it('Hidden Resources grants a point when Black Rose damage respawns a mage', () => {
  let g = started([eventFor('HIDDEN_RESOURCES'), quiet('q')]);
  const mage = g.players[0]; mage.wizard.damageCubes = mage.wizard.health - 2; mage.wizard.blackDamage = mage.wizard.health - 2;
    const mageId = mage.id, pointsBefore = mage.victoryPoints;
  g = nextRound(g, [eventFor('BLACK_THORNS'), quiet('next')]);
    const respawned = g.players.find(player => player.id === mageId)!;
    expect(respawned.wizard.damageCubes).toBe(0);
    expect(respawned.victoryPoints).toBe(pointsBefore + 1);
 });

 it('enter slot 1, pay BR on entry, and skip the discard', () => {
  const g = started([ongoing('a', 2, 3), quiet('q')]);
  expect(ids(g)).toEqual(['a', null, null]);
  expect(g.blackRose.victoryPoints).toBe(2);
  expect(g.usedEvent?.id).toBe('a');
  expect(g.eventDiscard).toEqual([]);
 });

 it('shift all before each draw and pay BR when the last one leaves', () => {
  let g = started([ongoing('a', 1, 4)]);
  g = nextRound(g, [ongoing('b', 0, 0)]);
  expect(ids(g)).toEqual(['b', 'a', null]);
  g = nextRound(g, [ongoing('c', 0, 0)]);
  expect(ids(g)).toEqual(['c', 'b', 'a']);
  expect(g.blackRose.victoryPoints).toBe(1);
  g = nextRound(g, [ongoing('d', 0, 0)]);
  expect(ids(g)).toEqual(['d', 'c', 'b']);
  expect(g.blackRose.victoryPoints).toBe(5);
  expect(g.eventDiscard.map(e => e.id)).toEqual(['a']);
 });

 it('instant event drawn on a shifted board leaves slot 1 empty', () => {
  let g = started([ongoing('a', 0, 0)]);
  g = nextRound(g, [quiet('q')]);
  expect(ids(g)).toEqual([null, 'a', null]);
  expect(g.eventDiscard.map(e => e.id)).toEqual(['q']);
 });
});
