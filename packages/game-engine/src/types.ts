export type PlayerId = string;
export type RoomId = string;
export type Phase = 'LOBBY' | 'BLACK_ROSE' | 'STUDY' | 'PREPARATION' | 'ACTION' | 'EVOCATION' | 'CLEANUP' | 'GAME_OVER';
export type Hex = { q: number; r: number };
export type Card = { id: string; name: string; kind: 'SPELL'; damage: number; instability: number; range: number; target: 'MODEL' | 'ROOM'; schoolId?: string; powerful?: boolean };
export type RoomColor = 'crimson' | 'azure' | 'emerald' | 'amber' | 'violet' | 'grey';
export type RoomEffect = 'ROOM_DAMAGE' | 'DRAW_DISCARD' | 'INSTABILITY' | 'DRAW_QUEST' | 'DRAW_GRIMOIRE' | 'SUMMON_CADAVER' | 'DRAW_POWERFUL';
export type LibraryDeck = { id: string; name: string; cards: Card[]; discard: Card[] };
export type EventCard = { id: string; name: string; description: string; kind: 'INSTABILITY' | 'BLACK_DAMAGE'; amount: number; rooms: number };
export type Quest = { id: string; name: string; description: string; kind: 'KILL' | 'REBUILD' | 'INSTABILITY'; amount: number; reward: number };
export type PreparedCard = { card: Card; used: boolean };
export type PreparedCards = { rapid: PreparedCard | null; slot1: PreparedCard | null; slot2: PreparedCard | null; slot3: PreparedCard | null };
// health is the authoritative maximum HP; damageCubes tracks current wounds.
export type Wizard = { id: string; playerId: PlayerId; health: number; attack: number; movement: number; damageCubes: number; blackDamage: number; damageByPlayer: Record<PlayerId, number>; position: Hex; startingRoomId: RoomId; alive: boolean };
export type Evocation = {
 id: string; playerId: PlayerId; name: string; archetype: 'UNDEAD'; movement: number; attack: number; health: number;
 passive: 'WOUNDED_FURY'; position: Hex; damageCubes: number; damageByPlayer: Record<PlayerId, number>; activated: boolean;
};
export type EvocationActivation = { evocationId: string; playerId: PlayerId; movesRemaining: number; returnToAction: boolean };
export type Player = {
 id: PlayerId; name: string; connected: boolean; ready: boolean;
 wizard: Wizard; personalDeck: Card[]; hand: Card[]; discard: Card[]; prepared: PreparedCards;
 cubes: { available: number; onWizard: number; onBoard: number; onEvocations: number }; actionTokens: number; victoryPoints: number;
 questsCompleted: number; kills: number; quest: Quest | null; additionalQuests: Quest[]; studyDrawn: boolean; studyDone: boolean;
 preparationDone: boolean; passed: boolean; cardLimit: number; questLimit: number;
};
export type Room = {
 id: RoomId; name: string; tiles: Hex[]; instability: number; instabilityLimit: number;
 cubesByPlayer: Record<PlayerId, number>; reconstructed: boolean; scored: boolean;
 rewards: [number, number]; startingFor?: PlayerId;
 color: RoomColor | null; effect: RoomEffect | null; specialUsed: boolean;
};
export type Board = { tiles: Hex[]; rooms: Room[] };
export type PhysicalAction = { kind: 'EXPLORE' | 'ATTACK'; mainEffectUsed: boolean; movementStarted: boolean };
// actionsUsed counts every turn action, including spells and discard-to-move.
export type Activation = { playerId: PlayerId; actionsUsed: number; exploring: number; sequencedSpellUsed: boolean; spellsCast: number; discardedExit: boolean; roomEffectUsed: boolean; physicalAction?: PhysicalAction | null };
export type GameState = {
 gameId: string; hostId: PlayerId; round: number; phase: Phase; players: Player[]; board: Board;
 library: LibraryDeck[]; eventDeck: EventCard[]; eventDiscard: EventCard[]; questDeck: Quest[]; questDiscard: Quest[];
 powerfulDeck: Card[]; removedCards: Card[];
 evocations: Evocation[]; evocationActivation: EvocationActivation | null;
 currentPlayerId: PlayerId | null; activation: Activation | null; winner: PlayerId | null; log: string[];
 usedEvent: EventCard | null; blackRoseResolved: boolean;
};
export type GameAction =
 | { type: 'SET_READY'; playerId: PlayerId; ready: boolean }
 | { type: 'START_GAME'; playerId: PlayerId }
 | { type: 'ADVANCE_PHASE'; playerId: PlayerId; expectedPhase: Phase; expectedRound: number }
 | { type: 'DRAW_STUDY'; playerId: PlayerId; deckId: string }
 | { type: 'DISCARD_STUDY'; playerId: PlayerId; cardIds: string[] }
 | { type: 'DISCARD_QUESTS'; playerId: PlayerId; questIds: string[] }
 | { type: 'DISCARD_HAND_LIMIT'; playerId: PlayerId; cardIds: string[] }
 | { type: 'PREPARE_CARDS'; playerId: PlayerId; rapidCardId: string; preparedCardIds: string[] }
 | { type: 'END_ACTIVATION'; playerId: PlayerId }
 | { type: 'PASS_ROUND'; playerId: PlayerId }
 | { type: 'ACTIVATE_EVOCATION'; playerId: PlayerId; evocationId: string }
 | { type: 'EVOCATION_STEP'; playerId: PlayerId; destination: Hex }
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
 | { type: 'CAST_POWERFUL_SPELL'; playerId: PlayerId; cardId: string; targetPlayerId?: PlayerId; targetEvocationId?: string; roomId?: RoomId; dummy?: boolean };