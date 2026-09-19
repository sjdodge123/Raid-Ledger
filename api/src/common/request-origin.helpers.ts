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
  const proto =
    (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ||
    req.protocol ||
    'http';
  const host = req.headers.host || 'localhost';
  return `${proto}://${host}`;
}
