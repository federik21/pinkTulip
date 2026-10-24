import { describe, expect, it } from 'vitest';
import { applyAction, BLACK_ROSE_ID, createGame, FEEDBACK_EVENT_LIMIT } from '../src';
import type { Card, Evocation, FeedbackTarget, GameAction, GameFeedbackEvent, GameState, Player, TriggerCondition, TriggeredInstruction } from '../src';

type Cast = Extract<GameAction, { type:'CAST_SPELL' }>;
type Selection = Omit<Cast, 'type' | 'playerId' | 'slot'>;
const center = 'room-0,0', east = 'room-1,0';
const player = (s:GameState, id = 'p1') => s.players.find(p => p.id === id)!;
const room = (s:GameState, id = center) => s.board.rooms.find(r => r.id === id)!;
const events = (s:GameState) => s.feedbackEvents ?? [];
const ofKind = <K extends GameFeedbackEvent['kind']>(s:GameState, kind:K) => events(s).filter((e): e is Extract<GameFeedbackEvent, {kind:K}> => e.kind === kind);
const mageTarget = (s:GameState, id:string, roomId = center):FeedbackTarget => ({ kind:'MAGE', id, name:player(s, id).name, roomId });
const roomTarget = (s:GameState, id = center):FeedbackTarget => ({ kind:'ROOM', id, name:room(s, id).name, roomId:id });
function turn(s:GameState, id = 'p1') {
 s.phase = 'ACTION'; s.currentPlayerId = id; s.evocationActivation = null;
 s.activation = { playerId:id, actionsUsed:0, exploring:0, sequencedSpellUsed:false, spellsCast:0, discardedExit:false, roomEffectUsed:false };
}
function fixture(count = 4) {
 const s = createGame(count); s.round = 1; s.firstPlayerId = 'p1'; turn(s);
 for (const p of s.players) { p.connected = true; p.wizard.position = { q:0, r:0 }; }
 return s;
}
function take(s:GameState, name:string):Card {
 for (const deck of s.library) {
  const i = deck.cards.findIndex(c => c.name === name);
  if (i >= 0) return deck.cards.splice(i, 1)[0];
 }
 throw new Error(`Missing physical card ${name}`);
}
function prepare(s:GameState, card:Card|string, id = 'p1', slot:keyof Player['prepared'] = 'rapid') {
 const spell = typeof card === 'string' ? take(s, card) : card;
 player(s, id).prepared[slot] = { card:spell, used:false }; return spell;
}
function cast(s:GameState, id = 'p1', selection:Selection = {}, slot:Cast['slot'] = 'rapid') {
 return applyAction(s, { type:'CAST_SPELL', playerId:id, slot, ...selection });
}
function arm(s:GameState, card:Card|string, id = 'p1', selection:Selection = { roomId:east }) {
 turn(s, id); prepare(s, card, id); return cast(s, id, selection);
}
function enter(s:GameState, id = 'p2') {
 turn(s, id); s = applyAction(s, { type:'EXPLORE', playerId:id });
 return applyAction(s, { type:'EXPLORE_STEP', playerId:id, destination:{ q:1, r:0 } });
}
function evoc(s:GameState, health = 4):Evocation {
 const e:Evocation = { id:'actual-cadaver-id', playerId:'p2', name:'Cadaver', number:2, archetype:'UNDEAD', movement:2, attack:2, health, passive:'WOUNDED_FURY', position:{ q:0, r:0 }, damageCubes:0, damageByPlayer:{}, activated:false };
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
function wound(s:GameState, id:string, ledger:Record<string, number>, black = 0, unattributed = 0) {
 const model = s.evocations.find(e => e.id === id) ?? player(s, id).wizard;
 model.damageByPlayer = { ...ledger }; model.damageCubes = Object.values(ledger).reduce((n, v) => n + v, 0) + black + unattributed;
 if ('blackDamage' in model) model.blackDamage = black;
 syncCubes(s);
}
function limitSupply(s:GameState, available:number, id = 'p1') {
 let remaining = player(s, id).cubes.available - available;
 for (const r of s.board.rooms.filter(r => !r.startingFor)) {
  const n = Math.min(remaining, r.instabilityLimit - r.instability);
  if (n > 0) { r.instability += n; r.cubesByPlayer[id] = (r.cubesByPlayer[id] ?? 0) + n; remaining -= n; }
 }
 expect(remaining).toBe(0); syncCubes(s);
}
function conserved(s:GameState) {
 const copy = structuredClone(s); syncCubes(copy);
 expect(s.players.map(p => p.cubes)).toEqual(copy.players.map(p => p.cubes));
 for (const p of s.players) {
  expect(Object.values(p.cubes).every(n => Number.isInteger(n) && n >= 0)).toBe(true);
  expect(Object.values(p.cubes).reduce((a, b) => a + b, 0)).toBe(25);
 }
 const cards = [...s.library.flatMap(d => [...d.cards, ...d.discard]), ...s.powerfulDeck, ...s.removedCards,
  ...[...s.readiedSpells ?? [], ...s.ongoingSpells ?? []].map(a => a.card),
  ...s.players.flatMap(p => [...p.hand, ...p.personalDeck, ...p.discard, ...Object.values(p.prepared).flatMap(c => c && !c.used ? [c.card] : [])])];
 expect(cards).toHaveLength(120); expect(new Set(cards.map(c => c.id)).size).toBe(120);
}
function custom(s:GameState, changes:Partial<Card>):Card {
 const physical = s.library[0].cards.shift()!;
 return { id:physical.id, schoolId:physical.schoolId, name:'Public custom spell', kind:'SPELL', target:'ROOM', range:3, damage:0, instability:0, ...changes };
}
const on = (event:TriggerCondition['event'], scope:TriggerCondition['scope'] = 'BOUND_ROOM', relation:TriggerCondition['relation'] = 'ANY'):TriggerCondition => ({ event, scope, relation });
const instruction = (effect:TriggeredInstruction['effect'], amount:number, target:TriggeredInstruction['target']):TriggeredInstruction => ({ effect, amount, target });
function reject(s:GameState, action:GameAction, message:RegExp) {
 const before = structuredClone(s); expect(() => applyAction(s, action)).toThrow(message); expect(s).toEqual(before);
}
function facts(s:GameState) {
 return events(s).map(({ id, round, ...fact }) => fact);
}

describe('authoritative damage feedback', () => {
 it('exports the exact target contract, initializes an empty feed, and uses the player ID for mage aliases', () => {
  const s = fixture(); expect(createGame().feedbackEvents).toEqual([]); expect(FEEDBACK_EVENT_LIMIT).toBe(512);
  const before = structuredClone(s), result = applyAction(s, { type:'PUNCH', playerId:'p1', targetId:'p2-wizard' });
  expect(s).toEqual(before);
  expect(facts(result)).toEqual([{ kind:'DAMAGE', target:mageTarget(s, 'p2'), sourceId:'p1', amount:2 }]);
  expect(events(result)[0]).toMatchObject({ id:expect.stringMatching(/^[0-9a-f-]{36}$/), round:1 }); conserved(result);
 });
 it.each([0, 1])('reports actual wounds with only %i cubes available, not the placed supply', supply => {
  const s = fixture(); limitSupply(s, supply);
  const result = applyAction(s, { type:'PUNCH', playerId:'p1', targetId:'p2' });
  expect(ofKind(result, 'DAMAGE')[0].amount).toBe(2); expect(player(result, 'p2').wizard.damageByPlayer).toEqual(supply ? { p1:1 } : {}); conserved(result);
 });
 it('caps overkill and snapshots the lethal victim and room before the ledger clears and respawn moves it', () => {
  const s = fixture(); wound(s, 'p2', { p1:9 });
  const result = applyAction(s, { type:'PUNCH', playerId:'p1', targetId:'p2' });
  expect(facts(result)).toEqual([
   { kind:'DAMAGE', target:mageTarget(s, 'p2'), sourceId:'p1', amount:1 },
   { kind:'MAGE_DEFEATED', target:mageTarget(s, 'p2'), sourceId:'p1', contributions:{ p1:10 },
    awards:[{ playerId:'p1', cubes:10, rank:1, tied:false, points:4 }], bonusPlayerId:'p1', returnedCubes:{ p1:10 }, respawnRoomId:player(s, 'p2').wizard.startingRoomId },
  ]);
  expect(player(result, 'p2').wizard).toMatchObject({ damageCubes:0, blackDamage:0, damageByPlayer:{} });
  expect(player(result, 'p2').wizard.position).toEqual(room(result, player(s, 'p2').wizard.startingRoomId).tiles[0]);
  expect(player(result).victoryPoints).toBe(5); expect(player(result).kills).toBe(1); conserved(result);
 });
 it.each([0, 1])('uses the real evocation ID/name and capped wounds even on destruction with %i available cubes', supply => {
  const s = fixture(); const e = evoc(s, 1); limitSupply(s, supply);
  const result = applyAction(s, { type:'PUNCH', playerId:'p1', targetId:e.id });
  expect(facts(result)).toEqual([{ kind:'DAMAGE', target:{ kind:'EVOCATION', id:e.id, name:'Cadaver', roomId:center }, sourceId:'p1', amount:1 }]);
  expect(result.evocations).toEqual([]); expect(player(result).kills).toBe(0); conserved(result);
 });
 it('attributes an evocation attack to its controlling player, not its model ID', () => {
  const s = fixture(); const e = evoc(s); e.playerId = 'p1';
  const active = applyAction(s, { type:'ACTIVATE_EVOCATION', playerId:'p1', evocationId:e.id });
  expect(events(active)).toEqual([]);
  const result = applyAction(active, { type:'EVOCATION_ATTACK', playerId:'p1', targetId:'p2' });
  expect(ofKind(result, 'DAMAGE')).toMatchObject([{ sourceId:'p1', amount:2, target:mageTarget(s, 'p2') }]); conserved(result);
 });
 it('reports every actual area victim in instruction order and never friendly models', () => {
  const s = fixture(); const e = evoc(s); prepare(s, 'Firestorm');
  const result = cast(s, 'p1', { roomId:center });
  expect(ofKind(result, 'DAMAGE').map(e => [e.target.id, e.amount])).toEqual([['p2', 2], ['p3', 2], ['p4', 2], [e.id, 2]]); conserved(result);
 });
 it('does not fabricate feedback for a dummy or zero-damage room cast', () => {
  const dummy = fixture(); prepare(dummy, 'Arcane Bolt');
  const dummyResult = cast(dummy, 'p1', { roomId:center, dummy:true });
  expect(events(dummyResult)).toEqual([]); conserved(dummyResult);
  const s = fixture();
  prepare(s, 'Fracture'); const result = cast(s, 'p1', { roomId:center });
  expect(room(result).instability).toBe(2); expect(events(result)).toEqual([]); conserved(result);
 });
});

describe('defeat recap scoring and actual returned cubes', () => {
 it('captures dense tied leaders and tied second rank including neutral damage before all ledgers clear', () => {
  const s = fixture(); wound(s, 'p4', { p1:4, p2:4, p3:1 });
  s.phase = 'CLEANUP'; s.eventDeck = [{ id:'neutral-finish', name:'Thorns', description:'Black damage', kind:'BLACK_DAMAGE', amount:1, rooms:0 }];
  const result = applyAction(s, { type:'ADVANCE_PHASE', playerId:'p1', expectedPhase:'CLEANUP', expectedRound:1 });
  const recap = ofKind(result, 'MAGE_DEFEATED')[0];
  expect(recap).toMatchObject({ round:2, target:mageTarget(s, 'p4'), sourceId:BLACK_ROSE_ID,
   contributions:{ p1:4, p2:4, p3:1, [BLACK_ROSE_ID]:1 }, returnedCubes:{ p1:4, p2:4, p3:1 },
   awards:[{ playerId:'p1', cubes:4, rank:1, tied:true, points:3 }, { playerId:'p2', cubes:4, rank:1, tied:true, points:3 },
    { playerId:'p3', cubes:1, rank:2, tied:true, points:1 }, { playerId:BLACK_ROSE_ID, cubes:1, rank:2, tied:true, points:1 }] });
  expect(recap).not.toHaveProperty('bonusPlayerId'); expect(recap.returnedCubes).not.toHaveProperty(BLACK_ROSE_ID);
  expect(result.blackRose).toEqual({ victoryPoints:1, kills:1 });
  expect(result.players.map(p => p.victoryPoints)).toEqual([3, 3, 1, 0]);
  expect(ofKind(result, 'DAMAGE').every(e => e.sourceId === BLACK_ROSE_ID)).toBe(true); conserved(result);
 });
 it.each([0, 2])('does not invent physical cubes or a solo bonus for %i neutral wounds and unplaced damage', black => {
  const s = fixture(); wound(s, 'p2', { p1:1 }, black, 8 - 1 - black); limitSupply(s, 0);
  const result = applyAction(s, { type:'PUNCH', playerId:'p1', targetId:'p2' });
  const recap = ofKind(result, 'MAGE_DEFEATED')[0];
  expect(recap.contributions).toEqual({ p1:1, ...(black ? { [BLACK_ROSE_ID]:black } : {}) });
  expect(recap.returnedCubes).toEqual({ p1:1 }); expect(recap).not.toHaveProperty('bonusPlayerId');
  expect(ofKind(result, 'DAMAGE')[0].amount).toBe(2); conserved(result);
 });
 it('includes player and neutral ledger entries together without returning neutral supply', () => {
  const s = fixture(); wound(s, 'p2', { p1:3, [BLACK_ROSE_ID]:2 }, 3);
  const result = applyAction(s, { type:'PUNCH', playerId:'p1', targetId:'p2' });
  const recap = ofKind(result, 'MAGE_DEFEATED')[0];
  expect(recap.contributions).toEqual({ p1:5, [BLACK_ROSE_ID]:5 });
  expect(recap.awards.map(a => [a.playerId, a.rank, a.tied, a.points])).toEqual([['p1', 1, true, 3], [BLACK_ROSE_ID, 1, true, 3]]);
  expect(recap.returnedCubes).toEqual({ p1:5 }); conserved(result);
 });
});

describe('conversion feedback', () => {
 it.each(['MAGE', 'EVOCATION', 'ROOM'] as const)('reports the actual %s target, converted amount and unchanged total', kind => {
  const s = fixture(); let target:FeedbackTarget; let selection:Selection; let name:string;
  if (kind === 'ROOM') {
   Object.assign(room(s), { instability:4, cubesByPlayer:{ p3:2, [BLACK_ROSE_ID]:2 } }); syncCubes(s);
   target = roomTarget(s); selection = { roomId:center }; name = 'Rewrite the Lodge';
  } else if (kind === 'EVOCATION') {
   const e = evoc(s, 8); wound(s, e.id, { p3:2, [BLACK_ROSE_ID]:2 });
   target = { kind, id:e.id, name:e.name, roomId:center }; selection = { targetEvocationId:e.id }; name = 'Reclaimed Servant';
  } else {
   wound(s, 'p2', { p3:2 }, 2); target = mageTarget(s, 'p2'); selection = { targetPlayerId:'p2-wizard' }; name = "Mage's Due";
  }
  prepare(s, name); const result = cast(s, 'p1', selection);
  expect(facts(result)).toEqual([{ kind:'CONVERT', target, sourceId:'p1', amount:kind === 'EVOCATION' ? 2 : 3, total:4 }]); conserved(result);
 });
 it('caps conversion by actual available supply', () => {
  const s = fixture(); wound(s, 'p2', { p3:4 }); limitSupply(s, 1); prepare(s, "Mage's Due");
  const result = cast(s, 'p1', { targetPlayerId:'p2' });
  expect(facts(result)).toEqual([{ kind:'CONVERT', target:mageTarget(s, 'p2'), sourceId:'p1', amount:1, total:4 }]); conserved(result);
 });
 it.each(['empty', 'own-color', 'no-supply', 'unattributed', 'scored-room', 'reconstructed-room'] as const)('emits no event for a %s conversion', condition => {
  const s = fixture(); let selection:Selection = { targetPlayerId:'p2' };
  if (condition === 'own-color') wound(s, 'p2', { p1:4 });
  if (condition === 'unattributed') wound(s, 'p2', {}, 0, 4);
  if (condition === 'no-supply') { wound(s, 'p2', { p3:4 }); limitSupply(s, 0); }
  if (condition.endsWith('-room')) {
   Object.assign(room(s), { instability:4, cubesByPlayer:{ [BLACK_ROSE_ID]:4 }, scored:condition === 'scored-room', reconstructed:condition === 'reconstructed-room' });
   selection = { roomId:center }; prepare(s, 'Rewrite the Lodge');
  } else prepare(s, "Mage's Due");
  const result = cast(s, 'p1', selection); expect(events(result)).toEqual([]); conserved(result);
 });
 it('records conversion before subsequent damage for a compound spell', () => {
  const s = fixture(); wound(s, 'p2', { p3:2 }); prepare(s, 'Transmuting Surge');
  const result = cast(s, 'p1', { targetPlayerId:'p2' });
  expect(events(result).map(e => e.kind)).toEqual(['CONVERT', 'DAMAGE']);
  expect(ofKind(result, 'CONVERT')[0]).toMatchObject({ amount:1, total:2 }); conserved(result);
 });
});

describe('trigger feedback follows reveal and instruction chronology', () => {
 it('arms silently and reveals a trap before its nested damage, with only whitelisted public metadata', () => {
  const s = arm(fixture(), 'Threshold Snare'), active = s.readiedSpells![0]; expect(events(s)).toEqual([]);
  const result = enter(s);
  expect(facts(result)).toEqual([
   { kind:'SPELL_TRIGGERED', activeSpellId:active.id, ownerId:'p1', cardName:'Threshold Snare', spellType:'TRAP', trigger:'ENTER_ROOM', target:mageTarget(s, 'p2', east), roomId:east, ongoing:false },
   { kind:'DAMAGE', target:mageTarget(s, 'p2', east), sourceId:'p1', amount:2 },
  ]);
  expect(result.readiedSpells).toEqual([]); expect(result.library[2].discard).toContainEqual(active.card);
  expect(JSON.stringify(events(result))).not.toMatch(/triggerEffects|rulesText|schoolId|targetPlayerId|targetEvocationId/);
  expect(JSON.stringify(events(result))).not.toContain(active.card.id); conserved(result);
 });
 it('prioritizes a bound model over its incidental armed room and uses its current public location', () => {
  let s = fixture(); const e = evoc(s); s = arm(s, "Servant's Safeguard", 'p1', { targetEvocationId:e.id });
  s.evocations[0].position = { q:1, r:0 }; player(s, 'p3').wizard.position = { q:1, r:0 }; turn(s, 'p3');
  const result = applyAction(s, { type:'PUNCH', playerId:'p3', targetId:e.id });
  expect(ofKind(result, 'SPELL_TRIGGERED')[0]).toMatchObject({ target:{ kind:'EVOCATION', id:e.id, name:e.name, roomId:east }, roomId:east, ongoing:false });
  expect(result.evocations[0].damageCubes).toBe(0); conserved(result);
 });
 it('preserves nested depth-first feedback instead of grouping popups after effects', () => {
  let s = arm(fixture(), 'Thorn Retort', 'p1', {}); s = arm(s, 'Thorn Retort', 'p2', {}); turn(s);
  const result = applyAction(s, { type:'PUNCH', playerId:'p1', targetId:'p2' });
  expect(events(result).map(e => e.kind === 'SPELL_TRIGGERED' ? [e.kind, e.ownerId] : [e.kind, 'sourceId' in e ? e.sourceId : ''])).toEqual([
   ['DAMAGE', 'p1'], ['SPELL_TRIGGERED', 'p2'], ['DAMAGE', 'p2'], ['SPELL_TRIGGERED', 'p1'], ['DAMAGE', 'p1'],
  ]); conserved(result);
 });
 it('marks repeat ongoing triggers public and true, without creating an arming popup', () => {
  let s = arm(fixture(), "Pilgrim's Mark", 'p1', {}); const active = s.ongoingSpells![0]; expect(events(s)).toEqual([]);
  Object.assign(room(s, east), { instability:2, cubesByPlayer:{ [BLACK_ROSE_ID]:2 } });
  s = enter(s, 'p1');
  expect(facts(s)).toEqual([
   { kind:'SPELL_TRIGGERED', activeSpellId:active.id, ownerId:'p1', cardName:"Pilgrim's Mark", spellType:'CONTINGENCY', trigger:'ENTER_ROOM', target:mageTarget(s, 'p1', east), roomId:east, ongoing:true },
   { kind:'CONVERT', target:roomTarget(s, east), sourceId:'p1', amount:1, total:2 },
  ]);
  s = applyAction(s, { type:'EXPLORE_STEP', playerId:'p1', destination:{ q:0, r:0 } });
  expect(ofKind(s, 'SPELL_TRIGGERED')).toHaveLength(2); expect(ofKind(s, 'SPELL_TRIGGERED').every(e => e.ongoing && e.activeSpellId === active.id)).toBe(true);
  expect(s.ongoingSpells).toHaveLength(1); conserved(s);
 });
 it.each(['MAGE', 'EVOCATION'] as const)('does not call lethal bound-%s expiry a trigger', kind => {
  let s = fixture(); const e = kind === 'EVOCATION' ? evoc(s, 2) : undefined;
  if (!e) player(s, 'p2').wizard.health = 2;
  s = arm(s, e ? "Servant's Safeguard" : 'Mending Ward', 'p1', e ? { targetEvocationId:e.id } : { targetPlayerId:'p2' }); turn(s);
  const result = applyAction(s, { type:'PUNCH', playerId:'p1', targetId:e?.id ?? 'p2' });
  expect(result.readiedSpells).toEqual([]); expect(ofKind(result, 'SPELL_TRIGGERED')).toEqual([]);
  expect(result.log.some(l => l.includes('expires with its bound model'))).toBe(true); conserved(result);
 });
 it.each(['MAGE', 'EVOCATION'] as const)('retains the actual lethal event %s and origin room for room-bound reactions', kind => {
  let s = fixture(); const e = kind === 'EVOCATION' ? evoc(s, 1) : undefined;
  if (!e) player(s, 'p2').wizard.health = 1;
  const c = custom(s, { spellType:'TRAP', trigger:on('DAMAGE_TAKEN'), triggerEffects:[] });
  s = arm(s, c, 'p3', { roomId:center }); turn(s);
  const result = applyAction(s, { type:'PUNCH', playerId:'p1', targetId:e?.id ?? 'p2' });
  expect(ofKind(result, 'SPELL_TRIGGERED')[0]).toMatchObject({ target:e ? { kind, id:e.id, name:e.name, roomId:center } : mageTarget(s, 'p2'), roomId:center }); conserved(result);
 });
 it('does not emit for stale model instructions after nested lethal damage', () => {
  let s = fixture(); player(s, 'p2').wizard.health = 1;
  const c = custom(s, { spellType:'TRAP', trigger:on('ENTER_ROOM'), triggerEffects:[instruction('DAMAGE', 2, 'EVENT_MODEL'), instruction('CONVERT', 2, 'EVENT_MODEL'), instruction('DAMAGE', 2, 'EVENT_MODEL')] });
  s = arm(s, c); const result = enter(s);
  expect(events(result).map(e => e.kind)).toEqual(['SPELL_TRIGGERED', 'DAMAGE', 'MAGE_DEFEATED']);
  expect(ofKind(result, 'DAMAGE')[0]).toMatchObject({ amount:1, target:mageTarget(s, 'p2', east) }); conserved(result);
 });
});

describe('bounded legacy-safe feedback and atomic failures', () => {
 it('initializes a missing legacy feed without fabricating events and leaves the input absent', () => {
  const s = fixture(); delete s.feedbackEvents;
  const result = applyAction(s, { type:'EXPLORE', playerId:'p1' });
  expect(result.feedbackEvents).toEqual([]); expect(s).not.toHaveProperty('feedbackEvents');
  const damaged = applyAction(s, { type:'PUNCH', playerId:'p1', targetId:'p2' });
  expect(events(damaged)).toHaveLength(1); conserved(damaged);
 });
 it('appends chronologically, prunes only the oldest prefix at 512, and does not rewrite retained IDs', () => {
  let s = fixture(); const target = mageTarget(s, 'p2');
  s.feedbackEvents = Array.from({ length:FEEDBACK_EVENT_LIMIT }, (_, i) => ({ kind:'DAMAGE', target, sourceId:'p1', amount:1, id:crypto.randomUUID(), round:i < 256 ? 0 : 1 }));
  const old = structuredClone(events(s)); s = applyAction(s, { type:'PUNCH', playerId:'p1', targetId:'p2' });
  expect(events(s)).toHaveLength(512); expect(events(s).slice(0, -1)).toEqual(old.slice(1));
  expect(events(s).at(-1)).toMatchObject({ kind:'DAMAGE', round:1, amount:2 });
  expect(new Set(events(s).map(e => e.id)).size).toBe(512);
  const retained = structuredClone(events(s)); turn(s, 'p3'); s = applyAction(s, { type:'EXPLORE', playerId:'p3' });
  expect(events(s)).toEqual(retained); conserved(s);
 });
 it('assigns disjoint UUIDs to alternative branches and JSON re-resolution, preserving prior events', () => {
  const initial = fixture(), action:GameAction = { type:'PUNCH', playerId:'p1', targetId:'p2' };
  const a = applyAction(initial, action), b = applyAction(initial, action), c = applyAction(JSON.parse(JSON.stringify(initial)), action);
  expect(facts(a)).toEqual(facts(b)); expect(facts(b)).toEqual(facts(c));
  expect(new Set([events(a)[0].id, events(b)[0].id, events(c)[0].id]).size).toBe(3);
  turn(a); const next = applyAction(a, action); expect(events(next)[0]).toEqual(events(a)[0]);
  expect(events(next)[1].id).not.toBe(events(next)[0].id); conserved(next);
 });
 it('leaves input events untouched on validation failure', () => {
  const s = fixture(); prepare(s, 'Arcane Bolt');
  reject(s, { type:'CAST_SPELL', playerId:'p1', slot:'rapid', targetPlayerId:'absent' }, /not found/);
  expect(events(s)).toEqual([]); conserved(s);
 });
 it('retains the 128-reaction guard and rolls back every nested feedback/cube/card change', () => {
  let s = fixture(); for (const p of s.players) p.wizard.health = 1000;
  for (const id of ['p1', 'p2']) {
   const c = custom(s, { target:'SELF', spellType:'CONTINGENCY', ongoing:{ trigger:on('DAMAGE_TAKEN', 'BOUND_MODEL'), effects:[instruction('DAMAGE', 1, 'EVENT_ACTOR')] } });
   s = arm(s, c, id, {});
  }
  turn(s); const before = structuredClone(s);
  reject(s, { type:'PUNCH', playerId:'p1', targetId:'p2' }, /resolution limit exceeded \(128\)/);
  expect(s).toEqual(before); expect(events(s)).toEqual([]); conserved(s);
 });
});