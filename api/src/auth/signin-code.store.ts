import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  SIGNIN_CODE_TTL_SECONDS,
  approvalKey,
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

interface CodeRecord {
  secretHash: string;
  createdAt: number;
  expiresAt: number;
}

const CREATE_ATTEMPTS = 5;

/**
 * ROK-2370: Redis-only store for sign-in codes. Three keys per code, all
 * expiring with it: the pending record, the device index (secret hash → code)
 * and the approval. The approval is written with ONE `SET NX` (atomic,
 * single-use: only the first approve lands) and read back with ONE `GETDEL`
 * (atomic, single-use: only one poll takes it). Only a hash of the device
 * secret is stored.
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
   * A poll: pending, expired (unknown secret, gone, or already taken) or the
   * approval — handed out once, after which the code is gone.
   */
  async takeBySecret(deviceSecret: string): Promise<SigninCodeTake> {
    const devKey = deviceKey(hashDeviceSecret(deviceSecret));
    const code = await this.redis.get(devKey);
    if (!code) return { status: 'expired' };
    const raw = await this.redis.getdel(approvalKey(code));
    if (raw) {
      await this.redis.del(devKey, codeKey(code));
      return { status: 'approved', approval: parseApproval(raw) };
    }
    const record = await this.readRecord(code);
    if (!record) return { status: 'expired' };
    return { status: 'pending', expiresAt: new Date(record.expiresAt) };
  }

  private async readRecord(code: string): Promise<CodeRecord | null> {
    const raw = await this.redis.get(codeKey(code));
    if (!raw) return null;
    const record = JSON.parse(raw) as CodeRecord;
    return record.expiresAt > Date.now() ? record : null;
  }
}

function parseApproval(raw: string): SigninCodeApproval {
  return JSON.parse(raw) as SigninCodeApproval;
}
