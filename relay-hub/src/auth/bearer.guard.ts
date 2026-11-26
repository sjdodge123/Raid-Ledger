import * as crypto from 'crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { z } from 'zod';
import { hubError, type HubHttpException } from '../common/hub-errors';
import type { HubInstanceStatus } from '../drizzle/schema';
import { InstancesRepository } from '../instances/instances.repository';
import { hashToken, TOKEN_PATTERN } from '../instances/tokens';

/** The authenticated instance a guarded handler receives (ROK-1672). */
export interface HubAuth {
  readonly instanceId: string;
  /** Hash of the token this request presented (equal to the stored one). */
  readonly tokenHash: string;
  readonly status: HubInstanceStatus;
  /** `reader` until approved, then `contributor` (ROK-1674 ContributorGuard). */
  readonly trustTier: string;
}

/** The request slice the guard reads, plus what it attaches. */
export interface HubAuthedRequest {
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly headers: { readonly authorization?: string | undefined };
  hubInstance?: HubAuth;
}

const BEARER = /^Bearer (\S+)$/;
const isUuid = (id: string): boolean => z.uuid().safeParse(id).success;
/** The generic L2 401 body; shared so the guard and the routes cannot drift. */
export const invalidToken = (): HubHttpException =>
  hubError(401, 'unknown', 'invalid_token');

/** Constant-time compare of two hex hashes; a length mismatch is just false. */
function hashesMatch(stored: string, presented: string): boolean {
  const a = Buffer.from(stored, 'hex');
  const b = Buffer.from(presented, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Which row a request's token is checked against: the path `:id` (a UUID)
 * when the route has one; the token's own hash only when the route has no
 * params at all; `null` (fail closed) for any other param shape.
 */
function lookupMode(
  params: HubAuthedRequest['params'],
): { readonly id: string } | 'token' | null {
  const id = params['id'];
  if (id !== undefined) return isUuid(id) ? { id } : null;
  return Object.keys(params).length === 0 ? 'token' : null;
}

/**
 * L1/L2 (ROK-1672): an `rlh_` bearer token is valid only for the instance in
 * the path `:id`. Only a route with NO params at all (ROK-1674
 * `crosswalk/contributions`) finds the instance by the token's hash
 * (`token_hash` is unique); any other param shape fails closed.
 * A revoked instance answers `revoked` only to its own token; every other
 * failure is the same generic 401. Logs nothing.
 */
@Injectable()
export class HubBearerGuard implements CanActivate {
  constructor(private readonly repo: InstancesRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<HubAuthedRequest>();
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
    const mode = lookupMode(req.params);
    if (!token || !TOKEN_PATTERN.test(token) || mode === null) {
      throw invalidToken();
    }
    const tokenHash = hashToken(token);
    const row =
      mode === 'token'
        ? await this.repo.findByTokenHash(tokenHash)
        : await this.repo.findById(mode.id);
    if (!row?.tokenHash || !hashesMatch(row.tokenHash, tokenHash)) {
      throw invalidToken();
    }
    if (row.status === 'revoked') throw hubError(401, 'revoked');
    req.hubInstance = {
      instanceId: row.instanceId,
      tokenHash,
      status: row.status,
      trustTier: row.trustTier,
    };
    return true;
  }
}
