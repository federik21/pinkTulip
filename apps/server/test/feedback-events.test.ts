import { describe, expect, it, vi } from 'vitest';
import { applyAction, BLACK_ROSE_ID, createGame, FEEDBACK_EVENT_LIMIT } from '@brw/game-engine';
import type { Card, Evocation, GameAction, GameFeedbackEvent, GameState, Player } from '@brw/game-engine';
import { ActionHistory } from '../src/action-history';
import { publicState } from '../src/public-state';

type Cast = Extract<GameAction, { type:'CAST_SPELL' }>;
type Selection = Omit<Cast, 'type' | 'playerId' | 'slot'>;
const center = 'room-0,0', east = 'room-1,0';
const viewers = ['p1', 'p2', 'p3', 'p4', null];
const player = (s:GameState, id = 'p1') => s.players.find(p => p.id === id)!;
const events = (s:GameState) => s.feedbackEvents ?? [];
const disabled = { canUndo:false, canRedo:false };
function turn(s:GameState, id = 'p1') {
 s.phase = 'ACTION'; s.currentPlayerId = id; s.evocationActivation = null;
 s.activation = { playerId:id, actionsUsed:0, exploring:0, sequencedSpellUsed:false, spellsCast:0, discardedExit:false, roomEffectUsed:false };
}
function fixture() {
 const s = createGame(4); s.round = 1; s.firstPlayerId = 'p1'; turn(s);
 for (const p of s.players) { p.connected = true; p.wizard.position = { q:0, r:0 }; }
 return s;
}
function take(s:GameState, name:string) {
 for (const deck of s.library) {
  const i = deck.cards.findIndex(c => c.name === name);
  if (i >= 0) return deck.cards.splice(i, 1)[0];
 }
 throw new Error(`Missing physical spell ${name}`);
}
function prepare(s:GameState, card:Card|string, id = 'p1', slot:keyof Player['prepared'] = 'rapid') {
 const spell = typeof card === 'string' ? take(s, card) : card;
 player(s, id).prepared[slot] = { card:spell, used:false }; return spell;
}
function arm(s:GameState, name:string, id:string, selection:Selection) {
 turn(s, id); prepare(s, name, id);
 return applyAction(s, { type:'CAST_SPELL', playerId:id, slot:'rapid', ...selection });
}
function evoc(s:GameState, health = 4):Evocation {
 const e:Evocation = { id:'actual-evocation-id', playerId:'p2', number:1, name:'Cadaver', archetype:'UNDEAD', movement:2, attack:2, health, passive:'WOUNDED_FURY', position:{ q:0, r:0 }, damageCubes:0, damageByPlayer:{}, activated:false };
 s.evocations.push(e); return e;
}
function syncCubes(s:GameState) {
 for (const p of s.players) {
  p.cubes.onWizard = s.players.reduce((n, t) => n + (t.wizard.damageByPlayer[p.id] ?? 0), 0);
  p.cubes.onEvocations = s.evocations.reduce((n, t) => n + (t.damageByPlayer[p.id] ?? 0), 0);
  p.cubes.onBoard = s.board.rooms.filter(r => !r.scored).reduce((n, r) => n + (r.cubesByPlayer[p.id] ?? 0), 0);
  p.cubes.available = 25 - p.cubes.onWizard - p.cubes.onEvocations - p.cubes.onBoard;
 }
}
const apply = (h:ActionHistory, s:GameState, a:GameAction) => h.apply(s, a, a.playerId);
const undo = (h:ActionHistory, s:GameState, id = 'p1') => apply(h, s, { type:'UNDO_ACTION', playerId:id });
const redo = (h:ActionHistory, s:GameState, id = 'p1') => apply(h, s, { type:'REDO_ACTION', playerId:id });
function replayWithoutResolution(h:ActionHistory, s:GameState, id = 'p1') {
 const uuid = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('Replay generated a UUID'); });
 const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Replay reran randomness'); });
 try { return redo(h, s, id); } finally { uuid.mockRestore(); random.mockRestore(); }
}
function publicFeedback(s:GameState, h:ActionHistory) {
 const before = structuredClone(s);
 for (const viewer of viewers) {
  const projection = publicState(s, viewer, h);
  const wire = JSON.parse(JSON.stringify(projection)) as GameState;
  expect(wire.feedbackEvents).toEqual(s.feedbackEvents);
  expect(wire.history).toEqual(h.status(s, viewer));
  expect(wire.ongoingSpells).toEqual(s.ongoingSpells);
  for (const active of s.readiedSpells ?? []) {
   const visible = wire.readiedSpells!.find(a => a.id === active.id)!;
   if (viewer === active.playerId) expect(visible).toEqual(active);
   else {
    expect(Object.keys(visible).sort()).toEqual(['card', 'id', 'playerId']);
    expect(visible.card.name).toBe('Hidden spell');
    expect(JSON.stringify(visible)).not.toMatch(/targetPlayerId|targetEvocationId|roomId|trigger|rulesText|private-/);
   }
   // Even owners get only public feedback, never their full private active payload.
   expect(JSON.stringify(wire.feedbackEvents)).not.toContain(active.card.id);
   expect(JSON.stringify(wire.feedbackEvents)).not.toContain(active.card.name);
  }
  for (const e of wire.feedbackEvents ?? []) {
   const allowed:Record<GameFeedbackEvent['kind'], string[]> = {
    DAMAGE:['id', 'round', 'kind', 'target', 'sourceId', 'amount'],
    CONVERT:['id', 'round', 'kind', 'target', 'sourceId', 'amount', 'total'],
    MAGE_DEFEATED:['id', 'round', 'kind', 'target', 'sourceId', 'contributions', 'awards', 'bonusPlayerId', 'returnedCubes', 'respawnRoomId'],
    SPELL_TRIGGERED:['id', 'round', 'kind', 'activeSpellId', 'ownerId', 'cardName', 'spellType', 'trigger', 'target', 'roomId', 'ongoing'],
   };
   expect(Object.keys(e).every(k => allowed[e.kind].includes(k))).toBe(true);
   if ('target' in e && e.target) expect(Object.keys(e.target).every(k => ['kind', 'id', 'name', 'roomId'].includes(k))).toBe(true);
  }
    const json = JSON.stringify(events(wire));
  expect(json).not.toMatch(/rulesText|triggerEffects|schoolId|targetPlayerId|targetEvocationId|private-|snapshots|undoStack|redoStack/);
 }
 expect(s).toEqual(before); expect(JSON.stringify(h)).toBe('{}');
}

describe('feedback wire privacy for every mage and spectator', () => {
 it('keeps existing events unchanged while all hidden binding categories remain armed and fully masked', () => {
  const h = new ActionHistory(); let s = fixture(); evoc(s);
  s = applyAction(s, { type:'PUNCH', playerId:'p1', targetId:'p2' }); const prior = structuredClone(events(s));
  s = arm(s, 'Threshold Snare', 'p1', { roomId:east });
  s = arm(s, 'Mending Ward', 'p2', { targetPlayerId:'p3-wizard' });
  s = arm(s, "Servant's Safeguard", 'p3', { targetEvocationId:'actual-evocation-id' });
  s = arm(s, 'Thorn Retort', 'p4', {});
  for (const active of s.readiedSpells!) Object.assign(active, { privateMetadata:{ cardId:active.card.id, target:'private-target', room:'private-room', rules:active.card } });
  for (const p of s.players) { p.hand.push(s.library[0].cards.shift()!); p.quest = s.questDeck.shift()!; }
  const bindings = structuredClone(s.readiedSpells); publicFeedback(s, h);
  expect(events(s)).toEqual(prior); expect(s.readiedSpells).toEqual(bindings);
  for (const viewer of viewers) {
   const feed = JSON.stringify(publicState(s, viewer, h).feedbackEvents);
   for (const p of s.players) { expect(feed).not.toContain(p.hand[0].id); expect(feed).not.toContain(p.quest!.id); }
  }
 });
 it('publishes reveal facts identically to every viewer without exposing another still-armed spell', () => {
  const h = new ActionHistory(); let s = arm(fixture(), 'Threshold Snare', 'p1', { roomId:east });
  const revealed = structuredClone(s.readiedSpells![0]);
  s = arm(s, 'Mending Ward', 'p3', { targetPlayerId:'p4' }); turn(s, 'p2');
  s = apply(h, s, { type:'EXPLORE', playerId:'p2' });
  s = apply(h, s, { type:'EXPLORE_STEP', playerId:'p2', destination:{ q:1, r:0 } });
  expect(events(s).map(e => e.kind)).toEqual(['SPELL_TRIGGERED', 'DAMAGE']);
  expect(events(s)[0]).toMatchObject({ activeSpellId:revealed.id, ownerId:'p1', cardName:revealed.card.name,
   spellType:'TRAP', trigger:'ENTER_ROOM', target:{ kind:'MAGE', id:'p2', name:player(s, 'p2').name, roomId:east }, roomId:east, ongoing:false });
  expect(s.library[2].discard).toContainEqual(revealed.card); publicFeedback(s, h);
  for (const viewer of viewers) expect(h.status(s, viewer)).toEqual(disabled);
  const before = structuredClone(s); expect(() => undo(h, s, 'p2')).toThrow(/No action available/); expect(s).toEqual(before);
 });
 it('publishes a protection’s canonical model target rather than its incidental room binding', () => {
  const h = new ActionHistory(); let s = fixture(); evoc(s);
  s = arm(s, "Servant's Safeguard", 'p3', { targetEvocationId:'actual-evocation-id' }); turn(s);
  s = apply(h, s, { type:'PUNCH', playerId:'p1', targetId:'actual-evocation-id' });
  expect(events(s)[1]).toMatchObject({ kind:'SPELL_TRIGGERED', spellType:'PROTECTION', target:{ kind:'EVOCATION', id:'actual-evocation-id', name:'Cadaver', roomId:center }, roomId:center, ongoing:false });
  publicFeedback(s, h);
 });
 it.each(['MAGE', 'EVOCATION'] as const)('exposes no fabricated trigger metadata when a bound %s spell expires', kind => {
  const h = new ActionHistory(); let s = fixture();
  const e = kind === 'EVOCATION' ? evoc(s, 2) : undefined;
  if (!e) player(s, 'p2').wizard.health = 2;
  s = arm(s, e ? "Servant's Safeguard" : 'Mending Ward', 'p3', e ? { targetEvocationId:e.id } : { targetPlayerId:'p2' }); turn(s);
  const privateId = s.readiedSpells![0].id;
  s = apply(h, s, { type:'PUNCH', playerId:'p1', targetId:e?.id ?? 'p2' });
  expect(s.readiedSpells).toEqual([]); expect(events(s).some(e => e.kind === 'SPELL_TRIGGERED')).toBe(false);
  expect(JSON.stringify(events(s))).not.toContain(privateId); publicFeedback(s, h);
  expect(h.status(s, 'p1')).toEqual(disabled);
 });
 it('deep-copies defeat contributions, awards and returned cubes independently for every viewer', () => {
  const h = new ActionHistory(); const initial = fixture();
  Object.assign(player(initial, 'p2').wizard, { damageCubes:9, damageByPlayer:{ p1:4, p3:3 }, blackDamage:2 }); syncCubes(initial);
  const s = apply(h, initial, { type:'PUNCH', playerId:'p1', targetId:'p2' }); const before = structuredClone(s);
  publicFeedback(s, h);
  for (const viewer of viewers) {
   const visible = publicState(s, viewer, h);
   const recap = visible.feedbackEvents!.find(e => e.kind === 'MAGE_DEFEATED')!;
   expect(recap).toMatchObject({ contributions:{ p1:5, p3:3, [BLACK_ROSE_ID]:2 }, returnedCubes:{ p1:5, p3:3 } });
   if (recap.kind !== 'MAGE_DEFEATED') throw new Error('Missing defeat recap');
   recap.target.name = 'mutated'; recap.contributions.p1 = 999; recap.awards[0].points = 999; recap.returnedCubes.p1 = 999;
   visible.feedbackEvents!.push({ kind:'DAMAGE', id:'fabricated-by-viewer', round:1, target:recap.target, amount:999, sourceId:'p1' });
  }
  expect(s).toEqual(before); expect(undo(h, s)).toEqual(initial);
 });
 it('does not add projection-only feedback to legacy states or mutate initialized feeds', () => {
  const s = fixture(), h = new ActionHistory(); delete s.feedbackEvents;
  for (const viewer of viewers) expect(publicState(s, viewer, h)).not.toHaveProperty('feedbackEvents');
  publicFeedback(s, h); expect(s).not.toHaveProperty('feedbackEvents');
 });
});

describe('feedback respects existing exact history snapshots', () => {
 it.each(['DAMAGE', 'DEFEAT', 'CONVERT_AND_DAMAGE'] as const)('undoes and redoes %s with identical events/UUIDs and no re-resolution', mode => {
  const h = new ActionHistory(), initial = fixture(); let action:GameAction = { type:'PUNCH', playerId:'p1', targetId:'p2' };
  if (mode === 'DEFEAT') Object.assign(player(initial, 'p2').wizard, { damageCubes:8, damageByPlayer:{ p1:8 } });
  if (mode === 'CONVERT_AND_DAMAGE') {
   Object.assign(player(initial, 'p2').wizard, { damageCubes:3, damageByPlayer:{ p3:3 } }); prepare(initial, 'Transmuting Surge');
   action = { type:'CAST_SPELL', playerId:'p1', slot:'rapid', targetPlayerId:'p2' };
  }
  syncCubes(initial); const before = structuredClone(initial);
  let s = apply(h, initial, action); const after = structuredClone(s), ids = events(s).map(e => e.id);
  expect(initial).toEqual(before); expect(ids.length).toBe(mode === 'DAMAGE' ? 1 : 2); publicFeedback(s, h);
  expect(h.status(s, 'p1').canUndo).toBe(true);
  for (let i = 0; i < 2; i++) {
   s = undo(h, s); expect(s).toEqual(before); expect(events(s)).toEqual([]); publicFeedback(s, h);
   s = replayWithoutResolution(h, s); expect(s).toEqual(after); expect(events(s).map(e => e.id)).toEqual(ids); publicFeedback(s, h);
  }
 });
 it('keeps hidden arming UUIDs stable on replay but never invents an arming event', () => {
  const h = new ActionHistory(), initial = fixture(); prepare(initial, 'Threshold Snare');
  let s = apply(h, initial, { type:'CAST_SPELL', playerId:'p1', slot:'rapid', roomId:east }); const after = structuredClone(s);
  expect(events(s)).toEqual([]); publicFeedback(s, h);
  s = undo(h, s); expect(s).toEqual(initial); expect(events(s)).toEqual([]);
  s = replayWithoutResolution(h, s); expect(s).toEqual(after); publicFeedback(s, h);
 });
 it('replays public ongoing triggers with stable UUIDs without introducing a new hidden-information barrier', () => {
  const h = new ActionHistory(); let s = arm(fixture(), "Pilgrim's Mark", 'p1', {}); turn(s);
  s = apply(h, s, { type:'EXPLORE', playerId:'p1' }); const before = structuredClone(s);
  s = apply(h, s, { type:'EXPLORE_STEP', playerId:'p1', destination:{ q:1, r:0 } }); const after = structuredClone(s);
  expect(events(s)).toHaveLength(1); expect(events(s)[0]).toMatchObject({ kind:'SPELL_TRIGGERED', ongoing:true, roomId:east });
  publicFeedback(s, h); expect(h.status(s, 'p1').canUndo).toBe(true);
  s = undo(h, s); expect(s).toEqual(before); expect(events(s)).toEqual([]);
  s = replayWithoutResolution(h, s); expect(s).toEqual(after); publicFeedback(s, h);
 });
 it('generates fresh event UUIDs for a new branch after undo, while failed redo does not fabricate events', () => {
  const h = new ActionHistory(), initial = fixture();
  let s = apply(h, initial, { type:'PUNCH', playerId:'p1', targetId:'p2' }); const abandoned = events(s)[0].id;
  s = undo(h, s); s = apply(h, s, { type:'PUNCH', playerId:'p1', targetId:'p3' });
  expect(events(s)).toHaveLength(1); expect(events(s)[0].id).not.toBe(abandoned);
  expect(events(s)[0]).toMatchObject({ target:{ id:'p3' } }); const before = structuredClone(s);
  expect(() => redo(h, s)).toThrow(/No action available/); expect(s).toEqual(before); publicFeedback(s, h);
 });
 it('restores legacy absence exactly on undo and the original initialized event on redo', () => {
  const h = new ActionHistory(), initial = fixture(); delete initial.feedbackEvents;
  let s = apply(h, initial, { type:'PUNCH', playerId:'p1', targetId:'p2' }); const after = structuredClone(s);
  s = undo(h, s); expect(s).toEqual(initial); expect(s).not.toHaveProperty('feedbackEvents'); publicFeedback(s, h);
  s = replayWithoutResolution(h, s); expect(s).toEqual(after); expect(events(s)).toHaveLength(1); publicFeedback(s, h);
 });
 it('undoes feed pruning as part of the snapshot instead of making append-only history or replay patches', () => {
  const h = new ActionHistory(), initial = fixture();
  initial.feedbackEvents = Array.from({ length:FEEDBACK_EVENT_LIMIT }, () => ({ kind:'DAMAGE', id:crypto.randomUUID(), round:0, sourceId:'p3', amount:1, target:{ kind:'MAGE', id:'p4', name:player(initial, 'p4').name, roomId:center } }));
  let s = apply(h, initial, { type:'PUNCH', playerId:'p1', targetId:'p2' }); const after = structuredClone(s);
  expect(events(s)).toHaveLength(512); expect(events(s).slice(0, -1)).toEqual(events(initial).slice(1));
  s = undo(h, s); expect(s).toEqual(initial); expect(events(s)[0].id).toBe(events(initial)[0].id);
  s = replayWithoutResolution(h, s); expect(s).toEqual(after); publicFeedback(s, h);
 });
 it('preserves events and both history stacks on rejected validation/authentication commands', () => {
  const h = new ActionHistory(), initial = fixture();
  let s = apply(h, initial, { type:'PUNCH', playerId:'p1', targetId:'p2' });
  s = apply(h, s, { type:'BEGIN_PHYSICAL_ACTION', playerId:'p1', kind:'ATTACK' }); s = undo(h, s);
  const before = structuredClone(s), flags = h.status(s, 'p1'); expect(flags).toMatchObject({ canUndo:true, canRedo:true });
  expect(() => apply(h, s, { type:'PUNCH', playerId:'p1', targetId:'absent' })).toThrow(/not found/);
  expect(() => h.apply(s, { type:'PUNCH', playerId:'p1', targetId:'p2' }, 'p2')).toThrow(/another player/);
  expect(s).toEqual(before); expect(h.status(s, 'p1')).toEqual(flags); publicFeedback(s, h);
  s = replayWithoutResolution(h, s); expect(events(s)).toEqual(events(before));
 });
 it('rejects a nested reaction overflow atomically without retaining partial public events or changing undo', () => {
  const h = new ActionHistory(); let s = fixture();
  for (const p of s.players) p.wizard.health = 1000;
  for (const id of ['p1', 'p2']) {
   const physical = s.library[0].cards.shift()!;
   const c:Card = { id:physical.id, schoolId:physical.schoolId, name:'Public feedback loop', kind:'SPELL', target:'SELF', range:0, damage:0, instability:0, spellType:'CONTINGENCY',
    ongoing:{ trigger:{ event:'DAMAGE_TAKEN', scope:'BOUND_MODEL', relation:'ANY' }, effects:[{ effect:'DAMAGE', amount:1, target:'EVENT_ACTOR' }] } };
   turn(s, id); prepare(s, c, id); s = applyAction(s, { type:'CAST_SPELL', playerId:id, slot:'rapid' });
  }
  turn(s); s = apply(h, s, { type:'BEGIN_PHYSICAL_ACTION', playerId:'p1', kind:'ATTACK' });
  const before = structuredClone(s), flags = h.status(s, 'p1');
  expect(() => apply(h, s, { type:'INFLICT_ATTACK', playerId:'p1', targetId:'p2' })).toThrow(/resolution limit exceeded \(128\)/);
  expect(s).toEqual(before); expect(events(s)).toEqual([]); expect(h.status(s, 'p1')).toEqual(flags); publicFeedback(s, h);
  s = undo(h, s); expect(events(s)).toEqual([]); s = replayWithoutResolution(h, s); expect(s).toEqual(before);
 });
});