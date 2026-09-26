import type { ActionKind } from '@cluecrew/shared';
import { mulberry32 } from '../../lib/rng.js';

const MOCK_TITLES = [
  'POV: you find the last slice of pizza',
  '3am cooking disaster',
  'my cat judges my outfit choices',
  'trying the viral pasta hack',
  'my dog sees snow for the first time',
  'gym bro attempts yoga',
  'rating airport snacks with zero mercy',
  'painting my room in one day',
  'the worst haircut of my life',
  'budget travel hacks that actually work',
  'learning to skate at 25',
  'ranking every pizza place in town',
  'ferret steals my keys again',
  '30 day drawing challenge: day 1 vs 30',
  'making coffee like a pretentious barista',
  'my plant collection is out of control',
  'testing 5 minute crafts so you do not have to',
  'the truth about working from home',
  'thrift store makeover challenge',
  'cooking for my very picky roommate',
  'when the wifi dies mid boss fight',
  'sunrise hike gone slightly wrong',
  'trying to teach my parrot a new word',
  'clean with me: chaos edition',
  'my morning routine as an actual human',
  'reacting to my old videos from 2019',
  'building a desk out of a door',
  'every sibling ever, a documentary',
  'meal prep but I only have three ingredients',
  'the cat distribution system chose me',
  'first day of pottery class',
  'speedrunning my chores before guests arrive',
  'reading my old diary entries out loud',
  'my dog has a favourite song',
  'one pan dinners that saved my week',
  'garage sale flip turned into a saga',
  'trying the spiciest noodles in the shop',
  'the great sock drawer purge',
  'learning guitar with zero talent',
  'rainy day comfort food mission',
  'I let my little sister pick my outfit',
  'weekend road trip on a tiny budget',
  'my houseplant murder trial',
  'slow morning with the loudest cat alive',
];

const MOCK_CREATORS = [
  'daily.doses',
  'loopmaster',
  'chaos.cat',
  'vibecheck.etc',
  'midnight.snacks',
  'tiny.kitchen',
  'plantparent.pete',
  'soft.aesthetics',
  'the.real.deal',
  'nofilterneeded',
  'cloudy.days',
  'pixel.pioneer',
  'second.breakfast',
  'wanderfoot',
  'quiet.corner',
  'main.character.energy',
  'notyourguru',
  'goldenhour.gal',
  'crafty.by.accident',
  'snack.reviewer',
  'deep.dive.diaries',
  'late.night.thoughts',
  'sunnysideup.exe',
  'cozy.chaos',
];

const MOCK_HASHTAGS = [
  'fyp',
  'pov',
  'comedy',
  'foodtok',
  'diy',
  'gaming',
  'cats',
  'dance',
  'travel',
  'study',
  'fitness',
  'art',
  'music',
  'memes',
  'sports',
  'tech',
  'fashion',
  'nature',
  'cars',
  'books',
  'anime',
  'coffee',
  'dogs',
  'hair',
];

const COVER_PALETTES: Array<[string, string]> = [
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

const KIND_LABEL: Record<ActionKind, string> = {
  like: 'LIKE',
  repost: 'REPOST',
  save: 'SAVE',
  post: 'POST',
};

/** Generates a self-contained SVG cover (original artwork, no external assets). */
export function buildMockCover(seed: number, kind: ActionKind, index: number): string {
  const palette = COVER_PALETTES[seed % COVER_PALETTES.length]!;
  const [from, to] = palette;
  const c1x = 90 + (seed % 460);
  const c1y = 120 + (seed % 260);
  const c2x = 140 + ((seed >> 3) % 420);
  const c2y = 540 + ((seed >> 5) % 320);
  const r1 = 140 + ((seed >> 2) % 140);
  const r2 = 180 + ((seed >> 4) % 160);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
<rect width="720" height="960" fill="url(#g)"/>
<circle cx="${c1x}" cy="${c1y}" r="${r1}" fill="#ffffff" opacity="0.14"/>
<circle cx="${c2x}" cy="${c2y}" r="${r2}" fill="#0b0a14" opacity="0.16"/>
<circle cx="360" cy="470" r="104" fill="#ffffff" opacity="0.92"/>
<polygon points="332,424 332,516 412,470" fill="#171432"/>
<text x="44" y="96" font-family="Verdana,DejaVu Sans,sans-serif" font-size="30" font-weight="bold" fill="#ffffff" opacity="0.9">DEMO - ${KIND_LABEL[kind]}</text>
<text x="44" y="896" font-family="Verdana,DejaVu Sans,sans-serif" font-size="34" font-weight="bold" fill="#ffffff" opacity="0.92">CLIP ${index}</text>
<text x="44" y="936" font-family="Verdana,DejaVu Sans,sans-serif" font-size="24" fill="#ffffff" opacity="0.75">generated demo data</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export interface GeneratedMockItem {
  contentId: string;
  title: string;
  coverUrl: string;
  authorName: string;
  createdAt: number;
}

/**
 * Deterministic demo content: the same player always gets the same pool, so a
 * replayed game is consistent and tests are stable.
 */
export function generateMockItems(
  playerKey: string,
  kind: ActionKind,
  count: number,
  now: number,
): GeneratedMockItem[] {
  let seed = 2166136261 ^ kind.length;
  const key = `${playerKey}::${kind}`;
  for (let i = 0; i < key.length; i += 1) {
    seed ^= key.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  seed = seed >>> 0;
  const rng = mulberry32(seed);
  const items: GeneratedMockItem[] = [];
  const dayMs = 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i += 1) {
    const title = MOCK_TITLES[Math.floor(rng() * MOCK_TITLES.length)]!;
    const creator = MOCK_CREATORS[Math.floor(rng() * MOCK_CREATORS.length)]!;
    const tagA = MOCK_HASHTAGS[Math.floor(rng() * MOCK_HASHTAGS.length)]!;
    let tagB = MOCK_HASHTAGS[Math.floor(rng() * MOCK_HASHTAGS.length)]!;
    if (tagB === tagA) tagB = MOCK_HASHTAGS[(MOCK_HASHTAGS.indexOf(tagA) + 7) % MOCK_HASHTAGS.length]!;
    const ageDays = Math.floor(rng() * 120);
    items.push({
      contentId: `mock_${kind}_${seed.toString(36)}_${i}`,
      title: `${title} #${tagA} #${tagB}`,
      coverUrl: buildMockCover((seed + i * 13) >>> 0, kind, i + 1),
      authorName: `@${creator}`,
      createdAt: now - ageDays * dayMs - i * 61_000,
    });
  }
  return items;
}
