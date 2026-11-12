/**
 * ROK-2187 — computes and stores GG <year> snapshots. Called by the delivery
 * cron and admin tools only; the owner/public reads never call it (AC1).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { count, isNotNull, isNull } from 'drizzle-orm';
import type { GgSnapshotV1 } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { SETTING_KEYS, users } from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { safeTimeZone } from '../../../notifications/weekly-digest-schedule.helpers';
import { GgCardRegistry } from './gg-card.registry';
import { upsertGgSnapshot } from './gg-snapshot.queries';
import { ggActivityTier, ggYearWindow } from './gg-window.helpers';

/** Outcome of one `computeAll` pass. */
export interface GgComputeAllResult {
  year: number;
  /** Snapshots written (short + full). */
  computed: number;
  short: number;
  full: number;
  /** Active users with no activity in the window — no row written (R4). */
  noActivity: number;
  /** Deactivated users, never computed. */
  deactivated: number;
}

@Injectable()
export class GgComputeService {
  private readonly logger = new Logger(GgComputeService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cards: GgCardRegistry,
    private readonly settings: SettingsService,
  ) {}

  /** The community IANA zone (`DEFAULT_TIMEZONE`), UTC when unset/bogus. */
  async communityTimeZone(): Promise<string> {
    return safeTimeZone(await this.settings.get(SETTING_KEYS.DEFAULT_TIMEZONE));
  }

  /**
   * One user's snapshot for `year` (window Jan 1 00:00 tz → `now`), NOT
   * stored. `null` when the user had no activity — never a zero-filled GG.
   */
  async computeForUser(
    userId: number,
    year: number,
    now: Date = new Date(),
    tz?: string,
  ): Promise<GgSnapshotV1 | null> {
    const zone = tz ?? (await this.communityTimeZone());
    const window = ggYearWindow(year, zone, now);
    const cards = await this.cards.produceAll({
      db: this.db,
      userId,
      year,
      window,
      tz: zone,
    });
    const tier = ggActivityTier(cards);
    if (tier === null) return null;
    return {
      schemaVersion: 1,
      year,
      window: { from: window.start.toISOString(), to: window.end.toISOString() },
      tier,
      computedAt: now.toISOString(),
      cards,
    };
  }

  /** Store `snapshot` for `userId` (UNIQUE(user_id, year) upsert). */
  async upsertSnapshot(userId: number, snapshot: GgSnapshotV1): Promise<void> {
    await upsertGgSnapshot(this.db, userId, snapshot);
  }

  /**
   * Compute + store `year` for every active user with any activity; skips
   * deactivated users and writes nothing for a user with no activity.
   */
  async computeAll(
    year: number,
    now: Date = new Date(),
  ): Promise<GgComputeAllResult> {
    const tz = await this.communityTimeZone();
    const result = await this.emptyResult(year);
    const active = await this.db
      .select({ id: users.id })
      .from(users)
      .where(isNull(users.deactivatedAt));
    for (const { id } of active) {
      const snapshot = await this.computeForUser(id, year, now, tz);
      if (snapshot === null) {
        result.noActivity += 1;
        continue;
      }
      await this.upsertSnapshot(id, snapshot);
      result.computed += 1;
      result[snapshot.tier] += 1;
    }
    this.logger.log(
      `GG ${year}: computed ${result.computed} (${result.full} full, ${result.short} short), ${result.noActivity} without activity`,
    );
    return result;
  }

  private async emptyResult(year: number): Promise<GgComputeAllResult> {
    const [row] = await this.db
      .select({ n: count() })
      .from(users)
      .where(isNotNull(users.deactivatedAt));
    const deactivated = row?.n ?? 0;
    return { year, computed: 0, short: 0, full: 0, noActivity: 0, deactivated };
  }
}
