import { useEffect, useRef, useState } from 'react';
import type { ActivityImportState } from '@cluecrew/shared';
import { ApiError, tiktokImportApi, type ActivityImportResponse } from '../lib/api';
import { useToast } from '../app/ToastProvider';
import { Badge, Banner, Button } from './ui';
import { CheckIcon, RefreshIcon, ShieldIcon } from './Icons';

const STEPS = [
  'Connect TikTok',
  'Authorize',
  'Requesting data',
  'Waiting for TikTok',
  'Importing',
  'Ready',
] as const;

export function importStepIndex(
  state: ActivityImportState,
  linked: boolean,
): { index: number; failed: boolean } {
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

/**
 * Data Portability import progress + controls. Everything shown here is real
 * server state: no fake progress, no placeholder counts.
 */
export function TikTokImportPanel({
  importState,
  linked,
  onStateChange,
  busy = false,
}: {
  importState: ActivityImportState;
  linked: boolean;
  onStateChange: (state: ActivityImportResponse) => void;
  busy?: boolean;
}) {
  const toast = useToast();
  const [working, setWorking] = useState(false);
  const statusRef = useRef(importState.status);
  const onStateRef = useRef(onStateChange);
  onStateRef.current = onStateChange;

  // Poll while TikTok prepares/imports the export.
  useEffect(() => {
    if (!linked || !importState.enabled || !importState.scopeGranted) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await tiktokImportApi.get();
        if (!cancelled) onStateRef.current(next);
      } catch {
        // Silent: the UI keeps the last known state.
      }
    };
    void poll();
    if (!['requesting', 'pending', 'importing'].includes(importState.status)) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [linked, importState.enabled, importState.scopeGranted, importState.status]);

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

  if (!importState.enabled) {
    return (
      <Banner kind="warn" icon={<ShieldIcon size={16} />}>
        TikTok activity import is currently unavailable for this application. TikTok requires a
        separate Data Portability API approval (typically 3-4 weeks) on top of Login Kit approval.
      </Banner>
    );
  }

  if (!importState.scopeGranted) {
    return (
      <Banner kind="warn" icon={<ShieldIcon size={16} />}>
        This account has not granted the data portability permission. Reconnect TikTok and accept
        that permission to import liked and saved videos.
      </Banner>
    );
  }

  const { index: currentStep, failed } = importStepIndex(importState, linked);
  const totals = importState.counts.like + importState.counts.save + importState.counts.repost;
  const busyNow = busy || working;

  return (
    <div className="stack-sm">
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
              <span className="step-dot">{isDone ? <CheckIcon size={12} /> : stepPosition + 1}</span>
              {label}
            </div>
          );
        })}
      </div>

      {importState.note && <p className="muted small">{importState.note}</p>}
      {importState.error && <Banner kind="error">{importState.error.message}</Banner>}

      {(importState.counts.like > 0 || importState.counts.save > 0) && (
        <div className="row wrap">
          <Badge variant="mint">{importState.counts.like} liked videos</Badge>
          <Badge variant="mint">{importState.counts.save} saved videos</Badge>
          {importState.skipped > 0 && <Badge>{importState.skipped} entries skipped</Badge>}
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
              void run(() => tiktokImportApi.remove(), 'Could not delete the imported data.')
            }
          >
            Delete imported data
          </Button>
        )}
      </div>
    </div>
  );
}
