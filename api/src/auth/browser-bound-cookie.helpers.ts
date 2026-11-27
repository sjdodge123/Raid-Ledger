import type { CookieOptions, Request } from 'express';
import { originOf } from '../settings/client-url.helpers';

/**
 * ROK-2322 review MAJOR-1: true when the deployment declares itself HTTPS —
 * the trusted `CLIENT_URL` (seeded at boot from deployer configuration by
 * ClientUrlSeederService, ROK-1627, never from a request header) is an
 * `https:` URL. Read per call: the seeder writes `process.env` after boot.
 */
export function configuredClientUrlIsHttps(): boolean {
  return originOf(process.env.CLIENT_URL)?.startsWith('https:') === true;
}

/**
 * ROK-2322: the one scheme check every auth cookie's `Secure` flag uses
 * (`rl_rt`, the link nonce/state cookies, the BNet probe cookie, the Discord
 * login cookies), so set and clear always agree.
 *
 * Secure when the request is secure OR the configured client URL is https.
 * Express derives `req.secure` from the socket, or — only when the hop is
 * covered by `trust proxy` (production, main.ts `applyTrustProxy`) — from
 * `X-Forwarded-Proto`; an untrusted hop's header is ignored. The CLIENT_URL
 * arm fails closed: an https deployment keeps Secure even if a proxy hop
 * drops `X-Forwarded-Proto` or a `TRUST_PROXY` override leaves loopback out.
 * A plain-HTTP install (http CLIENT_URL, http request) stays non-Secure, so
 * its cookies still stick. A missing request falls back to the CLIENT_URL
 * rule alone.
 */
export function isSecureRequest(
  req: Pick<Request, 'secure'> | undefined,
): boolean {
  return req?.secure === true || configuredClientUrlIsHttps();
}

/**
 * ROK-1808 (Codex r2 P2): attributes for the cookies that bind a Discord
 * LOGIN to the browser — the login state cookie and `rl_auth_code`.
 *
 * `Secure` follows `isSecureRequest`, not NODE_ENV. The all-in-one image runs
 * NODE_ENV=production and its documented default is plain
 * `http://<host>:8080`; a browser drops a Secure cookie set over HTTP, so a
 * NODE_ENV-keyed flag would fail every Discord login on such an install.
 *
 * SameSite stays Lax (never None, which would need Secure): the callback is a
 * cross-site top-level GET back from discord.com, which carries Lax cookies.
 * Path '/' for the dev `/auth` vs prod `/api/auth` split. Pass no `maxAgeMs`
 * when clearing.
 */
export function browserBoundCookieAttrs(
  req: Pick<Request, 'secure'> | undefined,
  maxAgeMs?: number,
): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecureRequest(req),
    sameSite: 'lax',
    path: '/',
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
  };
}
