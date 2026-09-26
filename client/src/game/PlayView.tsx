import { useEffect, useRef, useState } from 'react';
import { MODES, type GameSettings, type RoomState, type GameFlash } from '@shared';
import { Avatar } from '../components/Avatar';
import { Badge, Button } from '../components/ui';
import { LogOutIcon, SoundOffIcon, SoundOnIcon, SparklesIcon } from '../components/Icons';
import { sounds } from '../lib/sound';
import { roundLabel } from '../lib/format';
import { useServerOffset, useTicker } from '../lib/useRoom';
import { ContentCard } from './ContentCard';
import { GuessPanel } from './GuessPanel';
import { RevealPanel } from './RevealPanel';
import { ScoreboardPanel } from './ScoreboardPanel';
import { HostControls, ModeChip } from './HostControls';
import { TimerRing } from '../components/TimerRing';

export interface PlayViewActions {
  onSettings: (patch: Partial<GameSettings>) => void;
  onSkip: () => void;
  onNext: () => void;
  onPause: (paused: boolean) => void;
  onEnd: () => void;
  onLeave: () => void;
  onError: (message: string) => void;
}

export function PlayView({
  state,
  myPlayerId,
  emitAck,
  actions,
  busy,
}: {
  state: RoomState;
  myPlayerId: string;
  emitAck: <T>(event: 'guess:submit', payload?: Record<string, unknown>) => Promise<T>;
  actions: PlayViewActions;
  busy: boolean;
}) {
  const isHost = state.you?.isHost ?? false;
  const [soundEnabled, setSoundEnabled] = useState(() => sounds.isEnabled());
  const round = state.round;
  const mode = round ? MODES[round.mode] : null;
  const offset = useServerOffset(state);

  // Tick sound for the last seconds of guessing.
  const guessingActive = state.phase === 'GUESSING' && round?.guessingEndsAt !== null;
  const now = useTicker(Boolean(guessingActive), 250);
  const remainingSeconds = round?.guessingEndsAt
    ? Math.max(0, Math.ceil((round.guessingEndsAt - (now + offset)) / 1000))
    : null;
  const lastTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (remainingSeconds === null || remainingSeconds > 5 || remainingSeconds <= 0) return;
    if (lastTickRef.current === remainingSeconds) return;
    lastTickRef.current = remainingSeconds;
    sounds.play('tick');
  }, [remainingSeconds]);

  if (!round || !mode) {
    return (
      <div className="fullscreen-state">
        <span className="spinner" />
        <p className="muted">Loading the round…</p>
      </div>
    );
  }

  const you = state.you;
  const isActor = you?.isActor ?? false;
  const answeredCount = round.answeredPlayerIds.length;
  const answerableCount = round.answerablePlayerIds.length;

  return (
    <div className="game-shell">
      <header className="game-topbar">
        <div className="container game-topbar-inner">
          <span className="round-pill">{roundLabel(state.roundNumber, state.totalRounds)}</span>
          <ModeChip modeTitle={mode.title} accent={mode.accent} />
          <div className="grow" />
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
            title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
            onClick={() => setSoundEnabled(sounds.toggle())}
          >
            {soundEnabled ? <SoundOnIcon size={18} /> : <SoundOffIcon size={18} />}
          </button>
          {isHost && (
            <HostControls
              state={state}
              busy={busy}
              onSkip={actions.onSkip}
              onNext={actions.onNext}
              onPause={actions.onPause}
              onEnd={actions.onEnd}
              onSettings={actions.onSettings}
            />
          )}
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Leave room"
            title="Leave room"
            onClick={actions.onLeave}
          >
            <LogOutIcon size={18} />
          </button>
        </div>
      </header>

      <main className="game-stage">
        <div className="stage-narrow stack" style={{ alignItems: 'center', gap: 20 }}>
          {state.phase === 'ROUND_START' && (
            <div className="round-intro">
              <span className="round-intro-number">
                {state.totalRounds === 0 ? `Round ${state.roundNumber}` : `Round ${state.roundNumber}`}
              </span>
              <span className="round-intro-mode">{mode.title}</span>
            </div>
          )}

          {(state.phase === 'SHOW_CONTENT' ||
            state.phase === 'GUESSING' ||
            state.phase === 'LOCK_GUESSES') && (
            <>
              <h1 className="question-headline">{mode.question}</h1>
              <p className="phase-hint">
                {state.phase === 'SHOW_CONTENT'
                  ? 'Take a good look…'
                  : state.phase === 'LOCK_GUESSES'
                    ? 'Answers are locked. Revealing…'
                    : isActor
                      ? 'This one is yours — enjoy the guesses!'
                      : 'Who do you think this belongs to?'}
              </p>

              {round.content && <ContentCard content={round.content} />}

              {isActor && state.phase !== 'LOCK_GUESSES' && (
                <div className="actor-banner">
                  <SparklesIcon size={20} /> This round is yours — sit back!
                </div>
              )}

              {!isActor && (state.phase === 'GUESSING' || state.phase === 'LOCK_GUESSES') && (
                <GuessPanel state={state} emitAck={emitAck} onError={actions.onError} />
              )}

              <div className="row" style={{ justifyContent: 'center', gap: 18 }}>
                {state.phase === 'GUESSING' && (
                  <TimerRing
                    endsAtServer={round.guessingEndsAt}
                    serverOffset={offset}
                    totalMs={state.settings.secondsPerRound * 1000}
                  />
                )}
                <div className="answer-dots">
                  {round.answerablePlayerIds.map((playerId) => {
                    const player = state.players.find((entry) => entry.id === playerId);
                    const answered = round.answeredPlayerIds.includes(playerId);
                    return (
                      <span
                        key={playerId}
                        className={`answer-dot ${answered ? 'answered' : ''} ${
                          playerId === myPlayerId ? 'is-you' : ''
                        }`}
                      >
                        <span className={`dot ${answered ? 'dot-online' : 'dot-offline'}`} />
                        {player?.name ?? 'Player'}
                      </span>
                    );
                  })}
                </div>
              </div>
              {state.phase === 'GUESSING' && answerableCount > 0 && (
                <p className="faint small center">
                  {answeredCount} of {answerableCount} answered — you can still change your pick until
                  everyone is done.
                </p>
              )}
            </>
          )}

          {state.phase === 'REVEAL' && (
            <>
              <RevealPanel state={state} />
              <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
                <Badge variant="primary">Round {state.roundNumber}</Badge>
                {round.skipped && <Badge variant="amber">Skipped early</Badge>}
              </div>
            </>
          )}

          {state.phase === 'SHOW_POINTS' && (
            <ScoreboardPanel
              state={state}
              isHost={isHost}
              busy={busy}
              onNext={actions.onNext}
              onPause={actions.onPause}
            />
          )}
        </div>
      </main>

      {state.paused && (
        <div className="paused-overlay">
          <h2>Game paused</h2>
          <p className="muted">The host paused the game between rounds.</p>
          {isHost ? (
            <Button
              variant="primary"
              onClick={() => actions.onPause(false)}
              icon={<SparklesIcon size={17} />}
            >
              Resume game
            </Button>
          ) : (
            <div className="row">
              <span className="spinner" style={{ width: 22, height: 22, borderWidth: 2 }} />
              <span className="muted">Waiting for the host…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type { GameFlash };
