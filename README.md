# ClueCrew — Guess who did it.

A real-time, multiplayer party game: everyone joins from their own phone, one player's
social-media activity is shown anonymously, and the group guesses **who** it belongs to.

Built from scratch — original branding, UI, code and assets. No proprietary code, no copied
graphics, no scraping of any platform. Works on mobile and desktop. **Unlimited rounds, free
forever — no round caps, no daily limits, no subscriptions, no upgrade prompts.**

```
Create a room → share the 6-letter code → friends join instantly → play
```

---

## Table of contents

- [Feature overview](#feature-overview)
- [Quick start](#quick-start)
- [How to play](#how-to-play)
- [Game modes and the TikTok API reality](#game-modes-and-the-tiktok-api-reality)
- [Demo data (development mode)](#demo-data-development-mode)
- [Project structure](#project-structure)
- [Scripts](#scripts)
- [Testing](#testing)
- [Configuration](#configuration)
- [TikTok developer setup](#tiktok-developer-setup)
- [Deployment](#deployment)
- [Database](#database)
- [Security and privacy](#security-and-privacy)
- [Error handling](#error-handling)
- [Extending the game](#extending-the-game)
- [Honest limitations](#honest-limitations)

---

## Feature overview

- **Working multiplayer rooms** — real WebSocket sync via Socket.IO; every player sees the
  same lobby, round, timer, reveal and leaderboard at the same time.
- **Exact round state machine** — `WAITING_FOR_PLAYERS → ROUND_START → SHOW_CONTENT →
  GUESSING → LOCK_GUESSES → REVEAL → SHOW_POINTS → NEXT_ROUND …`
- **Configurable scoring** — Classic (+100 correct, up to +50 speed bonus, actor earns +50 per
  correct guesser) or Casual (flat +100, no speed bonus, nobody is punished for answering later).
- **Unlimited rounds** — round count 1–100 or *unlimited*; the host can also add rounds mid-game.
- **Modular game modes** — Who Liked / Who Reposted / Who Saved / Who Posted This, plus Random Mix.
- **Provider abstraction** — the engine never talks to TikTok directly:
  `GameEngine → SocialProvider → TikTokProvider | TikTokDataPortabilityProvider | DisconnectedSocialProvider`.
- **Official TikTok OAuth** — Login Kit v2 with CSRF state, encrypted token storage, refresh and
  revoke. Real data is used where the official API permits it, and only there.
- **Real activity import (Data Portability)** — players can import their liked and favourite
  videos from TikTok's official Data Portability export (requires app approval + EEA/UK account;
  the UI walks through the honest async states pending → waiting → importing → ready). See
  [`docs/TIKTOK-DATA-PORTABILITY.md`](docs/TIKTOK-DATA-PORTABILITY.md).
- **No demo data, ever** — production code ships no mock content. Without a connected TikTok
  account players get a clear empty state ("Connect your TikTok account to see your real data.");
  modes that no connected permission can fill report as unavailable with the exact TikTok scope
  they would need. Nothing is invented, nothing is scraped.
- **Robust reconnects** — disconnect during a round and rejoin with your answer intact; if the
  host disappears, host rights transfer automatically; rooms survive in the database.
- **Polished responsive UI** — dark/light theme, large touch targets, animations, countdown
  ring, animated reveal, confetti finale, sound effects generated with WebAudio (no assets).
- **Security first** — HTTP-only session cookies, CSRF protection, AES-256-GCM encrypted
  tokens, rate limiting, room-access validation, signed media proxy, CSP in production,
  privacy-first import handling (raw exports never stored, deleted immediately after parsing).

---

## Quick start

Requirements: **Node.js ≥ 22.13** (uses the built-in `node:sqlite`; the optional
`better-sqlite3` package is used automatically on older runtimes).

```bash
npm install        # installs all workspaces
cp .env.example .env
npm run dev        # starts API server (3001) + Vite client (5173)
```

Open http://localhost:5173, create a game, and open a second browser/device at the join URL.
Real TikTok data needs TikTok credentials (see [TikTok developer setup](#tiktok-developer-setup));
until then the app shows its honest empty states instead of demo content.

**Verify everything works** (builds nothing, starts a real server, checks health, client build,
security, room creation and the real-data guard):

```bash
npm run build
npm run smoke
# or verify a deployment:
node scripts/smoke.mjs --url https://cluecrew.onrender.com
```

---

## How to play

1. The host clicks **Create game**, picks a name and avatar, and shares the 6-letter code
   (QR code and copy-link included).
2. Friends open the site, click **Join game**, and enter the code. They appear in the lobby
   instantly — no account required.
3. The host chooses rounds, timer, modes and scoring, then hits **Start game**.
4. Each round: a piece of content is shown anonymously; everyone (except the player it belongs
   to, who sees "This round is yours") guesses who it belongs to.
5. Answers can be changed until everyone has answered or the timer runs out. Then the answer is
   revealed with points for correct guessers and a bonus for the player in the spotlight.
6. After the final round: podium, full standings and **Play again with the same crew** — no
   reconnecting needed.

Host controls: start, settings (live), skip round, pause between rounds, next round, end game,
back to lobby, play again, transfer host. Settings: round count (or unlimited), timer per
question, enabled modes, classic/casual scoring, randomised player order, show/hide avatars.

---

## Game modes and the TikTok API reality

Two audits back the implementation; both were run against the official documentation in
September 2026:

- [`docs/TIKTOK-API.md`](docs/TIKTOK-API.md) — Login Kit / Display API / Research API overview
- [`docs/TIKTOK-DATA-PORTABILITY.md`](docs/TIKTOK-DATA-PORTABILITY.md) — the full Data Portability
  audit (endpoints, scopes, data types, export lifecycle, privacy contract)

| Mode | Official TikTok API | Implementation |
| --- | --- | --- |
| **Who Posted This?** | ✅ Display API `POST /v2/video/list/` with `video.list` | Real integration via `TikTokProvider` |
| **Who Liked?** | ⚠️ Data Portability **full archive** only (`portability.all.*`, separate approval, EEA/UK users). The `activity` scope does **not** include likes. | Real via `TikTokDataPortabilityProvider` when approved and imported; otherwise the mode reports as unavailable |
| **Who Saved?** | ⚠️ Same full-archive "Favourite Videos" section | Same as Who Liked |
| **Who Reposted?** | ❌ Not a documented Data Portability data type; Research API is academic-only | Unavailable — no official API provides reposts |

Rules this project follows strictly:

- No passwords are ever requested. No scraping. No unofficial endpoints. No demo data in the
  product: when official API access does not exist for a mode, that mode is **unavailable** and
  says exactly which TikTok permission would be required.
- TikTok exports are parsed locally: only like/save entries are extracted, everything else
  (DMs, purchases, profile, watch history) is ignored, and the raw archive is deleted in a
  `finally` block. The UI shows the real async states instead of pretending data is instant.
- The engine and UI are provider-agnostic, so if TikTok expands access only the providers
  change — no game code.

---

## Real data only (and what happens without it)

Production code contains **no demo/mock provider**. Content comes from TikTok or not at all:

| Situation | What the app shows |
| --- | --- |
| No TikTok account connected | Empty state: "Connect your TikTok account to see your real data." — with a one-click **Continue with TikTok** button on the landing page, in the lobby and on `/account` |
| TikTok not configured on the server | Clear notice for players + instructions for the operator (TIKTOK_CLIENT_KEY/SECRET) |
| Connected without `video.list` | "Who Posted This?" reports the missing permission instead of showing content |
| Token rejected/expired | Reconnect banner with a working button (tokens refresh automatically first) |
| Liked/saved without Data Portability approval | Modes report unavailable with the exact scope (`portability.all.ongoing`) |
| Reposts | Always unavailable — no official API provides them |

The automated test suite gets its content from a **test-only provider double**
(`server/tests/testProvider.ts`) injected through the RoomManager's `providerFactory` option, so
full multiplayer games are still covered without shipping any fake data.

---

## Project structure

```
cluecrew/
├── shared/                     # Types + mode metadata shared by server and client
│   └── src/index.ts
├── server/                     # Node.js + Express + Socket.IO + SQLite
│   ├── src/
│   │   ├── api/                # REST routes (sessions, rooms, TikTok OAuth, import, media proxy)
│   │   ├── auth/               # Session service, TikTok OAuth v2 service, token refresh
│   │   ├── database/           # SQLite driver, schema, repositories
│   │   ├── game/               # Engine (state machine), scoring, modes, room manager
│   │   ├── portability/        # TikTok Data Portability client, export parser, import service
│   │   ├── providers/          # SocialProvider interface, TikTok + DataPortability providers
│   │   ├── realtime/           # Socket.IO wiring (auth, events, rate limits)
│   │   ├── lib/                # crypto, errors, ids, rate limit, http, media proxy
│   │   └── app.ts / server.ts  # Express app factory + entry point
│   └── tests/                  # Vitest: engine, scoring, modes, providers, OAuth, API, import, E2E
├── client/                     # React + TypeScript + Vite (mobile-first SPA)
│   └── src/
│       ├── app/                # App shell, theme, session, toasts
│       ├── components/         # UI primitives, icons, avatars, timer, confetti, TikTok cards
│       ├── game/               # Lobby, play, guess, reveal, scoreboard, results
│       ├── lib/                # API client, socket hook, sound, storage, avatars
│       ├── pages/              # Landing, join, room, account, 404
│       └── styles/             # Design tokens + components + screens CSS
├── docs/                       # TIKTOK-API.md, TIKTOK-DATA-PORTABILITY.md, ARCHITECTURE.md, DEPLOYMENT.md
├── scripts/                    # dev runner, full-stack smoke test (local + --url remote)
├── render.yaml / netlify.toml  # free-tier deployment blueprints
└── .env.example
```

The requested architecture (`/game/modes`, `/game/providers`, `/api`, `/database`, `/auth`,
`/lib`, `/types`, `/tests`) maps onto this layout; `shared/src/index.ts` is the `/types` layer.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Server + client dev servers with prefixed output |
| `npm run build` | Production build (client bundle + server esbuild bundle) |
| `npm start` | Run the production server (serves the built client too) |
| `npm test` | Full Vitest suite (92 tests) |
| `npm run typecheck` | Strict TypeScript check for server + client |
| `npm run smoke` | Start a real server and verify health, client build, security, rooms and the real-data guard |
| `node scripts/smoke.mjs --url <url>` | Same checks against a deployed instance |
| `SMOKE_MODE=prod npm run smoke` | Same, but against the built production bundle |

---

## Testing

```bash
npm test          # 92 automated tests
```

Coverage includes:

- **Engine**: full phase sequence, early lock, answer changes, timeout lock, disconnected
  players, skip, pause rules, round limits, unlimited rounds, actor fairness, content recycling,
  host transfer, round-count extension.
- **Scoring**: base points, speed bonus maths, casual mode has no speed component, actor bonus,
  missing answers, bonus clamping.
- **Modes/providers**: availability computation, honest capability maps, TikTok provider mapping,
  scope-aware profile/video loading, token refresh, unsupported capabilities throw, and the
  disconnected provider (no demo fallback).
- **OAuth**: state creation/one-time use/expiry, encrypted token storage, scope checks, revoke.
- **Account API**: empty state without a connection, real profile + statistics, unavailable fields
  with the exact required scope, real videos with statistics, reconnect state on rejected tokens.
- **Data Portability import**: authorization gating, export request creation, status handling
  (pending/downloading/expired/cancelled), successful download+parse, malformed archives,
  unsupported sections ignored, duplicates, missing URLs, transient vs. definitive errors,
  privacy filtering (DMs/purchases/watch history never stored), temp-file deletion,
  delete-on-request and delete-on-disconnect.
- **API**: room create/join, invalid codes, duplicate names, capacity, in-game joins, CSRF,
  import endpoints, session flow, user-data deletion.
- **Deployment config**: `FRONTEND_URL`/`BACKEND_URL`/`SESSION_SECRET`/`DATABASE_URL` aliases,
  PostgreSQL rejection, scope→category mapping, `GET /health`, `/api/config` secret-free
  output, CORS preflight.
- **End-to-end** (real sockets, 3 simulated players, injected test provider): a complete
  multi-round game with score verification against the database, unlimited rounds, mid-game
  reconnect with preserved answer, host transfer, mid-game leave, forged-token rejection.

Plus `npm run smoke`, which boots a real server and verifies health, the served client, security
headers/cookies/CORS, room creation and the honest "no content sources" guard.

---

## Configuration

Copy `.env.example` → `.env`. Key variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | API/WebSocket port |
| `BACKEND_URL` / `PUBLIC_URL` | `http://localhost:3001` | Public server URL (OAuth redirect base) |
| `FRONTEND_URL` / `CLIENT_URL` | `http://localhost:5173` | Where OAuth redirects return to the SPA |
| `ALLOWED_ORIGINS` | `FRONTEND_URL,BACKEND_URL` | CORS + CSRF origin allow-list (split deployments supported) |
| `DATABASE_PATH` / `DATABASE_URL` | `./data/cluecrew.sqlite` | SQLite file (auto-created; `file:` prefix supported; PostgreSQL URLs are rejected) |
| `TOKEN_ENCRYPTION_KEY` / `SESSION_SECRET` | dev key | 64 hex chars (used directly) or any other non-empty secret (hashed with SHA-256); **required in production** |
| `MAX_PLAYERS_PER_ROOM` | `12` | Room capacity |
| `HOST_TRANSFER_GRACE_SECONDS` | `30` | Time before host rights transfer after a disconnect |
| `ROOM_TTL_HOURS` | `12` | Rooms and stored content references expire |
| `GAME_INTRO_MS` … `GAME_POINTS_MS` | production values | Phase timings (tests/smoke use faster values) |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | empty | Required for the real TikTok connect flow |
| `TIKTOK_REDIRECT_URI` | `{BACKEND_URL}/api/auth/tiktok/callback` | Must match the TikTok app registration exactly (HTTPS) |
| `TIKTOK_EXTRA_SCOPES` | empty | Additional approved scopes, e.g. `user.info.profile,user.info.stats` |
| `TIKTOK_DATAPORTABILITY_ENABLED` | `false` | Enable activity import (only after TikTok approval) |
| `TIKTOK_DATAPORTABILITY_SCOPE` | `portability.all.ongoing` | Minimum scope that includes likes/saves |
| `DP_*` | see `.env.example` | Import behaviour: poll interval, caps, oEmbed enrichment |
| `APP_VERSION` | `1.1.0` | Reported by `GET /health` |
| `VITE_API_URL` (client build) | empty | Absolute backend origin for split deployments |

Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## TikTok developer setup

1. Create an app at <https://developers.tiktok.com/> and add the products **Login Kit (Web)** and
   **Display API**.
2. Request these scopes for the app (TikTok reviews each scope):
   - `user.info.basic` — display name + avatar (always requested)
   - `video.list` — the user's own public videos (always requested)
   - `user.info.profile` — username, bio, profile link (optional, extra approval)
   - `user.info.stats` — follower/video statistics (optional, extra approval)
3. Register the redirect URI exactly as `{BACKEND_URL}/api/auth/tiktok/callback`.
   TikTok requires **HTTPS** — `http://localhost` is rejected, so test against your deployed URL
   (or a tunnel) and use TikTok's sandbox/tester mode while the app is in review.
4. Set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` (and, once approved, e.g.
   `TIKTOK_EXTRA_SCOPES=user.info.profile,user.info.stats`) and restart.
5. Click **Connect TikTok** anywhere in the app. The OAuth flow uses a server-side CSRF `state`,
   stores tokens encrypted (AES-256-GCM), refreshes them automatically, shows a reconnect state if
   TikTok ever rejects them, and disconnecting revokes the token and deletes imported data.

What that enables: **profile, statistics and the player's own public videos**. Liked/saved content
additionally needs the **Data Portability API** approval (separate 3–4 week review; EEA/UK users
only) — set `TIKTOK_DATAPORTABILITY_ENABLED=true` afterwards and the lobby walks players through
the export states. Reposts have no official API and stay unavailable.
Full details: `docs/TIKTOK-DATA-PORTABILITY.md`.

## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full guide, including exactly what the
free tiers do and do not guarantee. Summary of the tested setup:

- **Recommended (free, single origin):** one Render free web service runs the API, the
  WebSockets and serves the built client. `render.yaml` is included as a Blueprint; health
  check at `/health`. The deploy is **zero-config**: the server auto-detects the assigned URL
  from Render's `RENDER_EXTERNAL_URL`, so cookies stay first-party and the TikTok redirect URI
  builds itself. Free instances spin down after 15 idle minutes and have an ephemeral
  filesystem (rooms/accounts reset on restart; the game recovers by design).
- **Optional split:** Netlify static frontend (`netlify.toml`) + Render backend with
  `VITE_API_URL`, CORS and automatic `SameSite=None` cookies. Works, but third-party cookie
  restrictions can affect browser-dependent flows — single origin avoids that entirely.
- **Durability upgrade path:** attach a Render persistent disk (no code changes,
  `DATABASE_PATH` is configurable) or port the repository layer to PostgreSQL (documented as
  future work; the SQLite path is the only fully tested driver).

```bash
# Docker, single host
docker compose up -d --build   # with TOKEN_ENCRYPTION_KEY set
# or manually
npm ci && npm run build
NODE_ENV=production TOKEN_ENCRYPTION_KEY=... npm start
```

In production the Node server serves both the API/WebSockets **and** the built client from one
origin — put it behind any HTTPS reverse proxy (Caddy, Nginx, Traefik) or platform (Render, Fly,
Railway, a VPS). Health check: `GET /api/health`.

---

## Database

SQLite via Node's built-in driver (zero native dependencies), schema auto-migrated on boot:

`users`, `sessions`, `oauth_states`, `oauth_accounts`, `game_rooms`, `game_players`, `games`,
`rounds`, `round_actions`, `guesses`, `scores`.

Live game state is kept in memory for speed and persisted on every transition; rooms are
rehydrated from the database after a restart (an interrupted game returns the group to the
lobby with a clear message). Content is stored as references plus minimal display metadata and
is deleted with the room (`ROOM_TTL_HOURS`). In-memory rate limiting and room timers assume a
single node — `docs/DEPLOYMENT.md` explains the Redis/Socket.IO adapter path for scaling out.

---

## Security and privacy

- Server-side validation (zod) of every request/event; room access checked on every socket join.
- Guest sessions with HTTP-only, SameSite=Lax cookies (`Secure` in production); per-player
  secret reconnect tokens stored only as SHA-256 hashes.
- CSRF: double-submit token for cookie-authenticated writes + strict origin allow-list.
- OAuth: one-time state token (10 min TTL), exact redirect-URI match, PKCE-verifier field ready.
- Tokens encrypted at rest (AES-256-GCM), never logged, never sent to browsers. Client secrets
  only ever exist in server environment variables.
- Rate limiting on all REST buckets and on socket events (guesses, host actions, joins).
- Signed media proxy: only URLs we signed can be fetched, only TikTok CDN hosts are allowed,
  5 MB cap, in-memory cache.
- Content minimisation: only what a round needs, for as long as the room lives.
- `DELETE /api/me` revokes TikTok, removes the user from live rooms and deletes all their data;
  disconnect-only is also supported.
- Production security headers incl. a strict CSP; HTTPS assumed (proxy/platform).

---

## Error handling

Every failure mode has a user-facing state: invalid/expired room codes, full rooms, joining a
started game, duplicate names, insufficient players/content sources, TikTok not configured, OAuth
failure/scope refusal, TikTok rate limits, content unavailable, network interruption (auto
reconnect banner), host disconnection (automatic host transfer), game expiration (TTL), and
server restarts (rooms restored to lobby with an explanation). No dead loading screens.

---

## Extending the game

- **New mode**: add an id to `MODE_IDS` + entry in `MODES` (shared), implement capability +
  fetch in the provider(s), and the engine, lobby toggles, round flow, reveal text and scoring
  pick it up automatically.
- **New social network**: implement the `SocialProvider` interface
  (`authenticate`, `getUser`, `getAvailableLikedContent`, `getAvailableRepostedContent`,
  `getAvailableSavedContent`, `getAvailablePostedContent`, `disconnect`, `getCapabilities`) and
  register it in `server/src/providers/factory.ts`.

---

## Honest limitations

- Liked and saved modes need TikTok's **Data Portability API approval** (separate 3–4 week
  review), the **all-data scope**, and a TikTok account in the **EEA or UK**. Until all three are
  true the app says so and shows the modes as unavailable — it never fills them with demo data.
  Reposts are not a documented Data Portability data type and cannot be provided at all.
- `user.info.profile` and `user.info.stats` (username, bio, follower/video counts) require
  TikTok's approval for those scopes. Without them the account page shows exactly which
  permission is missing instead of placeholder numbers.
- Async by nature: TikTok prepares exports in seconds-to-hours. The UI shows the real state
  (requesting → waiting → importing → ready) and never pretends data is instant.
- TikTok has no localhost redirect for web apps (HTTPS required): test the live flow on your
  deployed URL, or with TikTok's sandbox/tester mode.
- Free-tier hosting has an **ephemeral filesystem**: rooms, guest sessions and TikTok links
  reset when the service restarts. The game recovers gracefully; attach a persistent disk for
  durability (`DATABASE_PATH` is configurable).
- Live room state is in-process. One node handles hundreds of concurrent rooms comfortably;
  horizontal scaling needs a shared adapter (documented in `docs/DEPLOYMENT.md`).
- SQLite is ideal for a single node; the repository layer isolates queries so PostgreSQL can be
  swapped in for multi-node deployments (not shipped untested).
- The test suite uses a deterministic provider double (`server/tests/testProvider.ts`) so full
  games are testable without live TikTok credentials. This code never runs in the product.
