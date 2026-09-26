import { Link } from 'react-router-dom';
import { BRAND } from '@shared';

export function LogoMark({ size = 38 }: { size?: number }) {
  return (
    <span
      className="brand-mark"
      style={{ width: size, height: size, fontSize: size * 0.5, borderRadius: size * 0.32 }}
      aria-hidden
    >
      ?
    </span>
  );
}

export function Logo({ size = 38 }: { size?: number }) {
  return (
    <Link to="/" className="brand" aria-label={`${BRAND.name} home`}>
      <LogoMark size={size} />
      <span>{BRAND.name}</span>
    </Link>
  );
}
