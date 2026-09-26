export function roundLabel(roundNumber: number, totalRounds: number): string {
  if (totalRounds === 0) {
    return `Round ${Math.max(1, roundNumber)} / \u221E`;
  }
  return `Round ${Math.max(1, Math.min(roundNumber, totalRounds))} / ${totalRounds}`;
}

export function formatSeconds(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return seconds.toString().padStart(2, '0');
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

export function pointsLabel(points: number): string {
  return `${points} ${points === 1 ? 'point' : 'points'}`;
}

/** Compact number for real API values (e.g. 4242 -> "4.2K"). Never fakes values. */
export function formatCount(value: number): string {
  try {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(
      value,
    );
  } catch {
    return String(value);
  }
}

export function formatDate(value: string | number): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function phaseHeadline(phase: string): string {
  switch (phase) {
    case 'WAITING_FOR_PLAYERS':
      return 'Waiting for everyone to join';
    case 'ROUND_START':
      return 'Get ready';
    case 'SHOW_CONTENT':
      return 'Look closely';
    case 'GUESSING':
      return 'Lock in your guess';
    case 'LOCK_GUESSES':
      return 'Answers locked';
    case 'REVEAL':
      return 'The answer is';
    case 'SHOW_POINTS':
      return 'Leaderboard';
    case 'GAME_OVER':
      return 'Final results';
    default:
      return '';
  }
}

export function modeAccentColor(accent: string): string {
  switch (accent) {
    case 'pink':
      return 'var(--pink)';
    case 'mint':
      return 'var(--mint)';
    case 'amber':
      return 'var(--amber)';
    default:
      return 'var(--primary)';
  }
}

export function modeAccentGradient(accent: string): string {
  switch (accent) {
    case 'pink':
      return 'var(--grad-primary)';
    case 'mint':
      return 'var(--grad-mint)';
    case 'amber':
      return 'var(--grad-amber)';
    default:
      return 'var(--grad-violet)';
  }
}
