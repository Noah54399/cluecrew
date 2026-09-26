import { describe, expect, it } from 'vitest';
import { SCORING_RULES } from '@cluecrew/shared';
import { computeRoundResults } from '../src/game/scoring.js';
import type { EngineAnswer } from '../src/game/types.js';

const rules = SCORING_RULES.classic;
const casual = SCORING_RULES.casual;

function answers(entries: Array<[string, string, number]>): Map<string, EngineAnswer> {
  return new Map(entries.map(([playerId, targetPlayerId, at]) => [playerId, { targetPlayerId, at }]));
}

describe('scoring', () => {
  it('awards the base score for a correct guess and zero for a wrong one', () => {
    const result = computeRoundResults({
      answers: answers([
        ['p1', 'actor', 1_000],
        ['p2', 'p1', 2_000],
      ]),
      answerablePlayerIds: ['p1', 'p2'],
      actorPlayerId: 'actor',
      guessingStartedAt: 0,
      guessingEndsAt: 10_000,
      rules,
    });

    expect(result.results).toHaveLength(2);
    const correct = result.results.find((entry) => entry.playerId === 'p1')!;
    const wrong = result.results.find((entry) => entry.playerId === 'p2')!;
    expect(correct.correct).toBe(true);
    expect(correct.points).toBe(100);
    expect(wrong.correct).toBe(false);
    expect(wrong.points).toBe(0);
    expect(result.correctCount).toBe(1);
    expect(result.actorBonus).toBe(50);
  });

  it('scales the speed bonus with remaining time in classic mode', () => {
    const fast = computeRoundResults({
      answers: answers([['p1', 'actor', 1_000]]),
      answerablePlayerIds: ['p1'],
      actorPlayerId: 'actor',
      guessingStartedAt: 0,
      guessingEndsAt: 10_000,
      rules,
    });
    const slow = computeRoundResults({
      answers: answers([['p1', 'actor', 9_000]]),
      answerablePlayerIds: ['p1'],
      actorPlayerId: 'actor',
      guessingStartedAt: 0,
      guessingEndsAt: 10_000,
      rules,
    });

    expect(fast.results[0]!.bonus).toBe(45);
    expect(slow.results[0]!.bonus).toBe(5);
    expect(fast.results[0]!.points + fast.results[0]!.bonus).toBeGreaterThan(
      slow.results[0]!.points + slow.results[0]!.bonus,
    );
  });

  it('never applies a speed bonus in casual mode', () => {
    const result = computeRoundResults({
      answers: answers([['p1', 'actor', 1]]),
      answerablePlayerIds: ['p1'],
      actorPlayerId: 'actor',
      guessingStartedAt: 0,
      guessingEndsAt: 10_000,
      rules: casual,
    });
    expect(result.results[0]!.bonus).toBe(0);
    expect(result.results[0]!.points).toBe(100);
    expect(casual.speedBonusMax).toBe(0);
  });

  it('records players who did not answer without punishing them', () => {
    const result = computeRoundResults({
      answers: answers([['p1', 'actor', 500]]),
      answerablePlayerIds: ['p1', 'p2'],
      actorPlayerId: 'actor',
      guessingStartedAt: 0,
      guessingEndsAt: 1_000,
      rules,
    });
    const missing = result.results.find((entry) => entry.playerId === 'p2')!;
    expect(missing.guessedPlayerId).toBeNull();
    expect(missing.answeredAt).toBeNull();
    expect(missing.points).toBe(0);
    expect(missing.bonus).toBe(0);
  });

  it('pays the actor per correct guesser', () => {
    const result = computeRoundResults({
      answers: answers([
        ['p1', 'actor', 1_000],
        ['p2', 'actor', 1_100],
        ['p3', 'p1', 1_200],
      ]),
      answerablePlayerIds: ['p1', 'p2', 'p3'],
      actorPlayerId: 'actor',
      guessingStartedAt: 0,
      guessingEndsAt: 10_000,
      rules: casual,
    });
    expect(result.correctCount).toBe(2);
    expect(result.actorBonus).toBe(casual.actorBonusPerCorrectGuess * 2);
  });

  it('clamps bonuses when an answer arrives after the deadline', () => {
    const result = computeRoundResults({
      answers: answers([['p1', 'actor', 20_000]]),
      answerablePlayerIds: ['p1'],
      actorPlayerId: 'actor',
      guessingStartedAt: 0,
      guessingEndsAt: 10_000,
      rules,
    });
    expect(result.results[0]!.bonus).toBe(0);
    expect(result.results[0]!.points).toBe(100);
  });
});
