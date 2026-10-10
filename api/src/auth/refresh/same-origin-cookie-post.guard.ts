/**
 * ROK-1755 — defence-in-depth origin check for the cookie-bearing auth POSTs
 * (`/auth/refresh`, `/auth/logout`), independent of the global CORS policy
 * and of `CORS_AUTO_MODE` (report mode lets everything through).
 *
 * Decision table (`decideCookiePostOrigin`):
 * - `Sec-Fetch-Site: cross-site` → reject, whatever the Origin says.
 * - `Origin` present → allow only when its hostname equals the raw `Host`
 *   hostname (the CORS-auto rule, incl. dev localhost outside production), or
 *   it is the explicit `CORS_ORIGIN` (never `*`). Garbage / `null` → reject.
 * - no `Origin`: absent / `same-origin` / `none` Sec-Fetch-Site → allow
 *   (non-browser clients, older browsers); `same-site` → reject (a browser
 *   POST from a sibling host always carries an Origin, so this is forged).
 *
 * Reads the raw `Host` header only — never `req.hostname` / X-Forwarded-Host,
 * which `trust proxy` makes client-controlled (same rule as ROK-1732).
 */
import {
  ForbiddenException,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  decideAutoOrigin,
  decideExplicitOrigin,
} from '../../cors/cors-auto-decision';

export const CROSS_SITE_REJECTED_MESSAGE = 'Cross-site request rejected';

export type CookiePostReason =
  | 'cross-site'
  | 'origin-allowed'
  | 'origin-mismatch'
  | 'same-site-no-origin'
  | 'no-origin';

export interface CookiePostDecision {
  allow: boolean;
  reason: CookiePostReason;
}

export interface CookiePostInput {
  secFetchSite?: string | undefined;
  origin?: string | undefined;
  hostHeader?: string | undefined;
  corsOrigin?: string | undefined;
  isProduction: boolean;
}

/** Origin is same-host (CORS-auto rule) or the explicit, non-`*` allow-list. */
function isOriginAllowed(input: CookiePostInput, origin: string): boolean {
  const auto = decideAutoOrigin({
    origin,
    isProduction: input.isProduction,
    ...(input.hostHeader === undefined ? {} : { hostHeader: input.hostHeader }),
  });
  if (auto.allow) return true;
  const corsOrigin = input.corsOrigin;
  if (!corsOrigin || corsOrigin === 'auto' || corsOrigin === '*') return false;
  return decideExplicitOrigin({ origin, corsOrigin, isProduction: true }).allow;
}

/** Pure decision — see the file header for the table. */
export function decideCookiePostOrigin(
  input: CookiePostInput,
): CookiePostDecision {
  const site = input.secFetchSite?.trim().toLowerCase();
  if (site === 'cross-site') return { allow: false, reason: 'cross-site' };
  if (input.origin !== undefined) {
    return isOriginAllowed(input, input.origin)
      ? { allow: true, reason: 'origin-allowed' }
      : { allow: false, reason: 'origin-mismatch' };
  }
  if (site === 'same-site') {
    return { allow: false, reason: 'same-site-no-origin' };
  }
  return { allow: true, reason: 'no-origin' };
}

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(',') : value;
}

/** Rejects cross-site cookie POSTs with 403 before the handler runs. */
@Injectable()
export class SameOriginCookiePostGuard implements CanActivate {
  private readonly logger = new Logger(SameOriginCookiePostGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const decision = decideCookiePostOrigin({
      secFetchSite: header(req, 'sec-fetch-site'),
      origin: header(req, 'origin'),
      hostHeader: header(req, 'host'),
      corsOrigin: process.env.CORS_ORIGIN,
      isProduction: process.env.NODE_ENV === 'production',
    });
    if (decision.allow) return true;
    this.logger.warn(
      `ROK-1755: rejected ${req.method} ${req.path} (${decision.reason})`,
    );
    throw new ForbiddenException(CROSS_SITE_REJECTED_MESSAGE);
  }
}
