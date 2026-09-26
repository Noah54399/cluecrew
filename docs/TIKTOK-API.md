# TikTok API capability audit — what this game can and cannot use

**Audit date:** September 2026
**Sources:** TikTok for Developers documentation (developers.tiktok.com), fetched and verified during development:

- Login Kit for Web — `https://developers.tiktok.com/doc/login-kit-web/`
- User Access Token Management (OAuth v2) — `https://developers.tiktok.com/doc/oauth-user-access-token-management/`
- Display API Get Started — `https://developers.tiktok.com/doc/display-api-get-started/`
- List Videos — `https://developers.tiktok.com/doc/tiktok-api-v2-video-list/`
- Query Videos — `https://developers.tiktok.com/doc/tiktok-api-v2-video-query/`
- Get User Info — `https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info/`
- Scopes Reference — `https://developers.tiktok.com/doc/tiktok-api-scopes/`
- Research API — Query User Liked Videos / Reposted Videos
- Data Portability API — Get Started, Application Guidelines, Data Types
- Data Portability deep dive: [`TIKTOK-DATA-PORTABILITY.md`](./TIKTOK-DATA-PORTABILITY.md)

This document is the authoritative answer to "what may the official TikTok API actually do for us".
Nothing in this project fakes TikTok data. Where the official API does not permit an action, the
mode is either served by a real provider or reported as
**unavailable** (with the exact missing permission). Production ships **no demo data**.

---

## SUPPORTED — available through official TikTok APIs with a standard reviewed app

| Capability | API | Scope | Notes |
| --- | --- | --- | --- |
| "Login with TikTok" (OAuth v2 authorization code flow) | Login Kit for Web | — | `https://www.tiktok.com/v2/auth/authorize/` → callback `code` + `state`; token exchange `POST https://open.tiktokapis.com/v2/oauth/token/` |
| Token refresh (access token valid 24 h, refresh token 365 days) | OAuth v2 | — | `grant_type=refresh_token`; server-side only |
| Token revocation (disconnect) | OAuth v2 | — | `POST https://open.tiktokapis.com/v2/oauth/revoke/` |
| Basic profile: `open_id`, `union_id`, `avatar_url`, `display_name` | Display API `GET /v2/user/info/` | `user.info.basic` | Standard scope, granted in app review |
| Extended profile fields (bio, deep links, …) | Display API `GET /v2/user/info/` | `user.info.profile` | Additional scope, may require approval |
| Profile statistics (followers, likes, video count) | Display API `GET /v2/user/info/` | `user.info.stats` | Additional scope, may require approval |
| **The authorized user's own public videos** (id, title, description, duration, cover image, share/embed link) | Display API `POST /v2/video/list/` | `video.list` | Max 20 per page, paginated by cursor. Cover image URLs expire; refresh via `POST /v2/video/query/` (≤20 ids) |
| Video metadata refresh for own videos | Display API `POST /v2/video/query/` | `video.list` | Used to refresh expiring cover images |

**Product implication:** the only game action that can be backed by real TikTok data is
**Who Posted This?** (guessing which player posted their own public video). That mode is implemented
against the real API. It requires a reviewed TikTok app with `user.info.basic` + `video.list`.

---

## NOT SUPPORTED — no official API exists for a third-party consumer app

| Capability | Status | Detail |
| --- | --- | --- |
| The authenticated user's **liked videos** | ❌ Not available | There is **no Display API endpoint** for the likes of the logged-in user. No scope such as `likes.list` exists in the Scopes Reference. |
| The authenticated user's **favourites / saved videos** | ❌ Not available | No endpoint and no scope exist for "saved"/"favourite" videos in any standard product. |
| The authenticated user's **reposts** | ❌ Not available | No Display API endpoint exists for reposts of the logged-in user. |

These three capabilities power the game modes **Who Liked?**, **Who Saved?** and **Who Reposted?**.
Because TikTok's official API does not expose them, this project:

1. Keeps all three modes behind the `SocialProvider` interface, fully implemented against the engine.
2. Leaves them **unavailable** (with the exact missing permission) — production ships no demo data.
3. Marks those modes in the UI with an explicit "Not available via API" badge and a reason.
4. Never invents values: unavailable means unavailable, with the scope that would be required.

---

## REQUIRES SPECIAL APPROVAL — exists, but not usable by a normal party-game app

| Capability | API | Scope | Why it does not work here |
| --- | --- | --- | --- |
| Liked videos of **arbitrary public users** | Research API `POST /v2/research/user/liked_videos/` | `research.data.basic` | Research-only access. Requires an application, limited to academic/non-profit research, queries by username (not the authenticated user), and is subject to regional and usage restrictions. Not a fit for a consumer game. |
| Reposted videos of **arbitrary public users** | Research API `POST /v2/research/user/reposted_videos/` | `research.data.basic` | Same restrictions as above. |
| The user's **own** activity export, which includes liked/favourited items | Data Portability API — full archive (`all_data`) | `portability.all.ongoing` / `portability.all.single` | Requires a separate application (3–4 week review), high-fidelity UX mockups, a privacy/security review, and an approved Login Kit integration. Currently only returns data for **users in the EEA or UK**. Implemented and documented in detail in [`TIKTOK-DATA-PORTABILITY.md`](./TIKTOK-DATA-PORTABILITY.md). |
| The user's posts and profile as an export | Data Portability API | `portability.postsandprofile.ongoing` | Same approval and EEA/UK restrictions. |

### The concrete path for Who Liked / Who Saved — and one trap

Contrary to what the category name suggests, **`portability.activity.*` does NOT include likes or
favourites**. The "Activity" category is searches, watch history, share history, purchases, logins
and ad interests. Liked and favourite videos only appear in the **full archive**, so the minimum
permission is:

- `portability.all.ongoing` (Data Portability API, full archive) — **EEA/UK users only** — or
- `portability.all.single` for one-time exports, or
- a future Display API scope for liked/saved content (does not exist today).

Reposts are not a documented Data Portability data type and stay demo-only.
The implementation, endpoint details and privacy handling are documented in
[`TIKTOK-DATA-PORTABILITY.md`](./TIKTOK-DATA-PORTABILITY.md).

The `TikTokDataPortabilityProvider` in this repository already serves real likes/saves from an
approved export. When TikTok expands access (regions, scopes), only the provider needs to change;
the game engine, modes, scoring, lobby and UI are provider-agnostic.

---

## Rate limits (relevant to the implemented endpoints)

- Display API endpoints are rate limited per app/access token (TikTok documents a per-minute
  request budget per endpoint). This project fetches video lists **once per player per game**
  and caches them in memory for the duration of the room; it never polls.
- On HTTP 429 the provider throws `ProviderRateLimitError`; the room manager pauses content
  loading, retries once with backoff, and surfaces a friendly "TikTok is rate limiting us"
  message instead of a broken screen.

---

## Compliance notes baked into this codebase

- Passwords are never requested, stored, logged or transmitted.
- No scraping, no private endpoints, no browser automation.
- OAuth uses the documented authorization-code flow with a server-side `state` bound to the
  user's session (CSRF protection) and a strict redirect-URI match.
- Access/refresh tokens are encrypted at rest (AES-256-GCM) and never sent to the browser.
- Content fetched from TikTok is minimised: only the fields required to render a round are kept,
  stored as a reference plus display metadata for the lifetime of the room, and deleted with the
  room. Cover images are passed through a signed, allow-listed image proxy; no TikTok cookies or
  visitor tracking occur.
- Disconnecting a TikTok account revokes the token with TikTok and deletes the stored tokens.
