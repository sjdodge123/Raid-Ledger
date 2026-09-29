import * as crypto from 'crypto';
import type { CookieOptions, Request, Response } from 'express';
import {
  LINK_NONCE_TTL_SECONDS,
  type LinkNonceClaims,
  type LinkNonceService,
  type LinkProvider,
} from './link-nonce.service';

/**
 * ROK-1366 follow-up (PR #1384 review): bind a link nonce to the browser that
 * minted it. POST /auth/{provider}/link/start sets an httpOnly cookie holding
 * sha256(nonce); GET /auth/{provider}/link consumes the nonce ONLY when that
 * cookie matches. A nonce forwarded to another browser arrives without the
 * cookie and takes the same "Link request expired" 302 as a replay — so a
 * victim who opens an attacker's link cannot complete a link into the
 * attacker's account.
 *
 * `path: '/'`, not the link routes: there is no global `/api` prefix, so the
 * browser-visible path is `/auth/...` in dev and `/api/auth/...` in prod
 * (nginx strips `/api/`). Same trade-off as the `rl_rt` refresh cookie. The
 * cookie is httpOnly, lives 120s and is cleared on use.
 *
 * SameSite=Lax: the GET hop is a top-level navigation from the SPA, so a Lax
 * cookie rides it; a cross-site subresource or POST never carries it.
 */
export function linkNonceCookieName(provider: LinkProvider): string {
  return `rl_link_${provider}`;
}

function hashNonce(nonce: string): string {
  return crypto.createHash('sha256').update(nonce).digest('hex');
}

/** Shared by the nonce cookie and the state cookie (link-state-cookie.helpers). */
export function linkCookieAttrs(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

/** POST /link/start: remember this browser minted `nonce`. */
export function setLinkNonceCookie(
  res: Response,
  provider: LinkProvider,
  nonce: string,
): void {
  res.cookie(linkNonceCookieName(provider), hashNonce(nonce), {
    ...linkCookieAttrs(),
    maxAge: LINK_NONCE_TTL_SECONDS * 1000,
  });
}

/**
 * Read a cookie. Prefers cookie-parser's `req.cookies` (main.ts), falling
 * back to the raw header — the integration test app never runs main.ts.
 */
export function readCookie(req: Request, name: string): string | null {
  const parsed = (req.cookies ?? {}) as Record<string, unknown>;
  if (typeof parsed[name] === 'string') return parsed[name];
  const header = req.headers?.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Constant-time: does this browser hold the cookie for `nonce`? */
function cookieMatches(
  req: Request,
  provider: LinkProvider,
  nonce: string,
): boolean {
  const held = readCookie(req, linkNonceCookieName(provider));
  if (!held) return false;
  const want = Buffer.from(hashNonce(nonce));
  const got = Buffer.from(held);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/**
 * GET /link hop: consume the nonce only for the browser that minted it.
 * Returns null on EVERY miss (no/mismatched cookie, or any nonce miss) so the
 * caller answers them all with the one "Link request expired" 302. A matched
 * cookie is cleared before the nonce is consumed; a mismatched one is left
 * alone (it may belong to this browser's own in-flight link).
 */
export async function consumeBrowserBoundNonce(
  linkNonceService: LinkNonceService,
  provider: LinkProvider,
  nonce: string | undefined,
  req: Request,
  res: Response,
): Promise<LinkNonceClaims | null> {
  if (!nonce || !cookieMatches(req, provider, nonce)) return null;
  res.clearCookie(linkNonceCookieName(provider), linkCookieAttrs());
  return linkNonceService.consume(provider, nonce);
}
