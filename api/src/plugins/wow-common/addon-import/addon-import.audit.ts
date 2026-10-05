import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, eq, gte, ne } from 'drizzle-orm';
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
const WINDOW_MS = 60 * 60 * 1000;

/**
 * ROK-1724 §4.3 — one `addon_import_audit` row per attempt (preview, apply
 * or reject), and the per-user hourly limit counted from those rows. The
 * global `ThrottlerGuard` is per-IP/minute, so it can't express 20/h/user.
 */
@Injectable()
export class AddonImportAuditService {
  private readonly logger = new Logger(AddonImportAuditService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * 429 `RATE_LIMITED` once the user hit the hour's cap for this kind of
   * attempt. Rows that were themselves rate-limited don't count, so hammering
   * the endpoint can't extend the lockout. Read per call (not at import) so
   * the integration test can lift `THROTTLE_DISABLED` per test.
   */
  async assertWithinLimit(userId: number, dryRun: boolean): Promise<void> {
    if (process.env.THROTTLE_DISABLED === 'true') return;
    const since = new Date(Date.now() - WINDOW_MS);
    const [row] = await this.db
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
    const limit = dryRun
      ? ADDON_IMPORT_PREVIEW_LIMIT
      : ADDON_IMPORT_APPLY_LIMIT;
    if ((row?.n ?? 0) >= limit) throw new AddonImportError('RATE_LIMITED');
  }

  /**
   * Best effort: an audit write failure is logged, never surfaced — the
   * import's own outcome (already committed or rejected) stands.
   */
  async recordAttempt(row: AddonImportAuditInsert): Promise<void> {
    try {
      await this.db.insert(addonImportAudit).values(row);
    } catch (err) {
      this.logger.warn(
        `addon-import audit write failed userId=${row.userId} result=${row.result}: ${String(err)}`,
      );
    }
  }
}
