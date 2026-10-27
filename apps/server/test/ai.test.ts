import { afterEach, describe, expect, it, vi } from 'vitest';
import {
 applyAction, areAdjacent, areInSameRoom, createGame, GameRuleError,
 hexKey, summonEvocation,
} from '@brw/game-engine';
import * as engine from '@brw/game-engine';
import type { Card, GameAction, GameState, Player } from '@brw/game-engine';
import { chooseBotAction } from '../src/ai';
import { ActionHistory } from '../src/action-history';

const setBot = (p: Player, value = true) => Object.assign(p, { isBot: value });
function lobby(count = 2, bots = ['p1', 'p2', 'p3', 'p4']): GameState {
 const s = createGame(count);
 for (const p of s.players) { p.connected = true; setBot(p, bots.includes(p.id)); }
 return s;
}
function fixture(bots = ['p1']): GameState {
 const s = lobby(2, bots);
 s.phase = 'ACTION'; s.round = 1; s.firstPlayerId = 'p1'; s.currentPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false, spellsCast: 0, discardedExit: false, roomEffectUsed: false };
 s.players[0].wizard.position = { q: 0, r: 0 };
 s.players[1].wizard.position = { q: 1, r: 0 };
 return s;
}
function take(s: GameState, name: string): Card {
 for (const deck of s.library) for (const pile of [deck.cards, deck.discard]) {
  const i = pile.findIndex(c => c.name === name);
  if (i >= 0) return pile.splice(i, 1)[0];
 }
 throw new Error(`No physical ${name} remaining`);
}
function prepare(s: GameState, name: string, slot: keyof Player['prepared'] = 'slot1', owner = 0): Card {
 const card = take(s, name); s.players[owner].prepared[slot] = { card, used: false }; return card;
}
function arm(s: GameState, name: string, owner = 1): string {
 const active = { id: `armed-${owner}-${name}`, playerId: s.players[owner].id, card: take(s, name) };
 s.readiedSpells!.push(active); s.activeSpellOrder!.push(active.id); return active.id;
}
function next(s: GameState): GameAction {
 const before = structuredClone(s), action = chooseBotAction(s);
 expect(s).toEqual(before); expect(action, `No progress in ${s.phase}, round ${s.round}, current ${s.currentPlayerId}, pending ${s.pendingDecision?.kind}`).not.toBeNull();
 expect(() => applyAction(s, action!)).not.toThrow();
 return action!;
}
function step(s: GameState): GameState { return applyAction(s, next(s)); }
function expectCardsConserved(s: GameState) {
 const cards = [
  ...s.library.flatMap(d => [...d.cards, ...d.discard]), ...s.powerfulDeck, ...s.removedCards,
  ...s.players.flatMap(p => [...p.personalDeck, ...p.hand, ...p.discard, ...Object.values(p.prepared).flatMap(c => c && !c.used ? [c.card] : [])]),
  ...(s.readiedSpells ?? []).map(a => a.card), ...(s.ongoingSpells ?? []).map(a => a.card),
 ];
 expect(cards).toHaveLength(48); expect(new Set(cards.map(c => c.id)).size).toBe(48);
}
function expectCubesConserved(s: GameState) {
 for (const p of s.players) {
  expect(Object.values(p.cubes).reduce((a, b) => a + b, 0)).toBe(25);
  expect(p.cubes.onWizard).toBe(s.players.reduce((n, victim) => n + (victim.wizard.damageByPlayer[p.id] ?? 0), 0));
  expect(p.cubes.onEvocations).toBe(s.evocations.reduce((n, e) => n + (e.damageByPlayer[p.id] ?? 0), 0));
 }
}
function finishModel(s: GameState, owner: string): GameState {
 for (let i = 0; i < 12 && s.evocationActivation?.playerId === owner; i++) s = step(s);
 expect(s.evocationActivation?.playerId).not.toBe(owner); return s;
}
function publicOnlyMutation(s: GameState): GameState {
 const copy = structuredClone(s);
 // Preserve stocks/ownership/public facts while replacing EVERY hidden identity.
 const hidden = (c: Card, i: number): Card => ({ ...c, id: `unknown-${i}`, name: 'Unknown', moments: [], target: 'SELF', range: 0, trigger: undefined, ongoing: undefined });
 for (const d of copy.library) d.cards = [...d.cards].reverse().map(hidden);
 copy.eventDeck.reverse(); copy.questDeck.reverse(); copy.powerfulDeck = [...copy.powerfulDeck].reverse().map(hidden);
 for (const p of copy.players) {
  p.personalDeck = [...p.personalDeck].reverse().map(hidden);
  if (p.id === 'p1') continue;
  p.hand = p.hand.map(hidden);
  for (const slot of Object.keys(p.prepared) as Array<keyof Player['prepared']>) {
   const c = p.prepared[slot]; if (c) c.card = hidden(c.card, 100);
  }
  if (p.quest) Object.assign(p.quest, { name: 'Hidden quest', kind: 'KILL', amount: 100, reward: 999, completed: true });
  p.additionalQuests = [];
 }
 for (const active of copy.readiedSpells ?? []) if (active.playerId !== 'p1') active.card = hidden(active.card, 200);
 return copy;
}

afterEach(() => vi.restoreAllMocks());

describe('bot ownership and phase policy', () => {
 it('returns null for a human turn, pending human decision, finished game, or disconnected game', () => {
  const s = fixture([]); expect(chooseBotAction(s)).toBeNull();
  setBot(s.players[0]); s.pendingDecision = { kind: 'WAITING', playerId: 'p2', key: 'private' };
  expect(chooseBotAction(s)).toBeNull();
  s.pendingDecision = null; s.phase = 'GAME_OVER'; expect(chooseBotAction(s)).toBeNull();
  s.phase = 'ACTION'; s.players[1].connected = false; expect(chooseBotAction(s)).toBeNull();
 });
 it.each(['BLACK_ROSE', 'CLEANUP'] as const)('never advances %s even with a bot host and an all-bot roster', phase => {
  const s = fixture(['p1', 'p2']); s.phase = phase; s.activation = null; s.currentPlayerId = null;
  expect(chooseBotAction(s)).toBeNull();
 });
 it('documents actual auto-transition gating rather than returning an invalid phase command', () => {
  for (const phase of ['STUDY', 'PREPARATION'] as const) {
   const s = lobby(); s.phase = phase;
   for (const p of s.players) { p.studyDrawn = true; p.studyDone = true; p.preparationDone = true; }
   expect(() => applyAction(s, { type: 'ADVANCE_PHASE', playerId: 'p1', expectedPhase: phase, expectedRound: s.round })).toThrow(GameRuleError);
   expect(chooseBotAction(s)).toBeNull();
  }
 });
 it('does not change roster, connections, input or private replay when choosing repeatedly', () => {
  const s = fixture(), before = structuredClone(s), a = next(s);
  expect(chooseBotAction(s)).toEqual(a); expect(chooseBotAction(structuredClone(s))).toEqual(a);
  expect(s).toEqual(before);
 });
});

describe('blind setup and preparation', () => {
 it('selects school then ready, letting ActionHistory auto-start exactly once', () => {
  let s = lobby(2, ['p2']); const history = new ActionHistory();
  s = history.apply(s, { type: 'SELECT_STARTING_SCHOOL', playerId: 'p1', schoolId: 'agony' }, 'p1');
  s = history.apply(s, { type: 'SET_READY', playerId: 'p1', ready: true }, 'p1');
  expect(next(s)).toEqual({ type: 'SELECT_STARTING_SCHOOL', playerId: 'p2', schoolId: 'agony' });
  s = history.apply(s, next(s), 'p2');
  expect(next(s)).toEqual({ type: 'SET_READY', playerId: 'p2', ready: true });
  s = history.apply(s, next(s), 'p2');
  expect(s.phase).toBe('BLACK_ROSE'); expect(s.round).toBe(1); expect(chooseBotAction(s)).toBeNull();
  expect(s.players.map(p => p.personalDeck.length)).toEqual([6, 6]); expectCardsConserved(s);
 });
 it('supports direct engine startup only for an all-ready bot host', () => {
  let s = lobby();
  for (let i = 0; i < 4; i++) s = step(s);
  expect(next(s)).toEqual({ type: 'START_GAME', playerId: 'p1' });
  setBot(s.players[0], false); expect(chooseBotAction(s)).toBeNull();
 });
 it('respects aggregate reserved school stock without reading deck identities', () => {
    const s = lobby(2, ['p2']); s.players[0].startingSchoolId = 'agony';
    s.players[0].personalDeck.push(...s.library[0].cards.splice(13));
  expect(chooseBotAction(s)).toBeNull();
    s.library[0].discard.push(s.players[0].personalDeck.pop()!);
  expect(next(s)).toMatchObject({ type: 'SELECT_STARTING_SCHOOL', schoolId: 'agony' });
    expectCardsConserved(s);
 });
 it('picks a random valid starting school when the bot must choose', () => {
  const s = lobby(2, ['p2']);
  const validSchools = [...s.library].map(deck => deck.id).sort();
  const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);

  const action = chooseBotAction(s);

  expect(action).toMatchObject({
   type: 'SELECT_STARTING_SCHOOL',
   playerId: 'p2',
  });
  expect(validSchools).toContain(action!.schoolId);
  expect(randomSpy).toHaveBeenCalled();
 });
 it('draws four blind entries using lengths across stocks (including discard refill)', () => {
  const s = lobby(2, ['p1']); s.phase = 'STUDY';
    const stock = s.library[0].cards.splice(0, 3); s.library.push({ id: 'z-school', name: 'Other', cards: stock, discard: [] });
  s.library[0].discard.push(...s.library[0].cards.splice(1));
  const action = next(s);
  expect(action).toEqual({ type: 'DRAW_STUDY', playerId: 'p1', deckIds: ['agony', 'agony', 'agony', 'agony'] });
  expect(action).toEqual(chooseBotAction(publicOnlyMutation(s)));
  const drawn = applyAction(s, action); expect(drawn.players[0].studyCardIds).toHaveLength(4); expectCardsConserved(drawn);
  // A mixed draw is mandatory when no single stock has four cards.
    s.players[0].personalDeck.push(...s.library[0].discard.splice(0));
  expect(next(s)).toMatchObject({ type: 'DRAW_STUDY', deckIds: ['agony', 'z-school', 'z-school', 'z-school'] });
    expectCardsConserved(s);
 });
 it('discards the worst two tracked draws, never an older held card', () => {
  const s = lobby(2, ['p1']); s.phase = 'STUDY'; const p = s.players[0];
  p.hand.push(take(s, 'Submission'));
  const draws = ['Grim Torment', 'Hearth of Ice', 'Visceral Fire', 'Submission'].map(name => take(s, name));
  p.hand.push(...draws); p.studyDrawn = true; p.studyCardIds = draws.map(c => c.id);
  const action = next(s); expect(action.type).toBe('DISCARD_STUDY');
  if (action.type !== 'DISCARD_STUDY') throw new Error('Expected discard');
  expect(action.cardIds).toContain(draws[3].id); expect(action.cardIds).not.toContain(p.hand[0].id);
  expect(action.cardIds.every(id => p.studyCardIds!.includes(id))).toBe(true);
  expectCardsConserved(applyAction(s, action));
 });
 it('discards hand excess to personal discard then prepares four own ordered/Quick cards', () => {
  let s = lobby(2, ['p1']); s.phase = 'PREPARATION';
  s.players[0].hand.push(...s.library[0].cards.splice(0, 9));
  expect(next(s)).toMatchObject({ type: 'DISCARD_HAND_LIMIT', cardIds: expect.any(Array) });
  s = step(s); expect(s.players[0].discard).toHaveLength(2); expect(s.players[0].hand).toHaveLength(7);
  const own = new Set(s.players[0].hand.map(c => c.id)), action = next(s);
  expect(action.type).toBe('PREPARE_CARDS');
  if (action.type !== 'PREPARE_CARDS') throw new Error('Expected preparation');
  expect(action.preparedCardIds).toHaveLength(3); expect(action.rapidCardId).toBeDefined();
  expect([...action.preparedCardIds, action.rapidCardId].every(id => id && own.has(id))).toBe(true);
  s = applyAction(s, action); expect(s.players[0].preparationDone).toBe(true); expectCardsConserved(s);
  expect(chooseBotAction(s)).toBeNull(); // Human still preparing.
 });
 it('last bot discard/preparation automatically synchronizes a human who already finished', () => {
  let s = lobby(2, ['p2']); s.phase = 'STUDY'; s.players[0].studyDone = true;
  s = step(s); s = step(s); expect(s.phase).toBe('PREPARATION');
  s.players[0].preparationDone = true; s = step(s); expect(s.phase).toBe('ACTION');
  expect(s.currentPlayerId).toBe('p1'); expect(chooseBotAction(s)).toBeNull();
 });
 it('handles bot quest overflow after the explicit Black Rose continuation', () => {
  const s = lobby(2, ['p2']); s.phase = 'BLACK_ROSE'; s.blackRoseResolved = true;
  const p = s.players[1]; p.quest = s.questDeck.shift()!; p.additionalQuests = s.questDeck.splice(0, 2);
  const keep = p.additionalQuests[0]; keep.completed = true;
  const action = next(s); expect(action.type).toBe('DISCARD_QUESTS');
  const done = applyAction(s, action); expect(done.phase).toBe('STUDY'); expect(done.players[1].additionalQuests.some(q => q.id === keep.id) || done.players[1].quest?.id === keep.id).toBe(true);
 });
 it('reports the real four-mage finite-stock deadlock rather than inventing cards or an invalid advance', () => {
  let s = lobby(4); const history = new ActionHistory();
  for (let i = 0; i < 8; i++) { const action = next(s); s = history.apply(s, action, action.playerId); }
  expect(s.phase).toBe('BLACK_ROSE');
  s = applyAction(s, { type: 'ADVANCE_PHASE', playerId: s.hostId, expectedPhase: s.phase, expectedRound: s.round });
  for (let i = 0; i < 6; i++) s = step(s);
  expect(s.players.map(p => p.studyDone)).toEqual([true, true, true, false]);
  expect(s.library[0].cards.length + s.library[0].discard.length).toBe(2);
  expect(() => applyAction(s, { type: 'DRAW_STUDY', playerId: 'p4', deckId: 'agony' })).toThrow(/fewer than 4/);
  expect(chooseBotAction(s)).toBeNull(); expectCardsConserved(s);
 });
});

describe('normal action priorities, movement, and budgets', () => {
 it('claims a completed real quest for free before a combat spell, including the last-action reward window', () => {
  const s = fixture(); s.activation!.actionsUsed = 2;
  const q = s.questDeck.find(q => q.kind === 'ROOM_ACTIVATE')!;
  s.questDeck.splice(s.questDeck.indexOf(q), 1); q.completed = true; q.progress = q.amount; s.players[0].quest = q;
  prepare(s, 'Submission');
  expect(next(s)).toEqual({ type: 'USE_QUEST_REWARD', playerId: 'p1', questId: q.id, targetPlayerId: 'p1' });
  const done = step(s); expect(done.players[0].questsCompleted).toBe(1); expect(done.players[0].actionTokens).toBe(2); expectCardsConserved(done);
 });
 it('chooses a legal room/model target for a free quest reward', () => {
  const s = fixture(); const q = s.questDeck.find(q => q.kind === 'REBUILD')!;
  s.questDeck.splice(s.questDeck.indexOf(q), 1); q.completed = true; s.players[0].quest = q;
  const action = next(s); expect(action).toMatchObject({ type: 'USE_QUEST_REWARD', questId: q.id, roomId: expect.any(String) });
  expectCardsConserved(applyAction(s, action));
 });
 it('casts an actual Agony combat card on an enemy without spending a physical token', () => {
  const s = fixture(); prepare(s, 'Grim Torment');
  expect(next(s)).toEqual({ type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
  const done = step(s); expect(done.players[1].wizard.damageCubes).toBe(3); expect(done.players[0].wizard.blackDamage).toBe(1);
  expect(done.activation?.actionsUsed).toBe(1); expect(done.players[0].actionTokens).toBe(2); expectCardsConserved(done); expectCubesConserved(done);
 });
 it('activates a hidden Agony trap without any target payload', () => {
  const s = fixture(); prepare(s, 'Torment');
  expect(next(s)).toEqual({ type: 'ACTIVATE_SPELL', playerId: 'p1', slot: 'slot1' });
  const done = step(s); expect(done.readiedSpells).toHaveLength(1); expectCardsConserved(done);
 });
 it('targets a real enemy with an ongoing Agony spell rather than its own mage', () => {
  const s = fixture(); prepare(s, 'Pain Mark');
  expect(next(s)).toEqual({ type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
  expect(step(s).ongoingSpells![0]).toMatchObject({ playerId: 'p1', targetPlayerId: 'p2' });
 });
 it('skips blocked later numbered spells, respecting one numbered spell and two total actions', () => {
  let s = fixture(); s.players[0].actionTokens = 0;
    prepare(s, 'Grim Torment'); prepare(s, 'Hearth of Ice', 'slot2'); prepare(s, 'Submission', 'rapid');
  s = step(s); expect(s.activation?.sequencedSpellUsed).toBe(true); expect(s.activation?.actionsUsed).toBe(1);
  expect(next(s)).toMatchObject({ type: 'CAST_SPELL', slot: 'rapid' });
  s = step(s); expect(s.players[0].prepared.slot2?.used).toBe(false); expect(s.currentPlayerId).toBe('p2'); expect(chooseBotAction(s)).toBeNull();
  expectCardsConserved(s); expectCubesConserved(s);
 });
 it('validates candidates without accepting adjacent mage attacks or dummy physical attacks', () => {
  const s = fixture();
  expect(next(s)).toEqual({ type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'EXPLORE' });
  s.players[1].wizard.position = { q: 0, r: 0 };
  expect(next(s)).toMatchObject({ type: 'PUNCH', targetId: 'p2' });
  expect('dummy' in next(s)).toBe(false);
  const done = step(s); expect(done.players[1].wizard.damageCubes).toBe(2); expectCardsConserved(done); expectCubesConserved(done);
 });
 it('uses actual-board BFS to close distance, ends movement, and resolves the optional room effect', () => {
  let s = fixture(); s.players[0].wizard.position = { q: -2, r: 0 }; s.players[1].wizard.position = { q: 0, r: 1 };
  expect(next(s).type).toBe('BEGIN_PHYSICAL_ACTION'); s = step(s);
  expect(next(s).type).toBe('PERFORM_MOVEMENT'); s = step(s);
  const positions = [hexKey(s.players[0].wizard.position)];
  for (let i = 0; i < 8 && s.activation?.physicalAction; i++) {
   const action = next(s);
   if (action.type === 'EXPLORE_STEP') {
    expect(areAdjacent(s.players[0].wizard.position, action.destination)).toBe(true);
    expect(s.board.rooms.some(r => r.startingFor && r.tiles.some(t => hexKey(t) === hexKey(action.destination)))).toBe(false);
    positions.push(hexKey(action.destination));
   }
   s = applyAction(s, action);
  }
  expect(new Set(positions).size).toBe(positions.length); expect(positions).toHaveLength(3);
  expect(s.activation?.physicalAction).toBeNull(); expectCardsConserved(s);
 });
 it('never treats a missing board tile as a path or enters a cell', () => {
  let s = fixture(); s.players[0].wizard.position = { q: 0, r: 0 }; s.players[1].wizard.position = { q: 2, r: 0 };
  s.board.tiles = s.board.tiles.filter(h => hexKey(h) !== '1,0');
  s = step(step(s)); const action = next(s);
  expect(action.type).toBe('EXPLORE_STEP');
  if (action.type !== 'EXPLORE_STEP') throw new Error('Expected movement');
  expect(hexKey(action.destination)).not.toBe('1,0');
 });
 it('finishes active physical attacks before any quest/spell and skips unavailable room effects', () => {
  let s = fixture(); s.players[1].wizard.position = { q: 0, r: 0 };
  s = applyAction(s, { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'ATTACK' });
  prepare(s, 'Submission'); const room = s.board.rooms.find(r => r.tiles.some(t => hexKey(t) === '0,0'))!;
  room.reconstructed = true; room.specialUsed = true;
  expect(next(s)).toEqual({ type: 'INFLICT_ATTACK', playerId: 'p1', targetId: 'p2' });
  s = step(s); expect(next(s).type).toBe('SKIP_PHYSICAL_EFFECTS'); s = step(s);
  expect(s.activation?.physicalAction).toBeNull(); expect(next(s).type).toBe('CAST_SPELL');
 });
 it('leaves a cell with the last shared action, finishes its movement and never tries casting there', () => {
  let s = fixture(); const p = s.players[0]; p.wizard.position = { ...s.board.rooms.find(r => r.startingFor === p.id)!.tiles[0] };
  s.activation!.actionsUsed = 1; prepare(s, 'Submission');
  expect(next(s)).toMatchObject({ type: 'BEGIN_PHYSICAL_ACTION', kind: 'EXPLORE' });
  s = step(s); expect(s.activation?.mustExitCell).toBe(true); s = step(s);
  expect(next(s).type).toBe('EXPLORE_STEP'); s = step(s);
    expect(s.activation?.mustExitCell).not.toBe(true); expectCardsConserved(s);
 });
 it('discards an unused preparation to exit without tokens, preserving even weaker held cards', () => {
  let s = fixture(); const p = s.players[0]; p.actionTokens = 0;
  p.wizard.position = { ...s.board.rooms.find(r => r.startingFor === p.id)!.tiles[0] };
  const weak = take(s, 'Submission'); p.hand.push(weak); const ready = prepare(s, 'Grim Torment');
  const power = s.powerfulDeck.shift()!; p.hand.push(power); s.activation!.actionsUsed = 1;
  expect(next(s)).toMatchObject({ type: 'DISCARD_EXIT', cardId: ready.id });
  s = step(s); expect(s.players[0].hand).toEqual([weak,power]); expect(s.players[0].prepared.slot1?.used).toBe(true); expectCardsConserved(s);
 });
 it('can discard an unused preparation when it is the only legal no-token cell exit', () => {
  const s = fixture(), p = s.players[0]; p.actionTokens = 0;
  p.wizard.position = { ...s.board.rooms.find(r => r.startingFor === p.id)!.tiles[0] };
  const card = prepare(s, 'Submission'); p.hand.push(s.powerfulDeck.shift()!); s.activation!.actionsUsed = 1;
  expect(next(s)).toMatchObject({ type: 'DISCARD_EXIT', cardId: card.id });
  const done = step(s); expect(done.players[0].prepared.slot1?.used).toBe(true); expectCardsConserved(done);
 });
 it.each([
  { slot: 'slot2', spentQuota: false }, { slot: 'slot3', spentQuota: false },
  { slot: 'slot2', spentQuota: true }, { slot: 'slot3', spentQuota: true },
 ] as const)('discards weakest unused $slot for a tokenless cell exit regardless of cast order/quota (spent=$spentQuota)', ({ slot, spentQuota }) => {
  const s = fixture(), p = s.players[0]; p.actionTokens = 0;
  p.wizard.position = { ...s.board.rooms.find(r => r.startingFor === p.id)!.tiles[0] };
  const slots = ['slot1', 'slot2', 'slot3', 'rapid'] as const;
  const cards = slots.map(preparedSlot => prepare(s, preparedSlot === slot ? 'Submission' : preparedSlot === 'rapid' ? 'Torment' : 'Grim Torment', preparedSlot));
  const weakest = p.prepared[slot]!.card;
  p.hand.push(take(s, 'Submission'), s.powerfulDeck.shift()!);
  s.activation!.actionsUsed = 1; s.activation!.sequencedSpellUsed = spentQuota;
  expect(engine.getReadyPreparedSlots(p, s.activation)).toEqual(spentQuota ? ['rapid'] : ['slot1', 'rapid']);
  expect(engine.getDiscardMoveCards(p, s.activation)).toEqual(cards);
  const before = structuredClone(s), action = next(s);
  expect(action).toMatchObject({ type: 'DISCARD_EXIT', playerId: 'p1', cardId: weakest.id });
  expect(chooseBotAction(publicOnlyMutation(s))).toEqual(action); expect(s).toEqual(before);
  if (action.type !== 'DISCARD_EXIT') throw new Error('Expected discard exit');
  expect(areAdjacent(p.wizard.position, action.destination)).toBe(true);
  const done = applyAction(s, action);
  expect(done.currentPlayerId).toBe('p2'); expect(done.players[0].wizard.position).toEqual(action.destination);
  expect(engine.isInStartingRoom(done, done.players[0])).toBe(false); expect(done.players[0].actionTokens).toBe(0);
  expect(done.players[0].hand).toEqual(p.hand); expect(done.library[0].discard).toEqual([weakest]);
  for (const preparedSlot of slots) expect(done.players[0].prepared[preparedSlot]).toEqual({ card: p.prepared[preparedSlot]!.card, used: preparedSlot === slot });
  expect(done.players[0].discard).toEqual([]); expect(done.readiedSpells).toEqual([]); expect(done.ongoingSpells).toEqual([]);
  expect(done.evocations).toEqual([]); expect(done.feedbackEvents).toEqual([]);
  expect(done.log.some(line => /casts |Moment |activates a hidden/.test(line))).toBe(false);
  expectCardsConserved(done); expectCubesConserved(done);
 });
 it('never chooses held, used, Active, ongoing, foreign or Forgotten cards over an eligible future exit', () => {
  const s = fixture(), p = s.players[0]; p.actionTokens = 0;
  p.wizard.position = { ...s.board.rooms.find(r => r.startingFor === p.id)!.tiles[0] };
  p.prepared.slot1 = { card: s.powerfulDeck.shift()!, used: false };
  const used = prepare(s, 'Submission', 'slot2'); p.prepared.slot2!.used = true; s.library[0].discard.push(used);
  const eligible = prepare(s, 'Grim Torment', 'slot3'), active = prepare(s, 'Torment', 'rapid'); p.prepared.rapid!.used = true;
  s.readiedSpells!.push({ id: 'own-active', playerId: p.id, card: active }); s.activeSpellOrder!.push('own-active');
  const ongoing = take(s, 'Pain Mark'); s.ongoingSpells!.push({ id: 'own-ongoing', playerId: p.id, card: ongoing, targetPlayerId: 'p2' }); s.activeSpellOrder!.push('own-ongoing');
  prepare(s, 'Submission', 'rapid', 1); p.hand.push(take(s, 'Submission'), s.powerfulDeck.shift()!);
  s.activation!.actionsUsed = 1; s.activation!.sequencedSpellUsed = true;
  expect(engine.getReadyPreparedSlots(p, s.activation)).toEqual([]); expect(engine.getDiscardMoveCards(p, s.activation)).toEqual([eligible]);
  const action = next(s); expect(action).toMatchObject({ type: 'DISCARD_EXIT', cardId: eligible.id });
  expect(chooseBotAction(publicOnlyMutation(s))).toEqual(action);
  const done = applyAction(s, action); expect(done.players[0].prepared.slot3!.used).toBe(true);
  expect(done.library[0].discard).toEqual([used, eligible]); expect(done.players[0].hand).toEqual(p.hand);
  expect(done.players[0].prepared.slot1).toEqual(p.prepared.slot1); expect(done.readiedSpells).toEqual(s.readiedSpells);
  expect(done.ongoingSpells).toEqual(s.ongoingSpells); expect(done.players[1].prepared).toEqual(s.players[1].prepared);
  expect(done.players[0].actionTokens).toBe(0); expect(done.currentPlayerId).toBe('p2'); expectCardsConserved(done); expectCubesConserved(done);
 });
 it('finishes second-action physical effects before handing control to the human', () => {
  let s = fixture(); s.players[1].wizard.position = { q: 0, r: 0 }; s.activation!.actionsUsed = 1;
  s = applyAction(s, { type: 'BEGIN_PHYSICAL_ACTION', playerId: 'p1', kind: 'ATTACK' }); prepare(s, 'Grim Torment');
  expect(s.activation?.actionsUsed).toBe(2); expect(next(s).type).toBe('INFLICT_ATTACK'); s = step(s);
  expect(next(s).type).toBe('ACTIVATE_ROOM'); s = step(s);
  expect(s.currentPlayerId).toBe('p2'); expect(chooseBotAction(s)).toBeNull(); expectCardsConserved(s);
 });
 it('passes only when exhausted, may end outside a cell, but exits with quota-blocked preparations in a cell', () => {
  const s = fixture(); s.players[0].actionTokens = 0;
  expect(next(s)).toEqual({ type: 'PASS_ROUND', playerId: 'p1' });
  const card = prepare(s, 'Submission', 'slot2'); s.activation!.actionsUsed = 1; s.activation!.sequencedSpellUsed = true;
  expect(engine.getReadyPreparedSlots(s.players[0], s.activation)).toEqual([]);
  expect(engine.getDiscardMoveCards(s.players[0], s.activation)).toEqual([card]);
  // Outside cells the existing policy may defer; only mandatory exits require discarding.
  expect(next(s)).toEqual({ type: 'END_ACTIVATION', playerId: 'p1' });
  s.players[0].wizard.position = { ...s.board.rooms.find(r => r.startingFor === 'p1')!.tiles[0] };
  expect(next(s)).toMatchObject({ type: 'DISCARD_EXIT', playerId: 'p1', cardId: card.id });
  const done = step(s); expect(done.currentPlayerId).toBe('p2'); expect(done.players[0].actionTokens).toBe(0); expectCardsConserved(done);
 });
 it('can cast a prepared Forgotten spell but never the legacy cast-from-hand command', () => {
  const s = fixture(); const card = s.powerfulDeck.shift()!; s.players[0].prepared.slot1 = { card, used: false };
  const action = next(s); expect(action.type).toBe('CAST_SPELL'); expectCardsConserved(applyAction(s, action));
 });
});

describe('out-of-turn decisions and spell-granted continuations', () => {
 it('answers a bot Soul Tithe before the human attacker resumes, with no input mutation', () => {
  const s = fixture(['p2']); prepare(s, 'Grim Torment');
  const keeper = summonEvocation(s, s.players[1], 'SUCCUBUS', { q: 1, r: 0 })!;
  const paused = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
  expect(paused.pendingDecision?.kind).toBe('SOUL_TITHE');
  expect(next(paused)).toEqual({ type: 'RESPOND_SOUL_TITHE', playerId: 'p2', accept: true });
  const done = step(paused); expect(done.evocations.find(e => e.id === keeper.id)?.damageCubes).toBe(1);
  expect(done.players[1].wizard.damageCubes).toBe(2); expect(done.currentPlayerId).toBe('p1'); expect(chooseBotAction(done)).toBeNull(); expectCardsConserved(done); expectCubesConserved(done);
 });
 it('declines a nonlethal tithe that would destroy the last-wound servant, but sacrifices it to save its mage', () => {
  const s = fixture(['p2']); prepare(s, 'Grim Torment');
  const e = summonEvocation(s, s.players[1], 'SUCCUBUS', { q: 1, r: 0 })!; e.damageCubes = 2;
  const root: GameAction = { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' };
  expect(next(applyAction(s, root))).toMatchObject({ type: 'RESPOND_SOUL_TITHE', accept: false });
  s.players[1].wizard.health = 3;
  expect(next(applyAction(s, root))).toMatchObject({ type: 'RESPOND_SOUL_TITHE', accept: true });
 });
 it('reveals Torment on its forced actual dealer, not a hidden opponent card or an invented target', () => {
  const s = fixture(['p2']); prepare(s, 'Grim Torment'); const id = arm(s, 'Torment');
  const paused = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
  expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL');
  expect(next(paused)).toMatchObject({ type: 'RESPOND_REACTIVE_SPELL', playerId: 'p2', activeSpellId: id, targetId: 'p1' });
  const done = step(paused); expect(done.readiedSpells).toHaveLength(0); expect(done.evocations[0].playerId).toBe('p2'); expectCardsConserved(done); expectCubesConserved(done);
 });
 it('scores a scoped reactive moment in the remote reveal room, matching actual engine resolution', () => {
  const s = fixture(['p2']); prepare(s, 'Grim Torment'); const id = arm(s, 'Torment');
  // A custom/saved scoped card can reveal away from its owner's mage. No
  // extra physical card is created, and ordinary Torment behavior stays intact.
  s.readiedSpells![0].card.moments = [{ effect: 'DAMAGE', amount: 2, scope: 'CASTER_ROOM' }];
  expect(areInSameRoom(s, s.players[0].wizard.position, s.players[1].wizard.position)).toBe(false);
  const paused = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
  expect(next(paused)).toMatchObject({ type: 'RESPOND_REACTIVE_SPELL', playerId: 'p2', activeSpellId: id, targetId: 'p1' });
  const done = step(paused);
  // The interrupted Grim Torment resumes its separate Pain 1 moment afterward.
  expect(done.players[0].wizard.damageCubes).toBe(3);
  expect(done.players[0].wizard.blackDamage).toBe(1);
  expect(done.players[0].wizard.damageByPlayer.p2).toBe(2);
  expectCardsConserved(done); expectCubesConserved(done);
 });
 it('declines an unhelpful optional reveal when finite Succubus supply is exhausted', () => {
  const s = fixture(['p2']); prepare(s, 'Grim Torment'); arm(s, 'Liquefy the Pain');
  for (let i = 0; i < 3; i++) summonEvocation(s, s.players[0], 'SUCCUBUS', { q: -1, r: 0 });
  s.players[1].wizard.health = 1;
  const paused = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
  expect(paused.pendingDecision?.kind).toBe('REACTIVE_SPELL');
  expect(next(paused)).toMatchObject({ type: 'RESPOND_REACTIVE_SPELL', playerId: 'p2' });
  expect(next(paused)).not.toHaveProperty('activeSpellId');
 });
 it('chooses among legal non-forced reveal targets sensibly and can decline with an empty option list', () => {
  const s = fixture(['p2']); prepare(s, 'Grim Torment'); arm(s, 'Torment');
  const active = s.readiedSpells![0]; delete active.card.triggerTarget;
  const paused = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'slot1', targetPlayerId: 'p2' });
  expect(next(paused)).toHaveProperty('targetId', 'p1');
  // Empty options can occur in sanitized/stale decision snapshots; declining is legal.
  if (paused.pendingDecision?.kind !== 'REACTIVE_SPELL') throw new Error('Expected reactive');
  paused.pendingDecision.options = [];
  expect(next(paused)).not.toHaveProperty('activeSpellId');
 });
 it('reveals Master of Pleasure on the human quest solver before their turn resumes', () => {
  const s = fixture(['p2']); const id = arm(s, 'Master of Pleasure');
  const q = s.questDeck.find(q => q.kind === 'ROOM_ACTIVATE')!;
  s.questDeck.splice(s.questDeck.indexOf(q), 1); q.completed = true; s.players[0].quest = q;
  const paused = applyAction(s, { type: 'USE_QUEST_REWARD', playerId: 'p1', questId: q.id });
  expect(next(paused)).toMatchObject({ type: 'RESPOND_REACTIVE_SPELL', activeSpellId: id, targetId: 'p1' });
  const done = step(paused); expect(done.players[0].questsCompleted).toBe(1); expect(done.players[0].wizard.damageCubes).toBe(2);
  expect(done.currentPlayerId).toBe('p1'); expectCardsConserved(done); expectCubesConserved(done);
 });
 it.each(['ACTION', 'EVOCATION'] as const)('handles Liquefy defeat and resumes the interrupted human model in %s', phase => {
  let s = fixture(['p2']); s.players[1].wizard.position = { q: 0, r: 0 }; s.players[1].wizard.health = 1;
  arm(s, 'Liquefy the Pain'); const human = summonEvocation(s, s.players[0], 'CADAVER', { q: 0, r: 0 })!;
  s.phase = phase; if (phase === 'EVOCATION') s.activation = null;
  s = applyAction(s, { type: 'ACTIVATE_EVOCATION', playerId: 'p1', evocationId: human.id });
  s = applyAction(s, { type: 'EVOCATION_ATTACK', playerId: 'p1', targetId: 'p2' });
  expect(next(s)).toMatchObject({ type: 'RESPOND_REACTIVE_SPELL', playerId: 'p2', targetId: 'room-0,0' });
  s = step(s); expect(s.currentPlayerId).toBe('p2'); expect(s.evocationActivation?.resume?.currentPlayerId).toBe('p1');
  expect(next(s).type).toBe('EVOCATION_ATTACK');
  s = finishModel(s, 'p2');
  expect(s.currentPlayerId).toBe('p1'); expect(s.evocationActivation).toMatchObject({ evocationId: human.id, attackUsed: true });
  expect(chooseBotAction(s)).toBeNull(); expectCardsConserved(s); expectCubesConserved(s);
 });
 it('completes Cross and Delight’s free activation on the second shared action without spending another token', () => {
  let s = fixture(); prepare(s, 'Cross and Delight'); s.activation!.actionsUsed = 1; s.players[0].actionTokens = 0;
  s.players[1].wizard.position = { q: 0, r: 0 };
  expect(next(s).type).toBe('CAST_SPELL'); s = step(s);
    expect(s.pendingDecision?.kind).toBe('SOUL_TITHE'); s = step(s);
  expect(s.evocationActivation?.playerId).toBe('p1'); expect(s.activation?.actionsUsed).toBe(2);
  s = finishModel(s, 'p1'); expect(s.players[0].actionTokens).toBe(0); expect(s.currentPlayerId).toBe('p2'); expectCardsConserved(s); expectCubesConserved(s);
 });
});

describe('free and paid evocation control', () => {
 it('moves into an enemy room, attacks once, and finishes (no adjacent-room attack)', () => {
  let s = fixture(); s.phase = 'EVOCATION'; s.activation = null;
  const e = summonEvocation(s, s.players[0], 'CADAVER', { q: 0, r: 0 })!;
  expect(next(s)).toEqual({ type: 'ACTIVATE_EVOCATION', playerId: 'p1', evocationId: e.id }); s = step(s);
  expect(next(s)).toEqual({ type: 'EVOCATION_STEP', playerId: 'p1', destination: { q: 1, r: 0 } }); s = step(s);
  expect(next(s)).toEqual({ type: 'EVOCATION_ATTACK', playerId: 'p1', targetId: 'p2' }); s = step(s);
  expect(s.evocationActivation).toMatchObject({ attackUsed: true, movesRemaining: 1 }); expect(next(s).type).toBe('END_EVOCATION');
  s = step(s); expect(s.phase).toBe('CLEANUP'); expectCardsConserved(s); expectCubesConserved(s);
 });
 it('finishes movement-only activations with no enemies outside cells', () => {
  let s = fixture(); s.phase = 'EVOCATION'; s.activation = null;
  s.players[1].wizard.position = { ...s.board.rooms.find(r => r.startingFor === 'p2')!.tiles[0] };
  summonEvocation(s, s.players[0], 'CADAVER', { q: 0, r: 0 });
  s = step(s); expect(next(s).type).toBe('END_EVOCATION'); s = step(s); expect(s.phase).toBe('CLEANUP');
 });
 it('handles same multi-tile room targets and keeps movement after the single attack', () => {
  let s = fixture(); s.phase = 'EVOCATION'; s.activation = null;
  const room = s.board.rooms.find(r => r.id === 'room-0,0')!;
  s.board.rooms = s.board.rooms.filter(r => r.id !== 'room-1,0'); room.tiles.push({ q: 1, r: 0 });
  const e = summonEvocation(s, s.players[0], 'CADAVER', { q: 0, r: 0 })!;
  s = step(s); expect(areInSameRoom(s, e.position, s.players[1].wizard.position)).toBe(true);
  expect(next(s).type).toBe('EVOCATION_ATTACK'); s = step(s); expect(s.evocationActivation?.movesRemaining).toBe(2);
  expect(next(s).type).toBe('END_EVOCATION');
 });
 it('spends one shared action and token for a useful paid activation before a distant mage Explore', () => {
  const s = fixture(); s.players[0].wizard.position = { q: -2, r: 0 };
  const e = summonEvocation(s, s.players[0], 'CADAVER', { q: 1, r: 0 })!;
  expect(next(s)).toEqual({ type: 'ACTIVATE_EVOCATION', playerId: 'p1', evocationId: e.id });
  const active = step(s); expect(active.activation?.actionsUsed).toBe(1); expect(active.players[0].actionTokens).toBe(1);
 });
 it('uses retained movement after a defeat to pursue another enemy, but never attacks twice', () => {
  let s = fixture(); s.phase = 'EVOCATION'; s.activation = null;
  const third = lobby(3).players[2]; third.wizard.position = { q: 2, r: 0 }; s.players.push(third);
  s.players[1].wizard.position = { q: 0, r: 0 }; s.players[1].wizard.health = 1;
  summonEvocation(s, s.players[0], 'CADAVER', { q: 0, r: 0 });
  s = step(s); expect(next(s).type).toBe('EVOCATION_ATTACK'); s = step(s);
  expect(s.evocationActivation?.attackUsed).toBe(true); expect(next(s).type).toBe('EVOCATION_STEP');
  for (let i = 0; i < 3 && s.evocationActivation; i++) { expect(next(s).type).not.toBe('EVOCATION_ATTACK'); s = step(s); }
  expect(s.evocationActivation).toBeNull(); expectCardsConserved(s); expectCubesConserved(s);
 });
});

describe('privacy, legal-oracle failures, and bounded play', () => {
 it('makes the same combat decision under all opponent hidden-card/quest and future-deck mutations', () => {
  const s = fixture(); prepare(s, 'Grim Torment'); prepare(s, 'Torment', 'rapid', 1);
  s.players[1].hand.push(take(s, 'Cross and Delight')); s.players[1].personalDeck.push(take(s, 'Peak of Agony'));
  s.players[0].personalDeck.push(take(s, 'Submission'));
  s.players[1].quest = s.questDeck.shift()!; arm(s, 'Master of Pleasure');
  expect(next(s)).toEqual(next(publicOnlyMutation(s)));
 });
 it('never directly reads future card definitions or opponent private decision-scoring fields', () => {
  const s = fixture(); prepare(s, 'Submission'); s.players[0].personalDeck.push(take(s, 'Grim Torment'));
  // structuredClone/the oracle may copy them, but the policy may not read them.
  // Non-enumerable getters are deliberately absent from the engine clone.
  for (const deck of [s.library[0].cards, s.players[0].personalDeck]) for (const c of deck) {
   Object.defineProperty(c, 'name', { enumerable: false, get() { throw new Error('Hidden deck identity inspected'); } });
  }
  Object.defineProperty(s.players[1], 'hand', { enumerable: false, get() { throw new Error('Foreign hand inspected'); } });
  // The engine does not need a foreign hand while resolving this immediate spell.
  expect(next(s)).toMatchObject({ type: 'CAST_SPELL', targetPlayerId: 'p2' });
 });
 it('propagates unexpected failures instead of treating engine bugs as illegal moves', () => {
    const s = fixture(); vi.spyOn(engine, 'applyAction').mockImplementation(() => { throw new Error('Unexpected engine failure'); });
  expect(() => chooseBotAction(s)).toThrow('Unexpected engine failure');
 });
 it('does not use Math.random for policy tie breaks or inspect simulated random rewards', () => {
  const s = fixture(); prepare(s, 'Grim Torment');
  const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Policy RNG'); });
  expect(next(s)).toMatchObject({ type: 'CAST_SPELL' }); expect(random).not.toHaveBeenCalled();
 });
 it('ignores different random room-retrieval outcomes produced by the legality oracle', () => {
  const s = fixture(); s.players[1].wizard.position = { q: 0, r: 0 };
  const room = s.board.rooms.find(r => r.id === 'room-0,0')!; room.effect = 'DRAW_DISCARD';
  s.players[0].discard.push(take(s, 'Submission'), take(s, 'Grim Torment'));
  const random = vi.spyOn(Math, 'random').mockReturnValue(0), before = structuredClone(s);
  const action = chooseBotAction(s); random.mockReturnValue(0.999999);
  expect(chooseBotAction(s)).toEqual(action); expect(action).toMatchObject({ type: 'PUNCH', roomEffect: 'END' });
  expect(s).toEqual(before); expectCardsConserved(s);
 });
 it('treats only GameRuleError as a rejected candidate and validates independent clones', () => {
  const s = fixture(); prepare(s, 'Grim Torment'); const before = structuredClone(s);
  const oracle = vi.spyOn(engine, 'applyAction').mockImplementation((copy, action) => {
   expect(copy).not.toBe(s); copy.log.push('Oracle-only mutation'); action.playerId = 'clone-only';
   throw new GameRuleError('Reject candidate');
  });
  expect(chooseBotAction(s)).toBeNull(); expect(oracle.mock.calls.length).toBeGreaterThan(1); expect(oracle.mock.calls.length).toBeLessThanOrEqual(1024);
  expect(s).toEqual(before);
 });
 it.each([2, 3].flatMap(count => [0x31415926, 7, 42, 2026].map(initialSeed => ({ count, initialSeed }))))('drives a card-conserving $count-bot match, seed $initialSeed, across three rounds with explicit phase continuation', ({ count, initialSeed }) => {
  // Fixture entropy is deterministic; policy choices still see only own/public data.
  let seed = initialSeed;
  vi.spyOn(Math, 'random').mockImplementation(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; });
  let s = lobby(count); const history = new ActionHistory(), phases = new Set<string>(), rounds = new Set<number>();
  let commands = 0, botCommands = 0;
  for (; commands < 1500 && s.phase !== 'GAME_OVER'; commands++) {
   phases.add(s.phase); rounds.add(s.round); const before = structuredClone(s);
   let action = chooseBotAction(s);
   expect(s).toEqual(before);
  expect(chooseBotAction(structuredClone(s))).toEqual(action);
    if (!s.pendingDecision && (s.phase === 'BLACK_ROSE' && !s.blackRoseResolved || s.phase === 'CLEANUP')) {
    expect(action).toBeNull();
    action = { type: 'ADVANCE_PHASE', playerId: s.hostId, expectedPhase: s.phase, expectedRound: s.round };
   } else {
    expect(action, `Stuck at command ${commands}: ${s.phase} r${s.round}, current ${s.currentPlayerId}, pending ${s.pendingDecision?.kind}, hand ${s.players.map(p => p.hand.length)}, stock ${s.library[0].cards.length + s.library[0].discard.length}`).not.toBeNull();
    botCommands++;
   }
   expect(action!.type).not.toMatch(/UNDO|REDO|SET_EVOCATION_AUTO|SET_ACTIVE/);
   s = history.apply(s, action!, action!.playerId);
   expect(s).not.toEqual(before); expectCardsConserved(s); expectCubesConserved(s);
  if (s.activation) expect(s.activation.actionsUsed).toBeLessThanOrEqual(2);
  }
  expect(commands).toBeLessThan(1500); expect(botCommands).toBeGreaterThan(40);
  expect(s.phase).toBe('GAME_OVER'); expect(s.round).toBe(3); expect(s.winner).toBeTruthy();
  expect([...rounds]).toEqual([0, 1, 2, 3]);
  for (const phase of ['LOBBY', 'BLACK_ROSE', 'STUDY', 'PREPARATION', 'ACTION', 'CLEANUP']) expect(phases.has(phase), phase).toBe(true);
  // With no surviving models the engine enters and immediately skips Evocation.
  expect(s.log.some(entry => entry.startsWith('EVOCATION —'))).toBe(true);
 });
});