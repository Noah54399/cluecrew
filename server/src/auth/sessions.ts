import type { Request, Response } from 'express';
import type { ServerConfig } from '../config.js';
import type { Repositories, SessionRow, UserRow } from '../database/repositories.js';
import { SESSION_COOKIE_NAME, clearCookie, parseCookies, serializeCookie } from '../lib/cookies.js';
import { randomSecretToken } from '../lib/ids.js';
import { randomId } from '../lib/ids.js';

export interface AuthContext {
  user: UserRow;
  session: SessionRow;
}

export class SessionService {
  constructor(
    private readonly repos: Repositories,
    private readonly config: ServerConfig,
  ) {}

  private cookieAttributes(maxAgeSeconds: number) {
    const sameSite = this.config.cookieSameSite;
    return {
      httpOnly: true,
      // SameSite=None always requires Secure; production always uses HTTPS.
      secure: this.config.isProduction || sameSite === 'None',
      sameSite,
      path: '/',
      maxAgeSeconds,
    };
  }

  createSession(userId: string): SessionRow {
    const now = Date.now();
    const session: SessionRow = {
      id: randomSecretToken(),
      userId,
      csrfToken: randomSecretToken(),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.config.sessionTtlMs).toISOString(),
    };
    this.repos.sessions.create(session);
    return session;
  }

  createUserWithSession(params: { displayName: string; avatarSeed: number }): AuthContext {
    const now = new Date().toISOString();
    const user: UserRow = {
      id: randomId('usr'),
      displayName: params.displayName,
      avatarSeed: params.avatarSeed,
      preferredSource: 'auto',
      createdAt: now,
      updatedAt: now,
    };
    this.repos.users.create({
      id: user.id,
      displayName: user.displayName,
      avatarSeed: user.avatarSeed,
      now,
    });
    const session = this.createSession(user.id);
    return { user, session };
  }

  attachSessionCookie(res: Response, session: SessionRow): void {
    res.setHeader(
      'Set-Cookie',
      serializeCookie(
        SESSION_COOKIE_NAME,
        session.id,
        this.cookieAttributes(Math.floor(this.config.sessionTtlMs / 1000)),
      ),
    );
  }

  clearSessionCookie(res: Response): void {
    res.setHeader(
      'Set-Cookie',
      clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        secure: this.config.isProduction || this.config.cookieSameSite === 'None',
        sameSite: this.config.cookieSameSite,
        path: '/',
      }),
    );
  }

  readSessionId(req: Request): string | null {
    const cookies = parseCookies(req.headers.cookie);
    return cookies[SESSION_COOKIE_NAME] ?? null;
  }

  getAuth(req: Request): AuthContext | null {
    const sessionId = this.readSessionId(req);
    if (!sessionId) return null;
    const session = this.repos.sessions.get(sessionId);
    if (!session) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.repos.sessions.delete(sessionId);
      return null;
    }
    const user = this.repos.users.get(session.userId);
    if (!user) {
      this.repos.sessions.delete(sessionId);
      return null;
    }
    return { user, session };
  }

  destroySession(req: Request): void {
    const sessionId = this.readSessionId(req);
    if (sessionId) this.repos.sessions.delete(sessionId);
  }

  deleteUserData(userId: string): void {
    // Cascades through sessions, oauth accounts, tokens and per-player rows.
    this.repos.users.delete(userId);
  }

  cleanupExpired(): number {
    const nowIso = new Date().toISOString();
    return this.repos.sessions.deleteExpired(nowIso);
  }
}
