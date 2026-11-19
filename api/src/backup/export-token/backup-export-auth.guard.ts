/**
 * ROK-2263 D4/D5 — the one gate for the three export routes (list, create,
 * download). `Bearer rlbx_…` (scheme in any case) → the token path; anything else → the session
 * JWT then `AdminGuard`, exactly as before the split (same 401 / 403).
 *
 * Token path: shape check first (malformed → 401, no DB read) → lookup by
 * sha256 → timing-safe compare → refuse revoked, expired, owner not admin,
 * owner deactivated, owner banned or in a kick cooldown. Every refusal is the
 * SAME 401 (no oracle). Attaches `req.backupExport` and NEVER `req.user`.
 * Stamps last-used at most once per 60 s and logs one line per use.
 * Never logs the header, token, hash or hint.
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { firstValueFrom, isObservable } from 'rxjs';
import { AdminGuard } from '../../auth/admin.guard';
import { isBannedOrKickCoolingDown } from '../../auth/auth-status.helpers';
import { tokenHashesEqual } from '../../common/tokens/prefixed-token.helpers';
import { coarseIp } from '../../companion/devices/companion-device-token.helpers';
import type {
  BackupExportAuth,
  BackupExportRequest,
} from './backup-export-request';
import { backupExportTokenKit } from './backup-export-token.helpers';
import {
  BackupExportTokensRepository,
  type BackupExportTokenAuthRow,
} from './backup-export-tokens.repository';

/**
 * Export-token bearers take the token path — even malformed ones (→ 401).
 * The scheme is case-insensitive (RFC 7235); the `rlbx_` prefix is exact.
 */
const BEARER_SCHEME = 'bearer ';
const TOKEN_PREFIX = 'rlbx_';

/** The session JWT strategy as an injectable guard. */
@Injectable()
export class BackupExportSessionJwtGuard extends AuthGuard('jwt') {}

type Authenticator = Pick<CanActivate, 'canActivate'>;

async function run(
  guard: Authenticator,
  ctx: ExecutionContext,
): Promise<boolean> {
  const out = guard.canActivate(ctx);
  return isObservable(out) ? firstValueFrom(out) : out;
}

/** The raw `rlbx_…` bearer value, or null when the header is not one. */
function tokenBearerOf(req: BackupExportRequest): string | null {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return null;
  const scheme = header.slice(0, BEARER_SCHEME.length).toLowerCase();
  if (scheme !== BEARER_SCHEME) return null;
  const value = header.slice(BEARER_SCHEME.length);
  return value.startsWith(TOKEN_PREFIX) ? value.trim() : null;
}

/** True when the token row (and its owner) may still export. */
function isAcceptable(row: BackupExportTokenAuthRow, hash: string): boolean {
  if (!tokenHashesEqual(row.tokenHash, hash)) return false;
  if (row.revokedAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;
  if (row.role !== 'admin' || row.deactivatedAt) return false;
  return !isBannedOrKickCoolingDown(row);
}

@Injectable()
export class BackupExportAuthGuard implements CanActivate {
  private readonly logger = new Logger(BackupExportAuthGuard.name);
  private readonly admin = new AdminGuard();

  constructor(
    private readonly repo: BackupExportTokensRepository,
    @Inject(BackupExportSessionJwtGuard)
    private readonly session: Authenticator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<BackupExportRequest>();
    const token = tokenBearerOf(req);
    if (token === null) return this.viaSession(context);
    const auth = await this.authenticate(token);
    if (auth === null) throw new UnauthorizedException();
    req.backupExport = auth;
    await this.repo.touchLastUsed(auth.tokenId, coarseIp(req.ip));
    this.logger.log(
      `backup-export token #${auth.tokenId} (owner ${auth.ownerUserId}) ${req.method} ${req.path}`,
    );
    return true;
  }

  /** Today's behaviour: JWT (401 on failure) then admin (403 for non-admins). */
  private async viaSession(context: ExecutionContext): Promise<boolean> {
    if (!(await run(this.session, context))) return false;
    return run(this.admin, context);
  }

  /** Bearer → token row → auth record, or null for every refusal. */
  private async authenticate(token: string): Promise<BackupExportAuth | null> {
    if (!backupExportTokenKit.isToken(token)) return null;
    const hash = backupExportTokenKit.hash(token);
    const row = await this.repo.findAuthByHash(hash);
    if (!row || !isAcceptable(row, hash)) return null;
    return { tokenId: row.tokenId, ownerUserId: row.ownerUserId };
  }
}
