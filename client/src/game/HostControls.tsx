import { useState } from 'react';
import type { GameSettings, ModeAvailability, RoomState } from '@shared';
import { Badge, Button, Modal } from '../components/ui';
import { PauseIcon, PlayIcon, SettingsIcon, SkipIcon, StopIcon } from '../components/Icons';
import { GameSettingsForm } from './GameSettingsForm';

/** Host control bar shown during a game (topbar icons + settings modal). */
export function HostControls({
  state,
  busy,
  onSkip,
  onNext,
  onPause,
  onEnd,
  onSettings,
}: {
  state: RoomState;
  busy: boolean;
  onSkip: () => void;
  onNext: () => void;
  onPause: (paused: boolean) => void;
  onEnd: () => void;
  onSettings: (patch: Partial<GameSettings>) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const showNext = state.phase === 'SHOW_POINTS';
  const canPause = state.phase === 'SHOW_POINTS';
  const canSkip = ['ROUND_START', 'SHOW_CONTENT', 'GUESSING', 'LOCK_GUESSES', 'REVEAL'].includes(
    state.phase,
  );

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label="Game settings"
        title="Game settings"
        onClick={() => setSettingsOpen(true)}
      >
        <SettingsIcon size={18} />
      </button>

      {showNext && (
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label="Next round now"
          title="Next round now"
          disabled={busy}
          onClick={onNext}
        >
          <PlayIcon size={18} />
        </button>
      )}

      {canSkip && (
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label="Skip this round"
          title="Skip this round"
          disabled={busy}
          onClick={onSkip}
        >
          <SkipIcon size={18} />
        </button>
      )}

      {canPause && (
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label={state.paused ? 'Resume' : 'Pause between rounds'}
          title={state.paused ? 'Resume' : 'Pause between rounds'}
          disabled={busy}
          onClick={() => onPause(!state.paused)}
        >
          {state.paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
        </button>
      )}

      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label="End game"
        title="End game"
        disabled={busy}
        onClick={() => setConfirmEnd(true)}
      >
        <StopIcon size={18} />
      </button>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Game settings"
      >
        <p className="faint small" style={{ marginBottom: 16 }}>
          Changes apply to the upcoming rounds. You can always add more rounds — playing is unlimited
          and free.
        </p>
        <GameSettingsForm
          settings={state.settings}
          availability={state.modeAvailability as ModeAvailability[]}
          onChange={onSettings}
        />
      </Modal>

      <Modal open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End this game?">
        <p className="muted" style={{ marginBottom: 18 }}>
          Everyone will see the final scoreboard. You can start a brand-new game right away.
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
            Keep playing
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmEnd(false);
              onEnd();
            }}
          >
            End game
          </Button>
        </div>
      </Modal>
    </>
  );
}

export function ModeChip({ modeTitle, accent }: { modeTitle: string; accent: string }) {
  const variant =
    accent === 'pink' ? 'pink' : accent === 'mint' ? 'mint' : accent === 'amber' ? 'amber' : 'primary';
  return <Badge variant={variant}>{modeTitle}</Badge>;
}
