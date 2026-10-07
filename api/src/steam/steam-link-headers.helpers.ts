import type { Response } from 'express';

/**
 * ROK-1731: the Steam link hops carry single-use material (the link nonce,
 * the signed state, the OpenID assertion) in their URLs and bodies. Never let
 * a browser or intermediary cache them, and never leak the URL as a referrer.
 * Set explicitly on the raw response — these handlers run in `@Res()` mode.
 */
export function setNoStoreLinkHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
}
