import { AVATAR_SEED_COUNT, normalizeAvatarSeed } from '@shared';

/** Original gradient palette — generated avatars, no third-party assets. */
const GRADIENTS: Array<[string, string]> = [
  ['#7C5CFF', '#FF4D9D'],
  ['#33E1C7', '#2A6FFF'],
  ['#FF8A3D', '#FF3D77'],
  ['#5B8DEF', '#8F5BFF'],
  ['#FFC94D', '#FF6B3D'],
  ['#2DE1A6', '#0FA3B1'],
  ['#B95CFF', '#5C7CFF'],
  ['#FF5C8A', '#FFA24D'],
  ['#4DD4FF', '#4D7BFF'],
  ['#8FE14D', '#3DC98A'],
  ['#FF6BD6', '#7C5CFF'],
  ['#3DC9E1', '#5C8CFF'],
];

export const AVATAR_SEEDS: number[] = Array.from({ length: AVATAR_SEED_COUNT }, (_, index) => index);

export function gradientForSeed(seed: number): [string, string] {
  return GRADIENTS[normalizeAvatarSeed(seed)] ?? GRADIENTS[0]!;
}

export function initialsFor(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

export function avatarStyle(seed: number): { background: string } {
  const [from, to] = gradientForSeed(seed);
  return { background: `linear-gradient(135deg, ${from}, ${to})` };
}
