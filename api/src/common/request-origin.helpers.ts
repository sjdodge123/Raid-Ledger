/**
 * Request-local origin derivation (ROK-1627).
 *
 * The value returned here comes from the caller's own headers, so it is
 * trusted for nothing beyond the response to that same request: never store
 * it in `process.env`, a module variable or a cache, and never use it to
 * build a link that is sent to anybody else.
 */
import type { Request } from 'express';

/** Derive the external origin of a single request from its headers. */
export function getRequestOrigin(req: Request): string {
  // The forwarded proto is a request header: anything but http/https is
  // ignored, so it can never put another scheme into a link this builds.
  const forwarded = (req.headers['x-forwarded-proto'] as string | undefined)
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  const proto =
    forwarded === 'http' || forwarded === 'https'
      ? forwarded
      : req.protocol === 'https'
        ? 'https'
        : 'http';
  const host = req.headers.host || 'localhost';
  return `${proto}://${host}`;
}
