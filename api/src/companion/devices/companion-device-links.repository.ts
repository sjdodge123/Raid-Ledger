/**
 * ROK-1955: link-row queries. Every state transition is ONE conditional
 * UPDATE (`WHERE status = $from AND expires_at > now()`), so a lost race
 * returns no row instead of throwing — nothing here catches and retries.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type {
  CompanionDeviceLinkRow,
  CompanionDeviceRow,
} from './companion-device-dto.helpers';
import {
  LINK_TTL_SEC,
  MAX_POLL_INTERVAL_SEC,
  POLL_INTERVAL_SEC,
  SLOW_DOWN_STEP_SEC,
} from './companion-device-link.limits';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const links = schema.companionDeviceLinks;
const devices = schema.companionDevices;

/** Advisory-lock class serialising one user's device inserts (cap check). */
const DEVICE_CAP_LOCK_CLASS = 1955;

/** What `start` writes (both codes already hashed). */
export interface NewLink {
  deviceCodeHash: string;
  userCodeHash: string;
  deviceName: string;
  deviceOs: string;
  deviceOsVersion: string | null;
  appVersion: string;
  requestedIpCoarse: string | null;
}

/** The token half of a device insert (plaintext never reaches here). */
export interface IssuedTokenHash {
  tokenHash: string;
  tokenHint: string;
}

export type ConsumeResult =
  | { kind: 'issued'; device: CompanionDeviceRow }
  | { kind: 'device_limit' }
  | { kind: 'lost' };

const live = sql`${links.expiresAt} > now()`;

@Injectable()
export class CompanionDeviceLinksRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** Live pending links requested from one coarse network. */
  async countPendingForNetwork(network: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(links)
      .where(
        and(
          eq(links.status, 'pending'),
          eq(links.requestedIpCoarse, network),
          live,
        ),
      );
    return row?.n ?? 0;
  }

  /** Insert a pending link; null on a code collision (caller re-rolls). */
  async insertPending(link: NewLink): Promise<CompanionDeviceLinkRow | null> {
    const [row] = await this.db
      .insert(links)
      .values({
        ...link,
        status: 'pending',
        intervalSec: POLL_INTERVAL_SEC,
        expiresAt: sql`now() + make_interval(secs => ${LINK_TTL_SEC})`,
      })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  async findByDeviceCodeHash(
    hash: string,
  ): Promise<CompanionDeviceLinkRow | null> {
    const [row] = await this.db
      .select()
      .from(links)
      .where(eq(links.deviceCodeHash, hash));
    return row ?? null;
  }

  /** The newest unexpired link for a user code, in any status. */
  async findLiveByUserCodeHash(
    hash: string,
  ): Promise<CompanionDeviceLinkRow | null> {
    const [row] = await this.db
      .select()
      .from(links)
      .where(and(eq(links.userCodeHash, hash), live))
      .orderBy(desc(links.id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Stamp a pending poll in one statement. `tooFast` = polled before
   * `last_polled_at + interval_sec`; then the interval grows by 5 s (cap
   * 60). null when the link is no longer pending.
   */
  async stampPendingPoll(
    id: number,
  ): Promise<{ tooFast: boolean; intervalSec: number } | null> {
    const rows = await this.db.execute<{
      too_fast: boolean;
      interval_sec: number;
    }>(sql`
      WITH prev AS (
        SELECT id, (last_polled_at IS NOT NULL
          AND last_polled_at + make_interval(secs => interval_sec) > now()) AS too_fast
        FROM companion_device_links
        WHERE id = ${id} AND status = 'pending' AND expires_at > now()
        FOR UPDATE
      )
      UPDATE companion_device_links l
      SET last_polled_at = now(),
          interval_sec = CASE WHEN prev.too_fast
            THEN LEAST(l.interval_sec + ${SLOW_DOWN_STEP_SEC}, ${MAX_POLL_INTERVAL_SEC})
            ELSE l.interval_sec END
      FROM prev WHERE l.id = prev.id
      RETURNING prev.too_fast AS too_fast, l.interval_sec AS interval_sec`);
    const row = rows[0];
    return row
      ? { tooFast: row.too_fast, intervalSec: row.interval_sec }
      : null;
  }

  /** pending → approved | denied, by `userId`. null = lost the race. */
  async decide(
    id: number,
    userId: number,
    status: 'approved' | 'denied',
    name: string | null,
  ): Promise<CompanionDeviceLinkRow | null> {
    const [row] = await this.db
      .update(links)
      .set({
        status,
        decidedBy: userId,
        decidedAt: sql`now()`,
        ...(name === null ? {} : { deviceName: name }),
      })
      .where(and(eq(links.id, id), eq(links.status, 'pending'), live))
      .returning();
    return row ?? null;
  }

  /** Live (non-revoked) devices owned by `userId`. */
  async countLiveDevices(
    userId: number,
    tx: Db | Tx = this.db,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(devices)
      .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
    return row?.n ?? 0;
  }

  /**
   * The winning poll (D-2): under a per-user advisory lock, re-check the
   * cap, then `approved → consumed` (single use: exactly one caller gets a
   * row), insert the device, point the link at it. The cap check runs
   * BEFORE any write, so `device_limit` commits nothing and the link stays
   * approved.
   */
  async consume(
    link: CompanionDeviceLinkRow,
    ownerId: number,
    token: IssuedTokenHash,
    cap: number,
  ): Promise<ConsumeResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${DEVICE_CAP_LOCK_CLASS}::int4, ${ownerId}::int4)`,
      );
      if ((await this.countLiveDevices(ownerId, tx)) >= cap) {
        return { kind: 'device_limit' };
      }
      const [won] = await tx
        .update(links)
        .set({ status: 'consumed' })
        .where(and(eq(links.id, link.id), eq(links.status, 'approved'), live))
        .returning({ id: links.id });
      if (!won) return { kind: 'lost' };
      const device = await insertDevice(tx, link, ownerId, token);
      await tx
        .update(links)
        .set({ deviceId: device.id })
        .where(eq(links.id, link.id));
      return { kind: 'issued', device };
    });
  }
}

/** Insert the device row for a consumed link. */
async function insertDevice(
  tx: Tx,
  link: CompanionDeviceLinkRow,
  ownerId: number,
  token: IssuedTokenHash,
): Promise<CompanionDeviceRow> {
  const [device] = await tx
    .insert(devices)
    .values({
      userId: ownerId,
      name: link.deviceName ?? 'Companion device',
      os: link.deviceOs,
      osVersion: link.deviceOsVersion,
      appVersion: link.appVersion,
      tokenHash: token.tokenHash,
      tokenHint: token.tokenHint,
    })
    .returning();
  if (!device) throw new Error('companion device insert returned no row');
  return device;
}
