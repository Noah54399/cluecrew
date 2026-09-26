import { useEffect, useRef, useState } from 'react';
import type { ActivityImportState, ContentSourcePreference } from '@shared';
import {
  ApiError,
  tiktokImportApi,
  type ActivityImportResponse,
  type SessionPayload,
} from '../lib/api';
import { useToast } from '../app/ToastProvider';
import { Avatar } from './Avatar';
import { Badge, Banner, Button, Card } from './ui';
import { CheckIcon, LinkIcon, RefreshIcon, ShieldIcon } from './Icons';

const STEPS = [
  'Connect TikTok',
  'Authorize',
  'Requesting data',
  'Waiting for TikTok',
  'Importing',
  'Ready',
] as const;

function stepIndex(state: ActivityImportState, linked: boolean): { index: number; failed: boolean } {
  if (!linked) return { index: 0, failed: false };
  switch (state.status) {
    case 'failed':
      return { index: 2, failed: true };
    case 'expired':
      return { index: 3, failed: true };
    case 'requesting':
      return { index: 2, failed: false };
    case 'pending':
      return { index: 3, failed: false };
    case 'importing':
      return { index: 4, failed: false };
    case 'ready':
      return { index: 5, failed: false };
    default:
      return { index: state.scopeGranted ? 2 : 1, failed: false };
  }
}

const PREFERENCE_LABELS: Record<ContentSourcePreference, string> = {
  auto: 'Automatic',
  real: 'Real TikTok',
  mock: 'Mock data',
};

export function TikTokConnectionCard({
  tiktok,
  importState,
  preference,
  busy,
  onConnect,
  onDisconnectAndDelete,
  onPreferenceChange,
  onImportStateChange,
}: {
  tiktok: SessionPayload['tiktok'];
  importState: ActivityImportState;
  preference: ContentSourcePreference;
  busy: boolean;
  onConnect: () => void;
  onDisconnectAndDelete: () => void;
  onPreferenceChange: (preference: ContentSourcePreference) => void;
  onImportStateChange: (state: ActivityImportResponse) => void;
}) {
  const toast = useToast();
  const [working, setWorking] = useState(false);
  const statusRef = useRef(importState.status);
  const onStateRef = useRef(onImportStateChange);
  onStateRef.current = onImportStateChange;

  // Poll the import while TikTok is preparing/importing the export.
  useEffect(() => {
    if (!tiktok.linked || !importState.enabled || !importState.scopeGranted) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await tiktokImportApi.get();
        if (!cancelled) onStateRef.current(next);
      } catch {
        // Polling errors are silent; the UI keeps the last known state.
      }
    };
    void poll();
    const active = ['requesting', 'pending', 'importing'].includes(importState.status);
    if (!active) return () => { cancelled = true; };
    const timer = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    tiktok.linked,
    importState.enabled,
    importState.scopeGranted,
    importState.status,
  ]);

  // Celebrate a finished import exactly once.
  useEffect(() => {
    if (statusRef.current !== 'ready' && importState.status === 'ready') {
      toast.success(
        `TikTok data ready: ${importState.counts.like} liked, ${importState.counts.save} saved.`,
      );
    }
    statusRef.current = importState.status;
  }, [importState.status, importState.counts.like, importState.counts.save, toast]);

  const run = async (action: () => Promise<ActivityImportResponse>, fallbackMessage: string) => {
    setWorking(true);
    try {
      const next = await action();
      onStateRef.current(next);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : fallbackMessage);
    } finally {
      setWorking(false);
    }
  };

  const { index: currentStep, failed } = stepIndex(importState, tiktok.linked);
  const totals =
    importState.counts.like + importState.counts.save + importState.counts.repost;
  const busyNow = busy || working;

  return (
    <Card
      title={
        <>
          <LinkIcon size={18} /> TikTok connection
        </>
      }
      subtitle="Optional. Demo data keeps every mode playable without it."
    >
      {!tiktok.configured && (
        <div className="stack-sm">
          <Banner kind="warn" icon={<ShieldIcon size={16} />}>
            TikTok sign-in is not configured on this server. Add TIKTOK_CLIENT_KEY and
            TIKTOK_CLIENT_SECRET to enable it.
          </Banner>
          <p className="faint small">
            Real data is never faked: until credentials are configured, every mode runs on
            clearly-labelled demo content.
          </p>
        </div>
      )}

      {tiktok.configured && !tiktok.linked && (
        <div className="stack-sm">
          <p className="muted small">
            ClueCrew uses TikTok&apos;s official authorization system. We never ask for your TikTok
            password.
          </p>
          <ul className="muted small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Your own public videos via the official Display API (video.list).</li>
            <li>
              Liked and saved videos via TikTok&apos;s Data Portability export — only when this app
              is approved for it and your account is in the EEA or UK.
            </li>
            <li>Reposts: no official TikTok API provides them, so that mode stays on demo data.</li>
          </ul>
          <Button
            variant="outline"
            icon={<LinkIcon size={16} />}
            onClick={onConnect}
            disabled={busyNow}
          >
            Continue with TikTok
          </Button>
        </div>
      )}

      {tiktok.linked && (
        <div className="stack-sm">
          <div className="row">
            <Avatar
              name={tiktok.displayName ?? 'TikTok'}
              seed={0}
              url={tiktok.avatarUrl}
              size="md"
            />
            <div className="grow">
              <div className="setting-label">{tiktok.displayName ?? 'TikTok connected'}</div>
              <div className="faint small">
                {tiktok.scopes.length > 0 ? tiktok.scopes.join(', ') : 'no scopes reported'}
              </div>
            </div>
            <Badge variant="mint">Connected</Badge>
          </div>

          {!importState.enabled && (
            <Banner kind="warn" icon={<ShieldIcon size={16} />}>
              TikTok activity import is currently unavailable for this application. TikTok requires
              a separate Data Portability API approval (typically 3-4 weeks) on top of Login Kit
              approval.
            </Banner>
          )}

          {importState.enabled && !importState.scopeGranted && (
            <Banner kind="warn" icon={<ShieldIcon size={16} />}>
              This account has not granted the data portability permission. Reconnect TikTok and
              accept that permission to import liked and saved videos.
            </Banner>
          )}

          {importState.enabled && importState.scopeGranted && (
            <>
              <div className="steps">
                {STEPS.map((label, stepPosition) => {
                  const isFailed = failed && stepPosition === currentStep;
                  const isDone = stepPosition < currentStep;
                  const isCurrent = stepPosition === currentStep && !isFailed;
                  return (
                    <div
                      key={label}
                      className={`step ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''} ${
                        isFailed ? 'failed' : ''
                      }`}
                    >
                      <span className="step-dot">
                        {isDone ? <CheckIcon size={12} /> : stepPosition + 1}
                      </span>
                      {label}
                    </div>
                  );
                })}
              </div>

              {importState.note && <p className="muted small">{importState.note}</p>}
              {importState.error && (
                <Banner kind="error">{importState.error.message}</Banner>
              )}

              {(importState.counts.like > 0 || importState.counts.save > 0) && (
                <div className="row wrap">
                  <Badge variant="mint">{importState.counts.like} liked videos</Badge>
                  <Badge variant="mint">{importState.counts.save} saved videos</Badge>
                  {importState.skipped > 0 && (
                    <Badge>{importState.skipped} entries skipped</Badge>
                  )}
                </div>
              )}
              <Badge variant="default">Reposts: not available from TikTok</Badge>

              <div className="row wrap">
                {['pending', 'requesting', 'importing'].includes(importState.status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<RefreshIcon size={15} />}
                    disabled={busyNow}
                    onClick={() =>
                      void run(() => tiktokImportApi.refresh(), 'Could not check the import status.')
                    }
                  >
                    Check status now
                  </Button>
                )}
                {(importState.status === 'failed' ||
                  importState.status === 'expired' ||
                  importState.status === 'ready') && (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<RefreshIcon size={15} />}
                    disabled={busyNow}
                    onClick={() =>
                      void run(
                        () => tiktokImportApi.request(),
                        'Could not request a new activity export.',
                      )
                    }
                  >
                    {importState.status === 'ready' ? 'Refresh data' : 'Request a new export'}
                  </Button>
                )}
                {totals > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyNow}
                    onClick={() =>
                      void run(
                        () => tiktokImportApi.remove(),
                        'Could not delete the imported data.',
                      )
                    }
                  >
                    Delete imported data
                  </Button>
                )}
              </div>
            </>
          )}

          <hr className="divider" />

          <div className="stack-sm">
            <span className="label">Game content source</span>
            <div className="segmented" role="radiogroup" aria-label="Content source">
              {(['auto', 'real', 'mock'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={preference === value}
                  className={preference === value ? 'selected' : ''}
                  disabled={busyNow}
                  onClick={() => onPreferenceChange(value)}
                >
                  {PREFERENCE_LABELS[value]}
                </button>
              ))}
            </div>
            <p className="faint small">
              {preference === 'mock'
                ? 'Demo mode: your rounds use clearly-labelled demo data, even if TikTok is connected. Perfect for testing.'
                : preference === 'real'
                  ? 'Real mode: only real TikTok data is used. Modes without imported data show as unavailable instead of falling back to demo content.'
                  : 'Automatic: real TikTok data where available (imported likes/saves, your own videos), demo data for the rest — always labelled.'}
            </p>
          </div>

          <Button variant="ghost" size="sm" onClick={onDisconnectAndDelete} disabled={busyNow}>
            Disconnect TikTok &amp; delete imported data
          </Button>
        </div>
      )}
    </Card>
  );
}
