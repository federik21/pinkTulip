export type PlayerId = string;
export type RoomId = string;
export type Phase = 'LOBBY' | 'BLACK_ROSE' | 'STUDY' | 'PREPARATION' | 'ACTION' | 'EVOCATION' | 'CLEANUP' | 'GAME_OVER';
export type Hex = { q: number; r: number };
export type SpellTarget = 'SELF' | 'ROOM' | 'MAGE' | 'EVOCATION' | 'MODEL';
export type SpellType = 'COMBAT' | 'CONTINGENCY' | 'TRAP' | 'PROTECTION';
export type TriggerEvent = 'ENTER_ROOM' | 'DAMAGE_TAKEN' | 'DAMAGE_DEALT' | 'SPELL_CAST' | 'ROOM_ACTIVATED' | 'EVOCATION_ACTIVATED' | 'MAGE_ATTACK' | 'EVOCATION_ATTACK' | 'QUEST_SOLVED' | 'MAGE_DEFEATED' | 'VP_CHANGED';
export type FeedbackTarget = { kind: 'MAGE' | 'EVOCATION' | 'ROOM'; id: string; name: string; roomId?: string };
export type GameFeedbackEvent = { id: string; round: number; interruptId?: string } & (
 | { kind: 'DAMAGE'; target: FeedbackTarget; sourceId: string; amount: number }
 | { kind: 'HEAL'; target: FeedbackTarget; sourceId: string; amount: number }
 | { kind: 'CONVERT'; target: FeedbackTarget; sourceId: string; amount: number; total: number }
 | { kind: 'MAGE_DEFEATED'; target: FeedbackTarget; sourceId: string; contributions: Record<string, number>; awards: Array<{ playerId: string; cubes: number; rank: number; tied: boolean; points: number }>; bonusPlayerId?: string; returnedCubes: Record<string, number>; respawnRoomId: string }
 | { kind: 'SPELL_TRIGGERED'; activeSpellId: string; ownerId: string; cardName: string; spellType: SpellType; trigger: TriggerEvent; target?: FeedbackTarget; roomId?: string; ongoing: boolean; effects?: string[] }
);
export type TriggerCondition = { event: TriggerEvent; relation: 'ENEMY' | 'SELF' | 'ANY'; scope: 'BOUND_MODEL' | 'BOUND_ROOM' | 'BOUND_COLOR' | 'ANY' };
// One step of an effect. A Moment is a tagged union (the TypeScript equivalent of
// a Swift enum with associated values): add a variant with its own payload to
// teach the engine a new kind of step. A card resolves its moments in array
// order, and the same moment may appear any number of times (e.g. two hits).
export type MomentSplash = { amount?: number; range: number; when: 'AFTER_DEFEAT' };
export type Moment =
 | { effect: 'DAMAGE'; amount: number; splash?: MomentSplash }
 | { effect: 'HEAL'; amount: number }
 | { effect: 'CONVERT'; amount: number }
 | { effect: 'BLACK_ROSE_CONVERT'; amount: number }
 | { effect: 'INSTABILITY'; amount: number }
 | { effect: 'PAIN'; amount: number }
 | { effect: 'SUMMON'; kind: 'SUCCUBUS'; position?: 'CASTER' | 'TARGET' }
 | { effect: 'ACTIVATE_EVOCATION'; kind: 'SUCCUBUS' };
export type MomentEffect = Moment['effect'];
export type TriggeredInstruction = Moment & { target: 'BOUND_MODEL' | 'BOUND_ROOM' | 'EVENT_MODEL' | 'EVENT_ACTOR' | 'EVENT_ROOM' | 'OWNER' };
export type Card = { id: string; name: string; kind: 'SPELL'; moments: Moment[]; range: number; target: SpellTarget; schoolId?: string; powerful?: boolean; spellType?: SpellType; rulesText?: string; trigger?: TriggerCondition; triggerEffects?: TriggeredInstruction[]; ongoing?: { trigger: TriggerCondition; effects: TriggeredInstruction[] } };
export type ActiveSpell = { id: string; playerId: string; card: Card; targetPlayerId?: string; targetEvocationId?: string; roomId?: string; cleanupDestination?: 'HAND' | 'MEMORIES' };
export type RoomColor = 'crimson' | 'azure' | 'emerald' | 'amber' | 'violet' | 'grey';
export type RoomEffect = 'ROOM_DAMAGE' | 'DRAW_DISCARD' | 'INSTABILITY' | 'DRAW_QUEST' | 'DRAW_GRIMOIRE' | 'SUMMON_CADAVER' | 'DRAW_POWERFUL';
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
export type EvocationKind = 'CADAVER' | 'SUCCUBUS';
export type Evocation = {
 id: string; playerId: PlayerId; name: string; archetype: 'UNDEAD' | 'DEMON'; movement: number; attack: number; health: number;
 // Optional for snapshots predating finite model supplies; infer from archetype.
 kind?: EvocationKind;
 // Owner-local model slot, stable for its lifetime; optional for legacy states.
 number?: number;
 passive?: 'WOUNDED_FURY'; position: Hex; damageCubes: number; damageByPlayer: Record<PlayerId, number>; activated: boolean;
 // Triggered ability. SOUL_TITHE: when the owner's mage takes damage, one of those
 // damage cubes may go on this model instead. autoAbility skips the owner's prompt.
 ability?: 'SOUL_TITHE'; autoAbility?: boolean;
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
} | { kind: 'WAITING'; playerId: PlayerId; key: string };
export type PendingDecision = DecisionDetails & {
 resume?: { action: GameAction; answers: DecisionAnswer[]; entropy?: { ids: string[]; random: number[] } };
};
export type EvocationActivation = {
 evocationId: string; playerId: PlayerId; movesRemaining: number; returnToAction: boolean;
 // Omitted in older snapshots means the attack has not been used yet.
 attackUsed?: boolean;
};
export type Player = {
 id: PlayerId; name: string; connected: boolean; ready: boolean;
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
export type Activation = { playerId: PlayerId; actionsUsed: number; exploring: number; sequencedSpellUsed: boolean; spellsCast: number; discardedExit: boolean; roomEffectUsed: boolean; physicalAction?: PhysicalAction | null };
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
 evocations: Evocation[]; evocationActivation: EvocationActivation | null;
 // While set, only the named mage may answer; the paused root action is replayed from `resume`.
 pendingDecision?: PendingDecision | null;
 currentPlayerId: PlayerId | null; activation: Activation | null; winner: PlayerId | null; log: string[];
 // Public resolution facts only; optional for snapshots created before feedback events.
 feedbackEvents?: GameFeedbackEvent[];
 usedEvent: EventCard | null; blackRoseResolved: boolean;
};
export type GameAction =
 // Transport commands: intercepted by the server, never resolved by the engine.
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