# TikTok Data Portability API — capability audit & integration notes

**Audit date:** September 2026
**Status of this document:** research + implementation contract for `TikTokDataPortabilityProvider`

Official sources (all fetched and read while preparing this document):

- Get Started — <https://developers.tiktok.com/doc/data-portability-api-get-started/>
- Add Data Request — <https://developers.tiktok.com/doc/data-portability-api-add-data-request/>
- Check Status of Data Request — <https://developers.tiktok.com/doc/data-portability-api-check-status-of-data-request/>
- Download — <https://developers.tiktok.com/doc/data-portability-api-download/>
- Cancel Data Request — <https://developers.tiktok.com/doc/data-portability-api-cancel-data-request/>
- Data Types — <https://developers.tiktok.com/doc/data-portability-data-types/>
- Data Portability FAQ — <https://developers.tiktok.com/doc/data-portability-api-faq/>
- Application Guidelines — <https://developers.tiktok.com/doc/data-portability-api-application-guidelines/>
- Product page — <https://developers.tiktok.com/products/data-portability-api>
- Scopes Reference — <https://developers.tiktok.com/doc/tiktok-api-scopes/>
- TikTok public oEmbed endpoint (Embed Videos product) — <https://www.tiktok.com/oembed?url=…>

---

## TL;DR — the three findings that change the design

1. **`portability.activity.*` does NOT include likes, saves or reposts.**
   The "Activity" category contains Ad Interests, Hashtags, Login History, Off-TikTok Activity,
   Purchases, Searches, Share History and Watch History. Liked videos and favourite videos live
   in the **Full Archive** category, which requires the broadest scope pair:
   `portability.all.single` / `portability.all.ongoing`.
2. **Reposts are not a documented Data Portability data type at all.** There is no "Reposts"
   section in the data types documentation, and no category that would carry them. → *Who Reposted?*
   stays demo-only.
3. **Exports are asynchronous and EEA/UK-only.** Requests go `pending → downloading → expired`
   (4-day download window), data may take seconds, minutes or hours, and the API only returns data
   for TikTok users in the EEA or UK.

**Consequence for ClueCrew:** *Who Liked?* and *Who Saved?* can use **real** data **only** when the
app is approved for `portability.all.*` (full archive) and the player is in the EEA/UK. Everything
else stays clearly-labelled demo data.

---

## SUPPORTED — available through the official Data Portability API

| Capability | Scope | Category to request | Fields provided |
| --- | --- | --- | --- |
| Authorize ongoing/one-time data transfer | `portability.all.ongoing`, `portability.all.single`, `portability.activity.*`, `portability.postsandprofile.*`, `portability.directmessages.*` | — | via Login Kit consent screen |
| Request a data export | any `portability.*` scope | `category_selection_list` | returns `request_id` |
| Track export status | any `portability.*` scope | — | `status` = `pending` \| `downloading` \| `expired` \| `cancelled`, plus `apply_time`, `collect_time`, `data_format`, `category_selection_list` |
| Cancel an export | any `portability.*` scope | — | — |
| Download the finished export | any `portability.*` scope | — | streamed **ZIP** file |
| **Liked videos** (Like List) | ⚠️ `portability.all.*` only | `all_data` | `Date`, **`Video landing page link`** |
| **Favourite / saved videos** | ⚠️ `portability.all.*` only | `all_data` | `Date`, **`Video landing page link`** |
| Favourite hashtags / effects / sounds | `portability.all.*` | `all_data` | date + landing page link (not used by ClueCrew) |
| Own posts (date, title, download link, …) | `portability.all.*` **or** `portability.postsandprofile.*` | `all_data` / `video` | richer than the Display API, but heavier (file links) |
| Profile / followers / following | `portability.all.*` **or** `portability.postsandprofile.*` | `profile` | **not needed by ClueCrew — never imported** |

Endpoint summary (official, verified against the pages above):

| Action | HTTP |
| --- | --- |
| Add data request | `POST https://open.tiktokapis.com/v2/user/data/add/?fields=request_id` — body `{ "data_format": "json", "category_selection_list": ["all_data"] }` |
| Check status | `POST https://open.tiktokapis.com/v2/user/data/check/?fields=request_id,status,apply_time,collect_time,data_format,category_selection_list` — body `{ "request_id": … }` |
| Download | `POST https://open.tiktokapis.com/v2/user/data/download/` — body `{ "request_id": … }` → streamed ZIP |
| Cancel | `POST https://open.tiktokapis.com/v2/user/data/cancel/` — body `{ "request_id": … }` |

All endpoints require `Authorization: Bearer <user access token>` obtained through Login Kit.

---

## NOT SUPPORTED — not available through the Data Portability API

| Capability | Why |
| --- | --- |
| **Reposted videos** | No "Reposts" data type is documented for Data Portability (the Research API has `research/user/reposted_videos`, but that is academic-only). → *Who Reposted?* cannot use real data. |
| **Liked / saved videos via `portability.activity.*`** | The Activity category covers searches, watch history, share history, purchases, logins, ad interests — **not** likes or favourites. Requesting `activity` will legitimately produce an export with no like/favourite sections. |
| **Real-time or instant access** | Exports are prepared asynchronously; downloads are a ZIP file, available for **4 days** after they are ready. There is no streaming endpoint. |
| **Non-EEA/UK users** | The product page states the API "is available for TikTok users in the European Economic Area (EEA) or United Kingdom (UK)" and "will not return data for users outside the EEA or UK". |
| **Direct messages, purchases, follower lists for gameplay** | Technically present in exports (with `all_data`), but intentionally **out of scope** for ClueCrew and filtered out on import. |

---

## REQUIRES APPROVAL

| Requirement | Details |
| --- | --- |
| **Data Portability API application** | Separate application form (scopes selected in advance). Review can take **3–4 weeks**. Requires a well-defined use case and **high-fidelity UX mockups** of the end-to-end user journey, plus a privacy/security review. |
| **Login Kit approval** | Mandatory in addition to the DP approval — the API is unusable until both are approved. Consent happens through Login Kit. |
| **Webhooks (optional)** | Can notify when an export is ready; ClueCrew polls status instead, so webhooks are not required. |
| **`portability.all.*` for likes/saves** | Because likes/favourites are only in the full archive, the app must be approved for the **all-data** scope — the most privacy-sensitive scope. Reviewers may scrutinise a party-game use case for it; the application should honestly explain the "extract minimum, delete immediately" design (see below). |
| **`portability.activity.*` (fallback)** | Usable if approved, but then ClueCrew must clearly state that likes/saves are unavailable (this build does exactly that). |

---

## UNKNOWN / NEEDS VERIFICATION

These points are **not specified** in the official documentation and are handled defensively in code:

| Unknown | How ClueCrew handles it |
| --- | --- |
| **Exact ZIP layout** (file names, folders, whether one big JSON or many files, how sections are nested) | The parser scans **every** `.json`/`.txt` entry in the archive and finds like/favourite sections by *normalized key names* (`Like List`, `Favourite Videos`, `Favorite Videos`, …), regardless of nesting. |
| **`data_format: "text"` exact formatting** | We request `json`. A best-effort text fallback extracts video URLs and nearby dates; anything unparseable is skipped and counted, never guessed. |
| **Whether `Like List` / `Favourite Videos` always include a usable URL** | Entries without a parseable TikTok video URL are skipped and counted (`skipped` in the import state). No fabricated content IDs. |
| **Actual export latency for `all_data`** | Treated as unknown: the UI shows an explicit "TikTok is preparing your data — this can take minutes to hours" state and polls on a schedule. No fake progress bar. |
| **Whether a `*.single` scope can request a *second* export** | Docs state the scope remains on the token "after the current request is fulfilled", so a repeat request is attempted; if TikTok rejects it, the error is surfaced verbatim and the user is told to reconnect. `*.ongoing` is the default. |
| **Whether reposts will be added to exports in future** | The parser ignores unknown sections, so a future `Reposts` section could be enabled with a small mapping change. |
| **Region detection** | TikTok does not expose an "is this user EEA/UK" flag to the app; if an export contains no like/favourite data we say so honestly (empty export or region not covered). |

---

## Export lifecycle (as observed in the docs)

```
user consents (Login Kit, portability scope)
        │
        ▼
POST /v2/user/data/add/            → request_id          status: pending
        │  (data collection runs — seconds, minutes or hours; not guaranteed)
        ▼
POST /v2/user/data/check/          → status: downloading  (data ready)
        │                          → status: expired      (4 days after ready)
        │                          → status: cancelled
        ▼
POST /v2/user/data/download/       → streamed ZIP
        │
        ▼
ClueCrew: unzip in memory → extract ONLY Like List / Favourite Videos
        → store normalized actions → delete the ZIP immediately → status: ready
```

- Download window: **4 days after the data is prepared**.
- `*.ongoing` allows repeated requests with the same authorization; `*.single` allows one request
  at a time (with the scope retained on the token after fulfilment, per the docs).

---

## What ClueCrew does with the export (privacy contract)

1. Requests **only** the category needed for likes/favourites (`all_data` when the all-archive
   scope is approved; `activity` only if that is all the app has).
2. Downloads the ZIP to a temporary folder, parses it **locally**, and **deletes the ZIP in a
   `finally` block** — the raw export is never stored in the database.
3. Extracts only two things per entry: the **video URL** (→ content id) and the **date**, plus
   optional public oEmbed metadata (title/author/thumbnail) for display.
4. Ignores everything else in the archive by construction: direct messages, purchases, searches,
   watch history, login history, profile/followers. None of those strings ever reach the DB.
5. Caps the number of stored actions per user (`DP_MAX_ACTIONS`), deduplicates by
   `(user, type, contentId)`, and stores nothing that is not required by the game.
6. `Disconnect TikTok & delete imported data` removes every imported row and any temp file.
   Disconnecting always deletes imports, even when triggered outside that button.

## What the game shows

- Content from a Data Portability import is real TikTok data and is labelled **TikTok**, never
  "Demo data".
- When an import has no like/favourite entries (wrong region, activity-only scope, empty account),
  the modes fall back to their honest "unavailable / demo" state with the reason shown in the lobby.
- Nothing about the export process is simulated: pending stays pending until TikTok says otherwise.
