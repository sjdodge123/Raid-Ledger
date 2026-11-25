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
 * L1/L2 (ROK-1672): an `rlh_` bearer token is valid only for the instance in
 * the path `:id`. A revoked instance answers `revoked` only to its own token;
 * every other failure is the same generic 401. Logs nothing.
 */
@Injectable()
export class HubBearerGuard implements CanActivate {
  constructor(private readonly repo: InstancesRepository) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<HubAuthedRequest>();
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
    const id = req.params['id'];
    if (!token || !TOKEN_PATTERN.test(token) || !id || !isUuid(id)) {
      throw invalidToken();
    }
    const row = await this.repo.findById(id);
    const tokenHash = hashToken(token);
    if (!row?.tokenHash || !hashesMatch(row.tokenHash, tokenHash)) {
      throw invalidToken();
    }
    if (row.status === 'revoked') throw hubError(401, 'revoked');
    req.hubInstance = { instanceId: id, tokenHash, status: row.status };
    return true;
  }
}
