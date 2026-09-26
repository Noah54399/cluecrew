import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type {
  ActivityImportState,
  GameSettings,
  PublicServerConfig,
  RoomState,
} from '@shared';
import { BRAND } from '@shared';
import type { ActivityImportResponse, SessionPayload } from '../lib/api';
import { Badge, Banner, Button, Card, CopyField, Modal } from '../components/ui';
import {
  CrownIcon,
  InfoIcon,
  LinkIcon,
  LogOutIcon,
  PlayIcon,
  QrIcon,
  UsersIcon,
} from '../components/Icons';
import { GameSettingsForm } from './GameSettingsForm';
import { PlayerCard } from './PlayerCard';
import { TikTokConnectionCard } from '../components/TikTokConnectionCard';

export function LobbyView({
  state,
  myPlayerId,
  config,
  tiktok,
  importState,
  onSettings,
  onStart,
  onLeave,
  onConnectTikTok,
  onDisconnectTikTok,
  onImportStateChange,
  busy,
}: {
  state: RoomState;
  myPlayerId: string;
  config: PublicServerConfig | null;
  tiktok: SessionPayload['tiktok'] | null;
  importState: ActivityImportState;
  onSettings: (patch: Partial<GameSettings>) => void;
  onStart: () => void;
  onLeave: () => void;
  onConnectTikTok: () => void;
  onDisconnectTikTok: () => void;
  onImportStateChange: (state: ActivityImportResponse) => void;
  busy: boolean;
}) {
  const isHost = state.you?.isHost ?? false;
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState<string | null>(null);
  const [apiInfoOpen, setApiInfoOpen] = useState(false);
  const joinUrl = `${window.location.origin}/join/${state.code}`;
  const connectedCount = state.players.filter((player) => player.connected).length;
  const enabledPlayable = state.settings.enabledModes.filter((mode) =>
    state.availableModes.includes(mode),
  );
  const canStart = connectedCount >= 2 && enabledPlayable.length > 0;
  const notConnectedPlayers = state.players.filter((player) => player.source === 'none').length;

  useEffect(() => {
    if (!qrOpen || qrData) return;
    QRCode.toDataURL(joinUrl, {
      width: 336,
      margin: 1,
      color: { dark: '#171432', light: '#ffffff' },
    })
      .then(setQrData)
      .catch(() => undefined);
  }, [qrOpen, qrData, joinUrl]);

  return (
    <div className="container container-narrow stack-lg" style={{ paddingBottom: 48, paddingTop: 22 }}>
      <div className="lobby-code-card anim-fade-up">
        <div className="center">
          <p className="label">Game code</p>
          <div className="code-display">{state.code}</div>
          <p className="muted small">
            Share the code — friends join instantly, no account needed.
          </p>
        </div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button variant="outline" size="sm" icon={<QrIcon size={16} />} onClick={() => setQrOpen(true)}>
            Show QR code
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<LinkIcon size={16} />}
            onClick={() => void navigator.clipboard.writeText(joinUrl).catch(() => undefined)}
          >
            Copy join link
          </Button>
        </div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Badge variant={connectedCount >= 2 ? 'success' : 'default'}>
            <UsersIcon size={13} /> {connectedCount} online
          </Badge>
          <Badge>{state.players.length} in room</Badge>
          {state.hostPlayerId && (
            <Badge variant="amber">
              <CrownIcon size={13} />
              {state.players.find((player) => player.id === state.hostPlayerId)?.name ?? 'Host'}
            </Badge>
          )}
        </div>
      </div>

      {notConnectedPlayers > 0 && (
        <Banner kind="info" icon={<InfoIcon size={17} />}>
          {notConnectedPlayers} {notConnectedPlayers === 1 ? 'player has' : 'players have'} not
          connected TikTok yet — they cannot supply real content until they do.{' '}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ padding: '2px 8px' }}
            onClick={() => setApiInfoOpen(true)}
          >
            What can TikTok provide?
          </button>
        </Banner>
      )}

      <div className="stack-sm">
        <h2 className="card-title">
          <UsersIcon size={19} /> Players
        </h2>
        <div className="player-grid">
          {state.players.map((player) => (
            <PlayerCard
              key={player.id}
              player={player}
              isYou={player.id === myPlayerId}
              isHost={player.id === state.hostPlayerId}
              showAvatars={state.settings.showAvatars}
            />
          ))}
        </div>
      </div>

      <Card
        title={isHost ? 'Game settings' : 'Settings chosen by the host'}
        subtitle={
          isHost
            ? 'Everything is free and unlimited — no round caps, no upgrades, ever.'
            : 'Only the host can change these.'
        }
      >
        <GameSettingsForm
          settings={state.settings}
          availability={state.modeAvailability}
          onChange={onSettings}
          disabled={!isHost}
        />
      </Card>

      {tiktok && (
        <TikTokConnectionCard
          tiktok={tiktok}
          importState={importState}
          busy={busy}
          onConnect={onConnectTikTok}
          onDisconnectAndDelete={onDisconnectTikTok}
          onImportStateChange={onImportStateChange}
        />
      )}

      <div className="stack-sm">
        {isHost ? (
          <>
            <Button
              variant="primary"
              size="lg"
              block
              icon={<PlayIcon size={19} />}
              disabled={!canStart || busy}
              onClick={onStart}
            >
              Start game
            </Button>
            {!canStart && (
              <p className="center faint small">
                {connectedCount < 2
                  ? 'Waiting for at least one more player to join.'
                  : 'Enable at least one playable game mode in the settings.'}
              </p>
            )}
          </>
        ) : (
          <Banner kind="info">
            Waiting for the host to start… You can keep this screen open, it updates live.
          </Banner>
        )}
        <Button variant="ghost" block icon={<LogOutIcon size={17} />} onClick={onLeave}>
          Leave room
        </Button>
      </div>

      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title="Invite friends">
        <div className="stack">
          <div className="qr-panel">
            {qrData ? <img src={qrData} alt={`Join ${state.code}`} /> : <span className="spinner" />}
            <p className="center faint small" style={{ color: '#55507a' }}>
              Scan to join {BRAND.name}
            </p>
          </div>
          <CopyField value={joinUrl} label="Join link" />
        </div>
      </Modal>

      <Modal open={apiInfoOpen} onClose={() => setApiInfoOpen(false)} title="What TikTok's APIs allow">
        <div className="stack-sm">
          <p className="muted small">
            ClueCrew only shows real TikTok data. If a mode cannot be filled with official API data,
            it stays unavailable and says why — nothing is simulated.
          </p>
          <ul className="muted small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>
              <strong>Who Posted This?</strong> — your own public videos via the official Display API
              (<code>video.list</code>).
            </li>
            <li>
              <strong>Who Liked / Saved?</strong> — TikTok only exposes these in the Data Portability
              full archive (separate approval, EEA/UK users). Without it the modes stay unavailable.
            </li>
            <li>
              <strong>Who Reposted?</strong> — no official TikTok API provides reposts, so this mode
              stays unavailable.
            </li>
          </ul>
          <p className="faint small">
            Full technical breakdown: docs/TIKTOK-API.md and docs/TIKTOK-DATA-PORTABILITY.md in the
            project repository.
          </p>
        </div>
      </Modal>
    </div>
  );
}
