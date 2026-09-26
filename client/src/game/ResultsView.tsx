import { useState } from 'react';
import type { RoomState } from '@shared';
import { Avatar } from '../components/Avatar';
import { Button, Card } from '../components/ui';
import { Confetti } from '../components/Confetti';
import { LogOutIcon, PlayIcon, RefreshIcon, TrophyIcon } from '../components/Icons';
import { pluralize } from '../lib/format';

export function ResultsView({
  state,
  busy,
  onPlayAgain,
  onBackToLobby,
  onLeave,
}: {
  state: RoomState;
  busy: boolean;
  onPlayAgain: () => void;
  onBackToLobby: () => void;
  onLeave: () => void;
}) {
  const isHost = state.you?.isHost ?? false;
  const [confetti] = useState(true);
  const top = state.leaderboard.slice(0, 3);
  const rest = state.leaderboard.slice(3);
  const [first, second, third] = top;
  const myEntry = state.leaderboard.find((entry) => entry.playerId === state.you?.playerId);

  const podium = [second, first, third].filter(Boolean);

  return (
    <div className="container container-narrow stack-lg" style={{ paddingBottom: 56, paddingTop: 18 }}>
      <Confetti active={confetti} />

      <div className="center stack-sm anim-fade-up">
        <h1 style={{ fontSize: 'clamp(30px, 7vw, 46px)' }}>
          Final results
        </h1>
        <p className="muted">
          {state.gameNumber > 0
            ? `Game ${state.gameNumber} finished after ${state.roundNumber} ${pluralize(state.roundNumber, 'round')}.`
            : 'Game finished.'}
          {myEntry ? ` You finished #${myEntry.rank}.` : ''}
        </p>
      </div>

      <div className="podium">
        {podium.map((entry) => {
          const place = entry!.rank;
          return (
            <div
              key={entry!.playerId}
              className={`podium-place ${place === 1 ? 'first' : place === 2 ? 'second' : 'third'}`}
            >
              <Avatar
                name={entry!.name}
                seed={entry!.avatarSeed}
                url={entry!.avatarUrl}
                size={place === 1 ? 'xl' : 'lg'}
                ring={place === 1}
              />
              <span className="podium-name">{entry!.name}</span>
              <span className="podium-score">{entry!.score}</span>
              <div className="step">{place}</div>
            </div>
          );
        })}
      </div>

      <Card title={<><TrophyIcon size={19} /> Full standings</>} className="anim-fade-up">
        <div className="leaderboard">
          {[...top, ...rest].map((entry) => (
            <div
              key={entry.playerId}
              className={`leader-row ${entry.playerId === state.you?.playerId ? 'me' : ''}`}
            >
              <span className={`leader-rank ${entry.rank <= 3 ? `top-${entry.rank}` : ''}`}>
                {entry.rank}
              </span>
              <Avatar name={entry.name} seed={entry.avatarSeed} url={entry.avatarUrl} size="sm" />
              <span className="result-name">
                {entry.name}
                <span className="faint small" style={{ display: 'block' }}>
                  {entry.correctGuesses} correct {pluralize(entry.correctGuesses, 'guess')}
                </span>
              </span>
              <span className="leader-score">{entry.score}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="stack-sm">
        {isHost ? (
          <>
            <Button
              variant="primary"
              size="lg"
              block
              icon={<RefreshIcon size={18} />}
              disabled={busy}
              onClick={onPlayAgain}
            >
              Play again with the same crew
            </Button>
            <Button variant="outline" block disabled={busy} onClick={onBackToLobby}>
              Back to lobby
            </Button>
          </>
        ) : (
          <p className="center muted">
            <PlayIcon size={15} /> Waiting for the host to start the next game…
          </p>
        )}
        <Button variant="ghost" block icon={<LogOutIcon size={17} />} onClick={onLeave}>
          Leave room
        </Button>
      </div>
    </div>
  );
}
