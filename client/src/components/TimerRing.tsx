import { useTicker } from '../lib/useRoom';

/** SVG countdown ring driven by a server-authoritative deadline. */
export function TimerRing({
  endsAtServer,
  serverOffset,
  totalMs,
  active = true,
}: {
  endsAtServer: number | null;
  serverOffset: number;
  totalMs: number;
  active?: boolean;
}) {
  const ticking = active && endsAtServer !== null;
  const now = useTicker(ticking, 200);

  if (endsAtServer === null) return null;

  const remainingMs = Math.max(0, endsAtServer - (now + serverOffset));
  const seconds = Math.ceil(remainingMs / 1000);
  const fraction = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - fraction);
  const danger = remainingMs > 0 && seconds <= 5;

  return (
    <div className={`timer-ring ${danger ? 'danger' : ''}`} role="timer" aria-label="Time remaining">
      <svg viewBox="0 0 74 74">
        <circle className="track" cx="37" cy="37" r={radius} fill="none" strokeWidth="6" />
        <circle
          className="value"
          cx="37"
          cy="37"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
        />
      </svg>
      <span className="timer-ring-label">{seconds}</span>
    </div>
  );
}
