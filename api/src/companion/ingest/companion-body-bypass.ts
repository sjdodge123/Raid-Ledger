import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Path prefixes of the companion routes that read their own body (no global
 * API prefix). Deliberately NOT `/companion/v1/` as a whole: the device-link
 * and Devices API routes still take ordinary JSON bodies.
 */
export const COMPANION_BODY_BYPASS_PREFIXES: readonly string[] = Object.freeze([
  '/companion/v1/messages/',
  '/companion/v1/blobs/',
]);

/** Where the bypass parks the original `Content-Type` for the bounded reader. */
export const COMPANION_CONTENT_TYPE = 'companionContentType';

/** A request the bypass ran on. */
export interface CompanionBypassedRequest {
  headers: Record<string, string | string[] | undefined>;
  [COMPANION_CONTENT_TYPE]?: string;
}

/** True for a path the companion routes read themselves (case-insensitive). */
export function isCompanionBodyRoute(path: string): boolean {
  const lower = path.toLowerCase();
  return COMPANION_BODY_BYPASS_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * ROK-1956 §4: keep the global JSON / urlencoded parsers (2 MiB) off the
 * companion ingest + blob routes so the bounded reader enforces the 256 KiB
 * message cap BEFORE anything is parsed. body-parser only parses a body whose
 * `Content-Type` it recognises, so this moves the header onto the request
 * object (`readBoundedBody`'s `rawContentType`). Every other path, including
 * the other `/companion/v1/` routes, is untouched.
 */
export function companionBodyBypass(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (isCompanionBodyRoute(req.path)) {
    const bypassed = req as CompanionBypassedRequest;
    const type = req.headers['content-type'];
    if (typeof type === 'string') bypassed[COMPANION_CONTENT_TYPE] = type;
    delete req.headers['content-type'];
  }
  next();
}

/** Register the bypass — BEFORE any body parser (main.ts + the test app). */
export function installCompanionBodyBypass(app: {
  use: (handler: RequestHandler) => unknown;
}): void {
  app.use(companionBodyBypass);
}
