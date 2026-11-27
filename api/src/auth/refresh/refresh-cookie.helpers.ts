import type { CookieOptions, Request, Response } from 'express';
import { isSecureRequest } from '../browser-bound-cookie.helpers';

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

/**
 * Attributes shared by set and clear (they must match or the browser keeps
 * the cookie). ROK-2322: `Secure` follows the request's scheme
 * (`isSecureRequest` — direct TLS, or a trusted proxy's
 * `X-Forwarded-Proto: https`), not NODE_ENV: the all-in-one image runs
 * NODE_ENV=production on plain `http://<host>:8080`, where a Secure cookie
 * never sticks. SameSite stays Strict in production and Lax in dev, as
 * before — never None, which would need Secure. `res.req` is the request
 * Express pairs with every response.
 */
function refreshCookieAttrs(res: Response): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecureRequest(res.req),
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/',
  };
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
    ...refreshCookieAttrs(res),
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
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieAttrs(res));
}
