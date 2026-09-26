import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  GameFlash,
  RoomState,
  ServerToClientEvents,
  ToastMessage,
} from '@shared';
import { ApiError, API_BASE } from './api';
import type { StoredPlayer } from './storage';

type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface RoomConnection {
  state: RoomState | null;
  connected: boolean;
  connecting: boolean;
  error: { code: string; message: string } | null;
  closedReason: string | null;
  lastFlash: GameFlash | null;
  flashSeq: number;
  emitAck: <T>(event: keyof ClientToServerEvents, payload?: Record<string, unknown>) => Promise<T>;
}

export interface RoomConnectionCallbacks {
  onToast?: (toast: ToastMessage) => void;
  onFlash?: (flash: GameFlash) => void;
}

export function useRoomConnection(
  code: string | null,
  player: StoredPlayer | null,
  callbacks: RoomConnectionCallbacks = {},
): RoomConnection {
  const [state, setState] = useState<RoomState | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(Boolean(code && player));
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [lastFlash, setLastFlash] = useState<GameFlash | null>(null);
  const [flashSeq, setFlashSeq] = useState(0);

  const socketRef = useRef<RoomSocket | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!code || !player) {
      setConnecting(false);
      return;
    }

    setConnecting(true);
    setError(null);
    setClosedReason(null);

    const socket: RoomSocket = io(API_BASE || undefined, {
      auth: {
        code,
        playerId: player.playerId,
        playerToken: player.playerToken,
      },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 400,
      reconnectionDelayMax: 3000,
      timeout: 8000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setConnecting(false);
      setError(null);
      socket.emit(
        'room:join',
        { code, playerId: player.playerId, playerToken: player.playerToken },
        () => undefined,
      );
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', (err) => {
      setConnecting(false);
      const code2 = (err as { message?: string }).message ?? 'SOCKET_AUTH_FAILED';
      const friendly =
        code2 === 'ROOM_NOT_FOUND'
          ? 'This room no longer exists.'
          : code2 === 'PLAYER_NOT_FOUND' || code2 === 'SOCKET_AUTH_FAILED'
            ? 'Could not rejoin this room. Please join again.'
            : 'Connection problem — trying to reconnect…';
      setError({ code: code2, message: friendly });
    });

    socket.on('room:state', (next) => setState(next));
    socket.on('room:flash', (flash) => {
      setLastFlash(flash);
      setFlashSeq((seq) => seq + 1);
      callbacksRef.current.onFlash?.(flash);
    });
    socket.on('room:toast', (toast) => callbacksRef.current.onToast?.(toast));
    socket.on('room:error', (roomError) => {
      setError({ code: roomError.code, message: roomError.message });
      callbacksRef.current.onToast?.({ kind: 'error', message: roomError.message });
    });
    socket.on('room:closed', (payload) => {
      setClosedReason(payload.reason);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code, player?.playerId, player?.playerToken]);

  const emitAck = useCallback(
    <T,>(event: keyof ClientToServerEvents, payload: Record<string, unknown> = {}) => {
      return new Promise<T>((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          reject(new ApiError('SOCKET_AUTH_FAILED', 'Not connected to the room right now.'));
          return;
        }
        const timer = setTimeout(() => {
          reject(new ApiError('TIMEOUT', 'The server did not respond. Please try again.'));
        }, 8000);
        (socket as Socket).emit(event, payload, (result: unknown) => {
          clearTimeout(timer);
          const ack = result as { ok: boolean; data?: T; code?: string; message?: string };
          if (ack && ack.ok) resolve(ack.data as T);
          else
            reject(
              new ApiError(ack?.code ?? 'INTERNAL', ack?.message ?? 'That action failed.', 400),
            );
        });
      });
    },
    [],
  );

  return { state, connected, connecting, error, closedReason, lastFlash, flashSeq, emitAck };
}

/** A ticking clock; returns Date.now() at `intervalMs`. */
export function useTicker(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

/** Approximate offset between server time and local time for countdowns. */
export function useServerOffset(state: RoomState | null): number {
  return useMemo(() => (state ? state.serverTime - Date.now() : 0), [state]);
}
