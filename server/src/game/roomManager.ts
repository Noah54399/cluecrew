import {
  DEFAULT_SETTINGS,
  MODES,
  SCORING_RULES,
  sanitizeDisplayName,
  sanitizeGameSettings,
  normalizeAvatarSeed,
  type ActionKind,
  type ClientToServerEvents,
  type ContentSourcePreference,
  type ContentView,
  type GameSettings,
  type LeaderboardEntry,
  type ModeId,
  type PlayerPublic,
  type PublicRoomInfo,
  type RoundPublic,
  type RoomState,
  type SelfState,
  type ServerToClientEvents,
  type ToastMessage,
} from '@cluecrew/shared';
import type { ServerConfig } from '../config.js';
import type { OauthAccountRow, PlayerRow, Repositories } from '../database/repositories.js';
import { encryptString, sha256Hex } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { appEvents } from '../lib/events.js';
import { randomId, randomRoomCode, randomSecretToken } from '../lib/ids.js';
import { buildProxiedMediaUrl } from '../lib/mediaProxy.js';
import { createLogger, type Logger } from '../lib/logger.js';
import { createSocialProvider, type ProviderImportData } from '../providers/factory.js';
import type { ContentItem, ProviderCapabilities, SocialProvider } from '../providers/types.js';
import type { DataPortabilityService } from '../portability/DataPortabilityService.js';
import {
  ProviderAuthError,
  ProviderRateLimitError,
} from '../providers/types.js';
import {
  addPlayer,
  beginRound,
  createEngineRoom,
  endGame as engineEndGame,
  forceNext,
  getPlayer,
  pickUnusedContent,
  planRoundCandidates,
  prepareGame,
  removePlayer,
  resetForNewGame,
  setPaused,
  setPlayerConnected,
  skipRound,
  submitGuess as engineSubmitGuess,
  tick as engineTick,
  touch,
  transferHost,
  updateSettings as engineUpdateSettings,
  type EngineDeps,
  type EngineEffect,
  type EnginePlayer,
  type EngineRoom,
} from '../game/engine.js';
import { computeRoomModeSupport, type PlayerProviderInfo } from '../game/modes.js';

interface ContentContext {
  provider: SocialProvider;
  capabilities: ProviderCapabilities;
  items: Map<ActionKind, ContentItem[]>;
  account: OauthAccountRow | null;
}

type IoServer = RealtimeServer;

/** Minimal structural interface so RoomManager does not depend on socket.io types. */
export interface RealtimeEmitter {
  emit(event: string, ...args: unknown[]): void;
}

export interface RealtimeSocketLike {
  leave(room: string): void;
  emit(event: string, ...args: unknown[]): void;
}

export interface RealtimeServer {
  to(target: string): RealtimeEmitter;
  sockets: {
    sockets: Map<string, RealtimeSocketLike>;
  };
}

export interface RoomManagerOptions {
  config: ServerConfig;
  repos: Repositories;
  deps: EngineDeps;
  logger?: Logger;
  /** Optional: enables real TikTok activity data for linked players. */
  dataPortability?: DataPortabilityService | null;
}

export interface CreatedPlayer {
  playerId: string;
  playerToken: string;
}

const ROOM_TTL_REFRESH_MS = 60 * 60 * 1000;
const CONTENT_FETCH_LIMIT = 60;
const RATE_LIMIT_RETRY_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Owns live rooms: sockets, timers, provider contexts, persistence and the game
 * engine. The engine itself never touches sockets, the database or TikTok.
 */
export class RoomManager {
  private readonly config: ServerConfig;
  private readonly repos: Repositories;
  private readonly deps: EngineDeps;
  private readonly logger: Logger;
  private readonly dataPortability: DataPortabilityService | null;

  private rooms = new Map<string, EngineRoom>();
  private roomIdByCode = new Map<string, string>();
  private socketsByRoom = new Map<string, Map<string, Set<string>>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private hostTimers = new Map<string, NodeJS.Timeout>();
  private contentContexts = new Map<string, ContentContext>();
  private startingRound = new Set<string>();
  private io: IoServer | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private interruptedRooms = new Set<string>();
  private disposed = false;

  constructor(options: RoomManagerOptions) {
    this.config = options.config;
    this.repos = options.repos;
    this.deps = options.deps;
    this.logger = options.logger ?? createLogger('rooms');
    this.dataPortability = options.dataPortability ?? null;

    this.unsubscribe = [
      appEvents.on('tiktok:linked', ({ userId }) =>
        this.handleAccountChange(userId, 'linked'),
      ),
      appEvents.on('tiktok:unlinked', ({ userId }) =>
        this.handleAccountChange(userId, 'unlinked'),
      ),
      appEvents.on('tiktok:import:updated', ({ userId }) =>
        this.handleAccountChange(userId, 'import'),
      ),
    ];
  }

  private unsubscribe: Array<() => void>;

  attachIo(io: IoServer): void {
    this.io = io;
  }

  startSweeper(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), 5 * 60 * 1000);
    this.sweepTimer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const timer of this.hostTimers.values()) clearTimeout(timer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const unsubscribe of this.unsubscribe) unsubscribe();
  }

  // -------------------------------------------------------------------------
  // Room + player lifecycle (called from REST routes)
  // -------------------------------------------------------------------------

  createRoom(params: {
    name: string;
    avatarSeed: number;
    userId: string | null;
  }): { room: EngineRoom; player: EnginePlayer; playerToken: string } {
    const now = this.deps.now();
    const settings = sanitizeGameSettings({}, DEFAULT_SETTINGS);
    const roomId = randomId('rm', 10);
    let code = randomRoomCode();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (!this.roomIdByCode.has(code) && !this.repos.rooms.getByCode(code)) break;
      code = randomRoomCode();
    }

    const nowIso = new Date(now).toISOString();
    this.repos.rooms.create({
      id: roomId,
      code,
      hostPlayerId: null,
      settingsJson: JSON.stringify(settings),
      status: 'lobby',
      phase: 'WAITING_FOR_PLAYERS',
      now: nowIso,
      expiresAt: new Date(now + this.config.roomTtlMs).toISOString(),
    });

    const room = createEngineRoom({
      id: roomId,
      code,
      settings,
      hostPlayerId: null,
      now,
    });
    this.registerRoom(room);

    const playerToken = randomSecretToken();
    const playerId = randomId('pl', 10);
    this.repos.players.create({
      id: playerId,
      roomId,
      userId: params.userId,
      name: params.name,
      avatarSeed: params.avatarSeed,
      avatarUrl: null,
      reconnectTokenHash: sha256Hex(playerToken),
      isHost: 1,
      source: 'mock',
      now: nowIso,
    });

    const player: EnginePlayer = {
      id: playerId,
      userId: params.userId,
      name: params.name,
      avatarSeed: params.avatarSeed,
      avatarUrl: null,
      isHost: true,
      connected: false,
      source: 'mock',
      socketCount: 0,
      joinedAt: now,
      lastSeenAt: now,
    };
    addPlayer(room, player);
    room.hostPlayerId = playerId;
    this.refreshContentSources(room);
    this.persistRoom(room);
    this.logger.info('Room created', { code, roomId });
    return { room, player, playerToken };
  }

  joinRoom(params: {
    code: string;
    name: string;
    avatarSeed: number;
    userId: string | null;
  }): { room: EngineRoom; player: EnginePlayer; playerToken: string } {
    const room = this.getRoomByCode(params.code);
    if (!room) throw new AppError('ROOM_NOT_FOUND');
    if (room.status === 'in_game') throw new AppError('ROOM_IN_GAME');
    if (room.players.length >= this.config.maxPlayersPerRoom) throw new AppError('ROOM_FULL');
    if (this.repos.players.nameExists(room.id, params.name)) throw new AppError('NAME_TAKEN');

    const now = this.deps.now();
    const nowIso = new Date(now).toISOString();
    const playerToken = randomSecretToken();
    const playerId = randomId('pl', 10);
    this.repos.players.create({
      id: playerId,
      roomId: room.id,
      userId: params.userId,
      name: params.name,
      avatarSeed: params.avatarSeed,
      avatarUrl: null,
      reconnectTokenHash: sha256Hex(playerToken),
      isHost: 0,
      source: 'mock',
      now: nowIso,
    });

    const player: EnginePlayer = {
      id: playerId,
      userId: params.userId,
      name: params.name,
      avatarSeed: params.avatarSeed,
      avatarUrl: null,
      isHost: false,
      connected: false,
      source: 'mock',
      socketCount: 0,
      joinedAt: now,
      lastSeenAt: now,
    };
    addPlayer(room, player);
    this.refreshContentSources(room);
    touch(room, now);
    this.persistRoom(room);
    this.handleEffects(room, [
      { type: 'flash', flash: { type: 'player_joined', playerId, name: player.name } },
      { type: 'toast', kind: 'success', message: `${player.name} joined the room.` },
    ]);
    this.logger.info('Player joined', { code: room.code, playerId, name: player.name });
    return { room, player, playerToken };
  }

  leaveRoom(room: EngineRoom, playerId: string): void {
    const player = getPlayer(room, playerId);
    if (!player) return;
    const wasHost = room.hostPlayerId === playerId;
    const wasActor = room.round?.actorPlayerId === playerId && room.round.lockedAt === null;

    removePlayer(room, playerId);
    this.repos.players.delete(playerId);
    this.contentContexts.delete(playerId);
    this.clearHostTimer(playerId);

    if (room.status === 'in_game' && wasActor && room.round && room.round.lockedAt === null) {
      try {
        this.handleEffects(room, skipRound(room, this.deps));
      } catch {
        // Round may already have advanced — safe to ignore.
      }
    }

    for (const socketId of this.socketsByRoom.get(room.id)?.get(playerId) ?? []) {
      this.io?.sockets.sockets.get(socketId)?.leave(`room:${room.id}`);
      this.io?.sockets.sockets.get(socketId)?.emit('room:closed', {
        reason: 'You left the room.',
      });
    }
    this.socketsByRoom.get(room.id)?.delete(playerId);

    this.refreshContentSources(room);
    this.handleEffects(room, [
      { type: 'flash', flash: { type: 'player_left', playerId, name: player.name } },
      { type: 'toast', kind: 'info', message: `${player.name} left the room.` },
      { type: 'persist_room' },
    ]);

    if (wasHost && room.players.length > 0) {
      this.handleEffects(room, transferHost(room, undefined, this.deps));
    }

    if (room.players.length === 0) {
      this.closeRoom(room);
    }
    this.logger.info('Player left', { code: room.code, playerId });
  }

  closeRoom(room: EngineRoom): void {
    for (const socketId of this.allSocketIds(room.id)) {
      this.io?.sockets.sockets.get(socketId)?.emit('room:closed', {
        reason: 'The host closed the room.',
      });
      this.io?.sockets.sockets.get(socketId)?.leave(`room:${room.id}`);
    }
    for (const player of room.players) this.contentContexts.delete(player.id);
    this.socketsByRoom.delete(room.id);
    const timer = this.timers.get(room.id);
    if (timer) clearTimeout(timer);
    this.timers.delete(room.id);
    this.rooms.delete(room.id);
    this.roomIdByCode.delete(room.code);
    this.repos.rooms.delete(room.id);
  }

  // -------------------------------------------------------------------------
  // Sockets
  // -------------------------------------------------------------------------

  authenticatePlayer(params: { code: string; playerId: string; playerToken: string }): {
    room: EngineRoom;
    player: EnginePlayer;
  } {
    const room = this.getRoomByCode(params.code);
    if (!room) throw new AppError('ROOM_NOT_FOUND');
    const player = getPlayer(room, params.playerId);
    if (!player) throw new AppError('PLAYER_NOT_FOUND');
    const row = this.repos.players.get(params.playerId);
    if (!row || row.roomId !== room.id || row.reconnectTokenHash !== sha256Hex(params.playerToken)) {
      throw new AppError('SOCKET_AUTH_FAILED');
    }
    return { room, player };
  }

  attachSocket(room: EngineRoom, playerId: string, socketId: string): void {
    let sockets = this.socketsByRoom.get(room.id);
    if (!sockets) {
      sockets = new Map();
      this.socketsByRoom.set(room.id, sockets);
    }
    let set = sockets.get(playerId);
    if (!set) {
      set = new Set();
      sockets.set(playerId, set);
    }
    const firstSocket = set.size === 0;
    set.add(socketId);

    const player = getPlayer(room, playerId);
    if (!player) return;
    player.socketCount = set.size;
    const wasDisconnected = !player.connected;
    player.connected = true;
    player.lastSeenAt = this.deps.now();
    this.clearHostTimer(playerId);

    if (wasDisconnected && firstSocket) {
      const isReconnect = this.deps.now() - player.joinedAt > 3000;
      if (isReconnect) {
        this.handleEffects(room, [
          { type: 'toast', kind: 'success', message: `${player.name} reconnected.` },
        ]);
      }
    }

    if (this.interruptedRooms.has(room.id)) {
      this.interruptedRooms.delete(room.id);
      this.sendToPlayer(room, playerId, 'room:error', {
        code: 'ROOM_INTERRUPTED',
        message:
          'The server restarted while a game was running. Scores for the new game are reset — start a fresh game!',
      });
    }

    touch(room, this.deps.now());
    this.sendState(room, playerId);
    this.broadcast(room);
  }

  detachSocket(room: EngineRoom, playerId: string, socketId: string): void {
    const sockets = this.socketsByRoom.get(room.id);
    const set = sockets?.get(playerId);
    if (!set) return;
    set.delete(socketId);
    const player = getPlayer(room, playerId);
    if (!player) return;

    player.socketCount = set.size;
    if (set.size === 0) {
      setPlayerConnected(room, playerId, false);
      player.connected = false;
      this.handleEffects(room, [
        { type: 'flash', flash: { type: 'player_left', playerId, name: player.name } },
      ]);
      if (room.hostPlayerId === playerId) {
        this.scheduleHostTransfer(room, playerId);
      }
    }
    this.persistPlayerSeen(playerId);
  }

  allSocketIds(roomId: string): string[] {
    const sockets = this.socketsByRoom.get(roomId);
    if (!sockets) return [];
    const ids: string[] = [];
    for (const set of sockets.values()) for (const id of set) ids.push(id);
    return ids;
  }

  // -------------------------------------------------------------------------
  // Game actions (called from socket handlers)
  // -------------------------------------------------------------------------

  startGame(room: EngineRoom, byPlayerId: string): void {
    this.assertHost(room, byPlayerId);
    if (room.status === 'in_game') {
      throw new AppError('PHASE_MISMATCH', { message: 'A game is already running.' });
    }
    const connectedPlayers = room.players.filter((player) => player.connected);
    if (connectedPlayers.length < 2) {
      throw new AppError('NOT_ENOUGH_PLAYERS');
    }
    this.refreshContentSources(room);
    const eligibleModes = room.settings.enabledModes.filter(
      (mode) => (room.suppliersByMode[mode] ?? []).length > 0,
    );
    if (eligibleModes.length === 0) {
      throw new AppError('TOO_FEW_CONTENT_SOURCES', {
        message:
          'None of the selected modes can be supplied. Enable demo data or connect a TikTok account with the video.list permission.',
      });
    }
    const skippedModes = room.settings.enabledModes.filter(
      (mode) => !eligibleModes.includes(mode),
    );
    if (skippedModes.length > 0) {
      this.handleEffects(room, [
        {
          type: 'toast',
          kind: 'warn',
          message: `Skipping ${skippedModes
            .map((mode) => MODES[mode].title)
            .join(', ')} — nobody can supply content for this mode right now.`,
        },
      ]);
    }

    const nowIso = new Date().toISOString();
    const gameId = randomId('gm', 10);
    this.repos.games.create({
      id: gameId,
      roomId: room.id,
      roundCount: room.settings.roundCount,
      scoringMode: room.settings.scoringMode,
      now: nowIso,
    });

    prepareGame(room, { gameId, eligibleModes, suppliersByMode: room.suppliersByMode }, this.deps);
    this.handleEffects(room, [
      { type: 'flash', flash: { type: 'game_started', gameNumber: room.gameNumber } },
      {
        type: 'toast',
        kind: 'success',
        message:
          room.settings.roundCount === 0
            ? 'Game started — unlimited rounds!'
            : `Game started — ${room.settings.roundCount} rounds.`,
      },
      { type: 'persist_room' },
    ]);
    void this.startNextRound(room);
  }

  async startNextRound(room: EngineRoom): Promise<void> {
    if (this.disposed || room.status !== 'in_game') return;
    if (this.startingRound.has(room.id)) return;
    this.startingRound.add(room.id);
    try {
      const candidates = planRoundCandidates(room, this.deps);
      if (candidates.length === 0) {
        this.abortRoundWithError(room, 'Not enough content sources for the selected modes.');
        return;
      }

      let lastError: unknown = null;
      for (const candidate of candidates) {
        if (this.disposed || room.status !== 'in_game') return;
        const kind = MODES[candidate.mode].kind;

        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const items = await this.getItems(room, candidate.actorPlayerId, kind);
            const content = pickUnusedContent(room, candidate.actorPlayerId, kind, items, this.deps);
            if (!content) break;

            const roundId = randomId('rd', 10);
            const nowIso = new Date().toISOString();
            this.repos.rounds.create({
              id: roundId,
              gameId: room.gameId ?? '',
              roundNumber: room.roundNumber + 1,
              mode: candidate.mode,
              actorPlayerId: candidate.actorPlayerId,
              now: nowIso,
            });
            this.repos.roundActions.create({
              id: randomId('ra', 10),
              roundId,
              provider: content.provider,
              kind,
              contentId: content.contentId,
              contentJson: JSON.stringify(content),
              isMock: content.provider === 'mock' ? 1 : 0,
              now: nowIso,
            });

            this.handleEffects(
              room,
              beginRound(room, { roundId, candidate, content }, this.deps),
            );
            return;
          } catch (error) {
            lastError = error;
            if (error instanceof ProviderAuthError) {
              this.contentContexts.delete(candidate.actorPlayerId);
            }
            if (error instanceof ProviderRateLimitError && attempt === 0) {
              this.logger.warn('Provider rate limited — retrying once', {
                room: room.code,
                playerId: candidate.actorPlayerId,
              });
              await sleep(RATE_LIMIT_RETRY_DELAY_MS);
              continue;
            }
            this.logger.warn('Content fetch failed for candidate', {
              room: room.code,
              mode: candidate.mode,
              playerId: candidate.actorPlayerId,
              error: error instanceof Error ? error.message : String(error),
            });
            break;
          }
        }
      }

      const message =
        lastError instanceof AppError
          ? lastError.message
          : 'Could not load content for the next round.';
      this.abortRoundWithError(room, message);
    } finally {
      this.startingRound.delete(room.id);
    }
  }

  private abortRoundWithError(room: EngineRoom, message: string): void {
    this.handleEffects(room, [
      { type: 'toast', kind: 'error', message },
      { type: 'toast', kind: 'info', message: 'The game was ended. You can start a new one any time.' },
    ]);
    this.handleEffects(room, engineEndGame(room, this.deps, { aborted: true }));
  }

  submitGuess(room: EngineRoom, playerId: string, targetPlayerId: string): void {
    const effects = engineSubmitGuess(room, playerId, targetPlayerId, this.deps);
    const round = room.round;
    if (round && round.answers.has(playerId)) {
      const answer = round.answers.get(playerId)!;
      this.repos.guesses.upsert({
        id: randomId('gs', 10),
        roundId: round.id,
        playerId,
        guessedPlayerId: answer.targetPlayerId,
        submittedAt: new Date(answer.at).toISOString(),
      });
    }
    this.handleEffects(room, effects);
  }

  updateSettings(room: EngineRoom, byPlayerId: string, patch: Partial<GameSettings>): void {
    this.assertHost(room, byPlayerId);
    engineUpdateSettings(room, patch, this.deps);
    this.refreshContentSources(room);
    this.handleEffects(room, [{ type: 'persist_room' }]);
  }

  skip(room: EngineRoom, byPlayerId: string): void {
    this.assertHost(room, byPlayerId);
    this.handleEffects(room, skipRound(room, this.deps));
  }

  next(room: EngineRoom, byPlayerId: string): void {
    this.assertHost(room, byPlayerId);
    this.handleEffects(room, forceNext(room, this.deps));
  }

  pause(room: EngineRoom, byPlayerId: string, paused: boolean): void {
    this.assertHost(room, byPlayerId);
    this.handleEffects(room, setPaused(room, paused, this.deps));
  }

  endGame(room: EngineRoom, byPlayerId: string): void {
    this.assertHost(room, byPlayerId);
    if (room.status === 'lobby') {
      this.closeRoom(room);
      return;
    }
    this.handleEffects(room, engineEndGame(room, this.deps, { aborted: false }));
  }

  playAgain(room: EngineRoom, byPlayerId: string): void {
    this.assertHost(room, byPlayerId);
    this.handleEffects(room, resetForNewGame(room, this.deps));
    this.startGame(room, byPlayerId);
  }

  backToLobby(room: EngineRoom, byPlayerId: string): void {
    this.assertHost(room, byPlayerId);
    this.handleEffects(room, resetForNewGame(room, this.deps));
  }

  transferHostManually(room: EngineRoom, byPlayerId: string, targetPlayerId: string): void {
    this.assertHost(room, byPlayerId);
    if (!getPlayer(room, targetPlayerId)) throw new AppError('PLAYER_NOT_FOUND');
    this.handleEffects(room, transferHost(room, targetPlayerId, this.deps));
  }

  updatePlayerProfile(
    room: EngineRoom,
    playerId: string,
    patch: { name?: string; avatarSeed?: number },
  ): void {
    const player = getPlayer(room, playerId);
    if (!player) throw new AppError('PLAYER_NOT_FOUND');

    const updates: { name?: string; avatarSeed?: number; now: string } = {
      now: new Date(this.deps.now()).toISOString(),
    };

    if (patch.name !== undefined) {
      const name = sanitizeDisplayName(patch.name);
      if (!name) throw new AppError('NAME_INVALID');
      if (this.repos.players.nameExists(room.id, name, playerId)) {
        throw new AppError('NAME_TAKEN');
      }
      player.name = name;
      updates.name = name;
      const row = this.repos.players.get(playerId);
      if (row?.userId) {
        this.repos.users.update(row.userId, { displayName: name, now: updates.now });
      }
    }
    if (patch.avatarSeed !== undefined) {
      const seed = normalizeAvatarSeed(patch.avatarSeed);
      player.avatarSeed = seed;
      updates.avatarSeed = seed;
    }

    this.repos.players.update(playerId, updates);
    touch(room, this.deps.now());
    this.broadcast(room);
  }

  // -------------------------------------------------------------------------
  // State building
  // -------------------------------------------------------------------------

  buildRoomState(room: EngineRoom, selfPlayerId: string | null): RoomState {
    const self = selfPlayerId ? getPlayer(room, selfPlayerId) ?? null : null;
    const now = this.deps.now();
    const round = room.round && room.status !== 'lobby' ? room.round : null;
    const revealed =
      round !== null && (round.revealedAt !== null || room.phase === 'GAME_OVER');

    let roundPublic: RoundPublic | null = null;
    if (round) {
      const mode = MODES[round.mode];
      roundPublic = {
        id: round.id,
        roundNumber: round.roundNumber,
        totalRounds: room.settings.roundCount,
        mode: round.mode,
        modeTitle: mode.title,
        question: mode.question,
        content: this.buildContentView(round.content, revealed),
        actorPlayerId: revealed ? round.actorPlayerId : null,
        phase: room.phase,
        phaseEndsAt: room.phaseEndsAt,
        guessingStartedAt: round.guessingStartedAt,
        guessingEndsAt: round.guessingEndsAt,
        answerablePlayerIds: round.answerablePlayerIds,
        answeredPlayerIds: [...round.answers.keys()],
        results: revealed ? round.results : null,
        actorBonus: revealed ? round.actorBonus : null,
        skipped: round.skipped,
      };
    }

    const players = room.players.map((player) => this.buildPlayerPublic(room, player));
    const leaderboard = this.buildLeaderboard(room);

    let you: SelfState | null = null;
    if (self) {
      const isActor = round !== null && round.actorPlayerId === self.id && !revealed;
      const answer = round?.answers.get(self.id) ?? null;
      const canGuess =
        round !== null &&
        room.phase === 'GUESSING' &&
        !room.paused &&
        self.connected &&
        self.id !== round.actorPlayerId &&
        round.lockedAt === null;
      you = {
        playerId: self.id,
        isHost: room.hostPlayerId === self.id,
        canGuess,
        hasGuessed: Boolean(answer),
        guessTargetId: answer?.targetPlayerId ?? null,
        isActor,
        source: self.source,
      };
    }

    return {
      code: room.code,
      status: room.status,
      phase: room.phase,
      players,
      settings: room.settings,
      hostPlayerId: room.hostPlayerId,
      paused: room.paused,
      gameNumber: room.gameNumber,
      roundNumber: room.roundNumber,
      totalRounds: room.settings.roundCount,
      round: roundPublic,
      leaderboard,
      modeAvailability: room.availability,
      availableModes: room.availableModes,
      serverTime: now,
      you,
    };
  }

  private buildPlayerPublic(room: EngineRoom, player: EnginePlayer): PlayerPublic {
    const score = room.scores.get(player.id);
    return {
      id: player.id,
      name: player.name,
      avatarSeed: player.avatarSeed,
      avatarUrl: player.avatarUrl,
      isHost: room.hostPlayerId === player.id,
      connected: player.connected,
      source: player.source,
      joinedAt: player.joinedAt,
      score: score?.points ?? 0,
      roundPoints: score?.roundPoints ?? 0,
      correctGuesses: score?.correctGuesses ?? 0,
      timesActor: room.actorCounts.get(player.id) ?? 0,
    };
  }

  private buildLeaderboard(room: EngineRoom): LeaderboardEntry[] {
    const sorted = [...room.players].sort((a, b) => {
      const scoreA = room.scores.get(a.id)?.points ?? 0;
      const scoreB = room.scores.get(b.id)?.points ?? 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.joinedAt - b.joinedAt;
    });
    let lastScore: number | null = null;
    let lastRank = 0;
    return sorted.map((player, index) => {
      const score = room.scores.get(player.id)?.points ?? 0;
      const rank = lastScore !== null && score === lastScore ? lastRank : index + 1;
      lastScore = score;
      lastRank = rank;
      return {
        playerId: player.id,
        name: player.name,
        avatarSeed: player.avatarSeed,
        avatarUrl: player.avatarUrl,
        score,
        correctGuesses: room.scores.get(player.id)?.correctGuesses ?? 0,
        rank,
      };
    });
  }

  private buildContentView(item: ContentItem, revealed: boolean): ContentView {
    const hideAuthor = item.kind === 'post' && !revealed;
    return {
      provider: item.provider,
      kind: item.kind,
      contentId: item.contentId,
      title: item.title,
      coverUrl: item.coverUrl ? buildProxiedMediaUrl(item.coverUrl, this.config) : null,
      webUrl: hideAuthor ? null : item.webUrl,
      authorName: hideAuthor ? null : item.authorName,
      isMock: item.provider === 'mock',
      createdAt: item.createdAt,
    };
  }

  // -------------------------------------------------------------------------
  // Effects, timers, broadcasting
  // -------------------------------------------------------------------------

  private handleEffects(room: EngineRoom, effects: EngineEffect[]): void {
    if (this.disposed) return;
    if (effects.length === 0) {
      this.scheduleTimer(room);
      this.broadcast(room);
      return;
    }
    let needsNextRound = false;

    for (const effect of effects) {
      switch (effect.type) {
        case 'phase':
        case 'persist_room':
          this.persistRoom(room);
          break;
        case 'flash':
          this.io?.to(`room:${room.id}`).emit('room:flash', effect.flash);
          break;
        case 'toast':
          this.toast(room, effect.kind, effect.message);
          break;
        case 'round_resolved':
          this.persistRoundResults(effect);
          break;
        case 'round_closed':
          try {
            this.repos.rounds.finish(effect.roundId, effect.status, new Date().toISOString());
          } catch (error) {
            this.logger.warn('Failed to close round record', {
              roundId: effect.roundId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          break;
        case 'game_closed':
          try {
            this.repos.games.finish(effect.gameId, effect.status, new Date().toISOString());
          } catch (error) {
            this.logger.warn('Failed to close game record', {
              gameId: effect.gameId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          break;
        case 'next_round':
          needsNextRound = true;
          break;
      }
    }

    this.scheduleTimer(room);
    this.broadcast(room);
    if (needsNextRound) void this.startNextRound(room);
  }

  private persistRoundResults(effect: {
    gameId: string;
    roundId: string;
    actorPlayerId: string;
    results: Array<{
      playerId: string;
      correct: boolean;
      points: number;
      bonus: number;
    }>;
    actorBonus: number;
  }): void {
    const nowIso = new Date().toISOString();

    for (const result of effect.results) {
      const total = result.points + result.bonus;
      this.repos.guesses.resolve(effect.roundId, result.playerId, result.correct, total);
      if (total > 0) {
        this.repos.scores.insert({
          id: randomId('sc', 10),
          gameId: effect.gameId,
          playerId: result.playerId,
          roundId: effect.roundId,
          points: total,
          reason: result.bonus > 0 ? 'guess_with_speed_bonus' : 'guess',
          now: nowIso,
        });
      }
    }
    if (effect.gameId && effect.actorBonus > 0) {
      this.repos.scores.insert({
        id: randomId('sc', 10),
        gameId: effect.gameId,
        playerId: effect.actorPlayerId,
        roundId: effect.roundId,
        points: effect.actorBonus,
        reason: 'actor_bonus',
        now: nowIso,
      });
    }
  }

  private scheduleTimer(room: EngineRoom): void {
    if (this.disposed) return;
    const existing = this.timers.get(room.id);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(room.id);
    }
    if (room.status !== 'in_game' || room.paused || room.phaseEndsAt === null) return;
    const delay = Math.max(0, room.phaseEndsAt - this.deps.now()) + 15;
    const timer = setTimeout(() => {
      this.timers.delete(room.id);
      const effects = engineTick(room, this.deps);
      if (effects.length > 0) this.handleEffects(room, effects);
      else this.scheduleTimer(room);
    }, delay);
    timer.unref?.();
    this.timers.set(room.id, timer);
  }

  private scheduleHostTransfer(room: EngineRoom, playerId: string): void {
    this.clearHostTimer(playerId);
    const timer = setTimeout(() => {
      this.hostTimers.delete(playerId);
      const player = getPlayer(room, playerId);
      if (!player || player.connected) return;
      if (room.hostPlayerId !== playerId) return;
      this.handleEffects(room, transferHost(room, undefined, this.deps));
    }, this.config.hostTransferGraceMs);
    timer.unref?.();
    this.hostTimers.set(playerId, timer);
  }

  private clearHostTimer(playerId: string): void {
    const timer = this.hostTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.hostTimers.delete(playerId);
  }

  private broadcast(room: EngineRoom): void {
    if (this.disposed || !this.io) return;
    const sockets = this.socketsByRoom.get(room.id);
    if (!sockets) return;
    for (const playerId of sockets.keys()) {
      this.sendState(room, playerId);
    }
  }

  sendState(room: EngineRoom, playerId: string): void {
    const state = this.buildRoomState(room, playerId);
    this.sendToPlayer(room, playerId, 'room:state', state);
  }

  private sendToPlayer(
    room: EngineRoom,
    playerId: string,
    event: keyof ServerToClientEvents,
    payload: unknown,
  ): void {
    const ids = this.socketsByRoom.get(room.id)?.get(playerId);
    if (!ids || !this.io) return;
    for (const socketId of ids) {
      this.io.to(socketId).emit(event, payload);
    }
  }

  toast(room: EngineRoom, kind: ToastMessage['kind'], message: string): void {
    this.io?.to(`room:${room.id}`).emit('room:toast', { kind, message });
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private persistRoom(room: EngineRoom): void {
    if (this.disposed) return;
    const nowIso = new Date(room.updatedAt).toISOString();
    try {
      this.repos.rooms.update(room.id, {
        hostPlayerId: room.hostPlayerId,
        settingsJson: JSON.stringify(room.settings),
        stateJson: JSON.stringify({
          code: room.code,
          status: room.status,
          phase: room.phase,
          gameNumber: room.gameNumber,
          settings: room.settings,
          players: room.players.map((player) => ({
            id: player.id,
            name: player.name,
            avatarSeed: player.avatarSeed,
            avatarUrl: player.avatarUrl,
            source: player.source,
            isHost: player.isHost,
            joinedAt: player.joinedAt,
          })),
        }),
        status: room.status,
        phase: room.phase,
        now: nowIso,
        expiresAt: new Date(this.deps.now() + this.config.roomTtlMs).toISOString(),
      });
    } catch (error) {
      this.logger.error('Failed to persist room', {
        room: room.code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private persistPlayerSeen(playerId: string): void {
    try {
      this.repos.players.update(playerId, { now: new Date(this.deps.now()).toISOString() });
    } catch {
      // Non-critical.
    }
  }

  // -------------------------------------------------------------------------
  // Providers / content
  // -------------------------------------------------------------------------

  private getContext(room: EngineRoom, playerId: string): ContentContext {
    const cached = this.contentContexts.get(playerId);
    if (cached) return cached;

    const player = getPlayer(room, playerId);
    if (!player) throw new AppError('PLAYER_NOT_FOUND', { status: 404 });

    const account = player.userId
      ? this.repos.oauthAccounts.getForUser(player.userId, 'tiktok')
      : null;

    let importData: ProviderImportData | null = null;
    let preference: ContentSourcePreference = 'auto';
    if (player.userId) {
      const user = this.repos.users.get(player.userId);
      const stored = user?.preferredSource;
      if (stored === 'real' || stored === 'mock' || stored === 'auto') {
        preference = stored;
      }
      if (this.dataPortability) {
        const state = this.dataPortability.getState(player.userId);
        if (state.scopeGranted) {
          importData = {
            state,
            actions: this.repos.socialActions.listForUser(
              player.userId,
              this.config.dataPortability.maxActions,
            ),
          };
        }
      }
    }

    const provider = createSocialProvider({
      playerKey: player.id,
      playerName: player.name,
      avatarSeed: player.avatarSeed,
      account,
      config: this.config,
      preference,
      dataPortability: importData,
      onTokensRefreshed: (tokens) => {
        if (!account) return;
        try {
          this.repos.oauthAccounts.updateTokens(account.id, {
            accessTokenEnc: encryptString(tokens.accessToken, this.config.tokenEncryptionKey),
            refreshTokenEnc: tokens.refreshToken
              ? encryptString(tokens.refreshToken, this.config.tokenEncryptionKey)
              : null,
            accessTokenExpiresAt: new Date(tokens.accessTokenExpiresAt).toISOString(),
            refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
              ? new Date(tokens.refreshTokenExpiresAt).toISOString()
              : null,
            scopes: tokens.scopes.join(','),
            now: new Date().toISOString(),
          });
        } catch {
          // Token persistence is best-effort; the in-memory provider still works.
        }
      },
    });

    if (provider.source === 'tiktok' && account?.avatarUrl && !player.avatarUrl) {
      player.avatarUrl = account.avatarUrl;
      this.repos.players.update(playerId, {
        avatarUrl: account.avatarUrl,
        now: new Date().toISOString(),
      });
    }

    const context: ContentContext = {
      provider,
      capabilities: provider.getCapabilities(),
      items: new Map(),
      account,
    };
    this.contentContexts.set(playerId, context);
    return context;
  }

  refreshContentSources(room: EngineRoom): void {
    const infos: PlayerProviderInfo[] = [];
    for (const player of room.players) {
      const context = this.getContext(room, player.id);
      player.source = context.provider.source;
      infos.push({
        playerId: player.id,
        source: context.provider.source,
        capabilities: context.capabilities,
      });
    }
    const support = computeRoomModeSupport(infos);
    room.suppliersByMode = support.suppliersByMode;
    room.availability = support.availability;
    room.availableModes = support.modesWithSuppliers;
    if (room.status === 'in_game') {
      room.eligibleModes = room.settings.enabledModes.filter(
        (mode) => (support.suppliersByMode[mode] ?? []).length > 0,
      );
    }
  }

  private async getItems(
    room: EngineRoom,
    playerId: string,
    kind: ActionKind,
  ): Promise<ContentItem[]> {
    const context = this.getContext(room, playerId);
    const cached = context.items.get(kind);
    if (cached) return cached;

    let items: ContentItem[];
    switch (kind) {
      case 'like':
        items = await context.provider.getAvailableLikedContent(CONTENT_FETCH_LIMIT);
        break;
      case 'repost':
        items = await context.provider.getAvailableRepostedContent(CONTENT_FETCH_LIMIT);
        break;
      case 'save':
        items = await context.provider.getAvailableSavedContent(CONTENT_FETCH_LIMIT);
        break;
      case 'post':
        items = await context.provider.getAvailablePostedContent(CONTENT_FETCH_LIMIT);
        break;
    }
    context.items.set(kind, items);
    return items;
  }

  refreshPlayerSource(room: EngineRoom, playerId: string): void {
    if (!getPlayer(room, playerId)) throw new AppError('PLAYER_NOT_FOUND', { status: 404 });
    this.contentContexts.delete(playerId);
    this.refreshContentSources(room);
    this.handleEffects(room, [{ type: 'persist_room' }]);
  }

  /** Rebuilds provider contexts for a user in every live room (silent). */
  refreshUserSources(userId: string): void {
    this.handleAccountChange(userId, 'import');
  }

  /** Called when a user deletes their account: removes them from every live room. */
  handleUserDeleted(userId: string): void {
    for (const room of [...this.rooms.values()]) {
      for (const player of room.players.filter((candidate) => candidate.userId === userId)) {
        this.leaveRoom(room, player.id);
      }
    }
  }

  private handleAccountChange(userId: string, kind: 'linked' | 'unlinked' | 'import'): void {
    for (const room of this.rooms.values()) {
      const affected = room.players.filter((player) => player.userId === userId);
      if (affected.length === 0) continue;
      for (const player of affected) this.contentContexts.delete(player.id);
      this.refreshContentSources(room);
      this.handleEffects(room, [{ type: 'persist_room' }]);

      if (kind === 'import') {
        // Import progress changes silently: the connection card in the lobby
        // shows the exact state, and toasts are reserved for real events.
        continue;
      }
      const names = affected.map((player) => player.name).join(', ');
      this.toast(
        room,
        kind === 'linked' ? 'success' : 'info',
        kind === 'linked' ? `${names} connected TikTok.` : `${names} disconnected TikTok.`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Lookup / housekeeping
  // -------------------------------------------------------------------------

  getRoomByCode(code: string): EngineRoom | null {
    const roomId = this.roomIdByCode.get(code);
    if (roomId) return this.rooms.get(roomId) ?? null;
    const row = this.repos.rooms.getByCode(code);
    if (!row) return null;
    if (row.expiresAt <= new Date().toISOString()) return null;
    return this.rehydrateRoom(row.id);
  }

  getRoomById(roomId: string): EngineRoom | null {
    return this.rooms.get(roomId) ?? null;
  }

  getPublicRoomInfo(code: string): PublicRoomInfo | null {
    const row = this.repos.rooms.getByCode(code);
    if (!row) return null;
    if (row.expiresAt <= new Date().toISOString()) return null;
    const players = this.repos.players.listForRoom(row.id);
    const host = players.find((player) => player.isHost === 1) ?? null;
    const live = this.rooms.get(row.id);
    const status = (live?.status ?? row.status) as PublicRoomInfo['status'];
    const playerCount = live?.players.length ?? players.length;
    let joinable = true;
    let joinableReason: string | null = null;
    if (status === 'in_game') {
      joinable = false;
      joinableReason = 'A game is already running. Ask the host to start a new one.';
    } else if (playerCount >= this.config.maxPlayersPerRoom) {
      joinable = false;
      joinableReason = 'This room is full.';
    }
    return {
      code: row.code,
      status,
      playerCount,
      hostName: (live ? getPlayer(live, live.hostPlayerId ?? '')?.name : host?.name) ?? null,
      joinable,
      joinableReason,
      createdAt: Date.parse(row.createdAt),
    };
  }

  private registerRoom(room: EngineRoom): void {
    this.rooms.set(room.id, room);
    this.roomIdByCode.set(room.code, room.id);
  }

  private rehydrateRoom(roomId: string): EngineRoom | null {
    const row = this.repos.rooms.getById(roomId);
    if (!row) return null;
    const now = this.deps.now();
    const settings = sanitizeGameSettings(JSON.parse(row.settingsJson || '{}'), DEFAULT_SETTINGS);
    const room = createEngineRoom({
      id: row.id,
      code: row.code,
      settings,
      hostPlayerId: row.hostPlayerId,
      now,
    });
    room.status = 'lobby';
    room.phase = 'WAITING_FOR_PLAYERS';

    const playerRows = this.repos.players.listForRoom(row.id);
    for (const playerRow of playerRows) {
      addPlayer(room, {
        id: playerRow.id,
        userId: playerRow.userId,
        name: playerRow.name,
        avatarSeed: playerRow.avatarSeed,
        avatarUrl: playerRow.avatarUrl,
        isHost: playerRow.isHost === 1,
        connected: false,
        source: (playerRow.source === 'tiktok' ? 'tiktok' : 'mock') as EnginePlayer['source'],
        socketCount: 0,
        joinedAt: Date.parse(playerRow.joinedAt),
        lastSeenAt: Date.parse(playerRow.lastSeenAt),
      });
    }
    if (!room.hostPlayerId && room.players.length > 0) {
      room.hostPlayerId = room.players[0]!.id;
      room.players[0]!.isHost = true;
    }

    if (row.status === 'in_game') {
      this.interruptedRooms.add(room.id);
      if (room.gameId) this.repos.games.finish(room.gameId, 'aborted', new Date().toISOString());
    }
    room.gameId = null;

    this.registerRoom(room);
    this.refreshContentSources(room);
    this.persistRoom(room);
    this.logger.info('Room rehydrated from database', { code: room.code });
    return room;
  }

  private assertHost(room: EngineRoom, playerId: string): void {
    if (room.hostPlayerId !== playerId) throw new AppError('NOT_HOST');
  }

  private sweep(): void {
    if (this.disposed) return;
    const now = this.deps.now();
    const nowIso = new Date(now).toISOString();
    for (const room of [...this.rooms.values()]) {
      if (now - room.lastActivityAt > this.config.roomIdleTimeoutMs) {
        this.logger.info('Closing idle room', { code: room.code });
        this.closeRoom(room);
      }
    }
    try {
      this.repos.rooms.deleteExpired(nowIso);
      this.repos.sessions.deleteExpired(nowIso);
      this.repos.oauthStates.deleteExpired(nowIso);
    } catch (error) {
      this.logger.error('Sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Test helper: force a tick without waiting for timers. */
  forceTick(room: EngineRoom): void {
    const effects = engineTick(room, this.deps);
    if (effects.length > 0) this.handleEffects(room, effects);
  }
}
