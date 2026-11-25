import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { z } from 'zod';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  SIGNIN_CODE_TTL_SECONDS,
  approvalKey,
  claimKey,
  codeKey,
  deviceKey,
  generateSigninCode,
  hashDeviceSecret,
} from './signin-code.helpers';

/** What the bot stores when a member confirms a code (ROK-2370). */
export interface SigninCodeApproval {
  /** `existing` = a magic-link token; `first-time` = a discord-signin token. */
  kind: 'existing' | 'first-time';
  /** The one-time link token the poll redeems. Never sent to the page. */
  token: string;
  /** Who is signing in — display only. */
  displayName: string;
}

/** A code still waiting for its member. */
export interface PendingSigninCode {
  code: string;
  expiresAt: Date;
}

/** What a poll finds for its device secret. */
export type SigninCodeTake =
  | { status: 'pending'; expiresAt: Date }
  | { status: 'expired' }
  | { status: 'approved'; approval: SigninCodeApproval };

/** The pending record; anything else read back from Redis is expired. */
const CodeRecordSchema = z.object({
  secretHash: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
});
type CodeRecord = z.infer<typeof CodeRecordSchema>;

const SigninCodeApprovalSchema = z.object({
  kind: z.enum(['existing', 'first-time']),
  token: z.string().min(1),
  displayName: z.string(),
});

const CREATE_ATTEMPTS = 5;

/**
 * ROK-2370: Redis-only store for sign-in codes. Four keys per code, all
 * expiring with it: the pending record, the device index (secret hash → code),
 * the approval and the claim. Each state change is ONE atomic `SET NX`:
 * the approval (only the first approve lands) and the claim (only one poll
 * collects it). Neither is deleted on collection — they stay as the code's
 * tombstone until expiry, so a confirmation or poll that read the code just
 * before it was collected cannot approve or collect it a second time
 * (Codex P2). Only a hash of the device secret is stored.
 */
@Injectable()
export class SigninCodeStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Register a fresh code for `deviceSecret`; retries on a code collision. */
  async create(deviceSecret: string): Promise<PendingSigninCode> {
    const secretHash = hashDeviceSecret(deviceSecret);
    const now = Date.now();
    const expiresAt = now + SIGNIN_CODE_TTL_SECONDS * 1000;
    const record: CodeRecord = { secretHash, createdAt: now, expiresAt };
    for (let i = 0; i < CREATE_ATTEMPTS; i += 1) {
      const code = generateSigninCode();
      const set = await this.redis.set(
        codeKey(code),
        JSON.stringify(record),
        'PX',
        expiresAt - now,
        'NX',
      );
      if (set !== 'OK') continue;
      await this.redis.set(deviceKey(secretHash), code, 'PX', expiresAt - now);
      return { code, expiresAt: new Date(expiresAt) };
    }
    throw new Error('Could not allocate a sign-in code');
  }

  /** The code if it is live and not yet approved; null otherwise. */
  async findPending(code: string): Promise<PendingSigninCode | null> {
    const record = await this.readRecord(code);
    if (!record) return null;
    if ((await this.redis.exists(approvalKey(code))) > 0) return null;
    return { code, expiresAt: new Date(record.expiresAt) };
  }

  /**
   * Attach `approval` to a pending code. True only for the first approve of
   * a live code; a second approve, or one after expiry, is false.
   */
  async approve(code: string, approval: SigninCodeApproval): Promise<boolean> {
    const record = await this.readRecord(code);
    if (!record) return false;
    const ttlMs = record.expiresAt - Date.now();
    if (ttlMs <= 0) return false;
    const set = await this.redis.set(
      approvalKey(code),
      JSON.stringify(approval),
      'PX',
      ttlMs,
      'NX',
    );
    return set === 'OK';
  }

  /**
   * A poll: pending, expired (unknown secret, gone, corrupt or already
   * taken) or the approval — handed out once, to the poll that wins the
   * claim. The approval key is never freed early, so it cannot be re-set.
   */
  async takeBySecret(deviceSecret: string): Promise<SigninCodeTake> {
    const devKey = deviceKey(hashDeviceSecret(deviceSecret));
    const code = await this.redis.get(devKey);
    if (!code) return { status: 'expired' };
    const raw = await this.redis.get(approvalKey(code));
    if (raw) return this.claim(code, devKey, raw);
    const record = await this.readRecord(code);
    if (!record) return { status: 'expired' };
    return { status: 'pending', expiresAt: new Date(record.expiresAt) };
  }

  private async claim(
    code: string,
    devKey: string,
    raw: string,
  ): Promise<SigninCodeTake> {
    const ttlMs = SIGNIN_CODE_TTL_SECONDS * 1000;
    const won = await this.redis.set(claimKey(code), '1', 'PX', ttlMs, 'NX');
    if (won !== 'OK') return { status: 'expired' };
    await this.redis.del(devKey);
    const approval = parseJson(SigninCodeApprovalSchema, raw);
    return approval ? { status: 'approved', approval } : { status: 'expired' };
  }

  private async readRecord(code: string): Promise<CodeRecord | null> {
    const raw = await this.redis.get(codeKey(code));
    if (!raw) return null;
    const record = parseJson(CodeRecordSchema, raw);
    return record && record.expiresAt > Date.now() ? record : null;
  }
}

/** Parse a Redis value against `schema`; malformed or old-shape → null. */
function parseJson<T>(schema: z.ZodType<T>, raw: string): T | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
