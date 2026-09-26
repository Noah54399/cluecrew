import { Link } from 'react-router-dom';
import type { ActivityImportState } from '@cluecrew/shared';
import type { ActivityImportResponse, SessionPayload } from '../lib/api';
import { Avatar } from './Avatar';
import { Badge, Banner, Button, Card } from './ui';
import { LinkIcon, ShieldIcon } from './Icons';
import { TikTokImportPanel } from './TikTokImportPanel';

/**
 * Lobby card for the player's TikTok connection. Real data only — when no
 * account is connected this is a clear empty state, never demo content.
 */
export function TikTokConnectionCard({
  tiktok,
  importState,
  onConnect,
  onDisconnectAndDelete,
  onImportStateChange,
  busy,
}: {
  tiktok: SessionPayload['tiktok'];
  importState: ActivityImportState;
  onConnect: () => void;
  onDisconnectAndDelete: () => void;
  onImportStateChange: (state: ActivityImportResponse) => void;
  busy: boolean;
}) {
  return (
    <Card
      title={
        <>
          <LinkIcon size={18} /> TikTok connection
        </>
      }
      subtitle="Real TikTok data only — nothing is faked or demo-generated."
    >
      {!tiktok.configured && (
        <div className="stack-sm">
          <Banner kind="warn" icon={<ShieldIcon size={16} />}>
            TikTok sign-in is not configured on this server. The operator must add
            TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET.
          </Banner>
          <p className="faint small">
            Without a TikTok connection the game has no real data to show, so it will ask players
            to connect instead of inventing content.
          </p>
        </div>
      )}

      {tiktok.configured && !tiktok.linked && (
        <div className="stack-sm">
          <p className="muted small">
            <strong>Connect your TikTok account to see your real data.</strong> ClueCrew uses
            TikTok&apos;s official authorization system — we never ask for your TikTok password.
          </p>
          <ul className="muted small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Your profile and your own public videos come from the official Display API.</li>
            <li>
              Follower/video statistics need the <code>user.info.stats</code> permission.
            </li>
            <li>
              Liked and saved videos need TikTok&apos;s Data Portability approval (EEA/UK only).
            </li>
          </ul>
          <Button
            variant="outline"
            icon={<LinkIcon size={16} />}
            onClick={onConnect}
            disabled={busy}
          >
            Continue with TikTok
          </Button>
        </div>
      )}

      {tiktok.linked && (
        <div className="stack-sm">
          <div className="row">
            <Avatar name={tiktok.displayName ?? 'TikTok'} seed={0} url={tiktok.avatarUrl} size="md" />
            <div className="grow">
              <div className="setting-label">{tiktok.displayName ?? 'TikTok connected'}</div>
              <div className="faint small">
                {tiktok.scopes.length > 0 ? tiktok.scopes.join(', ') : 'no scopes reported'}
              </div>
            </div>
            <Badge variant="mint">Connected</Badge>
          </div>

          <TikTokImportPanel
            importState={importState}
            linked={tiktok.linked}
            onStateChange={onImportStateChange}
            busy={busy}
          />

          <div className="row wrap">
            <Link className="btn btn-outline btn-sm" to="/account">
              Profile &amp; videos
            </Link>
            <Button variant="ghost" size="sm" onClick={onDisconnectAndDelete} disabled={busy}>
              Disconnect TikTok &amp; delete data
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
