import { describe, expect, it } from 'vitest';
import { applyAction, BLACK_ROSE_ID, createGame, getDarkSide, getSpellForSide, summonEvocation, upgradeLegacyCards } from '../src';
import { mainEffects } from '../src/cards';
import type { Card, GameState } from '../src';

const DARK = ['Hysterical Escape', 'Thorn of Thorns', 'Persecution', 'Humiliation', 'Traitor Nightmare', 'Painful Loss', 'Anguish', 'Recurring Nightmare', 'Ephialtes'];
const LIGHT_ONLY = ['Shifting Nightmare', 'Mental Chasm', 'Shadow Blast'];

function fixture(playerCount = 3): GameState {
 const s = createGame(playerCount); s.round = 1; s.phase = 'ACTION'; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, spellsCast: 0, sequencedSpellUsed: false, discardedExit: false, roomEffectUsed: false };
 for (const p of s.players) { p.connected = true; p.wizard.position = { q: 0, r: 0 }; p.wizard.health = 30; }
 return s;
}
const school = (s: GameState) => s.library.find(d => d.id === 'nightmare')!;
function catalog(s: GameState, name: string): Card {
 const deck = school(s), index = deck.cards.findIndex(c => c.name === name);
 expect(index).toBeGreaterThanOrEqual(0);
 return deck.cards.splice(index, 1)[0];
}
type Target = { targetPlayerId?: string; targetEvocationId?: string; roomId?: string };
function cast(s: GameState, name: string, target: Target = {}) {
 s.players[0].prepared.rapid = { used: false, card: catalog(s, name), side: 'DARK' };
 return applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', ...target });
}
const choice = (s: GameState) => { const d = s.pendingDecision; if (d?.kind !== 'CHOICE') throw new Error(`Expected a choice, got ${d?.kind}`); return d; };
const answer = (s: GameState, choiceId?: string) => { const d = choice(s); return applyAction(s, { type: 'RESPOND_CHOICE', playerId: d.playerId, key: d.key, ...(choiceId ? { choiceId } : {}) }); };
// Answers every pending slot/order choice with its first option.
function settle(s: GameState): GameState {
 for (let guard = 0; guard < 20 && s.pendingDecision?.kind === 'CHOICE'; guard++) s = answer(s, (s.pendingDecision.options as { id: string }[])[0].id);
 return s;
}
const umbras = (s: GameState, mageId?: string) => s.evocations.filter(e => e.kind === 'UMBRA' && (!mageId || e.assignedTo === mageId));
const wounds = (s: GameState, index: number) => s.players[index].wizard.damageCubes;
function umbra(s: GameState, mageId: string, slot: number) {
 const mage = s.players.find(p => p.id === mageId)!;
 s.evocations.push({ id: `umbra-${mageId}-${slot}`, playerId: BLACK_ROSE_ID, assignedTo: mageId, slot, number: slot, kind: 'UMBRA', name: 'Umbra', archetype: 'NIGHTMARE', movement: 0, attack: 1, health: 2, position: { ...mage.wizard.position }, damageCubes: 0, damageByPlayer: {}, activated: true });
}
function ready(s: GameState, name: string, playerIndex: number) {
 const card = catalog(s, name), player = s.players[playerIndex], id = `ready-${name}`;
 s.readiedSpells!.push({ id, playerId: player.id, card: getSpellForSide(s, player, card, 'DARK'), printed: card, side: 'DARK' });
 s.activeSpellOrder!.push(id);
 return id;
}
const mover: Card = { id: 'mover', name: 'Mover', kind: 'SPELL', spellType: 'CONTINGENCY', target: 'SELF', range: 0, effects: mainEffects([{ effect: 'MOVE_TARGET', distance: 1 }]) };

describe('Nightmare dark sides', () => {
 it('gives nine Nightmare cards a dark side with its own name, element and type', () => {
  const s = fixture();
  for (const name of DARK) {
   const card = catalog(s, name), dark = getDarkSide(card);
   expect(card.darkSide).toBeDefined();
   expect(card.lightOnly).toBeUndefined();
   const face = getSpellForSide(s, s.players[0], card, 'DARK');
   expect(face.name).toBe(name);
   expect(face.element).toBe(dark.element);
   expect(face.spellType).toBe(dark.spellType);
  }
 });

 it('marks the three Traps as light-side only', () => {
  const s = fixture();
  for (const name of LIGHT_ONLY) {
   const card = catalog(s, name);
   expect(card.lightOnly).toBe(true);
   expect(card.darkSide).toBeUndefined();
  }
 });

 it('rejects preparing a light-only card on its dark side', () => {
  const s = fixture(); s.phase = 'PREPARATION';
  for (const p of s.players) p.preparationDone = false;
  const trap = catalog(s, 'Mental Chasm'), a = catalog(s, 'Humiliation'), b = catalog(s, 'Anguish');
  s.players[0].hand = [trap, a, b];
  expect(() => applyAction(s, { type: 'PREPARE_CARDS', playerId: 'p1', preparedCardIds: [trap.id, a.id], sides: { [trap.id]: 'DARK' } })).toThrow(/light side/);
  const ok = applyAction(s, { type: 'PREPARE_CARDS', playerId: 'p1', preparedCardIds: [trap.id, a.id], sides: { [a.id]: 'DARK' } });
  expect(ok.players[0].prepared.slot2?.side ?? ok.players[0].prepared.slot1?.side).toBe('DARK');
 });

 it('restores dark sides and the light-only flag on saved cards', () => {
  const s = fixture(), card = catalog(s, 'Ephialtes'), trap = catalog(s, 'Shadow Blast');
  delete card.darkSide; delete trap.lightOnly;
  upgradeLegacyCards(card); upgradeLegacyCards(trap);
  expect(card.darkSide).toMatchObject({ target: 'SELF', range: 0 });
  expect(trap.lightOnly).toBe(true);
 });

 it('Hysterical Escape moves a mage in the target room twice and gains 1 VP per Trap triggered', () => {
  const s = fixture(); s.players[1].wizard.position = { q: 1, r: 0 };
  const trap: Card = { id: 'entry-trap', name: 'Entry', kind: 'SPELL', spellType: 'TRAP', target: 'MAGE', range: Infinity, effects: mainEffects([{ effect: 'DAMAGE', amount: 1 }]), triggerTarget: 'EVENT_MODEL', trigger: { event: 'ENTER_ROOM', relation: 'ENEMY', scope: 'ANY', modelKind: 'MAGE' } };
  s.readiedSpells!.push({ id: 'entry-trap', playerId: 'p3', card: trap }); s.activeSpellOrder!.push('entry-trap');
  const vp = s.players[0].victoryPoints;
  let after = cast(s, 'Hysterical Escape', { roomId: 'room-1,0' });
  for (let guard = 0; guard < 12 && after.pendingDecision; guard++) {
   const d = after.pendingDecision;
   if (d.kind === 'REACTIVE_SPELL') { after = applyAction(after, { type: 'RESPOND_REACTIVE_SPELL', playerId: d.playerId, key: d.key, activeSpellId: 'entry-trap', targetId: 'p2' }); continue; }
   after = answer(after, (choice(after).options as { id: string }[])[0].id);
  }
  expect(after.players[0].victoryPoints - vp).toBe(1);
  expect(after.players[1].wizard.position).not.toEqual({ q: 1, r: 0 });
 });

 it('Thorn of Thorns gains 1 VP, draws a spell, takes the first player token and suffers 2 Pain', () => {
  const s = fixture(); s.firstPlayerId = 'p2';
  const handBefore = s.players[0].hand.length, vp = s.players[0].victoryPoints;
  const after = cast(s, 'Thorn of Thorns');
  expect(after.players[0].victoryPoints).toBe(vp + 1);
  expect(after.firstPlayerId).toBe('p1');
  expect(wounds(after, 0)).toBe(2);
  expect(after.players[0].hand.length).toBeGreaterThanOrEqual(handBefore);
 });

 it('Humiliation assigns an Umbra then scales its damage by the target\u2019s Nightmares', () => {
  const s = fixture(); s.players[1].wizard.position = { q: 1, r: 0 };
  let after = cast(s, 'Humiliation', { targetPlayerId: 'p2' });
  after = settle(after);
  expect(umbras(after, 'p2')).toHaveLength(1);
  expect(wounds(after, 1)).toBe(3);

  const t = fixture(); t.players[1].wizard.position = { q: 1, r: 0 };
  umbra(t, 'p2', 1); umbra(t, 'p2', 2);
  const more = settle(cast(t, 'Humiliation', { targetPlayerId: 'p2' }));
  expect(umbras(more, 'p2')).toHaveLength(3);
  expect(wounds(more, 1)).toBe(5);
 });

 it('Traitor Nightmare cannot target the caster and awards 1 VP at 3 Nightmares', () => {
  const s = fixture(); s.players[0].prepared.rapid = { used: false, card: catalog(s, 'Traitor Nightmare'), side: 'DARK' };
  expect(() => applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p1' })).toThrow();
  const t = fixture(); t.players[1].wizard.position = { q: 1, r: 0 }; umbra(t, 'p2', 1); umbra(t, 'p2', 2);
  const vp = t.players[0].victoryPoints;
  const after = settle(cast(t, 'Traitor Nightmare', { targetPlayerId: 'p2' }));
  expect(umbras(after, 'p2')).toHaveLength(3);
  expect(after.players[0].victoryPoints).toBe(vp + 1);
 });

 it('Traitor Nightmare awards no VP below 3 Nightmares', () => {
  const s = fixture(); s.players[1].wizard.position = { q: 1, r: 0 };
  const vp = s.players[0].victoryPoints;
  const after = settle(cast(s, 'Traitor Nightmare', { targetPlayerId: 'p2' }));
  expect(umbras(after, 'p2')).toHaveLength(1);
  expect(after.players[0].victoryPoints).toBe(vp);
 });

 it('Painful Loss inflicts damage and activates Nightmares only if the caster accepts the Pain', () => {
  const run = (accept: boolean) => {
   const s = fixture(); s.players[1].wizard.position = { q: 1, r: 0 }; umbra(s, 'p2', 1);
   let after = cast(s, 'Painful Loss');
   expect(choice(after).playerId).toBe('p1');
   after = accept ? answer(after, 'PAIN') : answer(after);
   return settle(after);
  };
  const yes = run(true), no = run(false);
  expect(wounds(yes, 0)).toBe(2);
  expect(wounds(yes, 1)).toBeGreaterThanOrEqual(2); // 1 damage + Umbra activation
  expect(wounds(no, 0)).toBe(0);
  expect(wounds(no, 1)).toBe(1); // Umbra activation only
 });

 it('Anguish defeats a target with 3 Nightmares and does nothing otherwise', () => {
  const s = fixture(); umbra(s, 'p2', 1); umbra(s, 'p2', 2); umbra(s, 'p2', 3);
  const after = cast(s, 'Anguish', { targetPlayerId: 'p2' });
  expect(after.feedbackEvents!.some(e => e.kind === 'MAGE_DEFEATED' && e.target.id === 'p2')).toBe(true);
  const t = fixture(); umbra(t, 'p2', 1); umbra(t, 'p2', 2);
  const safe = cast(t, 'Anguish', { targetPlayerId: 'p2' });
  expect(safe.players[1].wizard.alive).toBe(true);
  expect(wounds(safe, 1)).toBe(0);
 });

 it('Recurring Nightmare is ongoing and activates the target\u2019s Nightmares when it reveals a spell', () => {
  const s = fixture(); umbra(s, 'p2', 1);
  s.players[1].wizard.position = { q: 0, r: 0 };
  const after = cast(s, 'Recurring Nightmare', { targetPlayerId: 'p2' });
  expect(after.ongoingSpells).toHaveLength(1);
  expect(wounds(after, 1)).toBe(0);
  after.currentPlayerId = 'p2'; after.activation = { ...after.activation!, playerId: 'p2' };
  after.players[1].prepared.rapid = { used: false, card: mover };
  const next = settle(applyAction(after, { type: 'CAST_SPELL', playerId: 'p2', slot: 'rapid' }));
  expect(wounds(next, 1)).toBeGreaterThan(0);
 });

 it('Ephialtes draws one quest per Nightmare, then discards one of them', () => {
  const s = fixture(); umbra(s, 'p2', 1); umbra(s, 'p3', 1);
  const owned = (g: GameState) => (g.players[0].quest ? 1 : 0) + g.players[0].additionalQuests.length;
  const before = owned(s), discarded = s.questDiscard.length;
  let after = cast(s, 'Ephialtes');
  after = settle(after);
  expect(owned(after) - before).toBe(1);
  expect(after.questDiscard.length - discarded).toBe(1);
 });

 it('Persecution ignores a Trap aimed at its owner and steals the first player token', () => {
  const s = fixture(); s.firstPlayerId = 'p2'; s.players[1].victoryPoints = 3;
  const trap: Card = { id: 'entry-trap', name: 'Entry', kind: 'SPELL', spellType: 'TRAP', target: 'MAGE', range: Infinity, effects: mainEffects([{ effect: 'DAMAGE', amount: 3 }]), triggerTarget: 'EVENT_MODEL', trigger: { event: 'ENTER_ROOM', relation: 'ENEMY', scope: 'ANY', modelKind: 'MAGE' } };
  s.readiedSpells!.push({ id: 'entry-trap', playerId: 'p2', card: trap }); s.activeSpellOrder!.push('entry-trap');
  const persecution = ready(s, 'Persecution', 0);
  s.players[0].prepared.rapid = { used: false, card: mover };
  let after = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid' });
  for (let guard = 0; guard < 12 && after.pendingDecision; guard++) {
   const d = after.pendingDecision;
   if (d.kind === 'REACTIVE_SPELL') {
    const id = d.playerId === 'p2' ? 'entry-trap' : persecution;
    after = applyAction(after, { type: 'RESPOND_REACTIVE_SPELL', playerId: d.playerId, key: d.key, activeSpellId: id, targetId: 'p1' });
    continue;
   }
   after = answer(after, (choice(after).options as { id: string }[])[0].id);
  }
  expect(wounds(after, 0)).toBe(0);
  expect(after.firstPlayerId).toBe('p1');
  expect(after.players[1].victoryPoints).toBe(3);
 });

 it('Persecution steals 1 VP when the Trap owner does not hold the first player token', () => {
  const s = fixture(); s.firstPlayerId = 'p3'; s.players[1].victoryPoints = 3;
  const trap: Card = { id: 'entry-trap', name: 'Entry', kind: 'SPELL', spellType: 'TRAP', target: 'MAGE', range: Infinity, effects: mainEffects([{ effect: 'DAMAGE', amount: 3 }]), triggerTarget: 'EVENT_MODEL', trigger: { event: 'ENTER_ROOM', relation: 'ENEMY', scope: 'ANY', modelKind: 'MAGE' } };
  s.readiedSpells!.push({ id: 'entry-trap', playerId: 'p2', card: trap }); s.activeSpellOrder!.push('entry-trap');
  const persecution = ready(s, 'Persecution', 0);
  const vp = s.players[0].victoryPoints;
  s.players[0].prepared.rapid = { used: false, card: mover };
  let after = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid' });
  for (let guard = 0; guard < 12 && after.pendingDecision; guard++) {
   const d = after.pendingDecision;
   if (d.kind === 'REACTIVE_SPELL') {
    const id = d.playerId === 'p2' ? 'entry-trap' : persecution;
    after = applyAction(after, { type: 'RESPOND_REACTIVE_SPELL', playerId: d.playerId, key: d.key, activeSpellId: id, targetId: 'p1' });
    continue;
   }
   after = answer(after, (choice(after).options as { id: string }[])[0].id);
  }
  expect(wounds(after, 0)).toBe(0);
  expect(after.firstPlayerId).toBe('p3');
  expect(after.players[0].victoryPoints).toBe(vp + 1);
  expect(after.players[1].victoryPoints).toBe(2);
 });

 it('light Persecution takes back up to 3 of the damage and returns it to the source without healing', () => {
  const s = fixture();
  const card = catalog(s, 'Persecution');
  s.readiedSpells!.push({ id: 'light-persecution', playerId: 'p2', card, printed: card, side: 'LIGHT' }); s.activeSpellOrder!.push('light-persecution');
  const strike: Card = { id: 'strike', name: 'Strike', kind: 'SPELL', spellType: 'COMBAT', target: 'MAGE', range: 1, effects: mainEffects([{ effect: 'DAMAGE', amount: 5 }]) };
  s.players[0].prepared.rapid = { used: false, card: strike };
  let after = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p2' });
  for (let guard = 0; guard < 12 && after.pendingDecision; guard++) {
   const d = after.pendingDecision;
   if (d.kind === 'REACTIVE_SPELL') { after = applyAction(after, { type: 'RESPOND_REACTIVE_SPELL', playerId: d.playerId, key: d.key, activeSpellId: 'light-persecution', targetId: 'p2' }); continue; }
   after = answer(after, (choice(after).options as { id: string }[])[0].id);
  }
  expect(wounds(after, 1)).toBe(2);
  expect(wounds(after, 0)).toBe(3);
  expect(after.feedbackEvents.some(e => e.kind === 'HEAL')).toBe(false);
 });
});
