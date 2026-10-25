/**
 * ROK-1955: device-row queries for the guard and the Devices API. Every
 * owner-scoped write is ONE conditional UPDATE (`WHERE id AND user_id AND
 * revoked_at IS NULL`) — another user's id or a revoked row returns no row,
 * which the service answers with one 404. Nothing here catches and retries.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { CompanionDeviceRow } from './companion-device-dto.helpers';

type Db = PostgresJsDatabase<typeof schema>;
const devices = schema.companionDevices;
const users = schema.users;

/** Revoked devices stay listed ("Removed") this long (D-12). */
export const REVOKED_LISTED_DAYS = 30;
/** `last_used_at` moves at most once per this many seconds (§5.3). */
export const TOUCH_INTERVAL_SEC = 60;

/** What the guard needs to accept or refuse a bearer. */
export interface DeviceAuthRow {
  deviceId: number;
  userId: number;
  tokenHash: string;
  revokedAt: Date | null;
  deactivatedAt: Date | null;
}

@Injectable()
export class CompanionDevicesRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** The device for a token hash, joined to its owner's deactivation. */
  async findByHash(tokenHash: string): Promise<DeviceAuthRow | null> {
    const [row] = await this.db
      .select({
        deviceId: devices.id,
        userId: devices.userId,
        tokenHash: devices.tokenHash,
        revokedAt: devices.revokedAt,
        deactivatedAt: users.deactivatedAt,
      })
      .from(devices)
      .innerJoin(users, eq(users.id, devices.userId))
      .where(eq(devices.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  /** Stamp last-used (coarse network only), at most once per interval. */
  async touchLastUsed(deviceId: number, network: string | null): Promise<void> {
    const stale = sql`now() - make_interval(secs => ${TOUCH_INTERVAL_SEC})`;
    await this.db
      .update(devices)
      .set({ lastUsedAt: sql`now()`, lastUsedIpCoarse: network })
      .where(
        and(
          eq(devices.id, deviceId),
          or(isNull(devices.lastUsedAt), sql`${devices.lastUsedAt} < ${stale}`),
        ),
      );
  }

  /** One device by id (the self route). */
  async findById(deviceId: number): Promise<CompanionDeviceRow | null> {
    const [row] = await this.db
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);
    return row ?? null;
  }

  /** The owner's devices: live first, then revoked within 30 days. */
  async listForUser(userId: number): Promise<CompanionDeviceRow[]> {
    const cutoff = sql`now() - make_interval(days => ${REVOKED_LISTED_DAYS})`;
    return this.db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.userId, userId),
          or(isNull(devices.revokedAt), gt(devices.revokedAt, cutoff)),
        ),
      )
      .orderBy(sql`${devices.revokedAt} is not null`, desc(devices.createdAt));
  }

  /** Rename a live device the user owns; null when not theirs / revoked. */
  async rename(
    userId: number,
    deviceId: number,
    name: string,
  ): Promise<CompanionDeviceRow | null> {
    const [row] = await this.db
      .update(devices)
      .set({ name })
      .where(ownedLive(userId, deviceId))
      .returning();
    return row ?? null;
  }

  /** Soft-revoke (stamps `revoked_at`); false when not theirs / revoked. */
  async revoke(userId: number, deviceId: number): Promise<boolean> {
    const rows = await this.db
      .update(devices)
      .set({ revokedAt: sql`now()` })
      .where(ownedLive(userId, deviceId))
      .returning({ id: devices.id });
    return rows.length > 0;
  }
}

/** `id = $ AND user_id = $ AND revoked_at IS NULL`. */
function ownedLive(userId: number, deviceId: number) {
  return and(
    eq(devices.id, deviceId),
    eq(devices.userId, userId),
    isNull(devices.revokedAt),
  );
}
