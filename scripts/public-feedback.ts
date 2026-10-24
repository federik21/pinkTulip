import assert from 'node:assert/strict';
import type { GameFeedbackEvent, GameState } from '../packages/game-engine/src/types';

const fields:Record<GameFeedbackEvent['kind'], readonly string[]> = {
 DAMAGE:['target', 'sourceId', 'amount'], HEAL:['target', 'sourceId', 'amount'],
 CONVERT:['target', 'sourceId', 'amount', 'total'],
 MAGE_DEFEATED:['target', 'sourceId', 'contributions', 'awards', 'bonusPlayerId', 'returnedCubes', 'respawnRoomId'],
 SPELL_TRIGGERED:['activeSpellId', 'ownerId', 'cardName', 'spellType', 'trigger', 'target', 'roomId', 'ongoing', 'effects'],
};

export function checkPublicFeedback(state:GameState) {
 const events = state.feedbackEvents ?? [];
 assert.ok(events.length <= 512);
 assert.equal(new Set(events.map(event => event.id)).size, events.length);
 for (const event of events) {
  assert.match(event.id, /^[0-9a-f-]{36}$/i);
  assert.ok(event.round >= 0 && event.round <= state.round);
  assert.ok(Object.keys(event).every(key => ['id', 'round', 'kind', 'interruptId', ...fields[event.kind]].includes(key)),
   'Feedback contains resolution facts, never private card metadata or bindings');
  if (event.interruptId) {
   assert.match(event.interruptId, /^[0-9a-f-]{36}$/i);
   const parent = events.find(candidate => candidate.id === event.interruptId);
   assert.ok(parent?.kind === 'SPELL_TRIGGERED' || !parent && events.length === 512,
    'A nested fact points to its public interrupt (unless the bounded feed pruned it)');
  }
  if ('amount' in event) assert.ok(Number.isInteger(event.amount) && event.amount > 0, 'No fabricated zero-effect feedback');
  if ('target' in event && event.target) {
   assert.ok(Object.keys(event.target).every(key => ['kind', 'id', 'name', 'roomId'].includes(key)));
   assert.ok(['MAGE', 'EVOCATION', 'ROOM'].includes(event.target.kind));
  }
  if (event.kind === 'CONVERT' && event.target.kind !== 'ROOM') {
   const owner = event.target.kind === 'MAGE' ? event.target.id
    : state.evocations.find(model => model.id === event.target.id)?.playerId;
   // A destroyed evocation may be absent from a later STATE; its historical
   // fact is still public. Live own models can never have a conversion fact,
   // regardless of who supplied their wounds or the converter's cube supply.
   if (owner) assert.notEqual(owner, event.sourceId, 'Own-model damage conversion must not emit CONVERT feedback');
  }
  if (event.kind === 'SPELL_TRIGGERED') {
   assert.ok(event.effects?.every(effect => typeof effect === 'string'), 'Reveal instructions are public descriptions, not rules/binding objects');
  }
 }
}

/** Direct healing casts in these smoke flows have no nested damage/reactions. */
export function checkHealingFacts(before:GameState, after:GameState, sourceId:string) {
 const known = new Set((before.feedbackEvents ?? []).map(event => event.id));
 const facts = (after.feedbackEvents ?? []).filter(event => !known.has(event.id) && event.kind === 'HEAL');
 const models = (state:GameState) => [
  ...state.players.map(p => ({ id:p.id, kind:'MAGE', wounds:p.wizard.damageCubes })),
  ...state.evocations.map(e => ({ id:e.id, kind:'EVOCATION', wounds:e.damageCubes })),
 ];
 const previous = models(before), current = models(after);
 const healed = previous.flatMap(model => {
  const next = current.find(candidate => candidate.id === model.id && candidate.kind === model.kind);
  const amount = model.wounds - (next?.wounds ?? model.wounds);
  return amount > 0 ? [{ id:model.id, kind:model.kind, amount }] : [];
 });
 assert.deepEqual(facts.map(event => {
  assert.equal(event.kind, 'HEAL');
  if (event.kind !== 'HEAL') throw new Error('Expected healing fact');
  assert.equal(event.sourceId, sourceId); assert.equal(event.interruptId, undefined);
  return { id:event.target.id, kind:event.target.kind, amount:event.amount };
 }), healed, 'HEAL facts report actual wounds removed, including capped heals and no-op absence');
}