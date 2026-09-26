/**
 * @cluecrew/shared — the contract between server and client.
 *
 * Everything in this package is provider-agnostic and contains no secrets.
 * New game modes can be added by extending MODE_IDS + MODES and registering
 * a server-side mode handler (see server/src/game/modes.ts).
 */

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

export const BRAND = {
  name: 'ClueCrew',
  tagline: 'Guess who did it.',
  shortDescription: 'A real-time party game for you and your friends.',
  protocolVersion: 1,
  version: '1.1.0',
} as const;

// ---------------------------------------------------------------------------
// Game modes
// ---------------------------------------------------------------------------

export const MODE_IDS = ['who_liked', 'who_reposted', 'who_saved', 'who_posted'] as const;
export type ModeId = (typeof MODE_IDS)[number];

export type ActionKind = 'like' | 'repost' | 'save' | 'post';

export type ModeIcon = 'heart' | 'repeat' | 'bookmark' | 'clapper';
export type ModeAccent = 'pink' | 'mint' | 'violet' | 'amber';

export interface ModeDefinition {
  id: ModeId;
  kind: ActionKind;
  title: string;
  /** Large headline shown during the round. */
  question: string;
  /** Used in reveal sentences: "{Name} liked this". */
  verbPhrase: string;
  description: string;
  icon: ModeIcon;
  accent: ModeAccent;
}

export const MODES: Record<ModeId, ModeDefinition> = {
  who_liked: {
    id: 'who_liked',
    kind: 'like',
    title: 'Who Liked?',
    question: 'WHO LIKED THIS?',
    verbPhrase: 'liked this',
    description: 'One player liked this video. Guess who.',
    icon: 'heart',
    accent: 'pink',
  },
  who_reposted: {
    id: 'who_reposted',
    kind: 'repost',
    title: 'Who Reposted?',
    question: 'WHO REPOSTED THIS?',
    verbPhrase: 'reposted this',
    description: 'One player reposted this video. Guess who.',
    icon: 'repeat',
    accent: 'mint',
  },
  who_saved: {
    id: 'who_saved',
    kind: 'save',
    title: 'Who Saved?',
    question: 'WHO SAVED THIS?',
    verbPhrase: 'saved this',
    description: 'One player saved this video. Guess who.',
    icon: 'bookmark',
    accent: 'violet',
  },
  who_posted: {
    id: 'who_posted',
    kind: 'post',
    title: 'Who Posted This?',
    question: 'WHO POSTED THIS?',
    verbPhrase: 'posted this',
    description: 'One player posted this video. Guess who.',
    icon: 'clapper',
    accent: 'amber',
  },
};

export function isModeId(value: unknown): value is ModeId {
  return typeof value === 'string' && (MODE_IDS as readonly string[]).includes(value);
}

/** Static knowledge about official TikTok API availability, mirrored from docs/TIKTOK-API.md. */
export interface OfficialAccessInfo {
  supported: boolean;
  scope?: string;
  /** 'standard' = any reviewed app, 'special' = separate approval process */
  approval: 'standard' | 'special' | 'none';
  note: string;
}

export const OFFICIAL_TIKTOK_ACCESS: Record<ModeId, OfficialAccessInfo> = {
  who_liked: {
    supported: false,
    approval: 'special',
    scope: 'portability.all.ongoing',
    note: 'Liked videos are only available through TikTok\u2019s Data Portability full-archive export (all-data scope, separate approval, EEA/UK users). The "activity" scope does NOT include likes.',
  },
  who_reposted: {
    supported: false,
    approval: 'special',
    scope: 'research.data.basic',
    note: 'Reposts are not a documented Data Portability data type; only the academic Research API exposes them.',
  },
  who_saved: {
    supported: false,
    approval: 'special',
    scope: 'portability.all.ongoing',
    note: 'Favourite/saved videos appear only in the Data Portability full-archive export (all-data scope, separate approval, EEA/UK users).',
  },
  who_posted: {
    supported: true,
    approval: 'standard',
    scope: 'video.list',
    note: 'Fully supported: the Display API returns the authorized user\u2019s own public videos with the video.list scope.',
  },
};

export type ModeAvailabilitySource = 'official_api' | 'mock' | 'special_approval' | 'unavailable';

export interface ModeAvailability {
  mode: ModeId;
  playable: boolean;
  sources: ModeAvailabilitySource[];
  reason: string;
}

// ---------------------------------------------------------------------------
// Game state machine
// ---------------------------------------------------------------------------

export const PHASES = [
  'WAITING_FOR_PLAYERS',
  'ROUND_START',
  'SHOW_CONTENT',
  'GUESSING',
  'LOCK_GUESSES',
  'REVEAL',
  'SHOW_POINTS',
  'GAME_OVER',
] as const;

export type Phase = (typeof PHASES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  WAITING_FOR_PLAYERS: 'Lobby',
  ROUND_START: 'Round starting',
  SHOW_CONTENT: 'Look closely',
  GUESSING: 'Guessing',
  LOCK_GUESSES: 'Answers locked',
  REVEAL: 'Reveal',
  SHOW_POINTS: 'Scoreboard',
  GAME_OVER: 'Results',
};

export type RoomStatus = 'lobby' | 'in_game' | 'ended';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type ScoringMode = 'classic' | 'casual';

export interface GameSettings {
  /** 0 means unlimited rounds. */
  roundCount: number;
  secondsPerRound: number;
  enabledModes: ModeId[];
  randomMix: boolean;
  scoringMode: ScoringMode;
  randomizeOrder: boolean;
  showAvatars: boolean;
}

export const SETTINGS_LIMITS = {
  roundCount: { min: 1, max: 100, unlimited: 0 },
  secondsPerRound: { min: 5, max: 120 },
  maxPlayersPerRoom: 12,
  minPlayersToStart: 2,
} as const;

export const DEFAULT_SETTINGS: GameSettings = {
  roundCount: 10,
  secondsPerRound: 15,
  enabledModes: ['who_liked', 'who_reposted', 'who_saved', 'who_posted'],
  randomMix: true,
  scoringMode: 'classic',
  randomizeOrder: true,
  showAvatars: true,
};

export interface ScoringRules {
  mode: ScoringMode;
  label: string;
  description: string;
  correctPoints: number;
  speedBonusMax: number;
  actorBonusPerCorrectGuess: number;
  wrongPoints: number;
}

export const SCORING_RULES: Record<ScoringMode, ScoringRules> = {
  classic: {
    mode: 'classic',
    label: 'Classic',
    description: '+100 for a correct guess, up to +50 speed bonus for fast answers. The player in the spotlight earns +50 per player who recognises them.',
    correctPoints: 100,
    speedBonusMax: 50,
    actorBonusPerCorrectGuess: 50,
    wrongPoints: 0,
  },
  casual: {
    mode: 'casual',
    label: 'Casual',
    description: 'Flat +100 for a correct guess \u2014 no speed bonus, nobody is punished for thinking a little longer. The player in the spotlight earns +30 per correct guesser.',
    correctPoints: 100,
    speedBonusMax: 0,
    actorBonusPerCorrectGuess: 30,
    wrongPoints: 0,
  },
};

export function sanitizeGameSettings(
  patch: unknown,
  base: GameSettings = DEFAULT_SETTINGS,
): GameSettings {
  const input = (patch ?? {}) as Partial<Record<keyof GameSettings, unknown>>;
  const next: GameSettings = { ...base };

  if (typeof input.roundCount === 'number' && Number.isFinite(input.roundCount)) {
    const rounded = Math.round(input.roundCount);
    next.roundCount =
      rounded === 0
        ? 0
        : Math.min(
            SETTINGS_LIMITS.roundCount.max,
            Math.max(SETTINGS_LIMITS.roundCount.min, rounded),
          );
  }

  if (Array.isArray(input.enabledModes)) {
    const modes = input.enabledModes.filter(isModeId);
    const unique = [...new Set(modes)];
    next.enabledModes = unique.length > 0 ? unique : base.enabledModes;
  }

  if (
    input.scoringMode === 'classic' ||
    input.scoringMode === 'casual'
  ) {
    next.scoringMode = input.scoringMode;
  }

  if (typeof input.secondsPerRound === 'number' && Number.isFinite(input.secondsPerRound)) {
    next.secondsPerRound = Math.min(
      SETTINGS_LIMITS.secondsPerRound.max,
      Math.max(SETTINGS_LIMITS.secondsPerRound.min, Math.round(input.secondsPerRound)),
    );
  }

  for (const booleanKey of ['randomMix', 'randomizeOrder', 'showAvatars'] as const) {
    if (typeof input[booleanKey] === 'boolean') {
      next[booleanKey] = input[booleanKey] as boolean;
    }
  }

  return next;
}

// ---------------------------------------------------------------------------
// Public state (what the client receives over the socket)
// ---------------------------------------------------------------------------

export type ContentSource = 'tiktok' | 'mock';

export interface PlayerPublic {
  id: string;
  name: string;
  avatarSeed: number;
  avatarUrl: string | null;
  isHost: boolean;
  connected: boolean;
  source: ContentSource;
  joinedAt: number;
  score: number;
  roundPoints: number;
  correctGuesses: number;
  timesActor: number;
}

export interface ContentView {
  provider: ContentSource;
  kind: ActionKind;
  contentId: string;
  title: string | null;
  coverUrl: string | null;
  webUrl: string | null;
  authorName: string | null;
  /** True when the item is generated demo data. Always shown as a badge in the UI. */
  isMock: boolean;
  createdAt: number | null;
}

export interface GuessResult {
  playerId: string;
  guessedPlayerId: string | null;
  correct: boolean;
  points: number;
  bonus: number;
  answeredAt: number | null;
}

export interface RoundPublic {
  id: string;
  roundNumber: number;
  /** 0 = unlimited. */
  totalRounds: number;
  mode: ModeId;
  modeTitle: string;
  question: string;
  content: ContentView | null;
  /** Null until the reveal phase — never leaked early. */
  actorPlayerId: string | null;
  phase: Phase;
  phaseEndsAt: number | null;
  guessingStartedAt: number | null;
  guessingEndsAt: number | null;
  answerablePlayerIds: string[];
  answeredPlayerIds: string[];
  results: GuessResult[] | null;
  actorBonus: number | null;
  skipped: boolean;
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  avatarSeed: number;
  avatarUrl: string | null;
  score: number;
  correctGuesses: number;
  rank: number;
}

export interface SelfState {
  playerId: string;
  isHost: boolean;
  /** True while this player is allowed to submit/change a guess. */
  canGuess: boolean;
  hasGuessed: boolean;
  guessTargetId: string | null;
  /** Private hint for the player whose content is on screen. */
  isActor: boolean;
  source: ContentSource;
}

export interface RoomState {
  code: string;
  status: RoomStatus;
  phase: Phase;
  players: PlayerPublic[];
  settings: GameSettings;
  hostPlayerId: string | null;
  paused: boolean;
  gameNumber: number;
  roundNumber: number;
  totalRounds: number;
  round: RoundPublic | null;
  leaderboard: LeaderboardEntry[];
  modeAvailability: ModeAvailability[];
  availableModes: ModeId[];
  serverTime: number;
  you: SelfState | null;
}

export interface PublicRoomInfo {
  code: string;
  status: RoomStatus;
  playerCount: number;
  hostName: string | null;
  joinable: boolean;
  joinableReason: string | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Realtime protocol
// ---------------------------------------------------------------------------

export type Ack<T = undefined> = (
  result: { ok: true; data: T } | { ok: false; code: ErrorCode; message: string },
) => void;

export interface JoinRoomPayload {
  code: string;
  playerId: string;
  playerToken: string;
}

export interface CreateRoomResult {
  code: string;
  playerId: string;
  playerToken: string;
  /** Present when the request created or reused a session (for CSRF on later writes). */
  csrfToken?: string;
}

export interface JoinRoomResult {
  code: string;
  playerId: string;
  playerToken: string;
  room: PublicRoomInfo;
  csrfToken?: string;
}

export interface GuessPayload {
  targetPlayerId: string;
}

export type GameFlash =
  | { type: 'round_started'; roundNumber: number; mode: ModeId }
  | { type: 'guesses_locked'; roundNumber: number }
  | { type: 'reveal'; roundNumber: number; actorPlayerId: string }
  | { type: 'scores_updated'; roundNumber: number }
  | { type: 'game_over'; gameNumber: number }
  | { type: 'player_answered'; playerId: string }
  | { type: 'player_joined'; playerId: string; name: string }
  | { type: 'player_left'; playerId: string; name: string }
  | { type: 'host_changed'; playerId: string; name: string }
  | { type: 'game_started'; gameNumber: number }
  | { type: 'paused'; paused: boolean };

export interface ToastMessage {
  kind: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export interface ClientToServerEvents {
  'room:join': (payload: JoinRoomPayload, ack: Ack<{ playerId: string }>) => void;
  'player:update': (payload: { name?: string; avatarSeed?: number }, ack: Ack) => void;
  'player:refreshSource': (payload: Record<string, never>, ack: Ack) => void;
  'host:start': (payload: Record<string, never>, ack: Ack) => void;
  'host:settings': (payload: { settings: Partial<GameSettings> }, ack: Ack) => void;
  'host:skip': (payload: Record<string, never>, ack: Ack) => void;
  'host:next': (payload: Record<string, never>, ack: Ack) => void;
  'host:pause': (payload: { paused: boolean }, ack: Ack) => void;
  'host:end': (payload: Record<string, never>, ack: Ack) => void;
  'host:playAgain': (payload: Record<string, never>, ack: Ack) => void;
  'host:backToLobby': (payload: Record<string, never>, ack: Ack) => void;
  'host:transfer': (payload: { playerId: string }, ack: Ack) => void;
  'guess:submit': (payload: GuessPayload, ack: Ack<{ accepted: boolean }>) => void;
  'room:leave': (payload: Record<string, never>, ack: Ack) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'room:error': (error: { code: ErrorCode | string; message: string }) => void;
  'room:toast': (toast: ToastMessage) => void;
  'room:flash': (flash: GameFlash) => void;
  'room:closed': (payload: { reason: string }) => void;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'CSRF_FAILED',
  'RATE_LIMITED',
  'INTERNAL',
  'ROOM_NOT_FOUND',
  'ROOM_EXPIRED',
  'ROOM_FULL',
  'ROOM_IN_GAME',
  'ROOM_CLOSED',
  'ROOM_INTERRUPTED',
  'NAME_TAKEN',
  'NAME_INVALID',
  'NOT_IN_ROOM',
  'NOT_HOST',
  'NOT_ENOUGH_PLAYERS',
  'TOO_FEW_CONTENT_SOURCES',
  'GUESS_NOT_ALLOWED',
  'GUESS_ALREADY_LOCKED',
  'INVALID_TARGET',
  'PHASE_MISMATCH',
  'SOCKET_AUTH_FAILED',
  'PLAYER_NOT_FOUND',
  'CONTENT_UNAVAILABLE',
  'TIKTOK_NOT_CONFIGURED',
  'TIKTOK_AUTH_FAILED',
  'TIKTOK_STATE_INVALID',
  'TIKTOK_API_ERROR',
  'TIKTOK_RATE_LIMITED',
  'OAUTH_SCOPE_MISSING',
  'TIKTOK_DP_NOT_ENABLED',
  'TIKTOK_DP_SCOPE_MISSING',
  'TIKTOK_DP_REQUEST_FAILED',
  'TIKTOK_DP_EXPORT_FAILED',
  'TIKTOK_DP_EXPORT_EXPIRED',
  'TIKTOK_DP_PARSE_FAILED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Something in that request looked off. Please check the input and try again.',
  UNAUTHORIZED: 'You need to sign in to do that.',
  CSRF_FAILED: 'Your session security check failed. Please reload the page.',
  RATE_LIMITED: 'Too many requests \u2014 please slow down a moment.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
  ROOM_NOT_FOUND: 'No game found with that code. Double-check the letters and numbers.',
  ROOM_EXPIRED: 'This game has expired. Create a new one to keep playing.',
  ROOM_FULL: 'This room is full.',
  ROOM_IN_GAME: 'That game has already started. Ask the host to start a new game, or create your own room.',
  ROOM_CLOSED: 'The host closed this room.',
  ROOM_INTERRUPTED: 'The server restarted while this game was running. You are back in the lobby \u2014 start a new game!',
  NAME_TAKEN: 'Someone in this room already uses that name. Try another one.',
  NAME_INVALID: 'Please pick a name between 1 and 24 characters.',
  NOT_IN_ROOM: 'You are not part of this room.',
  NOT_HOST: 'Only the host can do that.',
  NOT_ENOUGH_PLAYERS: 'You need at least 2 players to start.',
  TOO_FEW_CONTENT_SOURCES: 'Not enough players can supply content for the selected modes.',
  GUESS_NOT_ALLOWED: 'You cannot guess in this round.',
  GUESS_ALREADY_LOCKED: 'Your answer is locked in \u2014 no take-backs!',
  INVALID_TARGET: 'That player is not a valid guess.',
  PHASE_MISMATCH: 'That action is not possible right now.',
  SOCKET_AUTH_FAILED: 'Could not rejoin the room. Refresh the page and join again.',
  PLAYER_NOT_FOUND: 'Your player session was not found. Please rejoin the room.',
  CONTENT_UNAVAILABLE: 'Could not load content for this round.',
  TIKTOK_NOT_CONFIGURED: 'TikTok sign-in is not configured on this server.',
  TIKTOK_AUTH_FAILED: 'TikTok sign-in failed. You can keep playing with demo data.',
  TIKTOK_STATE_INVALID: 'The TikTok sign-in request expired or was tampered with. Please try again.',
  TIKTOK_API_ERROR: 'TikTok returned an error. Please try again in a moment.',
  TIKTOK_RATE_LIMITED: 'TikTok is rate limiting us right now. Please try again shortly.',
  OAUTH_SCOPE_MISSING: 'The TikTok account did not grant the required permission.',
  TIKTOK_DP_NOT_ENABLED: 'TikTok activity import is currently unavailable for this application.',
  TIKTOK_DP_SCOPE_MISSING:
    'This TikTok account did not grant permission to import activity data. Reconnect TikTok and accept the data portability permission.',
  TIKTOK_DP_REQUEST_FAILED: 'TikTok did not accept the activity data request. Please try again later.',
  TIKTOK_DP_EXPORT_FAILED: 'TikTok could not prepare your activity data.',
  TIKTOK_DP_EXPORT_EXPIRED:
    'The prepared TikTok export has expired (exports are downloadable for 4 days). Request a new one.',
  TIKTOK_DP_PARSE_FAILED: 'The TikTok export could not be read. Nothing was imported.',
};

// ---------------------------------------------------------------------------
// TikTok Data Portability (activity import)
// ---------------------------------------------------------------------------

/**
 * Public, per-player state of a TikTok Data Portability import.
 * Mirrors the documented export lifecycle: pending -> downloading -> (import) -> ready,
 * plus the honest terminal states failed / expired.
 */
export type ActivityImportStatus =
  | 'none'
  | 'requesting'
  | 'pending'
  | 'importing'
  | 'ready'
  | 'failed'
  | 'expired';

export interface ActivityImportCounts {
  like: number;
  save: number;
  repost: number;
  post: number;
}

export interface ActivityImportState {
  /** Server has Data Portability configured + approved and can request exports. */
  enabled: boolean;
  /** The linked TikTok account granted a portability scope. */
  scopeGranted: boolean;
  /** Scope that would be / was requested. */
  scope: string | null;
  status: ActivityImportStatus;
  requestedAt: number | null;
  lastCheckedAt: number | null;
  readyAt: number | null;
  /** Exports are downloadable for 4 days after being prepared. */
  expiresAt: number | null;
  counts: ActivityImportCounts;
  /** Entries ignored during import (no URL, duplicates, unknown types). */
  skipped: number;
  error: { code: string; message: string } | null;
  /** Honest explanation shown in the UI (e.g. why the import has no liked videos). */
  note: string | null;
}

/** Player preference for where their game content comes from. */
export type ContentSourcePreference = 'auto' | 'real' | 'mock';

// ---------------------------------------------------------------------------
// Helpers shared by both sides
// ---------------------------------------------------------------------------

/** Unambiguous alphabet: no 0/O, 1/I/L. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const MAX_DISPLAY_NAME_LENGTH = 24;
export const AVATAR_SEED_COUNT = 12;

export function normalizeRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().toUpperCase().replace(/[^A-Z2-9]/g, '');
  return cleaned.length === 0 ? null : cleaned;
}

export function isValidRoomCode(code: unknown): code is string {
  if (typeof code !== 'string' || code.length !== ROOM_CODE_LENGTH) return false;
  for (const char of code) {
    if (!ROOM_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

export function sanitizeDisplayName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

export function normalizeAvatarSeed(input: unknown): number {
  const value = typeof input === 'number' && Number.isFinite(input) ? Math.floor(input) : 0;
  const count = AVATAR_SEED_COUNT;
  return ((value % count) + count) % count;
}

// ---------------------------------------------------------------------------
// Public server configuration (safe to expose to browsers)
// ---------------------------------------------------------------------------

export interface PublicServerConfig {
  brand: typeof BRAND;
  tiktokConfigured: boolean;
  mockProviderAllowed: boolean;
  maxPlayersPerRoom: number;
  settingsLimits: typeof SETTINGS_LIMITS;
  defaultSettings: GameSettings;
  scoringRules: Record<ScoringMode, ScoringRules>;
  modeInfo: Record<ModeId, ModeDefinition & { official: OfficialAccessInfo }>;
  dataPortability: {
    enabled: boolean;
    scope: string | null;
    categories: string[];
  };
}
