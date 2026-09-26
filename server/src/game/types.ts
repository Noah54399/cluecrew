import type {
  ContentSource,
  GameSettings,
  GameFlash,
  GuessResult,
  ModeAvailability,
  ModeId,
  Phase,
  RoomStatus,
} from '@cluecrew/shared';
import type { GameTimings } from '../config.js';
import type { ContentItem } from '../providers/types.js';

export interface EnginePlayer {
  id: string;
  userId: string | null;
  name: string;
  avatarSeed: number;
  avatarUrl: string | null;
  isHost: boolean;
  connected: boolean;
  source: ContentSource;
  socketCount: number;
  joinedAt: number;
  lastSeenAt: number;
}

export interface EngineAnswer {
  targetPlayerId: string;
  at: number;
}

export interface EngineRound {
  id: string;
  roundNumber: number;
  mode: ModeId;
  content: ContentItem;
  actorPlayerId: string;
  answerablePlayerIds: string[];
  startedAt: number;
  guessingStartedAt: number | null;
  guessingEndsAt: number | null;
  answers: Map<string, EngineAnswer>;
  lockedAt: number | null;
  revealedAt: number | null;
  results: GuessResult[] | null;
  actorBonus: number | null;
  skipped: boolean;
}

export interface EngineScore {
  points: number;
  correctGuesses: number;
  timesActor: number;
  roundPoints: number;
}

export interface EngineRoom {
  id: string;
  code: string;
  status: RoomStatus;
  phase: Phase;
  phaseEndsAt: number | null;
  paused: boolean;
  hostPlayerId: string | null;
  players: EnginePlayer[];
  settings: GameSettings;
  gameNumber: number;
  gameId: string | null;
  roundNumber: number;
  roundId: string | null;
  round: EngineRound | null;
  scores: Map<string, EngineScore>;
  actorCounts: Map<string, number>;
  usedContent: Map<string, Set<string>>;
  lastRoundActorId: string | null;
  eligibleModes: ModeId[];
  suppliersByMode: Record<ModeId, string[]>;
  availability: ModeAvailability[];
  availableModes: ModeId[];
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}

export interface EngineDeps {
  now(): number;
  rng(): number;
  timings: GameTimings;
}

export interface RoundCandidate {
  mode: ModeId;
  actorPlayerId: string;
}

export type EngineEffect =
  | { type: 'phase'; phase: Phase }
  | { type: 'flash'; flash: GameFlash }
  | { type: 'toast'; kind: 'info' | 'success' | 'warn' | 'error'; message: string }
  | {
      type: 'round_resolved';
      gameId: string;
      roundId: string;
      actorPlayerId: string;
      results: GuessResult[];
      actorBonus: number;
    }
  | { type: 'round_closed'; roundId: string; status: 'revealed' | 'skipped' }
  | { type: 'next_round' }
  | { type: 'game_closed'; gameId: string; status: 'finished' | 'aborted' }
  | { type: 'persist_room' };

export function createEngineRoom(params: {
  id: string;
  code: string;
  settings: GameSettings;
  hostPlayerId: string | null;
  now: number;
}): EngineRoom {
  const emptySuppliers = {
    who_liked: [],
    who_reposted: [],
    who_saved: [],
    who_posted: [],
  } as Record<ModeId, string[]>;
  return {
    id: params.id,
    code: params.code,
    status: 'lobby',
    phase: 'WAITING_FOR_PLAYERS',
    phaseEndsAt: null,
    paused: false,
    hostPlayerId: params.hostPlayerId,
    players: [],
    settings: params.settings,
    gameNumber: 0,
    gameId: null,
    roundNumber: 0,
    roundId: null,
    round: null,
    scores: new Map(),
    actorCounts: new Map(),
    usedContent: new Map(),
    lastRoundActorId: null,
    eligibleModes: [],
    suppliersByMode: emptySuppliers,
    availability: [],
    availableModes: [],
    createdAt: params.now,
    updatedAt: params.now,
    lastActivityAt: params.now,
  };
}

export function getPlayer(room: EngineRoom, playerId: string): EnginePlayer | undefined {
  return room.players.find((player) => player.id === playerId);
}

export function ensureScore(room: EngineRoom, playerId: string): EngineScore {
  let score = room.scores.get(playerId);
  if (!score) {
    score = { points: 0, correctGuesses: 0, timesActor: 0, roundPoints: 0 };
    room.scores.set(playerId, score);
  }
  return score;
}
