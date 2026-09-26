import { MODES, type RoomState } from '@shared';
import { Avatar } from '../components/Avatar';

export function RevealPanel({ state }: { state: RoomState }) {
  const round = state.round;
  if (!round || !round.actorPlayerId) return null;
  const actor = state.players.find((player) => player.id === round.actorPlayerId);
  const mode = MODES[round.mode];
  const results = round.results ?? [];

  return (
    <div className="stack anim-rise" style={{ width: '100%' }}>
      <div className="reveal-hero">
        <span className="reveal-label">The answer was…</span>
        {actor && (
          <Avatar
            name={actor.name}
            seed={actor.avatarSeed}
            url={actor.avatarUrl}
            size="xl"
            ring
            className="anim-pop-big"
          />
        )}
        <h2 className="reveal-name">{actor?.name ?? 'Unknown'}</h2>
        <p className="reveal-verb">
          {actor?.name ?? 'Someone'} {mode.verbPhrase}
        </p>
      </div>

      <div className="result-list">
        {actor && (
          <div className="result-row actor-row anim-fade-up">
            <Avatar name={actor.name} seed={actor.avatarSeed} url={actor.avatarUrl} size="sm" />
            <span className="result-name">{actor.name} was in the spotlight</span>
            <span className="result-points plus">
              {(round.actorBonus ?? 0) > 0 ? `+${round.actorBonus}` : '0'}
            </span>
          </div>
        )}
        {results.map((result, index) => {
          const player = state.players.find((entry) => entry.id === result.playerId);
          const guessed = result.guessedPlayerId
            ? state.players.find((entry) => entry.id === result.guessedPlayerId)
            : null;
          const total = result.points + result.bonus;
          return (
            <div
              key={result.playerId}
              className={`result-row ${result.correct ? 'correct' : 'wrong'}`}
              style={{ animationDelay: `${Math.min(index * 0.06, 0.4)}s` }}
            >
              {player && (
                <Avatar name={player.name} seed={player.avatarSeed} url={player.avatarUrl} size="sm" />
              )}
              <span className="result-name">
                {player?.name ?? 'Player'}{' '}
                {result.guessedPlayerId ? (
                  <>
                    guessed <strong>{guessed?.name ?? 'someone'}</strong>
                    {result.correct ? ' — correct!' : ' — wrong'}
                  </>
                ) : (
                  <span className="faint">did not answer</span>
                )}
              </span>
              <span className={`result-points ${total > 0 ? 'plus' : 'zero'}`}>
                {total > 0 ? `+${total}` : '0'}
                {result.bonus > 0 && <span className="faint small"> (+{result.bonus} speed)</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
