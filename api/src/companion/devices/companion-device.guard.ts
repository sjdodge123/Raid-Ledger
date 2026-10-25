import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { tokenHashesEqual } from '../../common/tokens/prefixed-token.helpers';
import { reserveOrThrow, type HeaderSink } from './companion-device-link-budget';
import { deviceUnauthorized } from './companion-device-link.errors';
import {
  CompanionDeviceRateLimiter,
  guardFailsPerIpLimit,
  MINUTE_MS,
} from './companion-device-link.limits';
import type {
  CompanionDeviceAuth,
  CompanionDeviceRequest,
} from './companion-device-request';
import {
  coarseIp,
  companionDeviceTokens,
} from './companion-device-token.helpers';
import { CompanionDevicesRepository } from './companion-devices.repository';

/** The raw bearer value, or null. Never logged. */
function bearerOf(req: CompanionDeviceRequest): string | null {
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

/**
 * ROK-1955 §5.3 — the scope gate for companion device routes. Accepts ONLY
 * an `rlcd_` bearer: malformed (incl. a session JWT or an `rlvl_` token) →
 * 401 with no DB read; unknown, revoked or a deactivated owner → the SAME
 * 401 `{ code: 'unauthorized' }` (no oracle). Attaches
 * `req.companionDevice` and NEVER `req.user`, so a device is never a
 * session (S-6). Pre-auth per-IP failure budget (30/min,
 * `COMPANION_DEVICE_RATE_AUTH_PER_MIN`), reserved before the lookup;
 * successes refund their slot. Stamps last-used at most once per 60 s.
 * Never logs: the header, token, hash and hint are secrets.
 */
@Injectable()
export class CompanionDeviceGuard implements CanActivate {
  constructor(
    private readonly repo: CompanionDevicesRepository,
    private readonly limiter: CompanionDeviceRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<CompanionDeviceRequest>();
    const settle = reserveOrThrow(
      this.limiter,
      http.getResponse<HeaderSink>(),
      [
        {
          key: `companion-device:auth:${req.ip ?? 'unknown'}`,
          limit: guardFailsPerIpLimit(),
          windowMs: MINUTE_MS,
        },
      ],
      'Too many failed device token attempts',
    );
    let auth: CompanionDeviceAuth | null;
    try {
      auth = await this.authenticate(req);
    } catch (err: unknown) {
      settle(false);
      throw err;
    }
    settle(auth === null);
    if (auth === null) throw deviceUnauthorized();
    req.companionDevice = auth;
    await this.repo.touchLastUsed(auth.deviceId, coarseIp(req.ip));
    return true;
  }

  /** Bearer → device row → auth record, or null for every refusal. */
  private async authenticate(
    req: CompanionDeviceRequest,
  ): Promise<CompanionDeviceAuth | null> {
    const token = bearerOf(req);
    if (token === null || !companionDeviceTokens.isToken(token)) return null;
    const hash = companionDeviceTokens.hash(token);
    const row = await this.repo.findByHash(hash);
    if (!row || !tokenHashesEqual(row.tokenHash, hash)) return null;
    if (row.revokedAt || row.deactivatedAt) return null;
    return { deviceId: row.deviceId, tokenHash: row.tokenHash, userId: row.userId };
  }
}
