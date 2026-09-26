import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  isModeId,
  isValidRoomCode,
  normalizeRoomCode,
  type ClientToServerEvents,
  type GameSettings,
  type ServerToClientEvents,
} from '@cluecrew/shared';
import type { ServerConfig } from '../config.js';
import { AppError, toAppError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { SlidingWindowLimiter } from '../lib/rateLimit.js';
import type { RoomManager } from '../game/roomManager.js';

interface SocketData {
  roomId: string;
  playerId: string;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export function createSocketServer(params: {
  httpServer: HttpServer;
  config: ServerConfig;
  roomManager: RoomManager;
}): IoServer {
  const { config, roomManager } = params;
  const logger = createLogger('socket');

  const io: IoServer = new Server(params.httpServer, {
    path: '/socket.io',
    cors: {
      origin: config.allowedOrigins,
      credentials: true,
    },
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 20_000,
    pingTimeout: 25_000,
  });

  const joinLimiter = new SlidingWindowLimiter(15, 10_000);
  const guessLimiter = new SlidingWindowLimiter(40, 10_000);
  const hostLimiter = new SlidingWindowLimiter(40, 10_000);

  io.use((socket, next) => {
    const origin = socket.handshake.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      next(new Error('origin_not_allowed'));
      return;
    }
    const auth = socket.handshake.auth as {
      code?: unknown;
      playerId?: unknown;
      playerToken?: unknown;
    };
    const code = normalizeRoomCode(auth.code);
    if (
      !code ||
      !isValidRoomCode(code) ||
      typeof auth.playerId !== 'string' ||
      typeof auth.playerToken !== 'string'
    ) {
      next(new Error('invalid_auth'));
      return;
    }
    try {
      const { room, player } = roomManager.authenticatePlayer({
        code,
        playerId: auth.playerId,
        playerToken: auth.playerToken,
      });
      socket.data.roomId = room.id;
      socket.data.playerId = player.id;
      next();
    } catch (error) {
      next(new Error(error instanceof AppError ? error.code : 'auth_failed'));
    }
  });

  function ack<T>(socket: GameSocket, callback: unknown, fn: () => T): void {
    try {
      const data = fn();
      if (typeof callback === 'function') {
        (callback as (result: unknown) => void)({ ok: true, data });
      }
    } catch (error) {
      const appError = toAppError(error);
      if (appError.status >= 500) {
        logger.error('Socket handler error', { code: appError.code, message: appError.message });
      }
      if (typeof callback === 'function') {
        (callback as (result: unknown) => void)({
          ok: false,
          code: appError.code,
          message: appError.message,
        });
      } else {
        socket.emit('room:error', { code: appError.code, message: appError.message });
      }
    }
  }

  io.on('connection', (socket: GameSocket) => {
    const roomId = socket.data.roomId;
    const playerId = socket.data.playerId;
    const room = roomManager.getRoomById(roomId);
    if (!room) {
      socket.emit('room:error', {
        code: 'ROOM_NOT_FOUND',
        message: 'This room no longer exists.',
      });
      socket.disconnect(true);
      return;
    }

    socket.join(`room:${roomId}`);
    roomManager.attachSocket(room, playerId, socket.id);
    logger.debug('Socket connected', { room: room.code, playerId });

    const currentRoom = () => {
      const live = roomManager.getRoomById(roomId);
      if (!live) throw new AppError('ROOM_NOT_FOUND');
      return live;
    };

    const checkLimit = (limiter: SlidingWindowLimiter, bucket: string) => {
      if (!limiter.check(`${bucket}:${socket.id}`).allowed) {
        throw new AppError('RATE_LIMITED');
      }
    };

    socket.on('room:join', (_payload, callback) => {
      ack(socket, callback, () => {
        checkLimit(joinLimiter, 'join');
        roomManager.sendState(currentRoom(), playerId);
        return { playerId };
      });
    });

    socket.on('player:update', (payload, callback) => {
      ack(socket, callback, () => {
        const patch: { name?: string; avatarSeed?: number } = {};
        if (payload && typeof payload.name === 'string') patch.name = payload.name;
        if (payload && typeof payload.avatarSeed === 'number') patch.avatarSeed = payload.avatarSeed;
        roomManager.updatePlayerProfile(currentRoom(), playerId, patch);
        return undefined;
      });
    });

    socket.on('player:refreshSource', (_payload, callback) => {
      ack(socket, callback, () => {
        checkLimit(joinLimiter, 'refresh');
        roomManager.refreshPlayerSource(currentRoom(), playerId);
        return undefined;
      });
    });

    socket.on('host:start', (_payload, callback) => {
      ack(socket, callback, () => {
        checkLimit(hostLimiter, 'host');
        roomManager.startGame(currentRoom(), playerId);
        return undefined;
      });
    });

    socket.on('host:settings', (payload, callback) => {
      ack(socket, callback, () => {
        checkLimit(hostLimiter, 'host');
        const patch = sanitizeSettingsPatch(payload?.settings);
        roomManager.updateSettings(currentRoom(), playerId, patch);
        return undefined;
      });
    });

    socket.on('host:skip', (_payload, callback) => {
      ack(socket, callback, () => {
        checkLimit(hostLimiter, 'host');
        roomManager.skip(currentRoom(), playerId);
        return undefined;
      });
    });

    socket.on('host:next', (_payload, callback) => {
      ack(socket, callback, () => {
        checkLimit(hostLimiter, 'host');
        roomManager.next(currentRoom(), playerId);
        return undefined;
      });
    });

    socket.on('host:pause', (payload, callback) => {
      ack(socket, callback, () => {
        checkLimit(hostLimiter, 'host');
        roomManager.pause(currentRoom(), playerId, Boolean(payload?.paused));
        return undefined;
      });
    });

    socket.on('host:end', (_payload, callback) => {
      ack(socket, callback, () => {
        checkLimit(hostLimiter, 'host');
        roomManager.endGame(currentRoom(), playerId);
        return undefined;
      });
    });

    socket.on('host:playAgain', (_payload, callback) => {
      ack(socket, callback, () => {
        checkLimit(hostLimiter, 'host');
        roomManager.playAgain(currentRoom(), playerId);
        return undefined;
      });
    });

    socket.on('host:backToLobby', (_payload, callback) => {
      ack(socket, callback, () => {
        checkLimit(hostLimiter, 'host');
        roomManager.backToLobby(currentRoom(), playerId);
        return undefined;
      });
    });

    socket.on('host:transfer', (payload, callback) => {
      ack(socket, callback, () => {
        checkLimit(hostLimiter, 'host');
        const targetId = payload?.playerId;
        if (typeof targetId !== 'string') throw new AppError('VALIDATION_FAILED');
        roomManager.transferHostManually(currentRoom(), playerId, targetId);
        return undefined;
      });
    });

    socket.on('guess:submit', (payload, callback) => {
      ack(socket, callback, () => {
        checkLimit(guessLimiter, 'guess');
        const targetId = payload?.targetPlayerId;
        if (typeof targetId !== 'string') throw new AppError('VALIDATION_FAILED');
        roomManager.submitGuess(currentRoom(), playerId, targetId);
        return { accepted: true };
      });
    });

    socket.on('room:leave', (_payload, callback) => {
      ack(socket, callback, () => {
        const live = roomManager.getRoomById(roomId);
        if (live) roomManager.leaveRoom(live, playerId);
        return undefined;
      });
    });

    socket.on('disconnect', () => {
      const live = roomManager.getRoomById(roomId);
      if (live) roomManager.detachSocket(live, playerId, socket.id);
      logger.debug('Socket disconnected', { roomId, playerId });
    });
  });

  return io;
}

function sanitizeSettingsPatch(raw: unknown): Partial<GameSettings> {
  const patch: Partial<GameSettings> = {};
  if (!raw || typeof raw !== 'object') return patch;
  const input = raw as Record<string, unknown>;
  if (typeof input.roundCount === 'number') patch.roundCount = input.roundCount;
  if (typeof input.secondsPerRound === 'number') patch.secondsPerRound = input.secondsPerRound;
  if (Array.isArray(input.enabledModes)) {
    patch.enabledModes = input.enabledModes.filter(isModeId);
  }
  if (typeof input.randomMix === 'boolean') patch.randomMix = input.randomMix;
  if (input.scoringMode === 'classic' || input.scoringMode === 'casual') {
    patch.scoringMode = input.scoringMode;
  }
  if (typeof input.randomizeOrder === 'boolean') patch.randomizeOrder = input.randomizeOrder;
  if (typeof input.showAvatars === 'boolean') patch.showAvatars = input.showAvatars;
  return patch;
}
