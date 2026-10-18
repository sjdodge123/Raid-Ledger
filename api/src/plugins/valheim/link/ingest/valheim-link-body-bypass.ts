import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Path prefix of every Valheim Link ingest route (no global API prefix). */
export const VALHEIM_LINK_PATH_PREFIX = '/plugins/valheim/link/';

/** Where the bypass parks the original `Content-Type` for the bounded reader. */
export const VALHEIM_LINK_CONTENT_TYPE = 'valheimLinkContentType';

/** A request the bypass ran on. */
export interface ValheimLinkBypassedRequest {
  headers: Record<string, string | string[] | undefined>;
  [VALHEIM_LINK_CONTENT_TYPE]?: string;
}

/**
 * ROK-1833: keep the global JSON / urlencoded parsers (2 MiB) off the Valheim
 * Link routes so the kind's CONTRACT §7 cap governs. body-parser 2 has no
 * skip flag; it only parses a body whose `Content-Type` it recognises, so this
 * moves the header onto the request object. The route reads the stream itself
 * after its guards (`readBoundedBody`). Every other path is untouched.
 */
export function valheimLinkBodyBypass(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // Express routing is case-insensitive, so the match must be too.
  if (req.path.toLowerCase().startsWith(VALHEIM_LINK_PATH_PREFIX)) {
    const bypassed = req as ValheimLinkBypassedRequest;
    const type = req.headers['content-type'];
    if (typeof type === 'string') bypassed[VALHEIM_LINK_CONTENT_TYPE] = type;
    delete req.headers['content-type'];
  }
  next();
}

/** Register the bypass — BEFORE any body parser (main.ts + the test app). */
export function installValheimLinkBodyBypass(app: {
  use: (handler: RequestHandler) => unknown;
}): void {
  app.use(valheimLinkBodyBypass);
}
