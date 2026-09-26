import { useState } from 'react';
import { avatarStyle, AVATAR_SEEDS, initialsFor } from '../lib/avatars';

export function Avatar({
  name,
  seed,
  url,
  size = 'md',
  ring = false,
  className = '',
}: {
  name: string;
  seed: number;
  url?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  ring?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(url) && !failed;
  return (
    <span
      className={`avatar avatar-${size} ${ring ? 'avatar-ring' : ''} ${className}`}
      style={showImage ? undefined : avatarStyle(seed)}
      title={name}
    >
      {showImage ? (
        <img src={url!} alt="" onError={() => setFailed(true)} referrerPolicy="no-referrer" />
      ) : (
        initialsFor(name)
      )}
    </span>
  );
}

export function AvatarPicker({
  value,
  onChange,
  name,
}: {
  value: number;
  onChange: (seed: number) => void;
  name: string;
}) {
  return (
    <div className="avatar-picker" role="radiogroup" aria-label="Pick an avatar">
      {AVATAR_SEEDS.map((seed) => (
        <button
          key={seed}
          type="button"
          role="radio"
          aria-checked={seed === value}
          aria-label={`Avatar style ${seed + 1}`}
          className={`avatar-option ${seed === value ? 'selected' : ''}`}
          onClick={() => onChange(seed)}
        >
          <Avatar name={name || '?'} seed={seed} size="md" />
        </button>
      ))}
    </div>
  );
}
