import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BRAND, MODES, MODE_IDS, type PublicServerConfig } from '@shared';
import { roomsApi, sessionApi, setCsrfToken } from '../lib/api';
import { getIdentity, saveIdentity, savePlayer } from '../lib/storage';
import { AvatarPicker, Avatar } from '../components/Avatar';
import { Badge, Button, Card, Input, Modal } from '../components/ui';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { useSession } from '../app/SessionProvider';
import { useToast } from '../app/ToastProvider';
import {
  InfoIcon,
  LinkIcon,
  QrIcon,
  SparklesIcon,
  ShieldIcon,
  UsersIcon,
} from '../components/Icons';

export function LandingPage() {
  const navigate = useNavigate();
  const { session } = useSession();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  const [config, setConfig] = useState<PublicServerConfig | null>(null);
  const [name, setName] = useState(() => getIdentity().name);
  const [avatarSeed, setAvatarSeed] = useState(() => getIdentity().avatarSeed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    roomsApi
      .config()
      .then(setConfig)
      .catch(() => undefined);
  }, []);

  const connectTikTok = async () => {
    setBusy(true);
    try {
      const { url } = await sessionApi.tiktokStartUrl('/account');
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the TikTok sign-in.');
      setBusy(false);
    }
  };


  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a display name.');
      return;
    }
    if (trimmed.length > 24) {
      setError('Names can be at most 24 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await roomsApi.create(trimmed, avatarSeed);
      setCsrfToken(result.csrfToken ?? null);
      savePlayer({
        code: result.code,
        playerId: result.playerId,
        playerToken: result.playerToken,
        name: trimmed,
        avatarSeed,
      });
      saveIdentity(trimmed, avatarSeed);
      navigate(`/room/${result.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the room.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <nav className="topnav">
        <div className="container topnav-inner">
          <Logo />
          <div className="row">
            {session?.tiktok.linked ? (
              <Link to="/account" className="chip" title="Manage your TikTok connection">
                <Avatar
                  name={session.tiktok.displayName ?? 'TikTok'}
                  seed={0}
                  url={session.tiktok.avatarUrl}
                  size="sm"
                />
                TikTok Connected
              </Link>
            ) : (
              <Button
                variant="mint"
                size="sm"
                icon={<LinkIcon size={15} />}
                disabled={busy || config?.tiktokConfigured === false}
                onClick={() => void connectTikTok()}
              >
                Connect TikTok
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setApiOpen(true)}>
              API status
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <header className="hero container">
        <span className="hero-kicker">
          <SparklesIcon size={15} /> Free forever · Unlimited rounds · No sign-up
        </span>
        <h1 className="hero-title">
          Guess <span className="accent">who did it.</span>
        </h1>
        <p className="hero-sub">
          {BRAND.name} is a real-time party game for you and your friends. Everyone joins from their
          own phone, and the group guesses who liked, reposted, saved — or posted — each clip.
        </p>
        <div className="hero-actions">
          <Button
            variant="primary"
            size="lg"
            icon={<UsersIcon size={19} />}
            onClick={() => setCreateOpen(true)}
          >
            Create game
          </Button>
          <Button
            variant="outline"
            size="lg"
            icon={<QrIcon size={19} />}
            onClick={() => navigate('/join')}
          >
            Join game
          </Button>
        </div>
      </header>

      <main className="container">
        <div className="feature-grid">
          <Card>
            <div className="feature-icon">
              <UsersIcon size={22} />
            </div>
            <h2 className="card-title">Play together, live</h2>
            <p className="card-sub">
              Create a room, share the 6-letter code, and everyone appears instantly. Play on phones
              and desktops at the same time.
            </p>
          </Card>
          <Card>
            <div className="feature-icon">
              <SparklesIcon size={22} />
            </div>
            <h2 className="card-title">Unlimited and free</h2>
            <p className="card-sub">
              No round caps, no daily limits, no upgrades. Play 5 rounds or 500 — the host can always
              start another game.
            </p>
          </Card>
          <Card>
            <div className="feature-icon">
              <ShieldIcon size={22} />
            </div>
            <h2 className="card-title">Honest about data</h2>
            <p className="card-sub">
              Real TikTok integration where the official API allows it, and clearly-labelled demo
              content everywhere else. No scraping, ever.
            </p>
          </Card>
        </div>

        <Card
          className="anim-fade-up"
          title={
            <>
              <LinkIcon size={19} /> Connect your TikTok
            </>
          }
          subtitle="Real data only — ClueCrew never fakes videos, follower counts or statistics."
        >
          {session?.tiktok.linked ? (
            <div className="stack-sm">
              <div className="row">
                <Avatar
                  name={session.tiktok.displayName ?? 'TikTok'}
                  seed={0}
                  url={session.tiktok.avatarUrl}
                  size="md"
                />
                <div className="grow">
                  <div className="setting-label">
                    {session.tiktok.displayName ?? 'TikTok connected'}
                  </div>
                  <div className="faint small">{session.tiktok.scopes.join(', ')}</div>
                </div>
                <Badge variant="mint">TikTok Connected</Badge>
              </div>
              <Link className="btn btn-outline btn-sm" to="/account">
                View profile, statistics &amp; videos
              </Link>
            </div>
          ) : (
            <div className="stack-sm">
              <p className="muted small">
                <strong>Connect your TikTok account to see your real data.</strong> Your profile,
                your public videos and (with TikTok&apos;s permission) your statistics come
                straight from the official APIs. ClueCrew never asks for your TikTok password.
              </p>
              <div className="row wrap">
                <Button
                  variant="primary"
                  icon={<LinkIcon size={17} />}
                  disabled={busy || config?.tiktokConfigured === false}
                  onClick={() => void connectTikTok()}
                >
                  Continue with TikTok
                </Button>
                {config?.tiktokConfigured === false && (
                  <span className="faint small">
                    TikTok sign-in is not configured on this server yet.
                  </span>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card
          className="anim-fade-up"
          title={
            <>
              <InfoIcon size={19} /> Game modes &amp; TikTok API status
            </>
          }
          subtitle="Exactly what is possible through TikTok's official APIs today — nothing is faked."
          actions={
            <Button variant="outline" size="sm" onClick={() => setApiOpen(true)}>
              Details
            </Button>
          }
        >
          <div className="mode-table">
            {MODE_IDS.map((modeId) => {
              const mode = MODES[modeId];
              const official = config?.modeInfo?.[modeId]?.official;
              return (
                <div key={modeId} className="mode-row">
                  <span
                    className="mode-row-icon"
                    style={{
                      background:
                        mode.accent === 'pink'
                          ? 'var(--grad-primary)'
                          : mode.accent === 'mint'
                            ? 'var(--grad-mint)'
                            : mode.accent === 'amber'
                              ? 'var(--grad-amber)'
                              : 'var(--grad-violet)',
                    }}
                  >
                    <ModeGlyph modeId={modeId} />
                  </span>
                  <span className="mode-row-body">
                    <span className="mode-row-title">
                      {mode.title}
                      {official ? (
                        official.supported ? (
                          <Badge variant="mint">Official API · {official.scope}</Badge>
                        ) : (
                          <Badge variant="danger">Not available via API</Badge>
                        )
                      ) : (
                        <Badge>checking…</Badge>
                      )}
                    </span>
                    <span className="mode-row-note">
                      {official?.note ?? mode.description}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </main>

      <footer className="site-footer">
        <div className="container row-between wrap">
          <span>
            {BRAND.name} — {BRAND.tagline} Built from scratch, no proprietary code or assets.
          </span>
          <span className="row">
            <LinkIcon size={14} />
            <span>TikTok is a trademark of its owner. Not affiliated.</span>
          </span>
        </div>
      </footer>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create a game">
        <div className="stack">
          <div className="field">
            <label className="label" htmlFor="create-name">
              Your display name
            </label>
            <Input
              id="create-name"
              value={name}
              maxLength={24}
              autoFocus
              placeholder="e.g. Nova"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void create();
              }}
            />
          </div>
          <div className="field">
            <span className="label">Pick your avatar</span>
            <AvatarPicker value={avatarSeed} name={name || '?'} onChange={setAvatarSeed} />
          </div>
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <Button variant="primary" size="lg" block loading={busy} onClick={() => void create()}>
            Create game
          </Button>
          <p className="faint small center">
            You&apos;ll get a 6-letter room code for your friends.
          </p>
        </div>
      </Modal>

      <Modal open={apiOpen} onClose={() => setApiOpen(false)} title="TikTok API — honest status">
        <div className="stack-sm">
          <p className="muted small">
            {BRAND.name} only uses TikTok's official developer APIs. Here is exactly what that allows
            today (verified September 2026):
          </p>
          {MODE_IDS.map((modeId) => {
            const official = config?.modeInfo?.[modeId]?.official;
            return (
              <div key={modeId} className="mode-row">
                <span className="mode-row-body">
                  <span className="mode-row-title">
                    {MODES[modeId].title}
                    {official?.supported ? (
                      <Badge variant="mint">Supported · {official.scope}</Badge>
                    ) : (
                      <Badge variant="danger">Not available via API</Badge>
                    )}
                  </span>
                  <span className="mode-row-note">{official?.note}</span>
                </span>
              </div>
            );
          })}
          <p className="muted small">
            Where official access is missing, we use a <strong>clearly-labelled demo provider</strong>{' '}
            instead of scraping or faking TikTok data. The game architecture is provider-based, so
            those modes can switch to real data the moment TikTok grants the required permission.
          </p>
        </div>
      </Modal>
    </div>
  );
}

function ModeGlyph({ modeId }: { modeId: (typeof MODE_IDS)[number] }) {
  const mode = MODES[modeId];
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {mode.icon === 'heart' && (
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      )}
      {mode.icon === 'repeat' && (
        <>
          <path d="m17 2 4 4-4 4" />
          <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path d="m7 22-4-4 4-4" />
          <path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </>
      )}
      {mode.icon === 'bookmark' && <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />}
      {mode.icon === 'clapper' && (
        <>
          <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
          <path d="m6.2 5.3 3.1 3.9" />
          <path d="m12.4 3.4 3.1 4" />
          <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        </>
      )}
    </svg>
  );
}
