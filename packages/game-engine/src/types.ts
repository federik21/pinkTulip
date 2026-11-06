export type PlayerId = string;
export type RoomId = string;
export type Phase = 'LOBBY' | 'SETUP' | 'BLACK_ROSE' | 'STUDY' | 'PREPARATION' | 'ACTION' | 'EVOCATION' | 'CLEANUP' | 'GAME_OVER';
export type MageDraftId = 'tizio' | 'caio' | 'sempronio' | 'tiriki';
export type Hex = { q: number; r: number };
export type SpellTarget = 'SELF' | 'ROOM' | 'MAGE' | 'EVOCATION' | 'MODEL';
export type SpellType = 'COMBAT' | 'CONTINGENCY' | 'TRAP' | 'PROTECTION';
export type TriggerEvent = 'ENTER_ROOM' | 'DAMAGE_TAKEN' | 'DAMAGE_DEALT' | 'SPELL_CAST' | 'SPELL_TARGETED' | 'ROOM_ACTIVATED' | 'EVOCATION_ACTIVATED' | 'MAGE_ATTACK' | 'EVOCATION_ATTACK' | 'QUEST_SOLVED' | 'MAGE_DEFEATED' | 'VP_CHANGED' | 'EVOCATION_LOST' | 'CUBE_PLACED';
// Jinx cards (Hex school): a negative effect attached to a mage. `cubes` is a plain progress counter.
export type JinxName = 'OBLIVION' | 'SLOWNESS' | 'VULNERABILITY' | 'WEAKNESS';
export type Jinx = { id: string; name: JinxName; cubes: number };
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
export type TriggerCondition = { event: TriggerEvent; relation: 'ENEMY' | 'SELF' | 'ANY'; scope: 'BOUND_MODEL' | 'BOUND_ROOM' | 'BOUND_COLOR' | 'ANY'; relationTo?: 'EVENT_ACTOR' | 'EVENT_MODEL'; damageOrigins?: DamageOrigin[]; roomColors?: RoomColor[]; modelKind?: 'MAGE' | 'EVOCATION'; spellTypes?: SpellType[] };
// One step of an effect. A Moment is a tagged union (the TypeScript equivalent of
// a Swift enum with associated values): add a variant with its own payload to
// teach the engine a new kind of step. A card resolves its moments in array
// order, and the same moment may appear any number of times (e.g. two hits).
// `when` makes a moment conditional on what earlier moments of the same card did:
// it resolves only if the card's chosen model has been defeated or destroyed by then
// (a defeat rescued by a reaction does not count). `area` redirects the moment to
// every other mage within `range` of where the chosen model was. Both compose.
export type MomentCondition = 'TARGET_DEFEATED' | 'UPGRADE_ASSIGNED' | 'EVOCATION_REMOVED' | 'TARGET_JINXED';
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
 | { effect: 'ACTIVATE_CHOICE'; archetype?: 'CONSTRUCT' | 'UNDEAD'; attackBonus?: number; endDamage?: number }
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
 | { effect: 'SEARCH_GRIMOIRE' }
 | { effect: 'DRAW_SCHOOL'; amount: number }
 | { effect: 'RETURN_REVEALED'; elements: Element[] }
 | { effect: 'IF_UNWOUNDED'; draw: number; otherwiseHeal: number }
 // Nightmares (Black Rose evocations attached to mages). The caster picks the slot of each assignment.
 | { effect: 'MOVE_TARGET'; distance: number }
 | { effect: 'ASSIGN_NIGHTMARE'; count?: number; others?: boolean }
 | { effect: 'ASSIGN_PER_EVENT' }
 | { effect: 'ACTIVATE_NIGHTMARES'; of: 'ASSIGNED' | 'TARGET' | 'ALL'; attackBonus?: number }
 | { effect: 'REASSIGN_NIGHTMARES' }
 | { effect: 'STEAL_VP'; amount: number }
 | { effect: 'FIRST_PLAYER' }
 | { effect: 'DISCARD_CARDS'; amount: number; stealVp?: boolean }
 | { effect: 'ACTIVATE_ROOM_IF_NIGHTMARE' }
 | { effect: 'INSTABILITY_PER_NIGHTMARE' }
 | { effect: 'DRAW_EVENT' }
 | { effect: 'GAIN_VP_PER_NIGHTMARE'; max: number }
 | { effect: 'GAIN_VP'; amount: number }
 | { effect: 'GAIN_VP_PER_ALTAR'; max: number }
 | { effect: 'COMPLETE_QUEST' }
 | { effect: 'RESHUFFLE_DRAW'; amount: number }
 | { effect: 'DRAW_QUEST' }
 // `used`: the room is activated even if its reconstructed special was already used.
 | { effect: 'ACTIVATE_TARGET_ROOM'; used?: boolean }
 // Jinx cards (Hex school). CHOICE lets the caster pick any jinx still in the supply.
 | { effect: 'ASSIGN_JINX'; jinx: JinxName | 'CHOICE' }
 // The caster discards one of their active quests or jinxes.
 | { effect: 'DISCARD_QUEST_OR_JINX' }
 // The caster draws spells from their grimoire.
 | { effect: 'DRAW_SPELLS'; amount: number }
 // Cubes in the target's room for each damage the preceding CONVERT could not convert / each jinx on the target.
 | { effect: 'INSTABILITY_PER_UNCONVERTED' }
 | { effect: 'INSTABILITY_PER_JINX' }
 // The target mage chooses: lose `amount` VP, or the triggering spell is ignored.
 | { effect: 'LOSE_VP_OR_PREVENT'; amount: number }
 | { effect: 'MOVE_MODEL'; distance: number }
 | { effect: 'PLACE_ALTAR_CUBES' }
 | { effect: 'PREVENT_SPELL' }
 | { effect: 'BLACK_ROSE_ALTAR_TITHE' }
 // Ignore up to `amount` of the damage just suffered; each ignored point is inflicted on the damage's source.
 | { effect: 'IGNORE_DAMAGE'; amount: number }
) & { scope?: 'CASTER' | 'CASTER_ROOM' | 'TARGET_ROOM' | 'ALL_MAGES' | 'DAMAGED' | 'MOVED'; when?: MomentCondition; area?: { range: number }; magesOnly?: boolean };
export type MomentEffect = Moment['effect'];
// An Effect is an ordered list of Moments. Each Moment is applied in full, in order; the parts of a
// Moment that cannot be applied (even all of them) are skipped and resolution continues with the next
// Moment. An Effect is resolved once every Moment has been attempted, even if none could be applied.
// Quests count Effects (not Moments), so every source of Moments is wrapped in an Effect:
//  - PLACE: the extra Effect of an unstable spell (place 1 instability), resolved before its main Effect
//  - MAIN: a spell card's printed Moments (also used by quest rewards)
//  - ROOM: the Moments generated by an activated room
//  - EXPLORE / ATTACK: the two physical-action Effects
export type EffectKind = 'PLACE' | 'MAIN' | 'ROOM' | 'EXPLORE' | 'ATTACK';
export type Effect = { kind: 'PLACE' | 'MAIN' | 'ROOM'; moments: Moment[] };
// Moments of a physical action. Explore: every MOVE 1, then the room activation.
// Attack: the attack, then the room activation.
export type PhysicalMoment = { moment: 'MOVE'; distance: 1 } | { moment: 'ATTACK' } | { moment: 'ACTIVATE_ROOM' };
export type PhysicalEffect = { kind: 'EXPLORE' | 'ATTACK'; moments: PhysicalMoment[]; resumeAfterDefeat: false };
export type TriggeredInstruction = Moment & { target: 'BOUND_MODEL' | 'BOUND_ROOM' | 'EVENT_MODEL' | 'EVENT_ACTOR' | 'EVENT_ROOM' | 'OWNER' };
// Enhancement: if the caster's other revealed spells show `requires` symbols, the
// enhancement moments are added (before or after the printed ones) and may override the target.
export type Enhancement = { requires: Element[]; moments?: Moment[]; position?: 'BEFORE' | 'AFTER'; target?: SpellTarget; range?: number; suppressReactions?: boolean; text: string };
// Extra printed restrictions on the chosen model.
export type TargetFilter = { own?: boolean; archetype?: 'CONSTRUCT'; maxHealth?: number; sameRoom?: boolean };
// triggerText is optional display copy only; trigger conditions govern matching.
// `effects` are resolved in order. An unstable card starts with a PLACE Effect ("place 1 instability in the
// caster's current room") followed by its MAIN Effect, so quests and triggers that count Effects (not
// Moments) can tell them apart. Reactive cards keep their body in `triggerEffects` and have no MAIN Effect.
export type Card = { id: string; name: string; kind: 'SPELL'; effects: Effect[]; range: number; target: SpellTarget; element?: Element; enhancement?: Enhancement; targetFilter?: TargetFilter; suppressReactions?: boolean; schoolId?: string; powerful?: boolean; spellType?: SpellType; triggerText?: string; rulesText?: string; trigger?: TriggerCondition; triggerTarget?: 'EVENT_MODEL' | 'EVENT_ACTOR' | 'EVENT_ROOM'; triggerSight?: number; targetFrom?: 'EVENT_MODEL'; triggerEffects?: TriggeredInstruction[]; ongoing?: { trigger: TriggerCondition; effects: TriggeredInstruction[] } };
export type ActiveSpell = { id: string; playerId: string; card: Card; targetPlayerId?: string; targetEvocationId?: string; roomId?: string; cleanupDestination?: 'HAND' | 'MEMORIES' };
export type RoomColor = 'crimson' | 'azure' | 'emerald' | 'amber' | 'violet' | 'grey';
export type QuestTrigger =
 | { event: 'SPELL_EFFECT'; spellType?: SpellType; summon?: boolean; elementGroup?: Element[]; minimumElements?: number }
 | { event: 'ROOM_EFFECT'; roomColor: RoomColor }
 | { event: 'INSTABILITY_EFFECT' };
export type RoomEffect =
 | 'ROOM_DAMAGE' | 'DRAW_DISCARD' | 'INSTABILITY' | 'DRAW_QUEST' | 'DRAW_GRIMOIRE' | 'SUMMON_CADAVER' | 'DRAW_POWERFUL' | 'FIRST_PLAYER'
 | 'BR_STANDARD' | 'BR_REBUILT'
 | 'CEMETERY_STANDARD' | 'CEMETERY_REBUILT' | 'CRYPT_STANDARD' | 'CRYPT_REBUILT' | 'ALTAR_STANDARD' | 'ALTAR_REBUILT'
 | 'ALCHEMICAL_LAB_STANDARD' | 'ALCHEMICAL_LAB_REBUILT' | 'ARENA_STANDARD' | 'ARENA_REBUILT' | 'SUMMONER_STANDARD' | 'SUMMONER_REBUILT'
 | 'BIBLIOTHECA_STANDARD' | 'BIBLIOTHECA_REBUILT' | 'OBSERVATORY_STANDARD' | 'OBSERVATORY_REBUILT' | 'SANCTUARY_STANDARD' | 'SANCTUARY_REBUILT'
 | 'FORGE_STANDARD' | 'FORGE_REBUILT' | 'GARDEN_STANDARD' | 'GARDEN_REBUILT' | 'TREASURE_STANDARD' | 'TREASURE_REBUILT'
 | 'ORACLE_STANDARD' | 'ORACLE_REBUILT' | 'ABYSS_STANDARD' | 'ABYSS_REBUILT' | 'MIRRORS_STANDARD' | 'MIRRORS_REBUILT'
 | 'ARMORY_STANDARD' | 'ARMORY_REBUILT' | 'PLEASURE_STANDARD' | 'PLEASURE_REBUILT' | 'THRONE_STANDARD' | 'THRONE_REBUILT';
export type LibraryDeck = { id: string; name: string; cards: Card[]; discard: Card[] };
// ONGOING events skip the discard on reveal and sit on GameState.eventBoard.
// entryPoints go to BR when the event enters; exitPoints when it shifts out.
export type OngoingEventRules = { entryPoints: number; exitPoints: number };
export type EventEffect = 'GIFT_TO_FOOLS' | 'AWAKENING' | 'DISLOCATION' | 'A_HARD_LESSON' | 'REBIRTH_AT_NOON' | 'BLACK_THORNS' | 'REBIRTH_AT_DAWN' | 'REBIRTH_AT_SUNSET' | 'PUPPETEER' | 'MIDNIGHT_REBIRTH' | 'BLACK_OVERLOAD' | 'HIDDEN_RESOURCES' | 'UNDEAD_ARMY';
export type EventCard = {
 id: string; name: string; description: string; kind: 'INSTABILITY' | 'BLACK_DAMAGE' | 'ONGOING' | 'INSTANT'; amount: number; rooms: number;
 ongoing?: OngoingEventRules; effect?: EventEffect; boardSlot?: 0 | 1 | 2; entryPoints?: number; exitPoints?: number; crown?: boolean;
};
export type Quest = {
 id: string; name: string; description: string; kind: 'KILL' | 'REBUILD' | 'INSTABILITY' | 'ROOM_ACTIVATE' | 'SPELL_EFFECT' | 'ROOM_EFFECT' | 'INSTABILITY_EFFECT'; amount: number; reward: number;
 trigger?: QuestTrigger;
 progress?: number; completed?: boolean; claimed?: boolean; rewardAction?: Card;
};
export type PreparedCard = { card: Card; used: boolean };
export type PreparedCards = { rapid: PreparedCard | null; slot1: PreparedCard | null; slot2: PreparedCard | null; slot3: PreparedCard | null };
// health is the authoritative maximum HP; damageCubes tracks current wounds.
export type Wizard = { id: string; playerId: PlayerId; health: number; attack: number; movement: number; damageCubes: number; blackDamage: number; damageByPlayer: Record<PlayerId, number>; damageOrder: PlayerId[]; position: Hex; startingRoomId: RoomId; alive: boolean };
export type EvocationKind = 'CADAVER' | 'SUCCUBUS' | 'COLOSSUS' | 'NIGREDO' | 'UMBRA' | 'TOTEM';
export type Evocation = {
 // At most one attached upgrade; health already includes its bonus.
 upgrade?: UpgradeName;
 id: string; playerId: PlayerId; name: string; archetype: 'UNDEAD' | 'DEMON' | 'CONSTRUCT' | 'NIGHTMARE' | 'ALTAR'; movement: number; attack: number; health: number;
 // Nightmares belong to the Black Rose and attach to a mage; `slot` is the assigned mage's evocation slot (1-3) they strike.
 assignedTo?: PlayerId; slot?: number;
 // Optional for snapshots predating finite model supplies; infer from archetype.
 kind?: EvocationKind;
 // Owner-local model slot, stable for its lifetime; optional for legacy states.
 number?: number;
 passive?: 'WOUNDED_FURY'; position: Hex; damageCubes: number; damageByPlayer: Record<PlayerId, number>; activated: boolean;
 // Triggered ability. SOUL_TITHE: when the owner's mage takes damage, one of those
 // damage cubes may go on this model instead. autoAbility skips the owner's prompt.
 ability?: 'SOUL_TITHE' | 'ENTRY_SHOCK' | 'ALCHEMY' | 'TOTEM'; autoAbility?: boolean;
 // Extra attack on the next/current activation only; cleared when that activation ends.
 bonusAttack?: number;
};
// A root action paused until a mage answers. `resume` is server-private: the
// original action and the answers given so far, replayed once the next answer arrives.
export type DecisionAnswer = { key: string; accept: boolean; activeSpellId?: string; targetId?: string };
export type ReactiveResolutionRecap = { summary: string; sourceCard?: Card; moment?: string };
export type DecisionDetails = {
 kind: 'SOUL_TITHE'; playerId: PlayerId; key: string; evocationId: string; evocationName: string;
 evocationWounds: number; evocationHealth: number; targetId: string; targetName: string;
 sourceName: string; amount: number;
} | {
 kind: 'REACTIVE_SPELL'; playerId: PlayerId; key: string; event: TriggerEvent;
 recap?: ReactiveResolutionRecap;
 options: Array<{ activeSpellId: string; card: Card; targets: FeedbackTarget[] }>;
} | {
 kind: 'CHOICE'; playerId: PlayerId; key: string; prompt: string; optional: boolean;
 options: Array<{ id: string; label: string; roomId?: string }>;
} | { kind: 'WAITING'; playerId: PlayerId; key: string };
export type PendingDecision = DecisionDetails & {
 resume?: { action: GameAction; answers: DecisionAnswer[]; entropy?: { ids: string[]; random: number[] } };
};
export type EvocationActivation = {
 evocationId: string; playerId: PlayerId; movesRemaining: number; returnToAction: boolean;
 // Omitted in older snapshots means the attack has not been used yet.
 attackUsed?: boolean;
 // True while the evocation's single movement block is in progress; it must be spent or ended before the attack.
 moving?: boolean;
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
 mageId?: MageDraftId | null;
 mageSpellSupply?: Card[];
 wizard: Wizard; personalDeck: Card[]; hand: Card[]; discard: Card[]; prepared: PreparedCards;
 cubes: { available: number; onWizard: number; onBoard: number; onEvocations: number; onJinxes?: number }; actionTokens: number; victoryPoints: number;
 questsCompleted: number; kills: number; trophies: PlayerId[]; quest: Quest | null; additionalQuests: Quest[]; studyDrawn: boolean; studyDone: boolean;
 // Actual library draws this Study, private to the owner; never personal/old hand cards.
 studyCardIds?: string[];
 // Jinx cards assigned to this mage (public); omitted on older saves.
 jinxes?: Jinx[];
 preparationDone: boolean; passed: boolean; cardLimit: number; questLimit: number;
};
export type Room = {
 id: RoomId; name: string; tiles: Hex[]; instability: number; instabilityLimit: number;
 // Full rooms reject new cubes immediately; reconstructed/scored change only at
 // Cleanup. After scoring, cubesByPlayer is history, not cubes still on the board.
 cubesByPlayer: Record<PlayerId, number>; reconstructed: boolean; scored: boolean;
 // Placement order lets conversions remove the most recently placed eligible cube.
 instabilityOrder?: PlayerId[];
 rewards: [number, number, number]; startingFor?: PlayerId;
 // `effect` is the room's standard effect; rebuilt overrides are configured independently per room.
 color: RoomColor | null; effect: RoomEffect | null;
 // A null rebuilt effect keeps the standard effect, upgraded by the current rebuild rules.
 rebuiltEffect: RoomEffect | null; specialUsed: boolean;
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
 setupOrder?: PlayerId[];
 setupStage?: 'SCHOOL' | 'MAGE' | null;
 moon?: 1 | 2 | 3;
 moonEvents?: (2 | 3)[];
 blackRose: { victoryPoints: number; kills: number; trophies: PlayerId[] }; firstPlayerId: PlayerId | null; endgameScored: boolean;
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
 // Public ongoing-event board, slot 0 = newest. Optional for older snapshots.
 eventBoard?: (EventCard | null)[];
};
export type GameAction =
 // Transport commands: intercepted by the server, never resolved by the engine.
 | { type: 'ADD_BOT'; playerId: PlayerId }
 | { type: 'REMOVE_BOT'; playerId: PlayerId; botId: PlayerId }
 | { type: 'UNDO_ACTION'; playerId: PlayerId }
 | { type: 'REDO_ACTION'; playerId: PlayerId }
 | { type: 'DRAFT_SCHOOL'; playerId: PlayerId; schoolId: string }
 | { type: 'DRAFT_MAGE'; playerId: PlayerId; mageId: MageDraftId }
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
 | { type: 'BEGIN_EVOCATION_MOVEMENT'; playerId: PlayerId }
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