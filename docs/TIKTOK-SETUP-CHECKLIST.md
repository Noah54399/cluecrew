# TikTok App Setup — 5-Minuten-Checkliste

> Für den Besitzer eines **funktionierenden TikTok-Developer-Accounts** (z. B. Papa).
> Es dauert einmalig ~5 Minuten. Danach verbindet sich das Spiel mit echten TikTok-Daten.
> Wichtig: TikTok verlangt für Web-Redirects **HTTPS** — `localhost` funktioniert nicht.

## 1. App anlegen

1. Auf https://developers.tiktok.com/ mit dem Developer-Account einloggen.
2. **Manage apps → Connect an app**
3. Felder:
   - **App name:** `ClueCrew`
   - **Website URL:** `https://cluecrew.onrender.com`
   - Beschreibung z. B.: *Party game for friends; shows the connected account's own profile and public videos and lets friends guess who they belong to.*
   - Icon: beliebig (ein Quadrat reicht)
4. App-Typ: **Web** / „Connect an app" bestätigen (Organisation ist optional, „individual developer account" ist erlaubt).

## 2. Produkte hinzufügen

Auf der App-Seite unter **Products** hinzufügen:

- ✅ **Login Kit** → „Configure for Web"
- ✅ **Display API** (Content Display)

## 3. Redirect URI eintragen (Login Kit → Web)

Exakt diese Zeile (kopieren, keine Änderung, kein Slash am Ende):

```
https://cluecrew.onrender.com/api/auth/tiktok/callback
```

## 4. Scopes

In den App-Einstellungen diese Scopes aktivieren/anfordern:

| Scope | Wofür | Pflicht? |
| --- | --- | --- |
| `user.info.basic` | Name + Avatar | ja |
| `video.list` | eigene öffentliche Videos („Who Posted This?") | ja |
| `user.info.profile` | @username, Bio, Profil-Link | optional (extra Review) |
| `user.info.stats` | Follower-/Video-Statistiken | optional (extra Review) |

## 5. Tester hinzufügen (kein App-Review nötig!)

Damit ihr **sofort** testen könnt, ohne auf die Freigabe zu warten:

- In der App unter **Sandbox / Test users / Tester** das persönliche **TikTok-Konto des Spielers** hinzufügen (das Konto, mit dem später „Connect TikTok" geklickt wird).

## 6. Keys kopieren → Render eintragen

1. Auf der App-Seite **Client key** und **Client secret** anzeigen lassen und kopieren.
2. https://dashboard.render.com → Service **cluecrew** → **Environment** → zwei Variablen anlegen:
   - `TIKTOK_CLIENT_KEY` = *(Client key)*
   - `TIKTOK_CLIENT_SECRET` = *(Client secret)*
   - *(erst nach Scope-Freigabe zusätzlich)* `TIKTOK_EXTRA_SCOPES` = `user.info.profile,user.info.stats`
3. **Save** → Render startet den Service automatisch neu.

## 7. Fertig — so wird geprüft

Danach auf **https://cluecrew.onrender.com**:

1. Oben rechts **Connect TikTok** klicken → normales TikTok-Login (Handynummer/Passwort — **nicht** der Developer-PIN) → Zustimmung erteilen.
2. Zurück auf **/account**: echtes Profil, Statistiken (falls Scope gewährt) und die eigenen öffentlichen Videos.
3. In der Lobby erscheint „TikTok connected" — und **Who Posted This?** läuft mit den echten Videos.

Wenn etwas nicht klappt: Sag Bescheid — die Server-Seite kann dann gezielt geprüft werden
(Authorize-Redirect, Callback, Token-Tausch, API-Antworten).

## Was bewusst NICHT geht (und warum)

- **Kein Login ohne Developer-App:** TikToks OAuth startet ausschließlich mit einem
  gültigen `client_key`. Es gibt keinen offiziellen Weg daran vorbei.
- **Kein Scraping / keine privaten Endpoints:** verboten laut Projektvorgabe, bricht sofort
  und ist unsicher. Deshalb zeigt die App lieber ehrliche Empty States.
- **Likes/Saved-Videos:** brauchen zusätzlich die **Data Portability API** (separate
  Freigabe, 3–4 Wochen, nur EEA/UK). Reposts: gibt es in keiner offiziellen API.
