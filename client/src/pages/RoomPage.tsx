import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ActivityImportState, PublicServerConfig } from '@shared';
import { ApiError, roomsApi, sessionApi } from '../lib/api';
import { getPlayer, removePlayer, type StoredPlayer } from '../lib/storage';
import { sounds } from '../lib/sound';
import { useRoomConnection } from '../lib/useRoom';
import { useToast } from '../app/ToastProvider';
import { useSession } from '../app/SessionProvider';
import { Button, Card, ErrorState, Modal, Spinner } from '../components/ui';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { WifiOffIcon } from '../components/Icons';
import { LobbyView } from '../game/LobbyView';
import { PlayView } from '../game/PlayView';
import { ResultsView } from '../game/ResultsView';

const EMPTY_IMPORT_STATE: ActivityImportState = {
  enabled: false,
  scopeGranted: false,
  scope: null,
  status: 'none',
  requestedAt: null,
  lastCheckedAt: null,
  readyAt: null,
  expiresAt: null,
  counts: { like: 0, save: 0, repost: 0, post: 0 },
  skipped: 0,
  error: null,
  note: null,
};

export function RoomPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { session, refresh: refreshSession } = useSession();
  const params = useParams<{ code?: string }>();
  const code = (params.code ?? '').toUpperCase();
  const [player] = useState<StoredPlayer | null>(() => getPlayer(code));
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<PublicServerConfig | null>(null);
  const [left, setLeft] = useState(false);
  const [localImport, setLocalImport] = useState<ActivityImportState | null>(null);

  useEffect(() => {
    if (!player && !left) navigate(`/join/${code}`, { replace: true });
  }, [player, left, code, navigate]);

  useEffect(() => {
    roomsApi
      .config()
      .then(setConfig)
      .catch(() => undefined);
  }, []);

  const connection = useRoomConnection(player && !left ? code : null, player && !left ? player : null, {
    onToast: (message) => toast.push(message),
    onFlash: (flash) => {
      switch (flash.type) {
        case 'round_started':
        case 'game_started':
          sounds.play('start');
          break;
        case 'guesses_locked':
          sounds.play('lock');
          break;
        case 'reveal':
          sounds.play('reveal');
          break;
        case 'scores_updated':
          sounds.play('correct');
          break;
        case 'game_over':
          sounds.play('victory');
          break;
        case 'player_joined':
          sounds.play('join');
          break;
        case 'paused':
          sounds.play('pause');
          break;
        default:
          break;
      }
    },
  });

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : 'That action failed.');
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const leave = useCallback(() => {
    setLeft(true);
    void connection.emitAck('room:leave').catch(() => undefined);
    removePlayer(code);
    navigate('/');
  }, [connection, code, navigate]);

  const state = connection.state;

  if (!player || left) {
    return (
      <div className="fullscreen-state">
        <span className="spinner" />
        <p className="muted">Leaving…</p>
      </div>
    );
  }

  if (!state && connection.error) {
    return (
      <ErrorState
        title="Could not join this room"
        message={connection.error.message}
        action={
          <div className="row">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Try again
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                removePlayer(code);
                navigate('/join');
              }}
            >
              Enter a different code
            </Button>
          </div>
        }
      />
    );
  }

  if (!state) {
    return <Spinner label={connection.connected ? 'Loading room…' : 'Connecting to the room…'} />;
  }

  const emitGuess = <T,>(event: 'guess:submit', payload?: Record<string, unknown>) =>
    connection.emitAck<T>(event, payload);

  return (
    <>
      {!connection.connected && (
        <div className="connection-banner">
          <WifiOffIcon size={16} /> Reconnecting…
        </div>
      )}

      {state.status !== 'in_game' && (
        <nav className="topnav">
          <div className="container topnav-inner">
            <Logo />
            <div className="row">
              <span className="badge badge-primary">{state.code}</span>
              <ThemeToggle />
            </div>
          </div>
        </nav>
      )}

      {state.status === 'lobby' && (
        <LobbyView
          state={state}
          myPlayerId={player.playerId}
          config={config}
          tiktok={session?.tiktok ?? null}
          importState={localImport ?? session?.import ?? EMPTY_IMPORT_STATE}
          busy={busy}
          onSettings={(patch) => void run(() => connection.emitAck('host:settings', { settings: patch }))}
          onStart={() => void run(() => connection.emitAck('host:start'))}
          onLeave={leave}
          onImportStateChange={(next) => setLocalImport(next)}
          onConnectTikTok={() =>
            void run(async () => {
              const { url } = await sessionApi.tiktokStartUrl(`/room/${code}`);
              window.location.href = url;
            })
          }
          onDisconnectTikTok={() =>
            void run(async () => {
              await sessionApi.tiktokDisconnect();
              const refreshed = await refreshSession();
              setLocalImport(refreshed?.import ?? null);
              toast.success('TikTok disconnected. Imported activity data was deleted.');
            })
          }
        />
      )}

      {state.status === 'in_game' && (
        <PlayView
          state={state}
          myPlayerId={player.playerId}
          busy={busy}
          emitAck={emitGuess}
          actions={{
            onSettings: (patch) => void run(() => connection.emitAck('host:settings', { settings: patch })),
            onSkip: () => void run(() => connection.emitAck('host:skip')),
            onNext: () => void run(() => connection.emitAck('host:next')),
            onPause: (paused) => void run(() => connection.emitAck('host:pause', { paused })),
            onEnd: () => void run(() => connection.emitAck('host:end')),
            onLeave: leave,
            onError: (message) => toast.error(message),
          }}
        />
      )}

      {state.status === 'ended' && (
        <ResultsView
          state={state}
          busy={busy}
          onPlayAgain={() => void run(() => connection.emitAck('host:playAgain'))}
          onBackToLobby={() => void run(() => connection.emitAck('host:backToLobby'))}
          onLeave={leave}
        />
      )}

      <Modal
        open={Boolean(connection.closedReason)}
        onClose={leave}
        dismissable={false}
        title="Room closed"
      >
        <Card className="card-flat">
          <p className="muted" style={{ marginBottom: 16 }}>
            {connection.closedReason}
          </p>
          <Button variant="primary" block onClick={leave}>
            Back to home
          </Button>
        </Card>
      </Modal>
    </>
  );
}
