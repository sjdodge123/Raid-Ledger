/**
 * ROK-1956 D-17 — the one auth gate for the companion ingest + blob routes.
 * `Bearer rlcd_…` → C2's `CompanionDeviceGuard` (its own 401 / pre-auth 429,
 * never `req.user`); anything else → the session JWT strategy. Either way it
 * attaches `req.companionIngest` (no token). Every refusal answers the
 * companion 401 `{ code: 'unauthorized' }`; whether a session may reach a
 * given contract is the handler's opt-in (`CompanionHandlerRegistry.resolve`).
 * Never logs: the header and the token are secrets.
 */
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';
import { CompanionDeviceGuard } from '../devices/companion-device.guard';
import { companionUnauthorized } from './companion-ingest.errors';
import type {
  CompanionIngestAuth,
  CompanionIngestRequest,
} from './companion-ingest-request';

/** Device bearers route to the device guard — even malformed ones (counted there). */
const DEVICE_BEARER_PREFIX = 'Bearer rlcd_';

/** The session JWT strategy as a guard (L3's module provides it). */
@Injectable()
export class CompanionSessionJwtGuard extends AuthGuard('jwt') {}

type Authenticator = Pick<CanActivate, 'canActivate'>;

/** True when the request carries a device bearer. */
function isDeviceBearer(req: CompanionIngestRequest): boolean {
  const header = req.headers['authorization'];
  return typeof header === 'string' && header.startsWith(DEVICE_BEARER_PREFIX);
}

/** The session user passport attached, if it may ingest; else null. */
function sessionUserIdOf(req: CompanionIngestRequest): number | null {
  const user: unknown = (req as { user?: unknown }).user;
  if (typeof user !== 'object' || user === null) return null;
  if (!('id' in user) || typeof user.id !== 'number') return null;
  // A deactivated user cannot write (NotDeactivatedGuard precedent); an
  // impersonating admin must not upload as the target.
  if ('deactivatedAt' in user && user.deactivatedAt) return null;
  if ('impersonatedBy' in user && user.impersonatedBy) return null;
  return user.id;
}

async function run(
  guard: Authenticator,
  ctx: ExecutionContext,
): Promise<boolean> {
  const out = guard.canActivate(ctx);
  return isObservable(out) ? firstValueFrom(out) : out;
}

/** 401 / 403 from passport or the strategy → the companion 401; others rethrow. */
function isAuthRefusal(err: unknown): boolean {
  if (!(err instanceof HttpException)) return false;
  const status = err.getStatus();
  return status === 401 || status === 403;
}

@Injectable()
export class CompanionIngestAuthGuard implements CanActivate {
  constructor(
    private readonly device: CompanionDeviceGuard,
    @Inject(CompanionSessionJwtGuard)
    private readonly session: Authenticator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CompanionIngestRequest>();
    req.companionIngest = isDeviceBearer(req)
      ? await this.viaDevice(context, req)
      : await this.viaSession(context, req);
    return true;
  }

  private async viaDevice(
    context: ExecutionContext,
    req: CompanionIngestRequest,
  ): Promise<CompanionIngestAuth> {
    // Throws its own companion 401 / 429; on success sets companionDevice.
    await this.device.canActivate(context);
    const auth = req.companionDevice;
    if (!auth) throw companionUnauthorized();
    const { userId, deviceId, tokenHash } = auth;
    return { userId, via: 'device', deviceId, tokenHash };
  }

  private async viaSession(
    context: ExecutionContext,
    req: CompanionIngestRequest,
  ): Promise<CompanionIngestAuth> {
    let ok: boolean;
    try {
      ok = await run(this.session, context);
    } catch (err: unknown) {
      if (isAuthRefusal(err)) throw companionUnauthorized();
      throw err;
    }
    const userId = ok ? sessionUserIdOf(req) : null;
    if (userId === null) throw companionUnauthorized();
    return { userId, via: 'session', deviceId: null, tokenHash: null };
  }
}
