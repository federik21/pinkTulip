import { describe, expect, it, vi } from 'vitest';
import { areAdjacent, createGame } from '@brw/game-engine';
import type { Card, GameAction, GameState, Player, RoomEffect } from '@brw/game-engine';
import { ActionHistory, HISTORY_LIMIT } from '../src/action-history';
import { publicState } from '../src/public-state';

function fixture(count = 2): GameState {
 const game = createGame(count);
 game.phase = 'ACTION'; game.round = 1; game.currentPlayerId = 'p1';
 game.activation = { playerId:'p1', actionsUsed:0, exploring:0, sequencedSpellUsed:false,
  spellsCast:0, discardedExit:false, roomEffectUsed:false };
 // Mid-game fixtures move real school cards into personal zones explicitly;
 // creating a lobby no longer generates twelve extra cards per mage.
 for (const p of game.players) {
  p.connected = true; p.wizard.position = { q:0, r:0 };
  p.personalDeck.push(...game.library[0].cards.splice(0, 8));
 }
 return game;
}
function prepare(game: GameState, changes: Partial<Card> = {}, slot: keyof Player['prepared'] = 'rapid') {
 const card = { ...game.library[0].cards.shift()!, target:'ROOM' as const, damage:0, instability:0, range:4, ...changes };
 game.players[0].prepared[slot] = { card, used:false };
 return card;
}
const command = (type: GameAction['type'], playerId = 'p1') => ({ type, playerId } as GameAction);
const cast: GameAction = { type:'CAST_SPELL', playerId:'p1', slot:'rapid', roomId:'room-0,0' };
const begin: GameAction = { type:'BEGIN_PHYSICAL_ACTION', playerId:'p1', kind:'EXPLORE' };
const undo = command('UNDO_ACTION'), redo = command('REDO_ACTION');
function apply(history: ActionHistory, game: GameState, action: GameAction) {
 return history.apply(game, action, action.playerId);
}
function available(history: ActionHistory, game: GameState, player = 'p1') {
 return history.status(game, player);
}
function reject(history: ActionHistory, game: GameState, action: GameAction, error: RegExp, auth = action.playerId) {
 const before = structuredClone(game), status = game.players.map(p => available(history, game, p.id));
 expect(() => history.apply(game, action, auth)).toThrow(error);
 expect(game).toEqual(before);
 expect(game.players.map(p => available(history, game, p.id))).toEqual(status);
}
function move(history: ActionHistory, game: GameState) {
 game = apply(history, game, begin);
 return apply(history, game, command('PERFORM_MOVEMENT'));
}
function adjacentDestination(game: GameState) {
 return game.board.rooms.find(room => !room.startingFor &&
  areAdjacent(game.players[0].wizard.position, room.tiles[0]))!.tiles[0];
}

describe('private exact snapshot undo/redo', () => {
 it('restores movement, pending effects, action/token cost, turn counters and log exactly', () => {
  const history = new ActionHistory(), initial = fixture();
  const states = [initial];
  const actions: GameAction[] = [begin, command('PERFORM_MOVEMENT'),
   { type:'EXPLORE_STEP', playerId:'p1', destination:{ q:1, r:0 } },
   { type:'EXPLORE_STEP', playerId:'p1', destination:{ q:1, r:-1 } }, command('SKIP_PHYSICAL_EFFECTS')];
  let game = initial;
  for (const action of actions) { game = apply(history, game, action); states.push(structuredClone(game)); }
  expect(game.players[0].actionTokens).toBe(1);
  expect(game.activation?.actionsUsed).toBe(1);
  for (let i = states.length - 2; i >= 0; i--) {
   game = apply(history, game, undo); expect(game).toEqual(states[i]);
  }
  expect(available(history, game)).toEqual({ canUndo:false, canRedo:true, redoLabel:'Begin physical action' });
  for (const state of states.slice(1)) { game = apply(history, game, redo); expect(game).toEqual(state); }
  expect(available(history, game).canRedo).toBe(false);
 });

 it('restores casting, defeat respawn, contributions, cubes, scoring and completed/promoted quests', () => {
  const history = new ActionHistory(), initial = fixture(3);
  prepare(initial, { damage:2, instability:2, target:'MODEL' }, 'slot1');
  const [attacker, victim, contributor] = initial.players;
  victim.wizard.damageCubes = 8; victim.wizard.blackDamage = 1;
  victim.wizard.damageByPlayer = { p1:5, p3:2 };
  attacker.cubes.available -= 5; attacker.cubes.onWizard = 5;
  contributor.cubes.available -= 2; contributor.cubes.onWizard = 2;
  attacker.quest = { id:'kill-quest', name:'Kill quest', description:'Defeat', kind:'KILL', amount:1, reward:3 };
  attacker.additionalQuests = [{ ...attacker.quest, id:'later-quest', kind:'REBUILD' }];
  const room = initial.board.rooms.find(r => r.id === 'room-0,0')!;
  room.instability = 8; room.cubesByPlayer = { p1:8 };
  attacker.cubes.available -= 8; attacker.cubes.onBoard = 8;
  let game = apply(history, initial, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', targetPlayerId:'p2' });
  const after = structuredClone(game);
  expect(game.players[0]).toMatchObject({ kills:1, questsCompleted:2, victoryPoints:11, cubes:{ onWizard:0, onBoard:10 } });
  expect(game.players[0].prepared.slot1?.used).toBe(true);
  expect(game.players[1].wizard).toMatchObject({ damageCubes:0, damageByPlayer:{}, blackDamage:0 });
  expect(game.players[1].wizard.position).not.toEqual(initial.players[1].wizard.position);
  expect(game.players[2].cubes.onWizard).toBe(0);
  expect(game.questDiscard).toHaveLength(2);
  expect(available(history, game).canUndo).toBe(true);
  game = apply(history, game, undo); expect(game).toEqual(initial);
  game = apply(history, game, redo); expect(game).toEqual(after);
 });

 it('restores removed forgotten preparations without changing draws', () => {
  const history = new ActionHistory(), initial = fixture();
  const card = initial.powerfulDeck.shift()!;
  initial.players[0].prepared.rapid = { card, used:false };
  let game = apply(history, initial, { ...cast, ...(card.target === 'MODEL' ? { dummy:true } : {}) });
  const after = structuredClone(game);
  expect(game.removedCards).toContainEqual(card);
  game = apply(history, game, undo); expect(game).toEqual(initial);
  game = apply(history, game, redo); expect(game).toEqual(after);
 });

 it('restores discard-to-leave card routing, movement and cost', () => {
  const history = new ActionHistory(), initial = fixture();
  initial.players[0].wizard.position = { q:3, r:-2 };
  const card = prepare(initial);
  let game = apply(history, initial, { type:'DISCARD_EXIT', playerId:'p1', cardId:card.id, destination:{ q:2, r:-2 } });
  const after = structuredClone(game);
  expect(game.players[0].actionTokens).toBe(2);
  expect(game.library[0].discard).toContainEqual(card);
  game = apply(history, game, undo); expect(game).toEqual(initial);
  game = apply(history, game, redo); expect(game).toEqual(after);
 });

 it('replays UUID summons exactly without rerunning randomness, including stable model numbers', () => {
  const history = new ActionHistory(), initial = fixture();
  const grey = initial.board.rooms.find(r => r.effect === 'SUMMON_CADAVER')!;
  grey.reconstructed = true;
  initial.players[0].wizard.position = { ...grey.tiles[0] };
  let game = apply(history, initial, { type:'EXPLORE', playerId:'p1', activateRoomAtStart:true });
  const after = structuredClone(game), ids = game.evocations.map(e => e.id);
  expect(ids).toHaveLength(2); expect(new Set(ids).size).toBe(2);
  expect(game.evocations.map(e => e.number)).toEqual([1, 2]);
  game = apply(history, game, undo); expect(game).toEqual(initial);
  const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Randomness rerun'); });
  const uuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('UUID rerun'); });
  try { game = apply(history, game, redo); expect(game).toEqual(after); }
  finally { random.mockRestore(); uuid.mockRestore(); }
 });

 it('bounds snapshots, discards oldest entries, and protects snapshots from returned-state mutations', () => {
  expect(() => new ActionHistory(0)).toThrow(RangeError);
  expect(() => new ActionHistory(HISTORY_LIMIT + 1)).toThrow(RangeError);
  const history = new ActionHistory(2);
  let game = fixture();
  game = apply(history, game, begin);
  const earliest = structuredClone(game);
  game = apply(history, game, command('PERFORM_MOVEMENT'));
  game = apply(history, game, { type:'EXPLORE_STEP', playerId:'p1', destination:{ q:1, r:0 } });
  const after = structuredClone(game);
  game.players[0].wizard.position.q = 99; game.log.push('not stored');
  game = apply(history, game, undo); game = apply(history, game, redo); expect(game).toEqual(after);
  game = apply(history, game, undo); game = apply(history, game, undo); expect(game).toEqual(earliest);
  reject(history, game, undo, /No action available/);
 });

 it.each(['ACTION', 'EVOCATION'] as const)('restores %s evocation activation, movement, damage, destruction and handoff', phase => {
  const history = new ActionHistory(), initial = fixture(); initial.phase = phase;
  if (phase === 'EVOCATION') initial.activation = null;
  const model = (id: string, owner: string) => ({ id, playerId:owner, number:1, name:'Cadaver',
   archetype:'UNDEAD' as const, movement:2, attack:2, health:2, passive:'WOUNDED_FURY' as const,
   position:{ q:0, r:0 }, damageCubes:0, damageByPlayer:{}, activated:false });
  initial.evocations = [model('own-model', 'p1'), model('victim-model', 'p2'), model('opponent-model', 'p2')];
  initial.evocations[1].position = { q:1, r:0 };
  const states = [initial]; let game = initial;
  const actions: GameAction[] = [
   { type:'ACTIVATE_EVOCATION', playerId:'p1', evocationId:'own-model' },
   { type:'EVOCATION_STEP', playerId:'p1', destination:{ q:1, r:0 } },
   { type:'EVOCATION_ATTACK', playerId:'p1', targetId:'victim-model' },
  ];
  for (const action of actions) {
   game = apply(history, game, action); states.push(structuredClone(game));
   if (action.type === 'ACTIVATE_EVOCATION') {
    reject(history, game, { type:'EVOCATION_ATTACK', playerId:'p1', targetId:'victim-model' }, /^Target must be in the same room$/);
   }
  }
  expect(game.evocations.map(e => e.id)).not.toContain('victim-model');
  expect(game.players[0].cubes.onEvocations).toBe(0);
  expect(game.players[0].actionTokens).toBe(phase === 'ACTION' ? 1 : 2);
  if (phase === 'EVOCATION') expect(game.currentPlayerId).toBe('p2');
  for (const state of states.slice(0, -1).reverse()) { game = apply(history, game, undo); expect(game).toEqual(state); }
  for (const state of states.slice(1)) { game = apply(history, game, redo); expect(game).toEqual(state); }
 });
});

describe('turn ownership, branching, validation and phase barriers', () => {
 it('allows the last owner to undo/redo after a same-phase handoff, but not the new current player', () => {
  const history = new ActionHistory(); let game = fixture(); prepare(game);
  game = apply(history, game, cast);
  const beforeHandoff = structuredClone(game);
  game = apply(history, game, command('END_ACTIVATION'));
  const after = structuredClone(game);
  expect(game.currentPlayerId).toBe('p2'); expect(available(history, game).canUndo).toBe(true);
  expect(available(history, game, 'p2')).toEqual({ canUndo:false, canRedo:false });
  reject(history, game, command('UNDO_ACTION', 'p2'), /No action available/);
  reject(history, game, undo, /another player/, 'p2');
  game = apply(history, game, undo); expect(game).toEqual(beforeHandoff);
  reject(history, game, command('REDO_ACTION', 'p2'), /No action available/);
  game = apply(history, game, redo); expect(game).toEqual(after);
 });

 it('preserves handoff undo after a failed opponent action, invalidates it only on successful opponent action', () => {
  const history = new ActionHistory(); let game = fixture(); prepare(game);
  game = apply(history, game, cast); game = apply(history, game, command('END_ACTIVATION'));
  reject(history, game, { type:'CAST_SPELL', playerId:'p2', slot:'rapid', roomId:'room-0,0' }, /Spell unavailable/);
  expect(available(history, game).canUndo).toBe(true);
  const opponentBefore = structuredClone(game);
  game = apply(history, game, { ...begin, playerId:'p2' });
  expect(available(history, game)).toEqual({ canUndo:false, canRedo:false });
  reject(history, game, undo, /No action available/);
  game = apply(history, game, command('UNDO_ACTION', 'p2')); expect(game).toEqual(opponentBefore);
  reject(history, game, undo, /No action available/);
 });

 it('keeps failed actions and stale phase commands inert with both undo and redo stacks present', () => {
  const history = new ActionHistory(); let game = move(history, fixture());
  game = apply(history, game, { type:'EXPLORE_STEP', playerId:'p1', destination:{ q:1, r:0 } });
  game = apply(history, game, undo);
  const status = available(history, game); expect(status.canUndo && status.canRedo).toBe(true);
  reject(history, game, { type:'EXPLORE_STEP', playerId:'p1', destination:{ q:99, r:99 } }, /adjacent/);
  reject(history, game, { type:'ADVANCE_PHASE', playerId:'p1', expectedPhase:'CLEANUP', expectedRound:1 }, /Stale phase/);
  reject(history, game, { type:'NOT_A_COMMAND', playerId:'p1' } as unknown as GameAction, /Unknown game action/);
  reject(history, game, command('ACTIVATE_ROOM'), /Finish exploring/);
  expect(available(history, game)).toEqual(status);
 });

 it('clears redo only when a new valid own action branches', () => {
  const history = new ActionHistory(); let game = move(history, fixture());
  game = apply(history, game, { type:'EXPLORE_STEP', playerId:'p1', destination:{ q:1, r:0 } });
  game = apply(history, game, undo);
  game = apply(history, game, { type:'EXPLORE_STEP', playerId:'p1', destination:{ q:0, r:1 } });
  expect(available(history, game)).toMatchObject({ canUndo:true, canRedo:false });
  reject(history, game, redo, /No action available/);
 });

 it('permits automatic handoff undo without refreshing the next player or rerunning the turn', () => {
  const history = new ActionHistory(); const initial = fixture(); prepare(initial);
  initial.activation!.actionsUsed = 1;
  let game = apply(history, initial, cast); const after = structuredClone(game);
  expect(game.currentPlayerId).toBe('p2');
  game = apply(history, game, undo); expect(game).toEqual(initial);
  game = apply(history, game, redo); expect(game).toEqual(after);
 });

 it('clears on phase transition, Cleanup scoring and round advance', () => {
  const history = new ActionHistory(); let game = fixture(); prepare(game);
  game.players.forEach(p => { p.actionTokens = 0; });
  const room = game.board.rooms.find(r => r.id === 'room-0,0')!;
  room.instability = room.instabilityLimit; room.cubesByPlayer = { p1:room.instabilityLimit };
  game.players[0].cubes.onBoard = room.instabilityLimit; game.players[0].cubes.available -= room.instabilityLimit;
  game = apply(history, game, cast);
  expect(game.phase).toBe('CLEANUP'); expect(game.players[0].victoryPoints).toBeGreaterThan(0);
  expect(available(history, game)).toEqual({ canUndo:false, canRedo:false });
  reject(history, game, undo, /No action available/);
  game = apply(history, game, { type:'ADVANCE_PHASE', playerId:'p1', expectedPhase:'CLEANUP', expectedRound:1 });
  expect(game.round).toBe(2); expect(available(history, game).canUndo).toBe(false);
  reject(history, game, redo, /No action available/);
 });

 it.each(['SELECT_STARTING_SCHOOL', 'SET_READY', 'DRAW_STUDY', 'DISCARD_STUDY', 'DISCARD_HAND_LIMIT', 'PREPARE_CARDS', 'DISCARD_QUESTS', 'ADVANCE_PHASE'] as const)(
  'treats successful %s as a barrier even without a phase change', type => {
   const history = new ActionHistory(); let initial = fixture();
   if (type === 'SET_READY') {
    initial.phase = 'LOBBY';
    initial = apply(history, initial, { type:'SELECT_STARTING_SCHOOL', playerId:'p1', schoolId:initial.library[0].id });
    initial.phase = 'ACTION';
   }
   let game = apply(history, initial, begin);
   expect(available(history, game).canUndo).toBe(true);
   let action: GameAction;
   switch (type) {
    case 'SELECT_STARTING_SCHOOL':
     game.phase = 'LOBBY'; action = { type, playerId:'p1', schoolId:game.library[0].id }; break;
    case 'SET_READY':
     game.phase = 'LOBBY';
     action = { type, playerId:'p1', ready:true }; break;
    case 'DRAW_STUDY': game.phase = 'STUDY'; action = { type, playerId:'p1', deckId:game.library[0].id }; break;
    case 'DISCARD_STUDY':
     game.phase = 'STUDY'; game.players[0].studyDrawn = true;
    game.players[0].hand = game.players[0].personalDeck.splice(0, 4);
     action = { type, playerId:'p1', cardIds:game.players[0].hand.slice(0, 2).map(c => c.id) }; break;
    case 'DISCARD_HAND_LIMIT':
     game.phase = 'PREPARATION'; game.players[0].hand = game.players[0].personalDeck.splice(0, 8);
     action = { type, playerId:'p1', cardIds:[game.players[0].hand[0].id] }; break;
    case 'PREPARE_CARDS':
     game.phase = 'PREPARATION'; game.players[0].hand = game.players[0].personalDeck.splice(0, 4);
     action = { type, playerId:'p1', rapidCardId:game.players[0].hand[0].id, preparedCardIds:game.players[0].hand.slice(1).map(c => c.id) }; break;
    case 'DISCARD_QUESTS':
     game.phase = 'BLACK_ROSE'; game.blackRoseResolved = true;
     game.players[0].quest = game.questDeck.shift()!;
     game.players[0].additionalQuests = game.questDeck.splice(0, 2);
     action = { type, playerId:'p1', questIds:[game.players[0].quest.id] }; break;
    case 'ADVANCE_PHASE':
     game.phase = 'BLACK_ROSE'; action = { type, playerId:'p1', expectedPhase:game.phase, expectedRound:game.round }; break;
   }
   game = apply(history, game, action);
   expect(available(history, game)).toEqual({ canUndo:false, canRedo:false });
   reject(history, game, undo, /No action available/);
  });

 it('enforces connection and pause checks, and clearing on disconnect prevents restoration after reconnect', () => {
  const history = new ActionHistory(); let game = apply(history, fixture(), begin);
  game.players[1].connected = false;
  expect(available(history, game)).toEqual({ canUndo:false, canRedo:false });
  reject(history, game, undo, /paused/);
  reject(history, game, command('UNDO_ACTION', 'p2'), /Join a room/);
  history.clear(); game.players[1].connected = true;
  reject(history, game, undo, /No action available/);
  reject(history, game, redo, /No action available/);
 });
});

const drawEffects: RoomEffect[] = ['DRAW_POWERFUL', 'DRAW_GRIMOIRE', 'DRAW_DISCARD', 'DRAW_QUEST'];
const drawModes = ['ACTIVATE_ROOM', 'EXPLORE', 'END_EXPLORE', 'EXPLORE_STEP', 'PUNCH_START', 'PUNCH_END'] as const;
function drawFixture(effect: RoomEffect, empty: boolean) {
 const game = fixture();
 const room = game.board.rooms.find(r => r.effect === effect)!;
 game.players.forEach(p => { p.wizard.position = { ...room.tiles[0] }; });
 if (effect === 'DRAW_DISCARD' && !empty) game.players[0].discard.push(...game.players[0].personalDeck.splice(0, 2));
 if (empty) {
  game.players[0].personalDeck = []; game.players[0].discard = [];
  game.powerfulDeck = []; game.questDeck = []; game.questDiscard = [];
 }
 return { game, room };
}

describe('hidden information barriers', () => {
 for (const effect of drawEffects) for (const empty of [false, true]) {
  it.each(drawModes)(`${effect}, ${empty ? 'empty' : 'populated'} source, %s clears all earlier history`, mode => {
   const history = new ActionHistory(); let { game, room } = drawFixture(effect, empty);
   // Establish real pre-draw history (including handoff undo/redo paths).
   let action: GameAction;
   if (mode === 'ACTIVATE_ROOM') {
    game = apply(history, game, begin); action = command('ACTIVATE_ROOM');
   } else if (mode === 'EXPLORE') {
    prepare(game); game = apply(history, game, { ...cast, roomId:room.id });
    action = { type:'EXPLORE', playerId:'p1', activateRoomAtStart:true };
   } else if (mode === 'PUNCH_START' || mode === 'PUNCH_END') {
    prepare(game); game = apply(history, game, { ...cast, roomId:room.id });
    action = { type:'PUNCH', playerId:'p1', targetId:'p2', roomEffect:mode === 'PUNCH_START' ? 'START' : 'END' };
   } else {
    game = apply(history, game, command('EXPLORE'));
    if (mode === 'END_EXPLORE') action = { type:'END_EXPLORE', playerId:'p1', activateRoomAtEnd:true };
    else {
     // Move from a different room onto the draw room on the final step.
      const adjacent = adjacentDestination(game);
     game = apply(history, game, { type:'EXPLORE_STEP', playerId:'p1', destination:adjacent });
     action = { type:'EXPLORE_STEP', playerId:'p1', destination:{ ...room.tiles[0] }, activateRoomAtEnd:true };
    }
   }
   expect(available(history, game).canUndo).toBe(true);
   game = apply(history, game, action);
   expect(available(history, game)).toEqual({ canUndo:false, canRedo:false });
   reject(history, game, undo, /No action available/);
   reject(history, game, redo, /No action available/);
  });
 }

 it('can undo movement after a draw, but cannot undo or replay the draw itself', () => {
  const history = new ActionHistory(); let { game } = drawFixture('DRAW_POWERFUL', false);
  game = apply(history, game, { type:'EXPLORE', playerId:'p1', activateRoomAtStart:true });
  const afterDraw = structuredClone(game), card = game.players[0].hand[0];
  game = apply(history, game, { type:'EXPLORE_STEP', playerId:'p1', destination:{ q:1, r:0 } });
  const afterMove = structuredClone(game);
  game = apply(history, game, undo); expect(game).toEqual(afterDraw);
  expect(game.players[0].hand[0]).toEqual(card);
  reject(history, game, undo, /No action available/);
  game = apply(history, game, redo); expect(game).toEqual(afterMove);
 });

 it('can undo movement following ACTIVATE_ROOM draw with modern physical menus', () => {
  const history = new ActionHistory(); let { game } = drawFixture('DRAW_QUEST', false);
  game = apply(history, game, begin); game = apply(history, game, command('ACTIVATE_ROOM'));
  const afterDraw = structuredClone(game);
  game = apply(history, game, command('PERFORM_MOVEMENT'));
  game = apply(history, game, { type:'EXPLORE_STEP', playerId:'p1', destination:adjacentDestination(game) });
  game = apply(history, game, undo); game = apply(history, game, undo);
  expect(game).toEqual(afterDraw); reject(history, game, undo, /No action available/);
 });

 it('does not treat merely passing through or entering a draw room as a draw', () => {
  const history = new ActionHistory(); let game = fixture();
  game.players[0].wizard.position = { q:1, r:0 };
  game = apply(history, game, command('EXPLORE'));
  const before = structuredClone(game);
  game = apply(history, game, { type:'EXPLORE_STEP', playerId:'p1', destination:{ q:0, r:0 }, activateRoomAtEnd:true });
  // Not the final movement step: the legacy flag has not activated anything.
  expect(game.players[0].hand).toHaveLength(0);
  expect(available(history, game).canUndo).toBe(true);
  game = apply(history, game, undo); expect(game).toEqual(before);
 });

});

describe('public projection and private storage', () => {
 it('exposes only per-viewer availability/labels, never private snapshots or future cards', () => {
  const history = new ActionHistory(); let game = fixture(); prepare(game);
  game.players[0].hand.push(game.players[0].personalDeck.shift()!);
  game.players[1].hand.push(game.players[1].personalDeck.shift()!);
  game.players[0].quest = game.questDeck.shift()!;
  game.players[1].quest = game.questDeck.shift()!;
  const hiddenIds = [...game.eventDeck, ...game.questDeck, ...game.powerfulDeck,
   ...game.library.flatMap(d => d.cards), ...game.players.flatMap(p => p.personalDeck)].map(c => c.id);
  game = apply(history, game, cast); game = apply(history, game, command('END_ACTIVATION'));
  const authoritative = structuredClone(game);
  const payload = publicState(game, 'p1', history);
  expect(payload.history).toEqual({ canUndo:true, canRedo:false, undoLabel:'End turn' });
  expect(publicState(game, 'p2', history).history).toEqual({ canUndo:false, canRedo:false });
  expect(publicState(game, null, history).history).toEqual({ canUndo:false, canRedo:false });
  const json = JSON.stringify({ type:'STATE', state:payload });
  for (const id of hiddenIds) expect(json).not.toContain(`"${id}"`);
  expect(json).not.toContain(game.players[1].hand[0].id);
  expect(json).not.toContain(game.players[1].quest!.id);
  expect(Object.keys(payload).sort()).toEqual([...Object.keys(game), 'history'].sort());
  expect(Object.keys(payload.history!).sort()).toEqual(['canRedo', 'canUndo', 'undoLabel']);
  for (const key of ['before', 'after', 'snapshots', 'undoStack', 'redoStack', 'owner']) expect(json).not.toContain(`"${key}":`);
  expect(JSON.stringify(history)).toBe('{}'); expect(Object.keys(history)).toEqual([]);
  expect(game).toEqual(authoritative); expect(game.history).toBeUndefined();
  payload.players[0].victoryPoints = 999;
  expect(game.players[0].victoryPoints).not.toBe(999);
 });

 it('never trusts or restores stale history metadata supplied in game snapshots', () => {
  const history = new ActionHistory(); let game = fixture();
  game.history = { canUndo:true, canRedo:true, undoLabel:'untrusted' };
  expect(publicState(game, 'p1', history).history).toEqual({ canUndo:false, canRedo:false });
  game = apply(history, game, begin); expect(game.history).toBeUndefined();
  game = apply(history, game, undo); expect(game.history).toBeUndefined();
 });
});