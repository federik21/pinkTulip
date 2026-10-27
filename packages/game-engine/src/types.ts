export type PlayerId = string;
export type RoomId = string;
export type Phase = 'LOBBY' | 'BLACK_ROSE' | 'STUDY' | 'PREPARATION' | 'ACTION' | 'EVOCATION' | 'CLEANUP' | 'GAME_OVER';
export type Hex = { q: number; r: number };
export type SpellTarget = 'SELF' | 'ROOM' | 'MAGE' | 'EVOCATION' | 'MODEL';
export type SpellType = 'COMBAT' | 'CONTINGENCY' | 'TRAP' | 'PROTECTION';
export type TriggerEvent = 'ENTER_ROOM' | 'DAMAGE_TAKEN' | 'DAMAGE_DEALT' | 'SPELL_CAST' | 'ROOM_ACTIVATED' | 'EVOCATION_ACTIVATED' | 'MAGE_ATTACK' | 'EVOCATION_ATTACK' | 'QUEST_SOLVED' | 'MAGE_DEFEATED' | 'VP_CHANGED' | 'EVOCATION_LOST';
export type UpgradeName = 'CEREBRAL_IMPLANT' | 'CORROSIVE_PLASMA' | 'MUSCULAR_IMPLANT' | 'REGENERATING_ICHOR' | 'REINFORCED_DERMIS' | 'TENDON_IMPLANT';
export type Element = 'air' | 'fire' | 'water' | 'earth' | 'evil' | 'good' | 'stars' | 'wild';
export type DamageOrigin = 'MAGE_PHYSICAL' | 'SPELL' | 'EVOCATION' | 'ROOM' | 'QUEST' | 'NEUTRAL';
export type FeedbackTarget = { kind: 'MAGE' | 'EVOCATION' | 'ROOM'; id: string; name: string; roomId?: string };
export type GameFeedbackEvent = { id: string; round: number; interruptId?: string } & (
 | { kind: 'DAMAGE'; target: FeedbackTarget; sourceId: string; amount: number }
 | { kind: 'HEAL'; target: FeedbackTarget; sourceId: string; amount: number }
 | { kind: 'CONVERT'; target: FeedbackTarget; sourceId: string; amount: number; total: number }
 | { kind: 'MAGE_DEFEATED'; target: FeedbackTarget; sourceId: string; contributions: Record<string, number>; awards: Array<{ playerId: string; cubes: number; rank: number; tied: boolean; points: number }>; bonusPlayerId?: string; returnedCubes: Record<string, number>; respawnRoomId: string }
 | { kind: 'SPELL_TRIGGERED'; activeSpellId: string; ownerId: string; cardName: string; spellType: SpellType; trigger: TriggerEvent; target?: FeedbackTarget; roomId?: string; ongoing: boolean; effects?: string[] }
);
export type TriggerCondition = { event: TriggerEvent; relation: 'ENEMY' | 'SELF' | 'ANY'; scope: 'BOUND_MODEL' | 'BOUND_ROOM' | 'BOUND_COLOR' | 'ANY'; relationTo?: 'EVENT_ACTOR' | 'EVENT_MODEL'; damageOrigins?: DamageOrigin[] };
// One step of an effect. A Moment is a tagged union (the TypeScript equivalent of
// a Swift enum with associated values): add a variant with its own payload to
// teach the engine a new kind of step. A card resolves its moments in array
// order, and the same moment may appear any number of times (e.g. two hits).
// `when` makes a moment conditional on what earlier moments of the same card did:
// it resolves only if the card's chosen model has been defeated or destroyed by then
// (a defeat rescued by a reaction does not count). `area` redirects the moment to
// every other mage within `range` of where the chosen model was. Both compose.
export type MomentCondition = 'TARGET_DEFEATED' | 'UPGRADE_ASSIGNED' | 'EVOCATION_REMOVED';
export type Moment = (
 | { effect: 'DAMAGE'; amount: number }
 | { effect: 'HEAL'; amount: number }
 | { effect: 'CONVERT'; amount: number }
 // An explicit CASTER scope converts that mage's foreign wounds to neutral
 // black damage; it does not enable normal conversion or friendly damage.
 | { effect: 'BLACK_ROSE_CONVERT'; amount: number }
 | { effect: 'INSTABILITY'; amount: number }
 | { effect: 'PAIN'; amount: number }
 | { effect: 'SUMMON'; kind: EvocationKind | 'EVENT_MODEL'; position?: 'CASTER' | 'TARGET' | 'EVENT' | 'REMOVED' | 'CHOICE' }
 // The target loses victory points (never below zero).
 | { effect: 'LOSE_VP'; amount: number }
 // The chosen evocation gets +attack on its next activation.
 | { effect: 'ATTACK_BONUS'; amount: number }
 // The caster moves one model damaged by this effect up to `distance` spaces.
 | { effect: 'MOVE_DAMAGED'; distance: number }
 // Activates the room effect where the chosen (own) evocation stands, even if used; never the central or violet room.
 | { effect: 'ACTIVATE_ROOM' }
 // The owner chooses one of their evocations to activate; optional bonus attack and damage inflicted by the Black Rose when it ends.
 | { effect: 'ACTIVATE_CHOICE'; archetype?: 'CONSTRUCT'; attackBonus?: number; endDamage?: number }
 | { effect: 'ACTIVATE_EVOCATION'; kind: EvocationKind }
 // Activates the chosen evocation under the caster's control (borrowed if it belongs to another mage).
 | { effect: 'ACTIVATE_TARGET' }
 | { effect: 'ASSIGN_UPGRADE'; upgrade: UpgradeName | 'RANDOM'; to?: 'SUMMONED' }
 // The caster may remove one of their evocations standing in the chosen model's room.
 | { effect: 'REMOVE_EVOCATION'; archetype?: 'UNDEAD'; chosen?: boolean }
 // Damage equal to the removed model's attack to every mage in its room and adjacent rooms.
 // Fixed `amount` and `models` (evocations too) override the removed model's attack / mages-only default.
 | { effect: 'REMOVED_BLAST'; amount?: number; models?: boolean }
 | { effect: 'LOOK_LIBRARY'; cards: number }
) & { scope?: 'CASTER' | 'CASTER_ROOM' | 'TARGET_ROOM' | 'ALL_MAGES' | 'DAMAGED'; when?: MomentCondition; area?: { range: number } };
export type MomentEffect = Moment['effect'];
export type TriggeredInstruction = Moment & { target: 'BOUND_MODEL' | 'BOUND_ROOM' | 'EVENT_MODEL' | 'EVENT_ACTOR' | 'EVENT_ROOM' | 'OWNER' };
// Enhancement: if the caster's other revealed spells show `requires` symbols, the
// enhancement moments are added (before or after the printed ones) and may override the target.
export type Enhancement = { requires: Element[]; moments?: Moment[]; position?: 'BEFORE' | 'AFTER'; target?: SpellTarget; range?: number; suppressReactions?: boolean; text: string };
// Extra printed restrictions on the chosen model.
export type TargetFilter = { own?: boolean; archetype?: 'CONSTRUCT'; maxHealth?: number; sameRoom?: boolean };
// triggerText is optional display copy only; trigger conditions govern matching.
export type Card = { id: string; name: string; kind: 'SPELL'; moments: Moment[]; range: number; target: SpellTarget; element?: Element; enhancement?: Enhancement; targetFilter?: TargetFilter; suppressReactions?: boolean; schoolId?: string; powerful?: boolean; instability?: boolean; spellType?: SpellType; triggerText?: string; rulesText?: string; trigger?: TriggerCondition; triggerTarget?: 'EVENT_MODEL' | 'EVENT_ACTOR' | 'EVENT_ROOM'; triggerSight?: number; targetFrom?: 'EVENT_MODEL'; triggerEffects?: TriggeredInstruction[]; ongoing?: { trigger: TriggerCondition; effects: TriggeredInstruction[] } };
export type ActiveSpell = { id: string; playerId: string; card: Card; targetPlayerId?: string; targetEvocationId?: string; roomId?: string; cleanupDestination?: 'HAND' | 'MEMORIES' };
export type RoomColor = 'crimson' | 'azure' | 'emerald' | 'amber' | 'violet' | 'grey';
export type RoomEffect = 'ROOM_DAMAGE' | 'DRAW_DISCARD' | 'INSTABILITY' | 'DRAW_QUEST' | 'DRAW_GRIMOIRE' | 'SUMMON_CADAVER' | 'DRAW_POWERFUL' | 'FIRST_PLAYER';
export type LibraryDeck = { id: string; name: string; cards: Card[]; discard: Card[] };
export type EventCard = { id: string; name: string; description: string; kind: 'INSTABILITY' | 'BLACK_DAMAGE'; amount: number; rooms: number };
export type Quest = {
 id: string; name: string; description: string; kind: 'KILL' | 'REBUILD' | 'INSTABILITY' | 'ROOM_ACTIVATE'; amount: number; reward: number;
 progress?: number; completed?: boolean; claimed?: boolean; rewardAction?: Card;
};
export type PreparedCard = { card: Card; used: boolean };
export type PreparedCards = { rapid: PreparedCard | null; slot1: PreparedCard | null; slot2: PreparedCard | null; slot3: PreparedCard | null };
// health is the authoritative maximum HP; damageCubes tracks current wounds.
export type Wizard = { id: string; playerId: PlayerId; health: number; attack: number; movement: number; damageCubes: number; blackDamage: number; damageByPlayer: Record<PlayerId, number>; damageOrder: PlayerId[]; position: Hex; startingRoomId: RoomId; alive: boolean };
export type EvocationKind = 'CADAVER' | 'SUCCUBUS' | 'COLOSSUS' | 'NIGREDO';
export type Evocation = {
 // At most one attached upgrade; health already includes its bonus.
 upgrade?: UpgradeName;
 id: string; playerId: PlayerId; name: string; archetype: 'UNDEAD' | 'DEMON' | 'CONSTRUCT'; movement: number; attack: number; health: number;
 // Optional for snapshots predating finite model supplies; infer from archetype.
 kind?: EvocationKind;
 // Owner-local model slot, stable for its lifetime; optional for legacy states.
 number?: number;
 passive?: 'WOUNDED_FURY'; position: Hex; damageCubes: number; damageByPlayer: Record<PlayerId, number>; activated: boolean;
 // Triggered ability. SOUL_TITHE: when the owner's mage takes damage, one of those
 // damage cubes may go on this model instead. autoAbility skips the owner's prompt.
 ability?: 'SOUL_TITHE' | 'ENTRY_SHOCK' | 'ALCHEMY'; autoAbility?: boolean;
 // Extra attack on the next/current activation only; cleared when that activation ends.
 bonusAttack?: number;
};
// A root action paused until a mage answers. `resume` is server-private: the
// original action and the answers given so far, replayed once the next answer arrives.
export type DecisionAnswer = { key: string; accept: boolean; activeSpellId?: string; targetId?: string };
export type DecisionDetails = {
 kind: 'SOUL_TITHE'; playerId: PlayerId; key: string; evocationId: string; evocationName: string;
 evocationWounds: number; evocationHealth: number; targetId: string; targetName: string;
 sourceName: string; amount: number;
} | {
 kind: 'REACTIVE_SPELL'; playerId: PlayerId; key: string; event: TriggerEvent;
 options: Array<{ activeSpellId: string; card: Card; targets: FeedbackTarget[] }>;
} | {
 kind: 'CHOICE'; playerId: PlayerId; key: string; prompt: string; optional: boolean;
 options: Array<{ id: string; label: string }>;
} | { kind: 'WAITING'; playerId: PlayerId; key: string };
export type PendingDecision = DecisionDetails & {
 resume?: { action: GameAction; answers: DecisionAnswer[]; entropy?: { ids: string[]; random: number[] } };
};
export type EvocationActivation = {
 evocationId: string; playerId: PlayerId; movesRemaining: number; returnToAction: boolean;
 // Omitted in older snapshots means the attack has not been used yet.
 attackUsed?: boolean;
 // Damage the Black Rose inflicts on the evocation when this activation ends.
 endDamage?: number;
 // Borrowed: playerId controls a model owned by this mage. Tendon: free Black Rose movement.
 borrowedFrom?: PlayerId; tendon?: boolean;
 // A spell may grant control outside its owner's turn, even during another
 // evocation activation. Preserve only public control state, not game snapshots.
 resume?: { currentPlayerId: PlayerId | null; evocationActivation: EvocationActivation | null };
};
export type Player = {
 id: PlayerId; name: string; connected: boolean; ready: boolean;
 // Server-controlled seat; omitted on older saves and human players.
 isBot?: boolean;
 startingSchoolId?: string | null;
 wizard: Wizard; personalDeck: Card[]; hand: Card[]; discard: Card[]; prepared: PreparedCards;
 cubes: { available: number; onWizard: number; onBoard: number; onEvocations: number }; actionTokens: number; victoryPoints: number;
 questsCompleted: number; kills: number; trophies: PlayerId[]; quest: Quest | null; additionalQuests: Quest[]; studyDrawn: boolean; studyDone: boolean;
 // Actual library draws this Study, private to the owner; never personal/old hand cards.
 studyCardIds?: string[];
 preparationDone: boolean; passed: boolean; cardLimit: number; questLimit: number;
};
export type Room = {
 id: RoomId; name: string; tiles: Hex[]; instability: number; instabilityLimit: number;
 // Full rooms reject new cubes immediately; reconstructed/scored change only at
 // Cleanup. After scoring, cubesByPlayer is history, not cubes still on the board.
 cubesByPlayer: Record<PlayerId, number>; reconstructed: boolean; scored: boolean;
 rewards: [number, number, number]; startingFor?: PlayerId;
 color: RoomColor | null; effect: RoomEffect | null; specialUsed: boolean;
};
export type Board = { tiles: Hex[]; rooms: Room[] };
export type PhysicalAction = { kind: 'EXPLORE' | 'ATTACK'; mainEffectUsed: boolean; movementStarted: boolean };
// actionsUsed counts every turn action, including spells and discard-to-move.
export type Activation = { playerId: PlayerId; actionsUsed: number; exploring: number; sequencedSpellUsed: boolean; spellsCast: number; discardedExit: boolean; roomEffectUsed: boolean; physicalAction?: PhysicalAction | null; mustExitCell?: boolean };
export type TurnRecapCard = { at: number; role: 'CAST' | 'DISCARDED' | 'TRIGGERED'; ownerId: PlayerId; card: Card; trigger?: TriggerEvent };
// `lines` is the public log of one Action-phase turn; each card is shown after line `at - 1`.
// Only publicly revealed cards are recorded: a hidden Trap/Protection appears once it triggers.
export type TurnRecap = { id: string; round: number; playerId: PlayerId; playerName: string; isBot: boolean; lines: string[]; cards: TurnRecapCard[] };
export type GameState = {
 gameId: string; hostId: PlayerId; round: number; phase: Phase; players: Player[]; board: Board;
 // Undefined selects the roster-based default at START_GAME, not during play.
 roomsPerColor?: 1 | 2 | 3;
 blackRose: { victoryPoints: number; kills: number }; firstPlayerId: PlayerId | null; endgameScored: boolean;
 // Server-owned, per-viewer metadata only. Undo/redo snapshots are private to the
 // server and must never be added to this shared/wire schema.
 history?: { canUndo: boolean; canRedo: boolean; undoLabel?: string; redoLabel?: string };
 library: LibraryDeck[]; eventDeck: EventCard[]; eventDiscard: EventCard[]; questDeck: Quest[]; questDiscard: Quest[];
 powerfulDeck: Card[]; removedCards: Card[];
 readiedSpells?: ActiveSpell[]; ongoingSpells?: ActiveSpell[];
 // Instance IDs only: stable chronology across both active zones, safe to mask.
 activeSpellOrder?: string[];
 evocations: Evocation[]; evocationActivation: EvocationActivation | null; tendonQueue?: string[];
 // While set, only the named mage may answer; the paused root action is replayed from `resume`.
 pendingDecision?: PendingDecision | null;
 currentPlayerId: PlayerId | null; activation: Activation | null; winner: PlayerId | null; log: string[];
 // Public resolution facts only; optional for snapshots created before feedback events.
 feedbackEvents?: GameFeedbackEvent[];
 // Draft of the turn in progress, and the last few finished turns (oldest first).
 turnRecapDraft?: { playerId: PlayerId; logStart: number; cards: TurnRecapCard[] } | null;
 turnRecaps?: TurnRecap[];
 usedEvent: EventCard | null; blackRoseResolved: boolean;
};
export type GameAction =
 // Transport commands: intercepted by the server, never resolved by the engine.
 | { type: 'ADD_BOT'; playerId: PlayerId }
 | { type: 'REMOVE_BOT'; playerId: PlayerId; botId: PlayerId }
 | { type: 'UNDO_ACTION'; playerId: PlayerId }
 | { type: 'REDO_ACTION'; playerId: PlayerId }
 | { type: 'SELECT_STARTING_SCHOOL'; playerId: PlayerId; schoolId: string }
 | { type: 'SET_READY'; playerId: PlayerId; ready: boolean }
 | { type: 'SET_ROOM_COUNT'; playerId: PlayerId; roomsPerColor: 1 | 2 | 3 | null }
 | { type: 'START_GAME'; playerId: PlayerId }
 | { type: 'ADVANCE_PHASE'; playerId: PlayerId; expectedPhase: Phase; expectedRound: number }
 | ({ type: 'DRAW_STUDY'; playerId: PlayerId } & ({ deckId: string; deckIds?: never } | { deckIds: string[]; deckId?: never }))
 | { type: 'DISCARD_STUDY'; playerId: PlayerId; cardIds: string[] }
 | { type: 'DISCARD_QUESTS'; playerId: PlayerId; questIds: string[] }
 | { type: 'DISCARD_HAND_LIMIT'; playerId: PlayerId; cardIds: string[] }
 // Numbered entries retain their slot index; null means an intentionally empty slot.
 | { type: 'PREPARE_CARDS'; playerId: PlayerId; rapidCardId?: string; preparedCardIds: (string | null)[] }
 | { type: 'END_ACTIVATION'; playerId: PlayerId }
 | { type: 'RESPOND_SOUL_TITHE'; playerId: PlayerId; accept: boolean }
 | { type: 'RESPOND_CHOICE'; playerId: PlayerId; key: string; choiceId?: string }
 | { type: 'RESPOND_REACTIVE_SPELL'; playerId: PlayerId; key: string; activeSpellId?: string; targetId?: string }
 | { type: 'ACTIVATE_SPELL'; playerId: PlayerId; slot: 'rapid' | 'slot1' | 'slot2' | 'slot3' }
 | { type: 'SET_ACTIVE_SPELL_CLEANUP'; playerId: PlayerId; activeSpellId: string; destination: 'HAND' | 'MEMORIES' }
 | { type: 'SET_EVOCATION_AUTO'; playerId: PlayerId; evocationId: string; auto: boolean }
 | { type: 'USE_QUEST_REWARD'; playerId: PlayerId; questId: string; targetPlayerId?: PlayerId; targetEvocationId?: string; roomId?: RoomId; dummy?: boolean }
 | { type: 'PASS_ROUND'; playerId: PlayerId }
 | { type: 'ACTIVATE_EVOCATION'; playerId: PlayerId; evocationId: string }
 | { type: 'EVOCATION_STEP'; playerId: PlayerId; destination: Hex }
 | { type: 'END_EVOCATION_MOVEMENT'; playerId: PlayerId }
 | { type: 'EVOCATION_ATTACK'; playerId: PlayerId; targetId: string }
 | { type: 'END_EVOCATION'; playerId: PlayerId }
 | { type: 'BEGIN_PHYSICAL_ACTION'; playerId: PlayerId; kind: 'EXPLORE' | 'ATTACK' }
 | { type: 'PERFORM_MOVEMENT'; playerId: PlayerId }
 | { type: 'ACTIVATE_ROOM'; playerId: PlayerId; roomTargetId?: RoomId }
 | { type: 'SKIP_PHYSICAL_EFFECTS'; playerId: PlayerId }
 | { type: 'INFLICT_ATTACK'; playerId: PlayerId; targetId: string }
 | { type: 'EXPLORE'; playerId: PlayerId; activateRoomAtStart?: boolean; roomTargetId?: RoomId }
 | { type: 'EXPLORE_STEP'; playerId: PlayerId; destination: Hex; activateRoomAtEnd?: boolean; roomTargetId?: RoomId }
 | { type: 'END_EXPLORE'; playerId: PlayerId; activateRoomAtEnd?: boolean; roomTargetId?: RoomId }
 | { type: 'DISCARD_EXIT'; playerId: PlayerId; cardId: string; destination: Hex }
 | { type: 'PUNCH'; playerId: PlayerId; targetId: PlayerId; roomEffect?: 'START' | 'END'; roomTargetId?: RoomId }
 | { type: 'CAST_SPELL'; playerId: PlayerId; slot: 'rapid' | 'slot1' | 'slot2' | 'slot3'; targetPlayerId?: PlayerId; targetEvocationId?: string; roomId?: RoomId; dummy?: boolean }
 // Legacy wire compatibility only: forgotten spells must be prepared and use CAST_SPELL.
 | { type: 'CAST_POWERFUL_SPELL'; playerId: PlayerId; cardId: string; targetPlayerId?: PlayerId; targetEvocationId?: string; roomId?: RoomId; dummy?: boolean };