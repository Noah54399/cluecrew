import type { RoomState } from '@shared';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/ui';
import { PlayIcon, PauseIcon } from '../components/Icons';
import { useServerOffset, useTicker } from '../lib/useRoom';

export function ScoreboardPanel({
  state,
  isHost,
  onNext,
  onPause,
  busy,
}: {
  state: RoomState;
  isHost: boolean;
  onNext: () => void;
  onPause: (paused: boolean) => void;
  busy: boolean;
}) {
  const offset = useServerOffset(state);
  const phaseEndsAt = state.round?.phaseEndsAt ?? null;
  const now = useTicker(!state.paused && phaseEndsAt !== null && state.phase === 'SHOW_POINTS', 250);
  const remainingSeconds = phaseEndsAt
    ? Math.max(0, Math.ceil((phaseEndsAt - (now + offset)) / 1000))
    : null;
  const roundsLeft = state.totalRounds === 0 ? null : state.totalRounds - state.roundNumber;

  return (
    <div className="stack anim-rise" style={{ width: '100%' }}>
      <h2 className="question-headline" style={{ fontSize: 'clamp(22px, 5vw, 34px)' }}>
        Leaderboard
      </h2>

      <div className="leaderboard">
        {state.leaderboard.map((entry, index) => {
          const player = state.players.find((item) => item.id === entry.playerId);
          const roundPoints = player?.roundPoints ?? 0;
          return (
            <div
              key={entry.playerId}
              className={`leader-row ${entry.playerId === state.you?.playerId ? 'me' : ''}`}
              style={{ animationDelay: `${Math.min(index * 0.05, 0.35)}s` }}
            >
              <span className={`leader-rank ${entry.rank <= 3 ? `top-${entry.rank}` : ''}`}>
                {entry.rank}
              </span>
              <Avatar
                name={entry.name}
                seed={entry.avatarSeed}
                url={entry.avatarUrl}
                size="sm"
              />
              <span className="result-name">{entry.name}</span>
              {roundPoints > 0 && <span className="leader-gain">+{roundPoints}</span>}
              <span className="leader-score">{entry.score}</span>
            </div>
          );
        })}
      </div>

      <p className="phase-hint">
        {state.paused
          ? 'Paused between rounds.'
          : remainingSeconds !== null
            ? `Next round starts in ${remainingSeconds}s${isHost ? ' — or start it now' : ''}.`
            : 'Waiting for the host…'}
        {roundsLeft === 1 ? ' Final round coming up!' : ''}
      </p>

      {isHost && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button
            variant="primary"
            icon={<PlayIcon size={17} />}
            onClick={onNext}
            disabled={busy}
          >
            Next round
          </Button>
          <Button
            variant="outline"
            icon={<PauseIcon size={16} />}
            disabled={busy}
            onClick={() => onPause(!state.paused)}
          >
            {state.paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      )}
    </div>
  );
}
