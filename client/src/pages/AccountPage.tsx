import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ActivityImportState, TikTokProfileView, TikTokVideosView } from '@cluecrew/shared';
import { ApiError, sessionApi, tiktokAccountApi } from '../lib/api';
import { useSession } from '../app/SessionProvider';
import { useToast } from '../app/ToastProvider';
import { Avatar } from '../components/Avatar';
import { Badge, Banner, Button, Card, Spinner } from '../components/ui';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { TikTokImportPanel } from '../components/TikTokImportPanel';
import { LinkIcon, RefreshIcon, ShieldIcon, SparklesIcon } from '../components/Icons';
import { formatCount, formatDate } from '../lib/format';

const EMPTY_IMPORT: ActivityImportState = {
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

export function AccountPage() {
  const { session, loading: sessionLoading, refresh: refreshSession } = useSession();
  const toast = useToast();

  const [profile, setProfile] = useState<TikTokProfileView | null>(null);
  const [videos, setVideos] = useState<TikTokVideosView | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localImport, setLocalImport] = useState<ActivityImportState | null>(null);

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true);
    setError(null);
    try {
      setProfile(await tiktokAccountApi.profile());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your TikTok profile.');
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  const loadVideos = useCallback(async () => {
    setLoadingVideos(true);
    try {
      setVideos(await tiktokAccountApi.videos(20));
    } catch (err) {
      setVideos({
        available: false,
        needsReconnect: false,
        reason: err instanceof ApiError ? err.message : 'Could not load your videos.',
        requiredScope: 'video.list',
        videos: [],
      });
    } finally {
      setLoadingVideos(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
    void loadVideos();
  }, [loadProfile, loadVideos]);

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    void run(async () => {
      const { url } = await sessionApi.tiktokStartUrl('/account');
      window.location.href = url;
    }, 'Could not start the TikTok sign-in.');

  const disconnect = () =>
    void run(async () => {
      await sessionApi.tiktokDisconnect();
      await refreshSession();
      setLocalImport(null);
      setVideos(null);
      toast.success('TikTok disconnected. Imported activity data was deleted.');
      await loadProfile();
      await loadVideos();
    }, 'Could not disconnect TikTok.');

  const importState = localImport ?? session?.import ?? EMPTY_IMPORT;
  const statsUnavailable = profile?.unavailable.find((entry) => entry.field === 'stats');
  const profileUnavailable = profile?.unavailable.find((entry) => entry.field === 'profile');

  return (
    <div className="page">
      <nav className="topnav">
        <div className="container topnav-inner">
          <Logo />
          <div className="row">
            <Link className="btn btn-ghost btn-sm" to="/">
              Back to the game
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <main
        className="container container-narrow stack-lg"
        style={{ paddingTop: 26, paddingBottom: 60 }}
      >
        <div className="stack-sm">
          <h1 style={{ fontSize: 'clamp(26px, 5vw, 36px)' }}>Your TikTok account</h1>
          <p className="muted">
            Real data from TikTok&apos;s official APIs — profile, statistics and your own public
            videos. Nothing on this page is simulated.
          </p>
        </div>

        {sessionLoading && <Spinner label="Loading your session…" />}

        {!sessionLoading && error && (
          <Banner kind="error">
            {error}{' '}
            <Button
              size="sm"
              variant="outline"
              icon={<RefreshIcon size={14} />}
              onClick={() => {
                void loadProfile();
                void loadVideos();
              }}
            >
              Try again
            </Button>
          </Banner>
        )}

        {!sessionLoading && !error && profile && !profile.connected && (
          <Card className="anim-fade-up">
            <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
              <span className="feature-icon" style={{ margin: 0 }}>
                <LinkIcon size={22} />
              </span>
              <h2 className="card-title" style={{ justifyContent: 'center' }}>
                Connect your TikTok account to see your real data.
              </h2>
              <p className="muted small" style={{ maxWidth: 460 }}>
                {profile.message ??
                  'ClueCrew uses TikTok’s official authorization system. We never ask for your TikTok password.'}
              </p>
              {profile.connected === false && (
                <ul className="muted small" style={{ textAlign: 'left', maxWidth: 460 }}>
                  <li>
                    <strong>Profile &amp; videos</strong> come from the official Display API
                    (permissions: <code>user.info.basic</code>, <code>video.list</code>).
                  </li>
                  <li>
                    <strong>Statistics</strong> (followers, likes, videos) require the{' '}
                    <code>user.info.stats</code> permission.
                  </li>
                  <li>
                    <strong>Liked / saved videos</strong> require TikTok&apos;s Data Portability
                    approval — the app shows exactly what is available and never invents data.
                  </li>
                </ul>
              )}
              <Button
                variant="primary"
                size="lg"
                icon={<LinkIcon size={18} />}
                onClick={connect}
                disabled={busy || !session?.tiktok.configured}
              >
                Continue with TikTok
              </Button>
              {!session?.tiktok.configured && (
                <Banner kind="warn" icon={<ShieldIcon size={16} />}>
                  TikTok sign-in is not configured on this server yet. The operator must add
                  TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET.
                </Banner>
              )}
            </div>
          </Card>
        )}

        {!sessionLoading && profile?.connected && (
          <>
            {profile.needsReconnect && (
              <Banner kind="error">
                {profile.message ??
                  'TikTok rejected the stored authorization. Reconnect your TikTok account to continue.'}{' '}
                <Button size="sm" variant="danger" onClick={connect} disabled={busy}>
                  Reconnect
                </Button>
              </Banner>
            )}

            <Card className="anim-fade-up">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <Avatar
                  name={profile.displayName ?? 'TikTok'}
                  seed={0}
                  url={profile.avatarUrl}
                  size="xl"
                />
                <div className="grow stack-sm">
                  <div className="row wrap">
                    <h2 style={{ fontSize: 24 }}>{profile.displayName ?? 'TikTok user'}</h2>
                    {profile.isVerified && <Badge variant="mint">Verified</Badge>}
                    <Badge variant={profile.needsReconnect ? 'danger' : 'success'}>
                      {profile.needsReconnect ? 'Reconnect needed' : 'Connected'}
                    </Badge>
                  </div>
                  <div className="row wrap faint small">
                    {profile.username && <span>@{profile.username}</span>}
                    {profile.connectedAt && <span>Connected {formatDate(profile.connectedAt)}</span>}
                    {profile.accessTokenExpiresAt && (
                      <span>Access valid until {formatDate(profile.accessTokenExpiresAt)}</span>
                    )}
                  </div>
                  {profile.bioDescription && <p className="muted small">{profile.bioDescription}</p>}
                  {profile.profileDeepLink && (
                    <a
                      className="small"
                      href={profile.profileDeepLink}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open profile on TikTok →
                    </a>
                  )}
                </div>
              </div>
            </Card>

            <Card
              title={
                <>
                  <SparklesIcon size={18} /> Profile statistics
                </>
              }
              subtitle="Values returned by TikTok's Display API for your account."
            >
              {profile.stats ? (
                <div className="stat-grid">
                  <div className="stat-card">
                    <span className="stat-value">{formatCount(profile.stats.followerCount)}</span>
                    <span className="stat-label">Followers</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-value">{formatCount(profile.stats.followingCount)}</span>
                    <span className="stat-label">Following</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-value">{formatCount(profile.stats.likesCount)}</span>
                    <span className="stat-label">Likes received</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-value">{formatCount(profile.stats.videoCount)}</span>
                    <span className="stat-label">Public videos</span>
                  </div>
                </div>
              ) : (
                <Banner kind="warn" icon={<ShieldIcon size={16} />}>
                  {statsUnavailable?.reason ??
                    'TikTok did not return statistics for this account.'}{' '}
                  Required permission: <code>{statsUnavailable?.requiredScope ?? 'user.info.stats'}</code>
                  . Ask the operator to enable it via <code>TIKTOK_EXTRA_SCOPES</code> after TikTok
                  approves that scope, then reconnect.
                </Banner>
              )}
            </Card>

            <Card
              title="Your public videos"
              subtitle="From the official Display API — real titles, covers and statistics."
            >
              {loadingVideos && (
                <div className="video-grid">
                  {[0, 1, 2].map((index) => (
                    <div key={index} className="video-card">
                      <div className="video-cover skeleton" />
                      <div className="video-body">
                        <div className="skeleton" style={{ height: 14, width: '80%' }} />
                        <div className="skeleton" style={{ height: 12, width: '50%', marginTop: 8 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!loadingVideos && videos && videos.available && videos.videos.length > 0 && (
                <div className="video-grid">
                  {videos.videos.map((video) => (
                    <a
                      key={video.id}
                      className="video-card"
                      href={video.shareUrl ?? '#'}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {video.coverUrl ? (
                        <img className="video-cover" src={video.coverUrl} alt="" loading="lazy" />
                      ) : (
                        <div className="video-cover video-cover-empty" aria-hidden>
                          &#9834;
                        </div>
                      )}
                      <div className="video-body">
                        <p className="video-title">{video.title ?? 'Untitled video'}</p>
                        <div className="video-meta">
                          {video.viewCount !== null && (
                            <span>{formatCount(video.viewCount)} views</span>
                          )}
                          {video.likeCount !== null && (
                            <span>{formatCount(video.likeCount)} likes</span>
                          )}
                          {video.commentCount !== null && (
                            <span>{formatCount(video.commentCount)} comments</span>
                          )}
                          {video.durationSeconds !== null && <span>{video.durationSeconds}s</span>}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
              {!loadingVideos && videos && videos.available && videos.videos.length === 0 && (
                <p className="muted small">
                  TikTok returned no public videos for this account yet.
                </p>
              )}
              {!loadingVideos && videos && !videos.available && (
                <Banner kind="warn" icon={<ShieldIcon size={16} />}>
                  {videos.reason ?? 'Your videos are not available.'}
                  {videos.requiredScope && (
                    <>
                      {' '}Required permission: <code>{videos.requiredScope}</code>.
                    </>
                  )}
                  {videos.needsReconnect && (
                    <>
                      {' '}
                      <Button size="sm" variant="danger" onClick={connect} disabled={busy}>
                        Reconnect
                      </Button>
                    </>
                  )}
                </Banner>
              )}
            </Card>

            <Card
              title="Connection &amp; permissions"
              subtitle="Manage the TikTok link and the optional activity import."
            >
              <div className="stack-sm">
                <div className="row wrap">
                  {profile.scopesGranted.length > 0 ? (
                    profile.scopesGranted.map((scope) => (
                      <Badge key={scope} variant="mint">
                        {scope}
                      </Badge>
                    ))
                  ) : (
                    <span className="faint small">No scopes reported.</span>
                  )}
                </div>
                {profile.scopesMissing.length > 0 && (
                  <p className="faint small">
                    Not granted: {profile.scopesMissing.join(', ')} — these features stay hidden
                    instead of being filled with placeholder values.
                  </p>
                )}
                {profileUnavailable && (
                  <p className="faint small">{profileUnavailable.reason}</p>
                )}

                <hr className="divider" />

                <TikTokImportPanel
                  importState={importState}
                  linked={Boolean(session?.tiktok.linked)}
                  onStateChange={setLocalImport}
                  busy={busy}
                />

                <hr className="divider" />

                <div className="row wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<LinkIcon size={15} />}
                    onClick={connect}
                    disabled={busy}
                  >
                    Reconnect TikTok
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={disconnect}
                    disabled={busy}
                  >
                    Disconnect TikTok &amp; delete imported data
                  </Button>
                </div>
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
