import type { PlayerPublic } from '@shared';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/ui';
import { CrownIcon } from '../components/Icons';

/** Lobby card for a single player. */
export function PlayerCard({
  player,
  isYou,
  isHost,
  showAvatars,
}: {
  player: PlayerPublic;
  isYou: boolean;
  isHost: boolean;
  showAvatars: boolean;
}) {
  return (
    <div className={`player-card ${isYou ? 'is-you' : ''}`}>
      {showAvatars ? (
        <Avatar name={player.name} seed={player.avatarSeed} url={player.avatarUrl} size="md" />
      ) : (
        <Avatar name={player.name.slice(0, 1)} seed={player.avatarSeed} size="md" />
      )}
      <div className="player-card-body">
        <div className="player-name">
          <span className={`dot ${player.connected ? 'dot-online' : 'dot-offline'}`} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.name}</span>
          {isHost && <CrownIcon size={15} className="crown" aria-label="Host" />}
        </div>
        <div className="player-meta">
          {isYou && <span>You</span>}
          {player.source === 'tiktok' ? (
            <Badge variant="mint">TikTok connected</Badge>
          ) : (
            <Badge variant="default">Not connected</Badge>
          )}
          {!player.connected && <span className="faint">reconnecting…</span>}
        </div>
      </div>
    </div>
  );
}
