import type { Request, Response } from 'express';

/**
 * ROK-1353: httpOnly refresh-token cookie helpers.
 *
 * The raw refresh token lives ONLY in this cookie (httpOnly so JS can never
 * read it); the server stores just its SHA-256 hash. Cookie `path: '/'` —
 * there is no `setGlobalPrefix('api')` in main.ts and no vite dev proxy, so
 * the browser-visible request path differs between dev (`/auth/refresh`) and
 * prod (`/api/auth/refresh`, nginx strips `/api/`). A root path matches both
 * topologies; httpOnly + sameSite already protect it (architect §3).
 */
export const REFRESH_COOKIE_NAME = 'rl_rt';

/** Whether we're running in production (drives secure + sameSite). */
function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Set the refresh cookie. `maxAgeMs` is the configured session length so the
 * cookie's lifetime tracks the DB row's `expires_at`.
 */
export function setRefreshCookie(
  res: Response,
  rawToken: string,
  maxAgeMs: number,
): void {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: isProd(),
    sameSite: isProd() ? 'strict' : 'lax',
    path: '/',
    maxAge: maxAgeMs,
  });
}

/**
 * Read the raw `rl_rt` cookie. Prefers cookie-parser's `req.cookies` (prod),
 * falling back to parsing the raw `Cookie` header — the NestJS test app boots
 * via `createNestApplication()` and never runs main.ts's `cookieParser()`
 * middleware, so `req.cookies` is undefined there.
 */
export function readRefreshCookie(req: Request): string | null {
  const parsed = (req.cookies ?? {}) as Record<string, unknown>;
  const fromParser = parsed[REFRESH_COOKIE_NAME];
  if (typeof fromParser === 'string') return fromParser;
  const header = req.headers?.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === REFRESH_COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Clear the refresh cookie (logout). Mirrors the set attrs so the browser
 * matches and drops it. */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd(),
    sameSite: isProd() ? 'strict' : 'lax',
    path: '/',
  });
}
