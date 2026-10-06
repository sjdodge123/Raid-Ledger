import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, eq, gte, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  addonImportAudit,
  type AddonImportAuditInsert,
} from '../../../drizzle/schema';
import { AddonImportError } from './addon-import.errors';

/** Applies (`dry_run=false`) per user per rolling hour (operator Q3). */
export const ADDON_IMPORT_APPLY_LIMIT = 20;
/** Previews (`dry_run=true`) per user per rolling hour (operator Q3). */
export const ADDON_IMPORT_PREVIEW_LIMIT = 60;
/** `pg_advisory_xact_lock(class, key)` namespace for the per-user limit. */
export const ADDON_IMPORT_LIMIT_LOCK_CLASS = 1724;
/** `result` of a reserved row until the attempt finishes (counts already). */
export const ADDON_IMPORT_PENDING = 'PENDING';
const WINDOW_MS = 60 * 60 * 1000;

type Db = PostgresJsDatabase<typeof schema>;

/** True once `used` attempts in the window already reach the cap. */
export function isOverLimit(used: number, dryRun: boolean): boolean {
  const limit = dryRun ? ADDON_IMPORT_PREVIEW_LIMIT : ADDON_IMPORT_APPLY_LIMIT;
  return used >= limit;
}

/** Fields `finish` fills in once the attempt's outcome is known. */
export type AddonImportAuditOutcome = Pick<
  AddonImportAuditInsert,
  'section' | 'payloadSha256' | 'result'
>;

/**
 * ROK-1724 §4.3 — one `addon_import_audit` row per attempt (preview, apply
 * or reject), and the per-user hourly limit counted from those rows. The
 * global `ThrottlerGuard` is per-IP/minute, so it can't express 20/h/user.
 */
@Injectable()
export class AddonImportAuditService {
  private readonly logger = new Logger(AddonImportAuditService.name);

  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /**
   * Atomically check the hour's cap and reserve this attempt's audit row
   * (result `PENDING`, counted by later checks). A per-(user, kind) advisory
   * lock serialises count + insert, so parallel requests can't all pass a
   * stale count. 429 `RATE_LIMITED` (nothing reserved) once at the cap; rows
   * that were themselves rate-limited don't count, so hammering can't extend
   * the lockout. `THROTTLE_DISABLED` is read per call (integration tests).
   */
  async reserveAttempt(row: AddonImportAuditInsert): Promise<number> {
    return this.db.transaction(async (tx) => {
      if (process.env.THROTTLE_DISABLED !== 'true') {
        const key = `${row.userId}:${row.dryRun}`;
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(${ADDON_IMPORT_LIMIT_LOCK_CLASS}::int4, hashtext(${key}))`,
        );
        const used = await countRecent(tx, row.userId, row.dryRun);
        if (isOverLimit(used, row.dryRun)) {
          throw new AddonImportError('RATE_LIMITED');
        }
      }
      const [reserved] = await tx
        .insert(addonImportAudit)
        .values({ ...row, result: ADDON_IMPORT_PENDING })
        .returning({ id: addonImportAudit.id });
      if (!reserved) throw new Error('addon-import audit reserve failed');
      return reserved.id;
    });
  }

  /**
   * Best effort: an audit write failure is logged, never surfaced — the
   * import's own outcome (already committed or rejected) stands. Finalises
   * the reserved row when there is one, else (a reject before the limit
   * check, incl. `RATE_LIMITED`) inserts the attempt's row.
   */
  async recordAttempt(
    row: AddonImportAuditInsert,
    reservedId?: number | null,
  ): Promise<void> {
    try {
      if (reservedId == null) {
        await this.db.insert(addonImportAudit).values(row);
        return;
      }
      const outcome: AddonImportAuditOutcome = {
        section: row.section,
        payloadSha256: row.payloadSha256,
        result: row.result,
      };
      await this.db
        .update(addonImportAudit)
        .set(outcome)
        .where(eq(addonImportAudit.id, reservedId));
    } catch (err) {
      this.logger.warn(
        `addon-import audit write failed userId=${row.userId} result=${row.result}: ${String(err)}`,
      );
    }
  }
}

/** Attempts of this kind in the window, reserved-but-unfinished included. */
async function countRecent(
  tx: Db,
  userId: number,
  dryRun: boolean,
): Promise<number> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [row] = await tx
    .select({ n: count() })
    .from(addonImportAudit)
    .where(
      and(
        eq(addonImportAudit.userId, userId),
        eq(addonImportAudit.dryRun, dryRun),
        gte(addonImportAudit.createdAt, since),
        ne(addonImportAudit.result, 'RATE_LIMITED'),
      ),
    );
  return Number(row?.n ?? 0);
}
