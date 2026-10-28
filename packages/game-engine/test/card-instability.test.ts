import { describe, expect, it } from 'vitest';
import { applyAction, createGame, moment } from '../src';
import type { Card, GameState } from '../src';

function fixture(instability = true): GameState {
 const s = createGame(2); s.phase = 'ACTION'; s.round = 1; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1';
 s.activation = { playerId: 'p1', actionsUsed: 0, exploring: 0, sequencedSpellUsed: false, spellsCast: 0, discardedExit: false, roomEffectUsed: false };
 for (const p of s.players) p.wizard.position = { q: 0, r: 0 };
 const deck = s.library[0], index = deck.cards.findIndex(c => c.name === 'Peak of Agony');
 const card = deck.cards.splice(index, 1)[0];
 card.moments = [...(instability ? [moment.inCasterRoom(moment.instability(1))] : []), moment.damage(1)]; card.target = 'ROOM'; card.range = 2;
 s.players[0].prepared.rapid = { card, used: false };
 return s;
}
const room = (s: GameState, id: string) => s.board.rooms.find(r => r.id === id)!;

describe('instability as a separate first spell effect', () => {
 it('places 1 cube in the caster room before the main effect', () => {
  const s = fixture(true), card = s.players[0].prepared.rapid!.card;
  expect(card.moments[0]).toEqual({ effect: 'INSTABILITY', amount: 1, scope: 'CASTER_ROOM' });
  const target = s.board.rooms.find(r => r.id !== 'room-0,0' && !r.startingFor && r.tiles.some(h => Math.abs(h.q) + Math.abs(h.r) <= 1))!;
  const result = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', roomId: target.id });
  expect(room(result, 'room-0,0').instability).toBe(1);
  expect(room(result, target.id).instability).toBe(0);
  const placed = result.log.findIndex(l => l.includes('places 1 instability in'));
  const main = result.log.findIndex(l => l.includes('Moment 2/2'));
  expect(placed).toBeGreaterThan(-1); expect(main).toBeGreaterThan(placed);
  expect(result.players[0].cubes.onBoard).toBe(1);
 });
 it('adds nothing when the spell has no instability moment', () => {
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
});
