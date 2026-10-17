import type { CookieOptions, Request } from 'express';

/**
 * ROK-1808 (Codex r2 P2): attributes for the cookies that bind a Discord
 * LOGIN to the browser — the login state cookie and `rl_auth_code`.
 *
 * `Secure` follows the request's actual scheme, not NODE_ENV. The all-in-one
 * image runs NODE_ENV=production and its documented default is plain
 * `http://<host>:8080`; a browser drops a Secure cookie set over HTTP, so a
 * NODE_ENV-keyed flag would fail every Discord login on such an install.
 * `req.secure` is true for direct TLS and, because main.ts applies
 * `trust proxy` in production, for an `X-Forwarded-Proto: https` hop (the
 * image's nginx forwards the outer proxy's value, or its own `$scheme`).
 *
 * SameSite stays Lax: the callback is a cross-site top-level GET back from
 * discord.com, which carries Lax cookies. Path '/' for the dev `/auth` vs
 * prod `/api/auth` split. Pass no `maxAgeMs` when clearing.
 */
export function browserBoundCookieAttrs(
  req: Pick<Request, 'secure'>,
  maxAgeMs?: number,
): CookieOptions {
  return {
    httpOnly: true,
    secure: req.secure === true,
    sameSite: 'lax',
    path: '/',
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
  };
}
