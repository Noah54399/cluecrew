import { describe, expect, it } from 'vitest';
import type { Phase } from '@cluecrew/shared';
import { AppError } from '../src/lib/errors.js';
import { randomId } from '../src/lib/ids.js';
import {
  addPlayer,
  beginRound,
  createEngineRoom,
  endGame,
  forceNext,
  pickUnusedContent,
  planRoundCandidates,
  prepareGame,
  removePlayer,
  resetForNewGame,
  setPaused,
  skipRound,
  submitGuess,
  tick,
  transferHost,
  updateSettings,
  type EngineDeps,
  type EnginePlayer,
  type EngineRoom,
} from '../src/game/engine.js';
import { engineSettings, makeContent, makeEngineDeps } from './helpers.js';

function mkPlayer(id: string, options: { connected?: boolean; joinedAt?: number } = {}): EnginePlayer {
  const connected = options.connected ?? true;
  return {
    id,
    userId: null,
    name: id.toUpperCase(),
    avatarSeed: 0,
    avatarUrl: null,
    isHost: false,
    connected,
    source: 'tiktok',
    socketCount: connected ? 1 : 0,
    joinedAt: options.joinedAt ?? 0,
    lastSeenAt: 0,
  };
}

function setupRoom(
  playerCount = 3,
  settings = engineSettings(),
  disconnected: string[] = [],
): { room: EngineRoom; deps: EngineDeps; clock: { value: number } } {
  const clock = { value: 1_000_000 };
  const deps = makeEngineDeps(clock);
  const room = createEngineRoom({
    id: 'rm_test',
    code: 'ABC123',
    settings,
    hostPlayerId: 'p1',
    now: clock.value,
  });
  for (let index = 1; index <= playerCount; index += 1) {
    const id = `p${index}`;
    addPlayer(room, mkPlayer(id, { joinedAt: index * 10, connected: !disconnected.includes(id) }));
  }
  const suppliers = {
    who_liked: room.players.map((player) => player.id),
    who_reposted: [],
    who_saved: [],
    who_posted: [],
  };
  prepareGame(
    room,
    { gameId: 'gm_test', eligibleModes: settings.enabledModes, suppliersByMode: suppliers },
    deps,
  );
  return { room, deps, clock };
}

function advanceTo(
  room: EngineRoom,
  deps: EngineDeps,
  clock: { value: number },
  target: Phase,
  maxSteps = 20,
): void {
  for (let step = 0; step < maxSteps && room.phase !== target; step += 1) {
    clock.value += 2_000;
    tick(room, deps);
  }
  expect(room.phase).toBe(target);
}

function playRound(
  room: EngineRoom,
  deps: EngineDeps,
  clock: { value: number },
): { actorId: string } {
  const candidates = planRoundCandidates(room, deps);
  expect(candidates.length).toBeGreaterThan(0);
  beginRound(
    room,
    {
      roundId: randomId('rd'),
      candidate: candidates[0]!,
      content: makeContent(`clip_${room.roundNumber + 1}`),
    },
    deps,
  );
  advanceTo(room, deps, clock, 'GUESSING');
  const actorId = room.round!.actorPlayerId;
  const answerers = room.players.filter((player) => player.id !== actorId && player.connected);
  answerers.forEach((player, index) => {
    const wrongTarget = answerers.find((candidate) => candidate.id !== player.id)?.id ?? actorId;
    submitGuess(room, player.id, index === 0 ? actorId : wrongTarget, deps);
  });
  advanceTo(room, deps, clock, 'SHOW_POINTS');
  return { actorId };
}

function expectAppError(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable('Expected an AppError to be thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

describe('game engine state machine', () => {
  it('walks ROUND_START -> SHOW_CONTENT -> GUESSING -> LOCK -> REVEAL -> SHOW_POINTS', () => {
    const { room, deps, clock } = setupRoom(3);
    expect(room.phase).toBe('WAITING_FOR_PLAYERS');

    const candidates = planRoundCandidates(room, deps);
    expect(candidates).toHaveLength(3);

    beginRound(
      room,
      { roundId: 'rd1', candidate: candidates[0]!, content: makeContent('c1') },
      deps,
    );
    expect(room.phase).toBe('ROUND_START');
    expect(room.roundNumber).toBe(1);
    expect(room.round!.content.contentId).toBe('c1');

    clock.value += 1001;
    tick(room, deps);
    expect(room.phase).toBe('SHOW_CONTENT');

    clock.value += 1001;
    tick(room, deps);
    expect(room.phase).toBe('GUESSING');
    expect(room.round!.guessingEndsAt).not.toBeNull();

    const actor = room.round!.actorPlayerId;
    const answerers = room.players.filter((player) => player.id !== actor);
    expect(answerers).toHaveLength(2);

    submitGuess(room, answerers[0]!.id, actor, deps);
    expect(room.phase).toBe('GUESSING');
    expect(room.round!.answers.size).toBe(1);

    submitGuess(room, answerers[1]!.id, answerers[0]!.id, deps);
    expect(room.phase).toBe('LOCK_GUESSES');
    expect(room.round!.results).toHaveLength(2);
    const correct = room.round!.results!.find((entry) => entry.playerId === answerers[0]!.id)!;
    const wrong = room.round!.results!.find((entry) => entry.playerId === answerers[1]!.id)!;
    expect(correct.correct).toBe(true);
    expect(correct.points).toBe(100);
    expect(wrong.correct).toBe(false);
    expect(wrong.points).toBe(0);
    expect(room.round!.actorBonus).toBe(30);

    clock.value += 1001;
    tick(room, deps);
    expect(room.phase).toBe('REVEAL');
    expect(room.round!.revealedAt).not.toBeNull();

    clock.value += 1001;
    tick(room, deps);
    expect(room.phase).toBe('SHOW_POINTS');

    const effects = (() => {
      clock.value += 1001;
      return tick(room, deps);
    })();
    expect(effects.some((effect) => effect.type === 'next_round')).toBe(true);
  });

  it('never lets the actor guess and locks answers once the round is locked', () => {
    const { room, deps, clock } = setupRoom(3);
    const candidates = planRoundCandidates(room, deps);
    beginRound(room, { roundId: 'rd1', candidate: candidates[0]!, content: makeContent('c1') }, deps);
    advanceTo(room, deps, clock, 'GUESSING');
    const actor = room.round!.actorPlayerId;
    const other = room.players.find((player) => player.id !== actor)!;

    expectAppError(() => submitGuess(room, actor, other.id, deps), 'GUESS_NOT_ALLOWED');
    expectAppError(() => submitGuess(room, other.id, other.id, deps), 'INVALID_TARGET');

    submitGuess(room, other.id, actor, deps);
    const second = room.players.find(
      (player) => player.id !== actor && player.id !== other.id,
    )!;
    submitGuess(room, second.id, actor, deps);
    expect(room.phase).toBe('LOCK_GUESSES');
    expectAppError(() => submitGuess(room, other.id, second.id, deps), 'GUESS_ALREADY_LOCKED');
  });

  it('allows changing an answer before the lock', () => {
    const { room, deps, clock } = setupRoom(4);
    const candidates = planRoundCandidates(room, deps);
    beginRound(room, { roundId: 'rd1', candidate: candidates[0]!, content: makeContent('c1') }, deps);
    advanceTo(room, deps, clock, 'GUESSING');
    const actor = room.round!.actorPlayerId;
    const answerers = room.players.filter((player) => player.id !== actor);
    const guesser = answerers[0]!;
    const alternative = answerers[1]!;

    submitGuess(room, guesser.id, alternative.id, deps);
    expect(room.round!.answers.get(guesser.id)!.targetPlayerId).toBe(alternative.id);
    submitGuess(room, guesser.id, actor, deps);
    expect(room.round!.answers.get(guesser.id)!.targetPlayerId).toBe(actor);
    expect(room.phase).toBe('GUESSING');
  });

  it('locks when the timer runs out even without all answers', () => {
    const { room, deps, clock } = setupRoom(3);
    const candidates = planRoundCandidates(room, deps);
    beginRound(room, { roundId: 'rd1', candidate: candidates[0]!, content: makeContent('c1') }, deps);
    advanceTo(room, deps, clock, 'GUESSING');

    clock.value = room.round!.guessingEndsAt! + 1;
    const effects = tick(room, deps);
    expect(room.phase).toBe('LOCK_GUESSES');
    expect(effects.some((effect) => effect.type === 'round_resolved')).toBe(true);
    const missing = room.round!.results!.filter((entry) => entry.answeredAt === null);
    expect(missing.length).toBeGreaterThan(0);
    for (const entry of missing) expect(entry.points).toBe(0);
  });

  it('does not wait for disconnected players', () => {
    const { room, deps, clock } = setupRoom(3, engineSettings(), ['p3']);
    const candidates = planRoundCandidates(room, deps);
    const candidate = candidates.find((entry) => entry.actorPlayerId !== 'p3') ?? candidates[0]!;
    beginRound(room, { roundId: 'rd1', candidate, content: makeContent('c1') }, deps);
    advanceTo(room, deps, clock, 'GUESSING');
    const actor = room.round!.actorPlayerId;
    const connected = room.players.filter((player) => player.connected && player.id !== actor);
    for (const player of connected) {
      submitGuess(room, player.id, actor, deps);
    }
    expect(room.phase).toBe('LOCK_GUESSES');
    const disconnectedResult = room.round!.results!.find((entry) => entry.playerId === 'p3')!;
    expect(disconnectedResult.answeredAt).toBeNull();
  });

  it('skips a round immediately and marks it as skipped', () => {
    const { room, deps, clock } = setupRoom(3);
    const candidates = planRoundCandidates(room, deps);
    beginRound(room, { roundId: 'rd1', candidate: candidates[0]!, content: makeContent('c1') }, deps);
    advanceTo(room, deps, clock, 'GUESSING');
    const effects = skipRound(room, deps);
    expect(room.phase).toBe('LOCK_GUESSES');
    expect(room.round!.skipped).toBe(true);
    expect(effects.some((effect) => effect.type === 'round_closed' && effect.status === 'skipped')).toBe(
      true,
    );
    for (const result of room.round!.results!) {
      expect(result.points).toBe(0);
    }
  });

  it('pauses only between rounds', () => {
    const { room, deps, clock } = setupRoom(3);
    const candidates = planRoundCandidates(room, deps);
    beginRound(room, { roundId: 'rd1', candidate: candidates[0]!, content: makeContent('c1') }, deps);
    advanceTo(room, deps, clock, 'GUESSING');
    expectAppError(() => setPaused(room, true, deps), 'PHASE_MISMATCH');

    clock.value = room.round!.guessingEndsAt! + 1;
    tick(room, deps);
    advanceTo(room, deps, clock, 'SHOW_POINTS');
    setPaused(room, true, deps);
    expect(room.paused).toBe(true);
    expect(room.phaseEndsAt).toBeNull();

    clock.value += 60_000;
    expect(tick(room, deps)).toHaveLength(0);
    expect(room.phase).toBe('SHOW_POINTS');

    setPaused(room, false, deps);
    expect(room.phaseEndsAt).not.toBeNull();
    expect(forceNext(room, deps).some((effect) => effect.type === 'next_round')).toBe(true);
  });

  it('ends after the configured number of rounds', () => {
    const { room, deps, clock } = setupRoom(3, engineSettings({ roundCount: 2 }));
    playRound(room, deps, clock);
    clock.value += 2_000;
    expect(tick(room, deps).some((effect) => effect.type === 'next_round')).toBe(true);
    playRound(room, deps, clock);
    clock.value += 2_000;
    const effects = tick(room, deps);
    expect(room.phase).toBe('GAME_OVER');
    expect(room.status).toBe('ended');
    expect(effects.some((effect) => effect.type === 'game_closed')).toBe(true);
  });

  it('supports unlimited rounds without ever stopping by itself', () => {
    const { room, deps, clock } = setupRoom(3, engineSettings({ roundCount: 0 }));
    for (let round = 0; round < 12; round += 1) {
      playRound(room, deps, clock);
      clock.value += 2_000;
      const effects = tick(room, deps);
      expect(effects.some((effect) => effect.type === 'game_closed')).toBe(false);
      expect(effects.some((effect) => effect.type === 'next_round')).toBe(true);
    }
    expect(room.roundNumber).toBe(12);
    expect(room.status).toBe('in_game');
    endGame(room, deps, { aborted: false });
    expect(room.phase).toBe('GAME_OVER');
  });

  it('recycles content when a player has exhausted their pool', () => {
    const { room, deps } = setupRoom(2);
    const items = [makeContent('only-one')];
    const first = pickUnusedContent(room, 'p1', 'like', items, deps);
    const second = pickUnusedContent(room, 'p1', 'like', items, deps);
    expect(first!.contentId).toBe('only-one');
    expect(second!.contentId).toBe('only-one');
  });

  it('spreads the actor role fairly across rounds', () => {
    const { room, deps, clock } = setupRoom(3, engineSettings({ roundCount: 0 }));
    const first = planRoundCandidates(room, deps)[0]!;
    beginRound(room, { roundId: 'rd1', candidate: first, content: makeContent('c1') }, deps);
    advanceTo(room, deps, clock, 'GUESSING');
    const actor1 = room.round!.actorPlayerId;
    skipRound(room, deps);
    advanceTo(room, deps, clock, 'SHOW_POINTS');
    clock.value += 2_000;
    tick(room, deps);

    const candidates = planRoundCandidates(room, deps);
    expect(candidates[0]!.actorPlayerId).not.toBe(actor1);
    const counts = candidates.map((candidate) => room.actorCounts.get(candidate.actorPlayerId) ?? 0);
    expect(counts[0]).toBe(0);
  });

  it('transfers the host to the longest-connected player and skips disconnected ones', () => {
    const { room, deps } = setupRoom(3);
    room.hostPlayerId = 'p1';
    room.players[0]!.isHost = true;

    transferHost(room, undefined, deps);
    expect(room.hostPlayerId).toBe('p2');
    expect(room.players.find((player) => player.id === 'p2')!.isHost).toBe(true);
    expect(room.players.find((player) => player.id === 'p1')!.isHost).toBe(false);

    // Both the old and the current host are offline: the connected player wins.
    room.players.find((player) => player.id === 'p1')!.connected = false;
    room.players.find((player) => player.id === 'p2')!.connected = false;
    transferHost(room, undefined, deps);
    expect(room.hostPlayerId).toBe('p3');

    resetForNewGame(room, deps);
    expect(room.status).toBe('lobby');
    expect(room.phase).toBe('WAITING_FOR_PLAYERS');
    for (const score of room.scores.values()) {
      expect(score.points).toBe(0);
      expect(score.correctGuesses).toBe(0);
    }
  });

  it('removes players and ends active games cleanly', () => {
    const { room, deps, clock } = setupRoom(3);
    const candidates = planRoundCandidates(room, deps);
    beginRound(room, { roundId: 'rd1', candidate: candidates[0]!, content: makeContent('c1') }, deps);
    advanceTo(room, deps, clock, 'GUESSING');
    removePlayer(room, 'p3');
    expect(room.players).toHaveLength(2);
    const effects = endGame(room, deps, { aborted: true });
    expect(room.phase).toBe('GAME_OVER');
    expect(room.round!.revealedAt).not.toBeNull();
    expect(effects.some((effect) => effect.type === 'game_closed' && effect.status === 'aborted')).toBe(
      true,
    );
  });

  it('applies extended round counts but never below the current round', () => {
    const { room } = setupRoom(3, engineSettings({ roundCount: 3 }));
    room.roundNumber = 2;
    updateSettings(room, { roundCount: 1 }, makeEngineDeps({ value: 1 }));
    expect(room.settings.roundCount).toBe(3);
  });
});
