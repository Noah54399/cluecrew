import {
  MODES,
  sanitizeGameSettings,
  SCORING_RULES,
  type GameSettings,
  type ModeId,
} from '@cluecrew/shared';
import { AppError } from '../lib/errors.js';
import { pickOne, shuffle } from '../lib/rng.js';
import type { ContentItem } from '../providers/types.js';
import { computeRoundResults } from './scoring.js';
import {
  createEngineRoom,
  ensureScore,
  getPlayer,
  type EngineDeps,
  type EngineEffect,
  type EnginePlayer,
  type EngineRoom,
  type EngineRound,
  type RoundCandidate,
} from './types.js';

export { createEngineRoom, getPlayer, ensureScore };
export type { EngineDeps, EngineEffect, EnginePlayer, EngineRoom, EngineRound, RoundCandidate };

export function touch(room: EngineRoom, now: number): void {
  room.updatedAt = now;
  room.lastActivityAt = now;
}

export function activeRules(room: EngineRoom) {
  return SCORING_RULES[room.settings.scoringMode];
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export function addPlayer(room: EngineRoom, player: EnginePlayer): void {
  room.players.push(player);
  ensureScore(room, player.id);
  room.actorCounts.set(player.id, room.actorCounts.get(player.id) ?? 0);
}

export function removePlayer(room: EngineRoom, playerId: string): boolean {
  const index = room.players.findIndex((player) => player.id === playerId);
  if (index === -1) return false;
  room.players.splice(index, 1);
  if (room.hostPlayerId === playerId) {
    room.hostPlayerId = null;
  }
  if (room.round && room.round.actorPlayerId === playerId && !room.round.lockedAt) {
    // The actor vanished mid-round: resolve it immediately, skip if nothing happened.
    room.round.skipped = true;
  }
  return true;
}

export function setPlayerConnected(room: EngineRoom, playerId: string, connected: boolean): void {
  const player = getPlayer(room, playerId);
  if (!player) return;
  player.connected = connected;
}

export function updateSettings(room: EngineRoom, patch: Partial<GameSettings>, deps: EngineDeps): void {
  const merged = sanitizeGameSettings(patch, room.settings);
  if (room.status === 'in_game') {
    // Round count may only grow during a game; the game ends when the round limit is hit.
    if (merged.roundCount !== 0 && room.roundNumber > 0) {
      const unlimited = room.settings.roundCount === 0;
      merged.roundCount =
        unlimited || merged.roundCount < room.roundNumber ? room.roundNumber + 1 : merged.roundCount;
    }
    room.eligibleModes = merged.enabledModes.filter((mode) => (room.suppliersByMode[mode] ?? []).length > 0);
  }
  room.settings = merged;
  touch(room, deps.now());
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

export function prepareGame(
  room: EngineRoom,
  params: { gameId: string; eligibleModes: ModeId[]; suppliersByMode: Record<ModeId, string[]> },
  deps: EngineDeps,
): void {
  room.status = 'in_game';
  room.phase = 'WAITING_FOR_PLAYERS';
  room.phaseEndsAt = null;
  room.paused = false;
  room.gameNumber += 1;
  room.gameId = params.gameId;
  room.roundNumber = 0;
  room.roundId = null;
  room.round = null;
  room.eligibleModes = params.eligibleModes;
  room.suppliersByMode = params.suppliersByMode;
  room.scores = new Map();
  room.actorCounts = new Map();
  room.usedContent = new Map();
  room.lastRoundActorId = null;
  for (const player of room.players) {
    room.scores.set(player.id, { points: 0, correctGuesses: 0, timesActor: 0, roundPoints: 0 });
    room.actorCounts.set(player.id, 0);
  }
  touch(room, deps.now());
}

export function planRoundCandidates(room: EngineRoom, deps: EngineDeps): RoundCandidate[] {
  const modes = room.eligibleModes.filter((mode) => (room.suppliersByMode[mode] ?? []).length > 0);
  if (modes.length === 0) return [];

  let orderedModes: ModeId[];
  if (room.settings.randomMix && modes.length > 1) {
    orderedModes = shuffle(modes, deps.rng);
  } else {
    const start = room.roundNumber % modes.length;
    orderedModes = [...modes.slice(start), ...modes.slice(0, start)];
  }

  const candidates: RoundCandidate[] = [];
  for (const mode of orderedModes) {
    const suppliers = room.suppliersByMode[mode] ?? [];
    if (suppliers.length === 0) continue;
    const pool =
      room.lastRoundActorId && suppliers.length > 1
        ? suppliers.filter((id) => id !== room.lastRoundActorId)
        : suppliers;
    const shuffled = shuffle(pool, deps.rng);
    // Stable sort keeps the random order for equal counts (fairness across rounds).
    shuffled.sort(
      (a, b) => (room.actorCounts.get(a) ?? 0) - (room.actorCounts.get(b) ?? 0),
    );
    for (const actorPlayerId of shuffled) {
      candidates.push({ mode, actorPlayerId });
    }
  }
  return candidates;
}

export function pickUnusedContent(
  room: EngineRoom,
  playerId: string,
  kind: ContentItem['kind'],
  items: ContentItem[],
  deps: EngineDeps,
): ContentItem | null {
  if (items.length === 0) return null;
  const key = `${playerId}:${kind}`;
  let used = room.usedContent.get(key);
  if (!used) {
    used = new Set();
    room.usedContent.set(key, used);
  }
  let fresh = items.filter((item) => !used.has(item.contentId));
  if (fresh.length === 0) {
    // Pool exhausted: recycle so unlimited play is always possible.
    used.clear();
    fresh = items;
  }
  const picked = pickOne(fresh, deps.rng) ?? null;
  if (picked) used.add(picked.contentId);
  return picked;
}

export function beginRound(
  room: EngineRoom,
  params: { roundId: string; candidate: RoundCandidate; content: ContentItem },
  deps: EngineDeps,
): EngineEffect[] {
  const now = deps.now();
  room.roundNumber += 1;
  room.roundId = params.roundId;
  room.round = {
    id: params.roundId,
    roundNumber: room.roundNumber,
    mode: params.candidate.mode,
    content: params.content,
    actorPlayerId: params.candidate.actorPlayerId,
    answerablePlayerIds: room.players
      .filter((player) => player.id !== params.candidate.actorPlayerId)
      .map((player) => player.id),
    startedAt: now,
    guessingStartedAt: null,
    guessingEndsAt: null,
    answers: new Map(),
    lockedAt: null,
    revealedAt: null,
    results: null,
    actorBonus: null,
    skipped: false,
  };
  room.actorCounts.set(
    params.candidate.actorPlayerId,
    (room.actorCounts.get(params.candidate.actorPlayerId) ?? 0) + 1,
  );
  room.lastRoundActorId = params.candidate.actorPlayerId;
  for (const score of room.scores.values()) score.roundPoints = 0;
  room.phase = 'ROUND_START';
  room.phaseEndsAt = now + deps.timings.introMs;
  touch(room, now);

  return [
    { type: 'phase', phase: 'ROUND_START' },
    {
      type: 'flash',
      flash: { type: 'round_started', roundNumber: room.roundNumber, mode: params.candidate.mode },
    },
    { type: 'persist_room' },
  ];
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

function allAnswerableAnswered(room: EngineRoom): boolean {
  const round = room.round;
  if (!round) return true;
  const connectedAnswerable = room.players.filter(
    (player) => player.connected && player.id !== round.actorPlayerId,
  );
  if (connectedAnswerable.length === 0) return true;
  return connectedAnswerable.every((player) => round.answers.has(player.id));
}

function lockRound(room: EngineRoom, deps: EngineDeps): EngineEffect[] {
  const round = room.round;
  if (!round || round.lockedAt !== null) return [];
  const now = deps.now();
  round.lockedAt = now;

  const rules = activeRules(room);
  const computed = computeRoundResults({
    answers: round.answers,
    answerablePlayerIds: round.answerablePlayerIds,
    actorPlayerId: round.actorPlayerId,
    guessingStartedAt: round.guessingStartedAt ?? now,
    guessingEndsAt: round.guessingEndsAt ?? now,
    rules,
  });
  round.results = computed.results;
  round.actorBonus = computed.actorBonus;

  for (const result of computed.results) {
    const score = ensureScore(room, result.playerId);
    const total = result.points + result.bonus;
    score.points += total;
    score.roundPoints += total;
    if (result.correct) score.correctGuesses += 1;
  }
  if (computed.actorBonus > 0) {
    const actorScore = ensureScore(room, round.actorPlayerId);
    actorScore.points += computed.actorBonus;
    actorScore.roundPoints += computed.actorBonus;
  }

  room.phase = 'LOCK_GUESSES';
  room.phaseEndsAt = now + deps.timings.lockMs;
  touch(room, now);

  return [
    { type: 'phase', phase: 'LOCK_GUESSES' },
    { type: 'flash', flash: { type: 'guesses_locked', roundNumber: round.roundNumber } },
    {
      type: 'round_resolved',
      gameId: room.gameId ?? '',
      roundId: round.id,
      actorPlayerId: round.actorPlayerId,
      results: computed.results,
      actorBonus: computed.actorBonus,
    },
    { type: 'round_closed', roundId: round.id, status: round.skipped ? 'skipped' : 'revealed' },
    { type: 'persist_room' },
  ];
}

function advanceFromPoints(room: EngineRoom, deps: EngineDeps): EngineEffect[] {
  const done =
    room.settings.roundCount > 0 && room.roundNumber >= room.settings.roundCount;
  if (done) return endGame(room, deps, { aborted: false });
  return [{ type: 'next_round' }];
}

export function tick(room: EngineRoom, deps: EngineDeps): EngineEffect[] {
  if (room.status !== 'in_game' || !room.round) return [];
  if (room.paused || room.phaseEndsAt === null) return [];
  const now = deps.now();
  if (now < room.phaseEndsAt) return [];

  switch (room.phase) {
    case 'ROUND_START':
      room.phase = 'SHOW_CONTENT';
      room.phaseEndsAt = now + deps.timings.contentMs;
      touch(room, now);
      return [{ type: 'phase', phase: room.phase }, { type: 'persist_room' }];

    case 'SHOW_CONTENT': {
      room.phase = 'GUESSING';
      room.round.guessingStartedAt = now;
      room.round.guessingEndsAt = now + room.settings.secondsPerRound * 1000;
      room.phaseEndsAt = room.round.guessingEndsAt;
      touch(room, now);
      return [{ type: 'phase', phase: room.phase }, { type: 'persist_room' }];
    }

    case 'GUESSING':
      return lockRound(room, deps);

    case 'LOCK_GUESSES':
      room.phase = 'REVEAL';
      room.round.revealedAt = now;
      room.phaseEndsAt = now + deps.timings.revealMs;
      touch(room, now);
      return [
        { type: 'phase', phase: room.phase },
        {
          type: 'flash',
          flash: {
            type: 'reveal',
            roundNumber: room.round.roundNumber,
            actorPlayerId: room.round.actorPlayerId,
          },
        },
        { type: 'persist_room' },
      ];

    case 'REVEAL':
      room.phase = 'SHOW_POINTS';
      room.phaseEndsAt = now + deps.timings.pointsMs;
      touch(room, now);
      return [
        { type: 'phase', phase: room.phase },
        {
          type: 'flash',
          flash: { type: 'scores_updated', roundNumber: room.round.roundNumber },
        },
        { type: 'persist_room' },
      ];

    case 'SHOW_POINTS':
      return advanceFromPoints(room, deps);

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Player actions (throw AppError with a user friendly message on invalid input)
// ---------------------------------------------------------------------------

export function submitGuess(
  room: EngineRoom,
  playerId: string,
  targetPlayerId: string,
  deps: EngineDeps,
): EngineEffect[] {
  const round = room.round;
  if (room.status !== 'in_game' || !round) {
    throw new AppError('PHASE_MISMATCH', { message: 'The round is not running right now.' });
  }
  if (round.lockedAt !== null) {
    throw new AppError('GUESS_ALREADY_LOCKED', {
      message: 'Your answer is locked in \u2014 no take-backs!',
    });
  }
  if (room.phase !== 'GUESSING') {
    throw new AppError('PHASE_MISMATCH', {
      message: room.phase === 'SHOW_CONTENT' ? 'Get ready \u2014 guessing starts in a moment.' : 'Guessing is not open right now.',
    });
  }
  const player = getPlayer(room, playerId);
  if (!player) throw new AppError('PLAYER_NOT_FOUND', { status: 404 });
  if (playerId === round.actorPlayerId) {
    throw new AppError('GUESS_NOT_ALLOWED', {
      message: 'This round is yours \u2014 enjoy watching everyone guess!',
    });
  }
  if (targetPlayerId === playerId) {
    throw new AppError('INVALID_TARGET', { message: 'You cannot guess yourself.' });
  }
  const target = getPlayer(room, targetPlayerId);
  if (!target) throw new AppError('INVALID_TARGET');

  const now = deps.now();
  if (round.guessingEndsAt !== null && now >= round.guessingEndsAt) {
    return lockRound(room, deps);
  }

  const isFirstAnswer = !round.answers.has(playerId);
  round.answers.set(playerId, { targetPlayerId, at: now });
  touch(room, now);

  const effects: EngineEffect[] = [];
  if (isFirstAnswer) {
    effects.push({ type: 'flash', flash: { type: 'player_answered', playerId } });
  }
  if (allAnswerableAnswered(room)) {
    effects.push(...lockRound(room, deps));
  }
  return effects;
}

export function skipRound(room: EngineRoom, deps: EngineDeps): EngineEffect[] {
  if (room.status !== 'in_game' || !room.round) {
    throw new AppError('PHASE_MISMATCH', { message: 'There is no round to skip.' });
  }
  if (room.phase === 'SHOW_POINTS') {
    return forceNext(room, deps);
  }
  if (room.phase === 'REVEAL') {
    room.phase = 'SHOW_POINTS';
    room.phaseEndsAt = deps.now() + deps.timings.pointsMs;
    return [
      { type: 'phase', phase: 'SHOW_POINTS' },
      { type: 'flash', flash: { type: 'scores_updated', roundNumber: room.round.roundNumber } },
      { type: 'persist_room' },
    ];
  }
  room.round.skipped = true;
  return lockRound(room, deps);
}

export function forceNext(room: EngineRoom, deps: EngineDeps): EngineEffect[] {
  if (room.status !== 'in_game') {
    throw new AppError('PHASE_MISMATCH', { message: 'No game is running.' });
  }
  if (room.phase !== 'SHOW_POINTS') {
    throw new AppError('PHASE_MISMATCH', { message: 'The next round has not reached the scoreboard yet.' });
  }
  room.paused = false;
  return advanceFromPoints(room, deps);
}

export function setPaused(room: EngineRoom, paused: boolean, deps: EngineDeps): EngineEffect[] {
  if (room.status !== 'in_game') {
    throw new AppError('PHASE_MISMATCH', { message: 'No game is running.' });
  }
  if (room.phase !== 'SHOW_POINTS') {
    throw new AppError('PHASE_MISMATCH', {
      message: 'Pausing is only possible between rounds.',
    });
  }
  const now = deps.now();
  room.paused = paused;
  room.phaseEndsAt = paused ? null : now + deps.timings.pointsMs;
  touch(room, now);
  return [
    { type: 'flash', flash: { type: 'paused', paused } },
    {
      type: 'toast',
      kind: 'info',
      message: paused ? 'Game paused between rounds.' : 'Game resumed.',
    },
    { type: 'persist_room' },
  ];
}

export function endGame(
  room: EngineRoom,
  deps: EngineDeps,
  options: { aborted?: boolean } = {},
): EngineEffect[] {
  const effects: EngineEffect[] = [];
  const now = deps.now();

  if (room.status === 'in_game' && room.round && room.round.lockedAt === null) {
    room.round.skipped = true;
    effects.push(...lockRound(room, deps));
  }
  if (room.round && room.round.revealedAt === null) {
    room.round.revealedAt = now;
  }

  const gameId = room.gameId;
  room.status = 'ended';
  room.phase = 'GAME_OVER';
  room.phaseEndsAt = null;
  room.paused = false;
  touch(room, now);

  if (gameId) {
    effects.push({
      type: 'game_closed',
      gameId,
      status: options.aborted ? 'aborted' : 'finished',
    });
  }
  effects.push(
    { type: 'phase', phase: 'GAME_OVER' },
    { type: 'flash', flash: { type: 'game_over', gameNumber: room.gameNumber } },
    { type: 'persist_room' },
  );
  return effects;
}

export function resetForNewGame(room: EngineRoom, deps: EngineDeps): EngineEffect[] {
  const now = deps.now();
  room.status = 'lobby';
  room.phase = 'WAITING_FOR_PLAYERS';
  room.phaseEndsAt = null;
  room.paused = false;
  room.gameId = null;
  room.roundNumber = 0;
  room.roundId = null;
  room.round = null;
  room.scores = new Map();
  room.actorCounts = new Map();
  room.usedContent = new Map();
  room.lastRoundActorId = null;
  for (const player of room.players) {
    room.scores.set(player.id, { points: 0, correctGuesses: 0, timesActor: 0, roundPoints: 0 });
    room.actorCounts.set(player.id, 0);
  }
  touch(room, now);
  return [{ type: 'phase', phase: 'WAITING_FOR_PLAYERS' }, { type: 'persist_room' }];
}

export function transferHost(
  room: EngineRoom,
  toPlayerId: string | undefined,
  deps: EngineDeps,
): EngineEffect[] {
  const candidates = room.players.filter((player) => player.id !== room.hostPlayerId);
  if (candidates.length === 0) {
    return [];
  }
  let next: EnginePlayer | undefined;
  if (toPlayerId) {
    next = candidates.find((player) => player.id === toPlayerId);
  }
  if (!next) {
    const connected = candidates.filter((player) => player.connected);
    const pool = connected.length > 0 ? connected : candidates;
    next = [...pool].sort((a, b) => a.joinedAt - b.joinedAt)[0];
  }
  if (!next) return [];
  if (room.hostPlayerId === next.id) return [];

  room.hostPlayerId = next.id;
  for (const player of room.players) {
    player.isHost = player.id === next.id;
  }
  touch(room, deps.now());
  return [
    { type: 'flash', flash: { type: 'host_changed', playerId: next.id, name: next.name } },
    {
      type: 'toast',
      kind: 'info',
      message: `${next.name} is now the host.`,
    },
    { type: 'persist_room' },
  ];
}

export function modeQuestion(mode: ModeId): string {
  return MODES[mode].question;
}
