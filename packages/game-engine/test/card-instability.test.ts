import { describe, expect, it } from 'vitest';
import { applyAction, createGame, moment } from '../src';
import type { Card, GameState } from '../src';

function fixture(instability = true, legacyMoment = false): GameState {
 const s = createGame(2); s.phase = 'ACTION'; s.round = 1; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false, spellsCast: 0, discardedExit: false, roomEffectUsed: false };
 for (const p of s.players) p.wizard.position = { q: 0, r: 0 };
 const deck = s.library[0], index = deck.cards.findIndex(c => c.name === 'Peak of Agony');
 const card = deck.cards.splice(index, 1)[0];
 card.moments = [...(instability && legacyMoment ? [moment.inCasterRoom(moment.instability(1))] : []), moment.damage(1)]; card.target = 'ROOM'; card.range = 2;
 if (instability && !legacyMoment) card.instability = true; else delete card.instability;
 s.players[0].prepared.rapid = { card, used: false };
 return s;
}
const room = (s: GameState, id: string) => s.board.rooms.find(r => r.id === id)!;

describe('instability as a separate first spell effect', () => {
 it('places 1 cube in the caster room as its own effect before the main effect', () => {
  const s = fixture(true), card = s.players[0].prepared.rapid!.card;
  expect(card.instability).toBe(true);
  expect(card.moments.map(m => m.effect)).toEqual(['DAMAGE']);
  const target = s.board.rooms.find(r => r.id !== 'room-0,0' && !r.startingFor && r.tiles.some(h => Math.abs(h.q) + Math.abs(h.r) <= 1))!;
  const result = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', roomId: target.id });
  expect(room(result, 'room-0,0').instability).toBe(1);
  expect(room(result, target.id).instability).toBe(0);
  const effect1 = result.log.findIndex(l => l.includes('Effect 1/2') && l.includes('instability'));
  const effect2 = result.log.findIndex(l => l.includes('Effect 2/2'));
  const placed = result.log.findIndex(l => l.includes('places 1 instability in'));
  const main = result.log.findIndex(l => l.includes('Moment 1/1'));
  expect(effect1).toBeGreaterThan(-1); expect(placed).toBeGreaterThan(effect1);
  expect(effect2).toBeGreaterThan(placed); expect(main).toBeGreaterThan(effect2);
  expect(result.log.some(l => l.includes('Moment 2/'))).toBe(false);
  expect(result.players[0].cubes.onBoard).toBe(1);
 });
 it('still resolves a printed first moment in the legacy moment form', () => {
  const s = fixture(true, true), target = s.board.rooms.find(r => r.id !== 'room-0,0' && !r.startingFor && r.tiles.some(h => Math.abs(h.q) + Math.abs(h.r) <= 1))!;
  const result = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', roomId: target.id });
  expect(room(result, 'room-0,0').instability).toBe(1);
  expect(result.log.some(l => l.includes('Moment 2/2'))).toBe(true);
 });
 it('keeps resolving the main effect where the caster stood after a mid-spell defeat', () => {
  const s = fixture(true), p = s.players[0], card = p.prepared.rapid!.card;
  card.moments = [moment.pain(p.wizard.health), moment.inCasterRoom(moment.instability(1)), moment.summon('CADAVER')];
  const target = s.board.rooms.find(r => r.id !== 'room-0,0' && !r.startingFor && r.tiles.some(h => Math.abs(h.q) + Math.abs(h.r) <= 1))!;
  const result = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', roomId: target.id });
  expect(result.pendingDecision).toBeUndefined();
  expect(result.feedbackEvents?.some(e => e.kind === 'MAGE_DEFEATED')).toBe(true);
  expect(result.players[0].wizard.position).not.toEqual({ q: 0, r: 0 });
  // Printed effect (1) + the caster-room moment after the defeat (1), both where the spell was cast.
  expect(room(result, 'room-0,0').instability).toBe(2);
  expect(result.evocations.filter(e => e.playerId === 'p1').map(e => e.position)).toEqual([{ q: 0, r: 0 }]);
 });
 it('adds nothing when the spell has no instability', () => {
  const s = fixture(false), target = s.board.rooms.find(r => r.id !== 'room-0,0' && !r.startingFor && r.tiles.some(h => Math.abs(h.q) + Math.abs(h.r) <= 1))!;
  const result = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', roomId: target.id });
  expect(room(result, 'room-0,0').instability).toBe(0);
  expect(result.log.some(l => l.toLowerCase().includes('instability'))).toBe(false);
 });
 it('resolves a reactive card’s first instability instruction in its owner’s room', () => {
  const s = fixture(false), attack = s.players[0].prepared.rapid!.card;
  attack.target = 'MAGE'; attack.moments = [moment.damage(1)];
  const reaction:Card={id:'unstable-protection',name:'Unstable protection',kind:'SPELL',spellType:'PROTECTION',target:'SELF',range:0,moments:[],
   trigger:{event:'DAMAGE_TAKEN',relation:'ENEMY',scope:'BOUND_MODEL'},
   triggerEffects:[{effect:'INSTABILITY',amount:1,scope:'CASTER_ROOM',target:'OWNER'}]};
  s.readiedSpells=[{id:reaction.id,playerId:'p2',targetPlayerId:'p2',card:reaction}];s.activeSpellOrder=[reaction.id];
  const paused=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
  expect(paused.pendingDecision).toMatchObject({kind:'REACTIVE_SPELL',playerId:'p2'});
  const result=applyAction(paused,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:paused.pendingDecision!.key,activeSpellId:reaction.id,targetId:'p2'});
  expect(room(result,'room-0,0').instability).toBe(1);
  expect(result.log.some(line=>line.includes('instability in the caster’s room'))).toBe(true);
 });
 it('resolves a reactive card’s printed instability as its own first effect', () => {
  const s = fixture(false), attack = s.players[0].prepared.rapid!.card;
  attack.target = 'MAGE'; attack.moments = [moment.damage(1)];
  const reaction:Card={id:'flagged-protection',name:'Flagged protection',kind:'SPELL',spellType:'PROTECTION',target:'SELF',range:0,moments:[],instability:true,
   trigger:{event:'DAMAGE_TAKEN',relation:'ENEMY',scope:'BOUND_MODEL'},
   triggerEffects:[{effect:'HEAL',amount:1,target:'OWNER'}]};
  s.readiedSpells=[{id:reaction.id,playerId:'p2',targetPlayerId:'p2',card:reaction}];s.activeSpellOrder=[reaction.id];
  const paused=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
  const result=applyAction(paused,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:paused.pendingDecision!.key,activeSpellId:reaction.id,targetId:'p2'});
  expect(room(result,'room-0,0').instability).toBe(1);
  const effect1=result.log.findIndex(l=>l.includes('Effect 1/2')&&l.includes('Flagged protection'));
  const moment1=result.log.findIndex(l=>l.includes('Moment 1/1')&&l.includes('Flagged protection'));
  expect(effect1).toBeGreaterThan(-1);expect(moment1).toBeGreaterThan(effect1);
 });
});
