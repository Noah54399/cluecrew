# Architecture

This document explains how ClueCrew is put together and why.

## Module map

```
┌────────────────────────────────────────────┐        ┌─────────────────────────┐
│ React client (client/)                     │        │ share (shared/src)      │
│  pages / game views / components / lib     │◄──────►│ types, modes, protocol  │
│  Socket.IO client + REST client            │        └─────────────────────────┘
└──────────────┬─────────────────────────────┘                    ▲
               │ WebSocket (room:*) + REST (/api/*)                │ imported by both
┌──────────────▼─────────────────────────────┐                    │
│ Node server (server/src)                   │────────────────────┘
│                                            │
│  api/         REST routes, validation,     │
│               TikTok OAuth, media proxy    │
│  realtime/    Socket.IO: auth middleware,  │
│               event handlers, rate limits  │
│  auth/        sessions, CSRF, OAuth flows  │
│  game/        RoomManager ─► GameEngine    │
│  providers/   SocialProvider interface     │
│               ├── TikTokProvider (official)│
│               └── MockSocialProvider (demo)│
│  database/    SQLite driver, schema, repos │
└────────────────────────────────────────────┘
```

**Dependency rule:** the game engine depends only on the `SocialProvider` *interface* —
never on TikTok, sockets, HTTP or SQLite. `RoomManager` is the only module allowed to touch
all of them (it is the composition root for live games).

## Round lifecycle

```
Host: host:start ─► GameEngine.prepareGame (scores reset, modes resolved)
                       │
                       ▼
             RoomManager.startNextRound
              ├─ planRoundCandidates()      (mode + actor selection, engine)
              ├─ provider.getItems(...)     (mock or TikTok, per-player context)
              ├─ pickUnusedContent()        (no repeats until exhausted → unlimited play)
              └─ engine.beginRound()        ─► phase ROUND_START
                       │
     timers ──► tick() │ ROUND_START → SHOW_CONTENT → GUESSING
                       │        (early lock when all connected players answered)
   guesses ─► submitGuess() ─► phase LOCK_GUESSES ─► REVEAL ─► SHOW_POINTS
                       │
                       └─ round limit reached ? GAME_OVER : next round
```

Phase timings are injected (`GameTimings`), which is why tests can run a full round in
milliseconds while production uses human-friendly durations.

## Game engine

`server/src/game/engine.ts` is a synchronous, deterministic state machine over a plain
`EngineRoom` object. It:

- owns phase transitions and deadlines (`phaseEndsAt`),
- validates every player action (wrong phase → typed `AppError` with a friendly message),
- scores rounds (`scoring.ts` is pure and independently unit-tested),
- tracks fairness (fewest-actors-first), used content, scores and actor counts,
- never emits anything itself: it **returns effects** which `RoomManager` translates into
  database writes, broadcasts and follow-up work.

The only crypto-level randomness the engine uses is the injected `rng` — tests seed it.

## Realtime protocol

Socket.IO with two payload shapes:

- `room:state` — a **complete snapshot**, personalised per player. Full snapshots instead of
  patches make reconnection trivial (one message restores the exact view) and eliminate
  ordering bugs. Secret data is stripped per recipient:
  - during guessing, `actorPlayerId` and the answer list contain only *who answered*, never
    *what they answered*;
  - `you.isActor` is only sent to the actor themselves;
  - TikTok post authors/links are hidden until the reveal (they would give the answer away).
- `room:flash` — tiny ephemeral events (`round_started`, `guesses_locked`, `reveal`, …) used
  for sounds and animations.

Timers are server-authoritative: the snapshot carries `serverTime` + `phaseEndsAt`, the client
computes an offset once and animates its countdown locally.

## Content flow (privacy-minimal)

```
provider.fetchItems() ──► ContentItem { id, title, coverUrl, webUrl, author }
        │                         │
        │                         ├─ persisted once in round_actions (reference + display data)
        │                         └─ sent in snapshots as ContentView (author hidden pre-reveal)
        └─ covers: data: URIs (demo) or proxied through /api/media/proxy (signed URL)
```

Cover images from TikTok CDNs are never hotlinked: the server signs the URL (HMAC) and serves
it through an allow-listed, size-capped, cached proxy. Demo covers are generated SVG data URIs
so nothing external is required.

## TikTok Data Portability import

```
Login Kit consent (portability scope)
        │
        ▼
DataPortabilityService.startImport ─► POST /v2/user/data/add/     (request_id stored)
        │
        ▼  server-side poll loop (DP_POLL_INTERVAL_SECONDS)
DataPortabilityService.refresh ─────► POST /v2/user/data/check/
        │        status: pending | downloading | expired | cancelled
        ▼ downloading
downloadArchive ─► temp ZIP on disk (never in the DB)
        │
        ▼
exportParser ─► ONLY "Like List" / "Favourite Videos" entries
        │        (normalized key matching, defensive against undocumented layouts)
        ▼
social_actions (dedup per user+kind+contentId) ─► temp ZIP deleted in `finally`
        │
        ▼
appEvents 'tiktok:import:updated' ─► RoomManager rebuilds provider contexts
        │
        ▼
TikTokDataPortabilityProvider ─► real like/save items for the game engine
```

Privacy invariants enforced in code and tests:

- the parser only recognises known sections; every other archive section is never read into
  structured data (DMs, purchases, searches, watch history, profile, followers);
- the raw archive exists only as a temp file for the duration of one parse, then is deleted;
- `social_actions` stores the video URL, content id, optional date and optional public oEmbed
  metadata — nothing else;
- deleting an import (or disconnecting TikTok) removes every imported row and any temp file.

Provider selection (`providers/factory.ts`) honours the player preference:

| Preference | Behaviour |
| --- | --- |
| `auto` (default) | real TikTok when a usable connection exists (Data Portability import and/or Display API), clearly-labelled demo data for everything else |
| `real` | real data only; modes without real data report as unavailable instead of silently using demo content |
| `mock` | always clearly-labelled demo data (the development/demo switch); works with zero TikTok credentials |

## Authentication & sessions

- Guests are first-class: creating/joining a room creates a `user` + HTTP-only session cookie.
- The TikTok account (optional) links to that user; OAuth tokens are AES-256-GCM encrypted.
- Room membership uses per-player reconnect secrets (SHA-256 hashed server-side) sent with the
  socket handshake — so a player can rejoin from the same browser without cookies, and a
  forged token is rejected.
- CSRF: double-submit token for cookie-auth writes; OAuth uses a one-time server-side state.

## Persistence model

Live rooms are in memory (fast ticks, no DB round-trips per guess) but every meaningful
transition is persisted:

| Event | Tables written |
| --- | --- |
| Room created / player joins | `game_rooms`, `game_players` |
| Game starts | `games` |
| Round begins | `rounds`, `round_actions` |
| Guess submitted / changed | `guesses` (upsert) |
| Round resolved | `guesses` (result), `scores`, `rounds.status` |
| Game over | `games.status` |
| Room changes | `game_rooms` (status, phase, host, settings, recovery snapshot) |

After a server restart, rooms are rehydrated into the lobby from the database; an interrupted
game informs the group and lets them start again — no silent data loss, no broken states.

## Why these choices

- **Socket.IO** — battle-tested reconnect semantics and rooms; runs on one process with plain
  HTTP (no extra infrastructure).
- **Full snapshots per player** — simplest correct answer for reconnect + no patch drift;
  payloads are small (≤12 players).
- **SQLite (built-in driver)** — zero native dependencies, instant start, perfect for one node;
  the repository layer is the seam for PostgreSQL.
- **Provider interface** — keeps the "what TikTok actually allows" reality out of the game
  logic and makes additional networks or future permissions a small, local change.
- **Mock provider first-class** — a testable game that never pretends demo data is real.

## Test architecture

`server/tests/helpers.ts` boots the real app on an ephemeral port with an in-memory database
and an injected clock-speed (`GameTimings`). The E2E tests connect actual Socket.IO clients,
so the suite exercises the same code paths a browser would.
