import type { ActionKind } from '@cluecrew/shared';
import { mulberry32 } from '../src/lib/rng.js';
import {
  UnsupportedCapabilityError,
  type ContentItem,
  type ProviderCapabilities,
  type ProviderIdentity,
  type SocialProvider,
} from '../src/providers/types.js';

/**
 * Test-only provider double.
 *
 * Production code never ships demo content — this class exists so the
 * automated suites (engine, modes, E2E multiplayer, portability) can run
 * without real TikTok credentials. It is injected through the RoomManager's
 * `providerFactory` option and never selected by application code.
 */

const TITLES = [
  'POV: you find the last slice of pizza',
  '3am cooking disaster',
  'my cat judges my outfit choices',
  'trying the viral pasta hack',
  'my dog sees snow for the first time',
  'gym bro attempts yoga',
  'rating airport snacks with no mercy',
  'the worst haircut of my life',
  'budget travel hacks that actually work',
  'ranking every pizza place in town',
  'testing 5 minute crafts so you do not have to',
  'clean with me: chaos edition',
  'reacting to my old videos',
  'first day of pottery class',
  'my houseplant murder trial',
];

const CREATORS = ['daily.doses', 'loopmaster', 'chaos.cat', 'vibecheck.etc', 'midnight.snacks'];

const PALETTES: Array<[string, string]> = [
  ['#7C5CFF', '#FF4D9D'],
  ['#33E1C7', '#2A6FFF'],
  ['#FF8A3D', '#FF3D77'],
  ['#5B8DEF', '#8F5BFF'],
];

function cover(seed: number, index: number): string {
  const [from, to] = PALETTES[seed % PALETTES.length]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="720" height="960" fill="url(#g)"/><circle cx="360" cy="470" r="100" fill="#ffffff" opacity="0.9"/><polygon points="334,426 334,514 410,470" fill="#171432"/><text x="44" y="900" font-family="Verdana,sans-serif" font-size="34" fill="#ffffff">TEST ${index}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export interface TestSocialProviderOptions {
  playerKey: string;
  playerName: string;
  avatarSeed: number;
  /** Simulate "no connection" behaviour for negative tests. */
  connected?: boolean;
}

export class TestSocialProvider implements SocialProvider {
  readonly source = 'tiktok' as const;
  readonly label = 'Test';
  private readonly options: TestSocialProviderOptions;

  constructor(options: TestSocialProviderOptions) {
    this.options = options;
  }

  isConnected(): boolean {
    return this.options.connected ?? true;
  }

  async authenticate(): Promise<ProviderIdentity> {
    return {
      providerUserId: `test:${this.options.playerKey}`,
      displayName: this.options.playerName,
      avatarUrl: null,
      scopes: ['user.info.basic', 'video.list'],
    };
  }

  async getUser(): Promise<ProviderIdentity> {
    return this.authenticate();
  }

  getCapabilities(): ProviderCapabilities {
    const reason = 'Test provider (injected in tests only).';
    if (!this.isConnected()) {
      const unavailable = { available: false, reason: 'Test provider not connected.' };
      return { like: unavailable, repost: unavailable, save: unavailable, post: unavailable };
    }
    const available = { available: true, reason };
    return { like: available, repost: available, save: available, post: available };
  }

  private build(kind: ActionKind, limit: number): ContentItem[] {
    if (!this.isConnected()) {
      throw new UnsupportedCapabilityError('Test provider not connected.');
    }
    let seed = 2166136261 ^ kind.length;
    const key = `${this.options.playerKey}::${kind}`;
    for (let index = 0; index < key.length; index += 1) {
      seed ^= key.charCodeAt(index);
      seed = Math.imul(seed, 16777619);
    }
    seed = seed >>> 0;
    const rng = mulberry32(seed);
    const count = Math.min(limit, 40);
    return Array.from({ length: count }, (_unused, index) => ({
      provider: 'tiktok' as const,
      kind,
      contentId: `test_${kind}_${seed.toString(36)}_${index}`,
      title: `${TITLES[Math.floor(rng() * TITLES.length)]!} #test`,
      coverUrl: cover((seed + index * 13) >>> 0, index + 1),
      webUrl: `https://www.tiktok.com/@test/video/${(1000000000000000000n + BigInt(index)).toString()}`,
      authorName: `@${CREATORS[Math.floor(rng() * CREATORS.length)]!}`,
      createdAt: Date.now() - index * 60_000,
    }));
  }

  async getAvailableLikedContent(limit: number): Promise<ContentItem[]> {
    return this.build('like', limit);
  }

  async getAvailableRepostedContent(limit: number): Promise<ContentItem[]> {
    return this.build('repost', limit);
  }

  async getAvailableSavedContent(limit: number): Promise<ContentItem[]> {
    return this.build('save', limit);
  }

  async getAvailablePostedContent(limit: number): Promise<ContentItem[]> {
    return this.build('post', limit);
  }

  async disconnect(): Promise<void> {
    // Nothing to revoke in tests.
  }
}
