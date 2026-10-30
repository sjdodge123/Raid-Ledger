/**
 * ROK-1701: claim an unclaimed (cloud) instance with its setup code. Checks
 * run in the spec's order, each a distinct error; the consume is one
 * transaction (FOR UPDATE on the claim rows → a racing second claimer gets
 * 409). The plaintext code and password are never logged or stored.
 */
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as bcrypt from 'bcrypt';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { isCloudFlavour } from '../common/flavour/flavour';
import { revokeAllAndBumpTx } from '../auth/refresh/refresh-rotation.helpers';
import { invalidateAuthUser } from '../auth/auth-user-cache';
import { isClaimExpired, verifyClaimCode } from './claim-code.helpers';
import {
  isClaimRequired,
  markClaimed,
  readClaimState,
  type ClaimDb,
  type ClaimState,
} from './claim-state.repository';
import { setAdminPasswordHash } from './claim-admin.repository';
import { ClaimLockService } from './claim-lock.service';
import { SetupClaimException } from './setup-claim.errors';
import {
  SETUP_CLAIM_EVENTS,
  type SetupClaimedPayload,
} from './setup-claim.events';

const CLAIM_BCRYPT_ROUNDS = 12;

export interface ClaimAttempt {
  code: string;
  newPassword: string;
  /** The request's external protocol (`getRequestOrigin`, D-12). */
  protocol: 'http' | 'https';
}

export interface PublicClaimStatus {
  claimRequired: boolean;
  claimExpiresAt?: string;
}

type ClaimedUser = typeof schema.users.$inferSelect;

@Injectable()
export class SetupClaimService {
  private readonly logger = new Logger(SetupClaimService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly lock: ClaimLockService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * For `GET /system/status`: never the code, only whether one is armed.
   * A NAS without DEMO_MODE never arms (only cloud bootstrap does), so it
   * skips the read + decrypt. DEMO_MODE keeps the read: the D-9 fixture arms
   * a claim on (non-cloud) test envs (D-7).
   */
  async publicStatus(): Promise<PublicClaimStatus> {
    if (!isCloudFlavour() && process.env.DEMO_MODE !== 'true') {
      return { claimRequired: false };
    }
    const state = await readClaimState(this.db);
    if (!isClaimRequired(state)) return { claimRequired: false };
    return state.expiresAt
      ? { claimRequired: true, claimExpiresAt: state.expiresAt.toISOString() }
      : { claimRequired: true };
  }

  /** Claim the instance; returns admin@local (bumped token version). */
  async claim(attempt: ClaimAttempt, now = new Date()): Promise<ClaimedUser> {
    this.assertClaimable(await readClaimState(this.db), attempt, now);
    const user = await this.consume(attempt, now);
    invalidateAuthUser(user.id);
    const payload: SetupClaimedPayload = {
      userId: user.id,
      claimedAt: now.toISOString(),
    };
    this.events.emit(SETUP_CLAIM_EVENTS.CLAIMED, payload);
    this.logger.log('setup-claim: instance claimed');
    return user;
  }

  /** Spec steps 2–6, in order. Only a wrong code counts toward the lock. */
  private assertClaimable(
    state: ClaimState,
    attempt: ClaimAttempt,
    now: Date,
  ): void {
    if (!isClaimRequired(state)) {
      throw new SetupClaimException('claim_not_available');
    }
    if (isCloudFlavour() && attempt.protocol !== 'https') {
      throw new SetupClaimException('claim_https_required');
    }
    const lockedUntil = this.lock.lockedUntil();
    if (lockedUntil) throw new SetupClaimException('claim_locked', lockedUntil);
    // A hash with no expiry is malformed → treat as expired (fail closed).
    if (state.expiresAt === null || isClaimExpired(state.expiresAt, now)) {
      throw new SetupClaimException('claim_expired');
    }
    if (!verifyClaimCode(attempt.code, state.codeHash)) {
      this.lock.recordFailure();
      throw new SetupClaimException('claim_code_invalid');
    }
  }

  /** Step 7: password + revoke + claimed_at in ONE transaction. */
  private async consume(
    attempt: ClaimAttempt,
    now: Date,
  ): Promise<ClaimedUser> {
    // Hash outside the tx so the row lock is not held for ~250 ms of bcrypt.
    const hash = await bcrypt.hash(attempt.newPassword, CLAIM_BCRYPT_ROUNDS);
    return this.db.transaction(async (tx) => {
      const locked = await readClaimState(tx, { forUpdate: true });
      if (
        !isClaimRequired(locked) ||
        !verifyClaimCode(attempt.code, locked.codeHash)
      ) {
        throw new SetupClaimException('claim_not_available');
      }
      const userId = await setAdminPasswordHash(tx, hash);
      if (userId === null) {
        throw new InternalServerErrorException('Claim account is missing');
      }
      await revokeAllAndBumpTx(tx, userId);
      await markClaimed(tx, now);
      return readUser(tx, userId);
    });
  }
}

async function readUser(db: ClaimDb, userId: number): Promise<ClaimedUser> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) throw new InternalServerErrorException('Claim account is missing');
  return user;
}
