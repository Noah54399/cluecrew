import { useMemo, useState } from 'react';
import type { PlayerPublic, RoomState } from '@shared';
import { Avatar } from '../components/Avatar';
import { LockIcon } from '../components/Icons';
import { ApiError } from '../lib/api';

function hash(input: string): number {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function GuessPanel({
  state,
  emitAck,
  onError,
}: {
  state: RoomState;
  emitAck: <T>(event: 'guess:submit', payload?: Record<string, unknown>) => Promise<T>;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const round = state.round!;
  const you = state.you!;
  const canGuess = you.canGuess;
  const locked = !canGuess && round.phase === 'GUESSING';

  const ordered = useMemo(() => {
    const players = round.answerablePlayerIds
      .map((id) => state.players.find((player) => player.id === id))
      .filter((player): player is PlayerPublic => Boolean(player));
    if (state.settings.randomizeOrder) {
      players.sort((a, b) => hash(`${round.id}:${a.id}`) - hash(`${round.id}:${b.id}`));
    }
    return players;
  }, [round.answerablePlayerIds, round.id, state.players, state.settings.randomizeOrder]);

  const submit = async (targetId: string) => {
    if (!canGuess || pending) return;
    setPending(targetId);
    try {
      await emitAck('guess:submit', { targetPlayerId: targetId });
    } catch (error) {
      onError(error instanceof ApiError ? error.message : 'Could not submit your guess.');
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="stack" style={{ width: '100%' }}>
      <div className="guess-grid">
        {ordered.map((player, index) => {
          const selected = you.guessTargetId === player.id;
          const dimmed = locked && !selected;
          return (
            <button
              key={player.id}
              type="button"
              disabled={!canGuess || pending !== null}
              className={`guess-btn anim-pop ${selected ? 'selected' : ''} ${
                locked && selected ? 'locked' : ''
              } ${dimmed ? 'picked-other' : ''}`}
              style={{ animationDelay: `${Math.min(index * 0.04, 0.25)}s` }}
              onClick={() => void submit(player.id)}
            >
              {state.settings.showAvatars && (
                <Avatar name={player.name} seed={player.avatarSeed} url={player.avatarUrl} size="sm" />
              )}
              <span className="guess-btn-name">{player.name}</span>
              {selected && <LockIcon size={16} />}
            </button>
          );
        })}
      </div>

      {locked && (
        <div className="locked-banner anim-pop">
          <LockIcon size={17} />
          Your answer is locked in — no take-backs!
        </div>
      )}
    </div>
  );
}
