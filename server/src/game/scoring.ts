import { SCORING_RULES, type GuessResult, type ScoringRules } from '@cluecrew/shared';
import type { EngineAnswer } from './types.js';

export interface ComputeResultsParams {
  answers: Map<string, EngineAnswer>;
  answerablePlayerIds: string[];
  actorPlayerId: string;
  guessingStartedAt: number;
  guessingEndsAt: number;
  rules: ScoringRules;
}

export interface ComputeResultsOutput {
  results: GuessResult[];
  actorBonus: number;
  correctCount: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Scores a finished round.
 *
 * - Correct answers award a flat base score.
 * - The speed bonus only exists when the selected scoring mode defines one
 *   (classic). In casual mode nobody is ever penalised for answering slower.
 * - The player in the spotlight earns a bonus per player who recognised them.
 */
export function computeRoundResults(params: ComputeResultsParams): ComputeResultsOutput {
  const { answers, answerablePlayerIds, actorPlayerId, rules } = params;
  const windowMs = params.guessingEndsAt - params.guessingStartedAt;
  const results: GuessResult[] = [];
  let correctCount = 0;

  for (const playerId of answerablePlayerIds) {
    const answer = answers.get(playerId);
    if (!answer) {
      results.push({
        playerId,
        guessedPlayerId: null,
        correct: false,
        points: 0,
        bonus: 0,
        answeredAt: null,
      });
      continue;
    }
    const correct = answer.targetPlayerId === actorPlayerId;
    let points = 0;
    let bonus = 0;
    if (correct) {
      correctCount += 1;
      points = rules.correctPoints;
      if (rules.speedBonusMax > 0 && windowMs > 0) {
        const remainingFraction = clamp01((params.guessingEndsAt - answer.at) / windowMs);
        bonus = Math.round(rules.speedBonusMax * remainingFraction);
      }
    } else {
      points = rules.wrongPoints;
    }
    results.push({
      playerId,
      guessedPlayerId: answer.targetPlayerId,
      correct,
      points,
      bonus,
      answeredAt: answer.at,
    });
  }

  return {
    results,
    actorBonus: correctCount * rules.actorBonusPerCorrectGuess,
    correctCount,
  };
}

export function scoringRulesFor(scoringMode: keyof typeof SCORING_RULES): ScoringRules {
  return SCORING_RULES[scoringMode];
}
