import {
 applyAction, areAdjacent, areInSameRoom, canStartGame, canUseSpellDummy,
 GameRuleError, getDiscardMoveCards, getEffectiveSpell, getEvocationSupply, getQuestRewardTargets, getSpellType,
 hexDistance, hexKey, isInStartingRoom, isWithinSpellRange, MAGE_DRAFT_POOL,
} from '@brw/game-engine';
import type { Card, FeedbackTarget, GameAction, GameState, Hex, Moment, Player, Room } from '@brw/game-engine';

type Slot = keyof Player['prepared'];
type Target = Pick<Extract<GameAction, { type: 'CAST_SPELL' }>, 'targetPlayerId' | 'targetEvocationId' | 'roomId' | 'dummy'>;
type Model = { id: string; playerId: string; kind: 'MAGE' | 'EVOCATION'; position: Hex; health: number; wounds: number; cubes: Record<string, number> };
type Choice = { target: Target; score: number };
const numbered: Slot[] = ['slot1', 'slot2', 'slot3'];
// The intersection also permits compiling against snapshots predating the optional flag.
const bot = (p: Player & { isBot?: boolean }) => p.isBot === true && p.connected;
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const at = (room: Room, h: Hex) => room.tiles.some(t => hexKey(t) === hexKey(h));
const roomAt = (s: GameState, h: Hex) => s.board.rooms.find(r => at(r, h));
const quests = (p: Player) => [...(p.quest ? [p.quest] : []), ...p.additionalQuests];

/** Only public model facts. Never spread an opponent Player into a scoring object. */
function models(s: GameState): Model[] {
 return [
  ...s.players.map(p => ({ id: p.id, playerId: p.id, kind: 'MAGE' as const, position: p.wizard.position,
   health: p.wizard.health, wounds: p.wizard.damageCubes, cubes: p.wizard.damageByPlayer })),
  ...s.evocations.filter(e => e.archetype !== 'NIGHTMARE' && e.damageCubes < e.health).map(e => ({ id: e.id, playerId: e.playerId, kind: 'EVOCATION' as const, position: e.position,
   health: e.health, wounds: e.damageCubes, cubes: e.damageByPlayer })),
 ];
}
function enemies(s: GameState, p: Player): Model[] {
 return models(s).filter(m => m.playerId !== p.id && !roomAt(s, m.position)?.startingFor)
  .sort((a, b) => (a.health - a.wounds) - (b.health - b.wounds) || compareId(a.id, b.id));
}

// The card's separate instability effect (Card.instability) is scored like a printed caster-room moment.
const PRINTED_INSTABILITY: Moment = { effect: 'INSTABILITY', amount: 1, scope: 'CASTER_ROOM' };
function steps(card: Card, reactive = false): Moment[] {
 const printed = reactive && !card.moments.length ? card.triggerEffects ?? [] : card.moments;
 return card.instability ? [PRINTED_INSTABILITY, ...printed] : printed;
}
function cardValue(card: Card): number {
 return steps(card, true).reduce((value, m) => value + (
  m.effect === 'SUMMON' ? 6 : m.effect === 'ACTIVATE_EVOCATION' ? 2 :
  m.effect === 'ASSIGN_UPGRADE' ? 4 : m.effect === 'ACTIVATE_TARGET' ? 3 :
  m.effect === 'REMOVE_EVOCATION' || m.effect === 'REMOVED_BLAST' || m.effect === 'MOVE_DAMAGED' || m.effect === 'ATTACK_BONUS' ? 0 : m.effect === 'LOOK_LIBRARY' ? 5 :
  m.effect === 'ACTIVATE_ROOM' || m.effect === 'ACTIVATE_CHOICE' ? 3 : m.effect === 'LOSE_VP' ? 3 * m.amount :
  m.effect === 'PAIN' ? -2 * m.amount : m.effect === 'DAMAGE' ? 3 * m.amount :
  m.effect === 'INSTABILITY' ? 4 * m.amount :
  'amount' in m ? m.amount : 3
 ), 0) + (card.ongoing ? 6 : 0) + (card.trigger ? 4 : 0) + Math.min(card.range, 4);
}
function bestCards(cards: Card[]): Card[] {
 return [...cards].sort((a, b) => cardValue(b) - cardValue(a) || compareId(a.id, b.id));
}
function worstCards(cards: Card[]): Card[] {
 return [...bestCards(cards)].reverse();
}

/** A printed-effect heuristic, NOT a simulation of random draws or hidden reactions. */
function targetValue(s: GameState, p: Player, card: Card, target: FeedbackTarget, reactive = false): number {
 const all = models(s), room = target.kind === 'ROOM' ? s.board.rooms.find(r => r.id === target.id) : roomAt(s, all.find(m => m.id === target.id)?.position ?? p.wizard.position);
 const selected = target.kind === 'ROOM' ? all.filter(m => room && at(room, m.position)) : all.filter(m => m.id === target.id);
 let value = 0;
 for (const m of steps(card, reactive)) {
  // Match resolveMomentBody: the selected/reveal room wins, with the owner's
  // current room only as fallback (including out-of-turn model reactions).
  const affected = m.scope === 'CASTER' ? all.filter(t => t.id === p.id) : m.scope === 'CASTER_ROOM' ? all.filter(t => room ? at(room, t.position) : areInSameRoom(s, p.wizard.position, t.position)) : selected;
  if (m.effect === 'PAIN') { value -= m.amount * 2; continue; }
  if (m.effect === 'SUMMON') {
   if (m.kind !== 'EVENT_MODEL' && getEvocationSupply(s)[m.kind] > 0 && s.evocations.filter(e => e.playerId === p.id).length < 3) value += 7;
   continue;
  }
  if (m.effect === 'ASSIGN_UPGRADE') {
   // Only upgrade friendly models, except when the printed spell grants a bonus anyway.
   value += selected.some(t => t.playerId === p.id) ? 3 : -1;
   continue;
  }
  if (m.effect === 'ACTIVATE_TARGET') {
   value += selected.some(t => t.playerId !== p.id) ? 2 : 1;
   continue;
  }
  if (m.effect === 'REMOVE_EVOCATION' || m.effect === 'REMOVED_BLAST' || m.effect === 'LOOK_LIBRARY') {
   if (m.effect === 'LOOK_LIBRARY') value += 2;
   continue;
  }
  if (m.effect === 'LOSE_VP') {
   value += selected.some(t => t.playerId !== p.id && t.kind === 'MAGE') ? 3 * m.amount : 0;
   continue;
  }
  if (m.effect === 'ACTIVATE_ROOM' || m.effect === 'ACTIVATE_CHOICE') { value += 1; continue; }
  if (m.effect === 'ATTACK_BONUS' || m.effect === 'MOVE_DAMAGED') continue;
  if (m.effect === 'ACTIVATE_EVOCATION') {
   if (getEvocationSupply(s)[m.kind] > 0 && s.evocations.filter(e => e.playerId === p.id).length < 3) value += 1;
   continue;
  }
  if (m.effect === 'INSTABILITY') {
   if (room && !room.reconstructed) value += 3 * Math.min(m.amount, room.instabilityLimit - room.instability, p.cubes.available);
   continue;
  }
  for (const model of affected) {
   const friend = model.playerId === p.id;
   if (m.effect === 'DAMAGE' && !friend) {
    value += 4 * Math.min(m.amount, model.health - model.wounds);
    if (m.amount >= model.health - model.wounds) value += model.kind === 'MAGE' ? 8 : 3;
   }
   if (m.effect === 'HEAL') value += (friend ? 3 : -3) * Math.min(m.amount, model.wounds);
   if (m.effect === 'CONVERT' && !friend) value += 2 * Math.min(m.amount, Object.entries(model.cubes).reduce((n, [id, cubes]) => n + (id === p.id ? 0 : cubes), 0));
  }
 }
 if (card.ongoing && selected.some(m => m.playerId !== p.id)) value += 5;
 return value;
}
function payload(target: FeedbackTarget): Target {
 return target.kind === 'ROOM' ? { roomId: target.id } : target.kind === 'MAGE' ? { targetPlayerId: target.id } : { targetEvocationId: target.id };
}
function targets(s: GameState, p: Player, card: Card): Choice[] {
 const choices = getQuestRewardTargets(s, p, card).map(t => ({ target: payload(t), score: targetValue(s, p, card, t) }));
 choices.sort((a, b) => b.score - a.score || compareId(JSON.stringify(a.target), JSON.stringify(b.target)));
 return choices;
}

/** Reverse BFS over actual board tiles; protected cells are never transit nodes. */
function route(s: GameState, p: Player, origin: Hex, evocation = false): Hex[] {
 const tiles = s.board.tiles.filter(h => !roomAt(s, h)?.startingFor).sort((a, b) => a.q - b.q || a.r - b.r);
 const enemy = enemies(s, p);
 const goals = tiles.filter(h => enemy.some(m => evocation ? areInSameRoom(s, h, m.position) : hexKey(h) === hexKey(m.position)));
 // No exposed enemy: converge on the center rather than probing protected cells.
 if (!goals.length) {
  const center = [...tiles].sort((a, b) => hexDistance(a, { q: 0, r: 0 }) - hexDistance(b, { q: 0, r: 0 }) || compareId(hexKey(a), hexKey(b)))[0];
  if (center) goals.push(center);
 }
 const distances = new Map<string, number>(goals.map(h => [hexKey(h), 0]));
 const queue = [...goals];
 for (let i = 0; i < queue.length; i++) {
  for (const next of tiles) if (areAdjacent(queue[i], next) && !distances.has(hexKey(next))) {
   distances.set(hexKey(next), distances.get(hexKey(queue[i]))! + 1); queue.push(next);
  }
 }
 const current = distances.get(hexKey(origin)) ?? Infinity;
 return tiles.filter(h => areAdjacent(origin, h) && (distances.get(hexKey(h)) ?? Infinity) < current)
  .sort((a, b) => distances.get(hexKey(a))! - distances.get(hexKey(b))! || a.q - b.q || a.r - b.r);
}

function* roomActions(s: GameState, p: Player): Generator<GameAction> {
 const room = roomAt(s, p.wizard.position);
 if (!room?.effect || room.startingFor || (room.reconstructed && room.specialUsed)) return;
 if (room.effect === 'INSTABILITY') {
  const rooms = s.board.rooms.filter(r => !r.startingFor && !r.reconstructed && r.instability < r.instabilityLimit)
   .sort((a, b) => (a.instabilityLimit - a.instability) - (b.instabilityLimit - b.instability) || compareId(a.id, b.id));
  for (const target of rooms) if (target.tiles.some(h => room.tiles.some(origin => isWithinSpellRange(origin, h, 1)))) {
   yield { type: 'ACTIVATE_ROOM', playerId: p.id, roomTargetId: target.id };
  }
 }
 yield { type: 'ACTIVATE_ROOM', playerId: p.id };
}
function* discardExit(s: GameState, p: Player): Generator<GameAction> {
 const cards = worstCards(getDiscardMoveCards(p,s.activation?.playerId===p.id?s.activation:null));
 for (const destination of route(s, p, p.wizard.position)) for (const card of cards) {
  yield { type: 'DISCARD_EXIT', playerId: p.id, cardId: card.id, destination };
 }
}
function* physical(s: GameState, p: Player): Generator<GameAction> {
 const a = s.activation!;
 if (a.exploring > 0) {
  for (const destination of route(s, p, p.wizard.position)) yield { type: 'EXPLORE_STEP', playerId: p.id, destination };
  if (!a.physicalAction && !a.roomEffectUsed) yield { type: 'END_EXPLORE', playerId: p.id, activateRoomAtEnd: true };
  yield { type: 'END_EXPLORE', playerId: p.id };
 }
 const pending = a.physicalAction;
 if (!pending) return;
 if (!pending.mainEffectUsed) {
  if (pending.kind === 'EXPLORE' && !pending.movementStarted) yield { type: 'PERFORM_MOVEMENT', playerId: p.id };
  if (pending.kind === 'ATTACK') for (const enemy of enemies(s, p)) {
   // Adjacent/same-room candidates are tested too; the current engine allows same HEX only.
   if (areInSameRoom(s, enemy.position, p.wizard.position) || hexDistance(enemy.position, p.wizard.position) <= 1)
    yield { type: 'INFLICT_ATTACK', playerId: p.id, targetId: enemy.id };
  }
 }
 if (!a.roomEffectUsed) yield* roomActions(s, p);
 yield { type: 'SKIP_PHYSICAL_EFFECTS', playerId: p.id };
}
function* evocation(s: GameState, p: Player): Generator<GameAction> {
 const active = s.evocationActivation;
 if (!active) {
  for (const e of s.evocations.filter(e => e.playerId === p.id && e.damageCubes < e.health && !e.activated)) yield { type: 'ACTIVATE_EVOCATION', playerId: p.id, evocationId: e.id };
  return;
 }
 const e = s.evocations.find(e => e.id === active.evocationId);
 if (!e) return; // The engine normally releases destroyed models before returning a state.
 if (!active.attackUsed) for (const enemy of enemies(s, p)) if (areInSameRoom(s, e.position, enemy.position)) {
  yield { type: 'EVOCATION_ATTACK', playerId: p.id, targetId: enemy.id };
 }
 if (active.movesRemaining > 0) for (const destination of route(s, p, e.position, true)) yield { type: 'EVOCATION_STEP', playerId: p.id, destination };
 yield { type: 'END_EVOCATION', playerId: p.id };
}

function* decisions(s: GameState, p: Player): Generator<GameAction> {
 const d = s.pendingDecision!;
 if (d.kind === 'SOUL_TITHE') {
  // Preserve a one-wound servant unless sacrificing it could save the mage.
  const accept = d.evocationWounds + 1 < d.evocationHealth || p.wizard.damageCubes + d.amount >= p.wizard.health;
  yield { type: 'RESPOND_SOUL_TITHE', playerId: p.id, accept };
  yield { type: 'RESPOND_SOUL_TITHE', playerId: p.id, accept: !accept };
 } else if (d.kind === 'CHOICE') {
  // Bots decline optional removals and otherwise take the first (best-listed) option.
  if (d.optional) yield { type: 'RESPOND_CHOICE', playerId: p.id, key: d.key };
  for (const option of d.options) yield { type: 'RESPOND_CHOICE', playerId: p.id, key: d.key, choiceId: option.id };
 } else if (d.kind === 'REACTIVE_SPELL') {
  const choices = d.options.flatMap(option => option.targets.map(target => ({
   activeSpellId: option.activeSpellId, targetId: target.id, score: targetValue(s, p, option.card, target, true),
  }))).sort((a, b) => b.score - a.score || compareId(a.activeSpellId, b.activeSpellId) || compareId(a.targetId, b.targetId));
  for (const c of choices) if (c.score > 0) yield { type: 'RESPOND_REACTIVE_SPELL', playerId: p.id, key: d.key, activeSpellId: c.activeSpellId, targetId: c.targetId };
  yield { type: 'RESPOND_REACTIVE_SPELL', playerId: p.id, key: d.key };
 }
}

function* actionTurn(s: GameState, p: Player): Generator<GameAction> {
 const a = s.activation;
 if (!a || a.playerId !== p.id) return;
 if (a.physicalAction || a.exploring > 0) { yield* physical(s, p); return; }
 for (const quest of quests(p).filter(q => q.completed && !q.claimed)) {
  if (!quest.rewardAction) yield { type: 'USE_QUEST_REWARD', playerId: p.id, questId: quest.id };
  else for (const choice of targets(s, p, quest.rewardAction)) yield { type: 'USE_QUEST_REWARD', playerId: p.id, questId: quest.id, ...choice.target };
 }
 if (isInStartingRoom(s, p)) {
  yield { type: 'BEGIN_PHYSICAL_ACTION', playerId: p.id, kind: 'EXPLORE' };
  yield* discardExit(s, p);
 } else {
  const next = numbered.find(slot => p.prepared[slot] && !p.prepared[slot]!.used);
  const available: Slot[] = [...(next && !a.sequencedSpellUsed ? [next] : []), 'rapid'];
  const spells: Array<{ action: GameAction; score: number }> = [];
  for (const slot of available) {
   const prepared = p.prepared[slot];
   if (!prepared || prepared.used) continue;
   const card = prepared.card;
   if (['TRAP', 'PROTECTION'].includes(getSpellType(card))) spells.push({ action: { type: 'ACTIVATE_SPELL', playerId: p.id, slot }, score: 2 });
   else for (const choice of targets(s, p, getEffectiveSpell(s, p, card))) spells.push({ action: { type: 'CAST_SPELL', playerId: p.id, slot, ...choice.target }, score: choice.score });
  }
  spells.sort((a, b) => b.score - a.score); // Stable ties preserve numbered-before-Quick order.
  for (const spell of spells) if (spell.score > 0) yield spell.action;
  // Real targets only. PUNCH's validation handles future adjacent-attack rules too.
  for (const enemy of enemies(s, p)) if (areInSameRoom(s, p.wizard.position, enemy.position) || hexDistance(p.wizard.position, enemy.position) <= 1) {
   for (const roomEffect of ['END', undefined] as const) yield { type: 'PUNCH', playerId: p.id, targetId: enemy.id, ...(roomEffect ? { roomEffect } : {}) };
  }
  // Paid model activations are worthwhile only if an attack is reachable this activation.
  for (const e of s.evocations.filter(e => e.playerId === p.id && e.damageCubes < e.health)) {
   const reachable = enemies(s, p).some(enemy => s.board.rooms.some(r => at(r, enemy.position) && r.tiles.some(h => hexDistance(e.position, h) <= e.movement)));
   if (reachable) yield { type: 'ACTIVATE_EVOCATION', playerId: p.id, evocationId: e.id };
  }
  if (route(s, p, p.wizard.position).length) yield { type: 'BEGIN_PHYSICAL_ACTION', playerId: p.id, kind: 'EXPLORE' };
  // Spending a remaining physical token still progresses at the goal, with an optional room effect.
  yield { type: 'BEGIN_PHYSICAL_ACTION', playerId: p.id, kind: 'ATTACK' };
  // Exhaust unproductive preparations rather than repeatedly ending fresh turns forever.
  for (const spell of spells) if (spell.score <= 0) yield spell.action;
  for (const slot of available) {
   const c = p.prepared[slot];
   if (c && !c.used && !['TRAP', 'PROTECTION'].includes(getSpellType(c.card)) && canUseSpellDummy(c.card)) {
    for (const room of s.board.rooms) if (!room.startingFor && room.tiles.some(h => isWithinSpellRange(p.wizard.position, h, c.card.range)))
     yield { type: 'CAST_SPELL', playerId: p.id, slot, dummy: true, roomId: room.id };
   }
  }
 }
 yield { type: 'PASS_ROUND', playerId: p.id };
 yield { type: 'END_ACTIVATION', playerId: p.id };
}

function* candidates(s: GameState): Generator<GameAction> {
 const decision = s.pendingDecision;
 if (decision) {
  const p = s.players.find(p => p.id === decision.playerId);
  if (p && bot(p)) yield* decisions(s, p);
  return;
 }
 if (s.phase === 'LOBBY') {
  for (const p of s.players.filter(bot))if(!p.ready)yield {type:'SET_READY',playerId:p.id,ready:true};
  // Normal transport history auto-starts on the last SET_READY. This fallback is
  // only for direct engine callers / an already-ready lobby with a BOT host.
  const host = s.players.find(p => p.id === s.hostId);
  if (host && bot(host) && canStartGame(s)) yield { type: 'START_GAME', playerId: host.id };
  return;
 }
 if(s.phase==='SETUP') {
  const order=s.setupOrder??[];
  const draftOrder=s.setupStage==='MAGE'?[...order].reverse():order;
  const drafter=draftOrder.map(id=>s.players.find(p=>p.id===id)).find(p=>p&&(s.setupStage==='SCHOOL'?p.startingSchoolId==null:p.mageId==null));
  if(drafter&&bot(drafter)) {
   if(s.setupStage==='SCHOOL') {
    const options=s.library.filter(deck=>!s.players.some(p=>p.startingSchoolId===deck.id)&&deck.cards.length+deck.discard.length>=6);
    if(options.length)yield {type:'DRAFT_SCHOOL',playerId:drafter.id,schoolId:options[Math.floor(Math.random()*options.length)].id};
   } else if(s.setupStage==='MAGE') {
    const options=MAGE_DRAFT_POOL.filter(mage=>!s.players.some(p=>p.mageId===mage.id));
    if(options.length)yield {type:'DRAFT_MAGE',playerId:drafter.id,mageId:options[Math.floor(Math.random()*options.length)].id};
   }
  }
  return;
 }
 if (s.phase === 'BLACK_ROSE' && s.evocationActivation?.tendon) {
  const owner = s.players.find(p => p.id === s.evocationActivation!.playerId);
  if (owner && bot(owner)) yield { type: 'END_EVOCATION', playerId: owner.id };
  return;
 }
 if (s.phase === 'BLACK_ROSE' && s.blackRoseResolved) {
  for (const p of s.players.filter(bot)) {
   const held = quests(p), excess = held.length - p.questLimit;
   if (excess > 0) yield { type: 'DISCARD_QUESTS', playerId: p.id, questIds: [...held].sort((a, b) => Number(a.completed) - Number(b.completed) || (a.progress ?? 0) - (b.progress ?? 0) || a.reward - b.reward || compareId(a.id, b.id)).slice(0, excess).map(q => q.id) };
  }
  return;
 }
 if (s.phase === 'STUDY' || s.phase === 'PREPARATION') {
  for (const p of s.players.filter(bot)) {
   if (s.phase === 'STUDY') {
    if (!p.studyDrawn) {
     const deckIds: string[] = [];
     // Blind selection: ONLY school IDs and stock lengths, never card identities.
     for (const deck of [...s.library].sort((a, b) => compareId(a.id, b.id))) {
      for (let i = 0; i < deck.cards.length + deck.discard.length && deckIds.length < 4; i++) deckIds.push(deck.id);
     }
     if (deckIds.length === 4) yield { type: 'DRAW_STUDY', playerId: p.id, deckIds };
    } else if (!p.studyDone) yield { type: 'DISCARD_STUDY', playerId: p.id, cardIds: worstCards(p.hand.filter(c => p.studyCardIds?.includes(c.id) && !c.powerful)).slice(0, 2).map(c => c.id) };
   } else if (!p.preparationDone) {
    const excess = p.hand.length - p.cardLimit;
    if (excess > 0) yield { type: 'DISCARD_HAND_LIMIT', playerId: p.id, cardIds: worstCards(p.hand).slice(0, excess).map(c => c.id) };
    else {
     const cards = bestCards(p.hand).slice(0, 4);
     if (cards.length >= 2) yield { type: 'PREPARE_CARDS', playerId: p.id, preparedCardIds: cards.slice(0, -1).map(c => c.id), rapidCardId: cards[cards.length - 1].id };
    }
   }
  }
  // Current engine transitions atomically on the last discard/preparation. Only
  // offer a synchronization fallback in an all-done state, and only as a bot host;
  // the legality oracle rejects it in this engine. Never impersonate a human host.
  const done = s.players.every(p => s.phase === 'STUDY' ? p.studyDone : p.preparationDone);
  const host = s.players.find(p => p.id === s.hostId);
  if (done && host && bot(host)) yield { type: 'ADVANCE_PHASE', playerId: host.id, expectedPhase: s.phase, expectedRound: s.round };
  return;
 }
 const p = s.players.find(p => p.id === (s.evocationActivation?.playerId ?? s.currentPlayerId));
 if (!p || !bot(p)) return;
 if (s.evocationActivation || s.phase === 'EVOCATION') yield* evocation(s, p);
 else if (s.phase === 'ACTION') yield* actionTurn(s, p);
}

/**
 * Stateless, deterministic, one-command policy. Reinvoke on each authoritative
 * state, including out-of-turn decisions and spell-granted model activations.
 *
 * Priorities: decisions > setup > active model/physical effects > free rewards >
 * useful spells/hidden activation > real attacks > pursuit > exhaust/end/pass.
 * Black Rose/Cleanup continuation is ALWAYS external (also for all-bot games).
 * Study/Preparation auto-transition in the current engine; no timers or roster
 * changes, hidden-state lookahead, random-result scoring or multi-ply search.
 *
 * applyAction is a legality oracle ONLY: its resulting state is discarded, and
 * only GameRuleError means "try next". Clones protect even suspended replay data.
 * At most 1,024 ordered candidates are tried; null also covers paused/disconnected
 * games, invalid legacy states, exhausted stock, or a phase requiring human input.
 * In particular, four starting grimoires consume 28 of Agony's 36 cards: the
 * fourth Study draw is impossible after the first three keep two each. This
 * engine/supply limitation cannot be repaired by a normal bot action.
 */
export function chooseBotAction(game: GameState): GameAction | null {
 if (game.phase === 'GAME_OVER' || (game.phase !== 'LOBBY' && game.players.some(p => !p.connected))) return null;
 let tried = 0;
 for (const action of candidates(game)) {
  if (++tried > 1024) break;
  try { applyAction(structuredClone(game), structuredClone(action)); return action; }
  catch (error) { if (!(error instanceof GameRuleError)) throw error; }
 }
 return null;
}