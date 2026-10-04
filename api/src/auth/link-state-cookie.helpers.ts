import * as crypto from 'crypto';
import type { Request, Response } from 'express';
import {
  LINK_REQUEST_EXPIRED_MESSAGE,
  type LinkProvider,
} from './link-nonce.service';
import { linkCookieAttrs, readCookie } from './link-nonce-cookie.helpers';

/**
 * ROK-1366 follow-up (PR #1384 review): carry the browser binding from the
 * GET /link hop through to the provider callback.
 *
 * The nonce cookie (link-nonce-cookie.helpers) only guards the GET hop. The
 * 302 it answers with carries a signed state that is good for 10 minutes, so
 * without this an attacker could start a link in their own browser, copy the
 * discord.com authorize URL (or the steamcommunity.com OpenID URL) out of the
 * 302, and send it to a victim — whose Discord/Steam account would then be
 * linked into the attacker's user.
 *
 * So the hop mints a random `r`, puts it in the signed state, and sets an
 * httpOnly cookie of sha256(r) on the same response. The callback accepts
 * the state only from the browser holding that cookie. SameSite=Lax is
 * enough: the callback is a top-level GET navigation back from discord.com /
 * steamcommunity.com, which carries Lax cookies. Path '/' for the same
 * dev-vs-prod `/api` reason as the nonce cookie.
 */

/** Matches the 10-minute signed-state age limit on both providers. */
export const LINK_STATE_TTL_MS = 10 * 60 * 1000;

export function linkStateCookieName(provider: LinkProvider): string {
  return `rl_link_state_${provider}`;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * GET /link hop, after the nonce matched: remember in this browser a fresh
 * `r` and return it for the signed state.
 */
export function bindLinkStateToBrowser(
  res: Response,
  provider: LinkProvider,
): string {
  const r = crypto.randomBytes(32).toString('base64url');
  res.cookie(linkStateCookieName(provider), sha256(r), {
    ...linkCookieAttrs(),
    maxAge: LINK_STATE_TTL_MS,
  });
  return r;
}

/** Constant-time: does this browser hold the cookie for the state's `r`? */
function stateCookieMatches(
  req: Request,
  provider: LinkProvider,
  r: unknown,
): boolean {
  if (typeof r !== 'string' || r.length === 0) return false;
  const held = readCookie(req, linkStateCookieName(provider));
  if (!held) return false;
  const want = Buffer.from(sha256(r));
  const got = Buffer.from(held);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/**
 * Provider callback: throw "Link request expired" unless this browser holds
 * the cookie minted for the state's `r` (a forwarded authorize/OpenID URL
 * arrives without it). A match clears the cookie so the state is single-use;
 * a mismatch leaves it (it may be this browser's own in-flight link).
 */
export function assertLinkStateBoundToBrowser(
  req: Request,
  res: Response,
  provider: LinkProvider,
  r: unknown,
): void {
  if (!stateCookieMatches(req, provider, r)) {
    throw new Error(LINK_REQUEST_EXPIRED_MESSAGE);
  }
  res.clearCookie(linkStateCookieName(provider), linkCookieAttrs());
}
