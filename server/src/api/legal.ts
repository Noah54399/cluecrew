import { Router } from 'express';
import { BRAND } from '@cluecrew/shared';

/**
 * Legal pages + TikTok developer URL verification.
 *
 * TikTok requires Terms of Service and Privacy Policy URLs on a domain we
 * control (and, for some products, ownership verification of the domain via a
 * signature file). Serving both from this server keeps those URLs first-party
 * and verifiable — the GitHub repository URL can never be verified by TikTok.
 */

const REPO_URL = 'https://github.com/Noah54399/cluecrew';

function legalPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} - ${BRAND.name}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0a16; color: #f4f2ff; font-family: system-ui, 'Segoe UI', sans-serif; line-height: 1.6; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 20px 80px; }
  h1 { font-size: 32px; margin: 0 0 4px; }
  h2 { font-size: 19px; margin: 32px 0 8px; color: #cfc9f5; }
  p, li { color: #b9b3dd; font-size: 15.5px; }
  a { color: #9d8cff; }
  .muted { color: #7e79a8; font-size: 14px; }
</style>
</head>
<body><main>
<p class="muted"><a href="/">← ${BRAND.name}</a></p>
<h1>${title}</h1>
<p class="muted">${BRAND.name} — ${BRAND.tagline} Last updated: September 2026.</p>
${body}
</main></body>
</html>`;
}

export function createLegalRouter(): Router {
  const router = Router();

  router.get('/terms', (_req, res) => {
    res.type('html').send(
      legalPage(
        'Terms of Service',
        `
<h2>1. What ClueCrew is</h2>
<p>ClueCrew is a free, non-commercial party game hosted for friends to play together. It has no
subscriptions, no in-app purchases and no round limits. By using the service you agree to these
terms.</p>

<h2>2. TikTok integration</h2>
<p>Signing in with TikTok is optional and uses TikTok's official Login Kit and Display API. We
never ask for your TikTok password, never scrape TikTok and only display data that you explicitly
authorized through TikTok's consent screen. Your use of TikTok remains subject to TikTok's own
terms.</p>

<h2>3. Acceptable use</h2>
<p>Do not use ClueCrew to harass others, to upload unlawful content or to attempt to break,
overload or abuse the service. Rooms and accounts may be removed when they violate these rules.</p>

<h2>4. Availability and warranty</h2>
<p>The service is provided "as is" without warranties of any kind. Games, rooms and connected
accounts may be interrupted (for example when the free hosting instance restarts), and data stored
during a session can be lost. Do not rely on ClueCrew for permanent storage.</p>

<h2>5. Changes</h2>
<p>These terms may be updated as the project evolves; the current version is always published at
this URL.</p>

<h2>6. Contact</h2>
<p>Questions or issues: <a href="${REPO_URL}">${REPO_URL}</a></p>`,
      ),
    );
  });

  router.get('/privacy', (_req, res) => {
    res.type('html').send(
      legalPage(
        'Privacy Policy',
        `
<h2>1. What we store</h2>
<ul>
  <li><strong>Guest profile:</strong> the display name and avatar style you choose (no account,
      no password, no email required).</li>
  <li><strong>Game data:</strong> room codes, players, rounds, guesses and scores for the games
      you play. Rooms expire automatically after a few hours.</li>
  <li><strong>TikTok connection (optional):</strong> if you connect TikTok, we store your TikTok
      open id, display name, avatar and OAuth tokens on our server. Tokens are encrypted at rest
      (AES-256-GCM) and are never exposed to the browser.</li>
  <li><strong>TikTok activity import (optional):</strong> if the app is approved for TikTok's Data
      Portability API and you request an import, we extract only the video references needed for
      the game (liked/saved videos) and immediately delete the raw export archive. Everything
      else in the export (messages, purchases, watch history, profile lists) is ignored and never
      stored.</li>
</ul>

<h2>2. What we do not do</h2>
<p>We do not ask for passwords, do not scrape TikTok, do not sell or share personal data with
advertisers, and do not store anything that is not needed for the game.</p>

<h2>3. TikTok data</h2>
<p>All TikTok data (profile, videos, statistics) is fetched live through TikTok's official APIs
with the permissions you granted. You can revoke these permissions at any time in TikTok
(Settings → Security → Manage app permissions) or by using "Disconnect TikTok &amp; delete data"
inside ClueCrew, which also deletes all imported activity data.</p>

<h2>4. Cookies</h2>
<p>We use a single session cookie that is required for the service to work (no tracking or
advertising cookies). Core game features also work without it using per-player room tokens.</p>

<h2>5. Retention &amp; deletion</h2>
<p>Rooms expire automatically (default: 12 hours), sessions after 30 days. Use "Delete my data"
in the app or contact us to have your data removed immediately.</p>

<h2>6. Contact</h2>
<p><a href="${REPO_URL}">${REPO_URL}</a></p>`,
      ),
    );
  });

  return router;
}

/**
 * Serves the TikTok URL-ownership signature file. The token comes from the
 * TikTok portal dialog ("Verify properties" → URL prefix → download file) and
 * is configured via the TIKTOK_SITE_VERIFICATION environment variable. It is a
 * public token by design — TikTok fetches this file from the internet.
 */
export function createTikTokVerificationRouter(token: string): Router {
  const router = Router();
  const paths = [
    '/.well-known/tiktok-developers-site-verification.txt',
    '/.well-known/tiktok-developers-verification.txt',
    '/tiktok-developers-site-verification.txt',
  ];
  const body = token.includes('=')
    ? token
    : `tiktok-developers-site-verification=${token}`;
  for (const path of paths) {
    router.get(path, (_req, res) => {
      if (!token) {
        res.status(404).type('text/plain').send('No TikTok verification token configured.');
        return;
      }
      res.type('text/plain').send(body);
    });
  }
  return router;
}
