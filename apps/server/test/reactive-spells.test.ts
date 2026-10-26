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
 it('publishes only active types on whole masked adversarial instances, with public ongoing cards', () => {
  const history = new ActionHistory(); let game = fixture(); evoc(game, 'p1');
  game = arm(game, 'Threshold Snare', 'p1', { roomId:east });
  game = arm(game, "Servant's Safeguard", 'p2', { targetEvocationId:'p1-servant' });
  game = arm(game, 'Mending Ward', 'p1', { targetPlayerId:'p2-wizard' });
  game = arm(game, 'Hearth Ward', 'p2', { roomId:center });
  game = arm(game, 'Runic Remedy', 'p1', { targetPlayerId:'p1' });
  game = arm(game, 'Thorned Path', 'p2', { targetPlayerId:'p1' });
  for (const p of game.players) {
    p.personalDeck.push(...game.library[0].cards.splice(0, 2));
   p.hand.push(p.personalDeck.shift()!); p.quest = game.questDeck.shift()!;
   p.additionalQuests.push(game.questDeck.shift()!);
  }
  prepare(game, 'Renewing Word', 'p1'); prepare(game, 'Mending Light', 'p2');
  for (const active of game.readiedSpells!) Object.assign(active, {
    name:`private-${active.id}`, schoolId:'private-school', spellType:'COMBAT',
   trigger:active.card.trigger, triggerEffects:active.card.triggerEffects,
   payload:{ targetPlayerId:'private-mage', targetEvocationId:'private-model', roomId:'private-room',
    nested:{ card:active.card, trigger:active.card.trigger } },
  });
  const cards = physicalCards(game), before = structuredClone(game);
  privacy(game, history); conserved(game, cards);
  for (const viewer of ['p1', 'p2', null]) {
   const projected = publicState(game, viewer, history), json = JSON.stringify(projected);
   const opponents = projected.readiedSpells!.filter(active => active.playerId !== viewer);
   for (const active of opponents) expect(Object.keys(active).sort()).toEqual(['card', 'id', 'playerId']);
  expect(JSON.stringify(opponents)).not.toMatch(/private-|trigger|schoolId|targetPlayerId|targetEvocationId|roomId|rulesText/);
  for (const active of opponents) {
   const actual = game.readiedSpells!.find(a => a.id === active.id)!;
   expect(active.card).toEqual({ ...hidden(game.readiedSpells!.indexOf(actual)), spellType:actual.card.spellType });
   expect(['TRAP', 'PROTECTION']).toContain(active.card.spellType);
  }
   for (const active of game.readiedSpells!.filter(a => a.playerId !== viewer)) expect(json).not.toContain(`private-${active.id}`);
   // Active ordering contains only instance UUIDs, not physical IDs or bindings.
   expect(projected.activeSpellOrder).toEqual([...game.readiedSpells!, ...game.ongoingSpells!].map(a => a.id));
   for (const id of projected.activeSpellOrder!) expect(id).toMatch(/^[0-9a-f-]{36}$/);
   projected.readiedSpells![0].card.name = 'mutated';
   projected.ongoingSpells![0].card.ongoing!.effects[0].amount = 999;
   const own = projected.readiedSpells!.find(a => a.playerId === viewer);
   if (own) { own.roomId = 'mutated'; own.card.triggerEffects![0].amount = 999; }
  }
  expect(game).toEqual(before);
 });

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
describe('secret arming snapshots', () => {
 it.each(readiness)('undoes/redoes $name with the exact same UUID, binding, payment and private payload', ({ name, selection }) => {
  const initial = fixture(), history = new ActionHistory(); evoc(initial);
  const card = prepare(initial, name, 'p1', 'slot1'), cards = physicalCards(initial), before = structuredClone(initial);
  let game = apply(history, initial, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', ...selection });
  const after = structuredClone(game), active = game.readiedSpells![0];
  expect(initial).toEqual(before); expect(game.readiedSpells).toHaveLength(1); expect(active.card).toEqual(card);
  expect(active.id).toMatch(/^[0-9a-f-]{36}$/); expect(active.id).not.toBe(card.id);
  expect(game.activeSpellOrder).toEqual([active.id]);
  expect(game.activation).toMatchObject({ actionsUsed:1, spellsCast:1, sequencedSpellUsed:true });
  expect(player(game).actionTokens).toBe(2); expect(player(game).prepared.slot1).toEqual({ card, used:true });
  expect(game.library.find(d => d.id === 'enchantment')!.discard).toEqual([]);
  expect(game.log.at(-1)).toBe(`${player(game).name} activates a hidden spell for 1 action (no physical token).`);
  expect(game.log.join('\n')).not.toMatch(new RegExp(`${card.name}|${card.id}|${active.id}|${active.roomId}`));
  expect(history.status(game, 'p1')).toEqual({ canUndo:true, canRedo:false, undoLabel:'Cast spell' });
  privacy(game, history); conserved(game, cards);
  game = undo(history, game); expect(game).toEqual(initial); privacy(game, history); conserved(game, cards);
  const uuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('UUID regenerated'); });
  const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Randomness rerun'); });
  try { game = redo(history, game); } finally { uuid.mockRestore(); random.mockRestore(); }
  expect(game).toEqual(after); expect(game.readiedSpells![0].id).toBe(active.id);
  privacy(game, history); conserved(game, cards);
 });
});

describe('reveals and expiry are irreversible information barriers', () => {
 it('returns untriggered readied cards privately at Cleanup, discards ongoing cards and cannot undo either expiry', () => {
  const history = new ActionHistory(); let game = arm(fixture(), 'Threshold Snare', 'p1', { roomId:east });
  game = arm(game, 'Mending Ward', 'p2', { targetPlayerId:'p2' });
  game = arm(game, "Pilgrim's Mark", 'p1', {}); turn(game);
  prepare(game, 'Renewing Word', 'p1', 'slot1');
  const readied = structuredClone(game.readiedSpells!), ongoing = game.ongoingSpells![0], cards = physicalCards(game);
  const feedback = structuredClone(game.feedbackEvents);
  for (const p of game.players) p.actionTokens = 0;
  game = apply(history, game, { type:'CAST_SPELL', playerId:'p1', slot:'slot1', targetPlayerId:'p1' });
  expect(game.phase).toBe('CLEANUP');
  expect(game.readiedSpells).toEqual([]); expect(game.ongoingSpells).toEqual([]); expect(game.activeSpellOrder).toEqual([]);
  expect(game.feedbackEvents).toEqual(feedback);
  expect(game.library[2].discard).toEqual([ongoing.card]);
  for (const p of game.players) expect(p.hand).toEqual(readied.filter(a => a.playerId === p.id).map(a => a.card));
  conserved(game, cards); barrier(game, history);
  for (const viewer of ['p1', 'p2', null]) {
   const visible = publicState(game, viewer, history);
   for (const p of visible.players) expect(p.hand).toEqual(p.id === viewer
    ? player(game, p.id).hand : player(game, p.id).hand.map((_, i) => hidden(i)));
  }
  const hands = game.players.map(p => p.hand);
  game = apply(history, game, { type:'ADVANCE_PHASE', playerId:'p1', expectedPhase:'CLEANUP', expectedRound:1 });
  expect(game.players.map(p => p.hand)).toEqual(hands); // No second return at Pink Tulip.
  expect(game.players.every(p => p.studyCardIds?.length === 0)).toBe(true);
  conserved(game, cards); barrier(game, history);
 });

 it('clears both stacks on enemy entry, publishes only the completed interrupt, and allows only post-reveal undo', () => {
  const history = new ActionHistory(); let game = arm(fixture(), 'Threshold Snare', 'p1', { roomId:east });
  turn(game, 'p2'); const cards = physicalCards(game), active = structuredClone(game.readiedSpells![0]);
  game = apply(history, game, { type:'EXPLORE', playerId:'p2' });
  game = apply(history, game, { type:'EXPLORE_STEP', playerId:'p2', destination:{ q:-1, r:0 } });
  game = undo(history, game, 'p2'); expect(history.status(game, 'p2')).toMatchObject({ canUndo:true, canRedo:true });
  const before = structuredClone(game); privacy(game, history);
  game = apply(history, game, { type:'EXPLORE_STEP', playerId:'p2', destination:{ q:1, r:0 } });
  expect(before.readiedSpells).toEqual([active]); expect(game.readiedSpells).toEqual([]); expect(game.activeSpellOrder).toEqual([]);
  expect(player(game, 'p2').wizard).toMatchObject({ damageCubes:2, damageByPlayer:{ p1:2 }, position:{ q:1, r:0 } });
  expect(game.activation).toMatchObject({ actionsUsed:1, spellsCast:0, exploring:1 });
  expect(player(game, 'p2').actionTokens).toBe(1);
  expect(game.log.slice(-4).join('\n')).toMatch(/reveals Threshold Snare[\s\S]*suffers 2[\s\S]*Resume ENTER_ROOM/);
  for (const viewer of ['p1', 'p2', null]) expect(publicState(game, viewer, history).library[2].discard).toEqual([active.card]);
  conserved(game, cards); barrier(game, history);
  const afterReveal = structuredClone(game);
  game = apply(history, game, { type:'EXPLORE_STEP', playerId:'p2', destination:{ q:0, r:0 } });
  const afterMove = structuredClone(game);
  game = undo(history, game, 'p2'); expect(game).toEqual(afterReveal); barrier(game, new ActionHistory());
  expect(() => undo(history, game, 'p2')).toThrow(/No action available/);
  game = redo(history, game, 'p2'); expect(game).toEqual(afterMove); conserved(game, cards); privacy(game, history);
 });

 it.each(['p1', 'p2'])('blocks attack undo when the revealed protection belongs to %s', owner => {
  const history = new ActionHistory(); let game = arm(fixture(), 'Mending Ward', owner, { targetPlayerId:'p2' });
  turn(game); const cards = physicalCards(game), active = game.readiedSpells![0];
  game = pendingAttack(history, game); const before = structuredClone(game); privacy(game, history);
  game = apply(history, game, { type:'INFLICT_ATTACK', playerId:'p1', targetId:'p2' });
  expect(before.readiedSpells).toEqual([active]); expect(game.readiedSpells).toEqual([]);
  expect(player(game, 'p2').wizard).toMatchObject({ damageCubes:0, damageByPlayer:{} });
  expect(game.library[2].discard).toEqual([active.card]);
  expect(game.log.join('\n')).toMatch(/reveals Mending Ward[\s\S]*Healing removes 2[\s\S]*Resume DAMAGE_TAKEN/);
  expect(game.activation).toMatchObject({ actionsUsed:1, physicalAction:{ kind:'ATTACK', mainEffectUsed:true } });
  expect(player(game).actionTokens).toBe(1); conserved(game, cards); barrier(game, history);
 });

 for (const owner of ['p1', 'p2']) it.each(['MAGE', 'EVOCATION'] as const)(`blocks %s expiry undo even without a fired trigger (hidden owner ${owner})`, kind => {
  const history = new ActionHistory(); let game = fixture();
  const target = kind === 'MAGE' ? 'p2' : evoc(game, 'p2', 2).id;
  if (kind === 'MAGE') player(game, target).wizard.health = 2;
  game = arm(game, kind === 'MAGE' ? 'Mending Ward' : "Servant's Safeguard", owner,
   kind === 'MAGE' ? { targetPlayerId:target } : { targetEvocationId:target });
  turn(game); const cards = physicalCards(game), active = game.readiedSpells![0];
  game = pendingAttack(history, game); privacy(game, history);
  game = apply(history, game, { type:'INFLICT_ATTACK', playerId:'p1', targetId:target });
  expect(game.readiedSpells).toEqual([]); expect(game.activeSpellOrder).toEqual([]);
  expect(game.library[2].discard).toEqual([active.card]);
  expect(game.log).toContain(`${active.card.name} expires with its bound model.`);
  expect(game.log.some(line => line.startsWith('Interrupt '))).toBe(false);
  if (kind === 'MAGE') {
   expect(player(game, target).wizard).toMatchObject({ damageCubes:0, damageByPlayer:{} });
   expect(player(game, target).wizard.position).not.toEqual({ q:0, r:0 }); expect(player(game).kills).toBe(1);
  } else { expect(game.evocations).toEqual([]); expect(player(game).kills).toBe(0); }
  conserved(game, cards); barrier(game, history);
 });

 it('resolves nested protections depth-first as one root action, then never restores either revealed card', () => {
  const history = new ActionHistory(); let game = arm(fixture(), 'Thorn Retort', 'p1', {});
  game = arm(game, 'Thorn Retort', 'p2', {}); turn(game);
  const cards = physicalCards(game), readied = structuredClone(game.readiedSpells!);
  game = pendingAttack(history, game); const before = structuredClone(game);
  game = apply(history, game, { type:'INFLICT_ATTACK', playerId:'p1', targetId:'p2' });
  expect(before.readiedSpells).toEqual(readied); expect(game.readiedSpells).toEqual([]);
  expect(game.log.filter(line => /^(Interrupt|Resume)/.test(line))).toEqual([
   `Interrupt DAMAGE_TAKEN: ${player(game, 'p2').name} reveals Thorn Retort.`,
   `Interrupt DAMAGE_TAKEN: ${player(game).name} reveals Thorn Retort.`,
   'Resume DAMAGE_TAKEN after Thorn Retort.', 'Resume DAMAGE_TAKEN after Thorn Retort.',
  ]);
  expect(game.players.map(p => p.wizard.damageCubes)).toEqual([0, 2]);
  expect(game.library[2].discard.map(card => card.id).sort()).toEqual(readied.map(a => a.card.id).sort());
  expect(game.activeSpellOrder).toEqual([]); expect(player(game).actionTokens).toBe(1);
  expect(game.activation).toMatchObject({ actionsUsed:1, spellsCast:0 });
  conserved(game, cards); barrier(game, history);
  const completed = structuredClone(game);
  game = apply(history, game, { type:'SKIP_PHYSICAL_EFFECTS', playerId:'p1' });
  game = undo(history, game); expect(game).toEqual(completed); expect(() => undo(history, game)).toThrow(/No action available/);
 });
});

describe('public ongoing snapshots and normal information barriers', () => {
 it.each([
  { name:"Pilgrim's Mark", selection:{}, wounds:[2, 2] },
  { name:'Thorned Path', selection:{ targetPlayerId:'p2' }, wounds:[2, 2] },
  { name:'Runic Remedy', selection:{ targetPlayerId:'p1' }, wounds:[1, 2] },
  { name:'Arcane Feedback', selection:{ targetPlayerId:'p2' }, wounds:[2, 3] },
 ])('restores the complete physical supply, base effects and public binding for $name', ({ name, selection, wounds }) => {
  const initial = fixture(), history = new ActionHistory();
  Object.assign(player(initial).wizard, { damageCubes:2, damageByPlayer:{ p2:2 } });
  Object.assign(player(initial, 'p2').wizard, { damageCubes:2, damageByPlayer:{ [BLACK_ROSE_ID]:2 } }); syncCubes(initial);
  const card = prepare(initial, name), cards = physicalCards(initial), before = structuredClone(initial);
  let game = apply(history, initial, { type:'CAST_SPELL', playerId:'p1', slot:'rapid', ...selection });
  const after = structuredClone(game);
  expect(initial).toEqual(before); expect(game.players.map(p => p.wizard.damageCubes)).toEqual(wounds);
  if (name === 'Thorned Path') expect(player(game, 'p2').wizard.damageByPlayer).toEqual({ p1:1, [BLACK_ROSE_ID]:1 });
  expect(game.ongoingSpells).toHaveLength(1); expect(game.ongoingSpells![0].card).toEqual(card);
  expect(game.readiedSpells).toEqual([]); expect(game.library[2].discard).toEqual([]);
  expect(game.activeSpellOrder).toEqual([game.ongoingSpells![0].id]);
  expect(game.activation).toMatchObject({ actionsUsed:1, spellsCast:1 }); expect(player(game).actionTokens).toBe(2);
  expect(history.status(game, 'p1').canUndo).toBe(true); conserved(game, cards); privacy(game, history);
  game = undo(history, game); expect(game).toEqual(initial); conserved(game, cards); privacy(game, history);
  const uuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('UUID regenerated'); });
  try { game = redo(history, game); } finally { uuid.mockRestore(); }
  expect(game).toEqual(after); conserved(game, cards); privacy(game, history);
 });

 it('commits own-target Thorned Path and its ongoing binding even though base damage conversion is ignored', () => {
  const initial = fixture(), history = new ActionHistory();
  Object.assign(player(initial).wizard, { damageCubes:4, blackDamage:1, damageByPlayer:{ p2:2, [BLACK_ROSE_ID]:1 } });
  syncCubes(initial);
  const card = prepare(initial, 'Thorned Path'), cards = physicalCards(initial), before = structuredClone(initial);
  let game = apply(history, initial, { type:'CAST_SPELL', playerId:'p1', slot:'rapid', targetPlayerId:'p1-wizard' });
  const afterCast = structuredClone(game), active = game.ongoingSpells![0];
  expect(initial).toEqual(before); expect(game.players.map(p => p.wizard)).toEqual(before.players.map(p => p.wizard));
  expect(game.players.map(p => p.cubes)).toEqual(before.players.map(p => p.cubes));
  expect(game.board).toEqual(before.board); expect(game.feedbackEvents).toEqual(before.feedbackEvents);
  expect(game.ongoingSpells).toEqual([{ id:expect.any(String), playerId:'p1', card, targetPlayerId:'p1', roomId:center }]);
  expect(game.activeSpellOrder).toEqual([active.id]); expect(game.readiedSpells).toEqual([]);
  expect(game.library[2].discard).toEqual([]); expect(player(game).prepared.rapid).toEqual({ card, used:true });
  expect(game.activation).toMatchObject({ actionsUsed:1, spellsCast:1 }); expect(player(game).actionTokens).toBe(2);
  conserved(game, cards); privacy(game, history);
  game = undo(history, game); expect(game).toEqual(before); conserved(game, cards); privacy(game, history);
  const uuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('UUID regenerated'); });
  try { game = redo(history, game); } finally { uuid.mockRestore(); }
  expect(game).toEqual(afterCast); conserved(game, cards); privacy(game, history);
  game = apply(history, game, { type:'BEGIN_PHYSICAL_ACTION', playerId:'p1', kind:'EXPLORE' });
  game = apply(history, game, { type:'PERFORM_MOVEMENT', playerId:'p1' });
  const beforeEntry = structuredClone(game);
  game = apply(history, game, { type:'EXPLORE_STEP', playerId:'p1', destination:{ q:1, r:0 } });
  const afterEntry = structuredClone(game);
  expect(room(game, east)).toMatchObject({ instability:1, cubesByPlayer:{ p1:1 } });
  expect(game.ongoingSpells).toEqual(afterCast.ongoingSpells);
  expect(player(game).wizard.damageByPlayer).toEqual(before.players[0].wizard.damageByPlayer);
  expect((game.feedbackEvents ?? []).map(event => event.kind)).toEqual(['SPELL_TRIGGERED']);
  conserved(game, cards); privacy(game, history);
  game = undo(history, game); expect(game).toEqual(beforeEntry); conserved(game, cards);
  game = redo(history, game); expect(game).toEqual(afterEntry); conserved(game, cards); privacy(game, history);
 });

 it('undoes/redoes ongoing entry conversion, movement, pending effects, turn counters and cross-zone chronology exactly', () => {
  const initial = fixture(), history = new ActionHistory();
  Object.assign(room(initial, east), { instability:3, cubesByPlayer:{ p2:2, [BLACK_ROSE_ID]:1 } }); syncCubes(initial);
  prepare(initial, "Pilgrim's Mark"); const cards = physicalCards(initial), states = [structuredClone(initial)];
  let game = initial;
  const actions: GameAction[] = [
   { type:'CAST_SPELL', playerId:'p1', slot:'rapid' },
   { type:'BEGIN_PHYSICAL_ACTION', playerId:'p1', kind:'EXPLORE' },
   { type:'PERFORM_MOVEMENT', playerId:'p1' },
   { type:'EXPLORE_STEP', playerId:'p1', destination:{ q:1, r:0 } },
  ];
  for (const action of actions) {
   game = apply(history, game, action); states.push(structuredClone(game)); conserved(game, cards); privacy(game, history);
  }
  expect(room(game, east)).toMatchObject({ instability:3, cubesByPlayer:{ p1:1, p2:1, [BLACK_ROSE_ID]:1 } });
  expect(game.players.map(p => p.cubes.onBoard)).toEqual([1, 1]);
  expect(game.activation).toMatchObject({ actionsUsed:2, spellsCast:1, exploring:1 });
  expect(player(game).actionTokens).toBe(1); expect(game.ongoingSpells).toEqual(states[1].ongoingSpells);
  for (const state of states.slice(0, -1).reverse()) {
   game = undo(history, game); expect(game).toEqual(state); conserved(game, cards); privacy(game, history);
  }
  for (const state of states.slice(1)) {
   game = redo(history, game); expect(game).toEqual(state); conserved(game, cards); privacy(game, history);
  }
 });

 it('allows undo/redo of public ongoing expiry on model death when no hidden spell was revealed', () => {
  const history = new ActionHistory(), initial = fixture(); player(initial, 'p2').wizard.health = 3;
  prepare(initial, 'Arcane Feedback'); const cards = physicalCards(initial);
  let game = apply(history, initial, { type:'CAST_SPELL', playerId:'p1', slot:'rapid', targetPlayerId:'p2' });
  const beforeDeath = structuredClone(game), active = game.ongoingSpells![0];
  game = apply(history, game, { type:'PUNCH', playerId:'p1', targetId:'p2' }); const after = structuredClone(game);
  expect(game.ongoingSpells).toEqual([]); expect(game.activeSpellOrder).toEqual([]);
  expect(game.library[2].discard).toEqual([active.card]); expect(player(game).kills).toBe(1);
  expect(game.currentPlayerId).toBe('p2'); expect(history.status(game, 'p1').canUndo).toBe(true);
  conserved(game, cards); privacy(game, history);
  game = undo(history, game); expect(game).toEqual(beforeDeath); conserved(game, cards); privacy(game, history);
  game = redo(history, game); expect(game).toEqual(after); conserved(game, cards); privacy(game, history);
 });

 it.each(['DRAW', 'PHASE'] as const)('keeps the existing %s barrier even with an active public ongoing spell', mode => {
  const history = new ActionHistory(), initial = fixture(); prepare(initial, "Pilgrim's Mark");
  if (mode === 'PHASE') for (const p of initial.players) p.actionTokens = 0;
  const cards = physicalCards(initial);
  let game = apply(history, initial, { type:'CAST_SPELL', playerId:'p1', slot:'rapid' });
  if (mode === 'DRAW') {
   expect(history.status(game, 'p1').canUndo).toBe(true);
   game = apply(history, game, { type:'EXPLORE', playerId:'p1', activateRoomAtStart:true });
   expect(player(game).hand).toHaveLength(1); expect(player(game).hand[0].powerful).toBe(true);
   expect(game.ongoingSpells).toHaveLength(1);
  } else {
   expect(game.phase).toBe('CLEANUP'); expect(game.ongoingSpells).toEqual([]);
   expect(game.activeSpellOrder).toEqual([]);
   expect(game.library[2].discard.some(c => c.name === "Pilgrim's Mark")).toBe(true);
  }
  conserved(game, cards); barrier(game, history);
 });

 it('preserves both history stacks and every supply/log entry when nested resolution aborts atomically', () => {
  const history = new ActionHistory(); let game = fixture();
  for (const id of ['p1', 'p2']) {
   player(game, id).wizard.health = 1000;
   const card = prepare(game, "Pilgrim's Mark", id);
   card.ongoing = { trigger:{ event:'DAMAGE_TAKEN', relation:'ANY', scope:'BOUND_MODEL' },
    effects:[{ effect:'DAMAGE', amount:1, target:'EVENT_ACTOR' }] };
   turn(game, id); game = applyAction(game, { type:'CAST_SPELL', playerId:id, slot:'rapid' });
  }
  turn(game); const cards = physicalCards(game); game = pendingAttack(history, game);
  const before = structuredClone(game), status = history.status(game, 'p1');
  const wireBefore = ['p1', 'p2', null].map(viewer => JSON.stringify(publicState(game, viewer, history)));
  expect(() => apply(history, game, { type:'INFLICT_ATTACK', playerId:'p1', targetId:'p2' })).toThrow(/resolution limit exceeded \(128\)/);
  expect(game).toEqual(before); expect(history.status(game, 'p1')).toEqual(status);
  expect(['p1', 'p2', null].map(viewer => JSON.stringify(publicState(game, viewer, history)))).toEqual(wireBefore);
  conserved(game, cards); privacy(game, history);
  game = redo(history, game); expect(game.activation!.physicalAction).toBeNull();
  game = undo(history, game); expect(game).toEqual(before);
 });
});