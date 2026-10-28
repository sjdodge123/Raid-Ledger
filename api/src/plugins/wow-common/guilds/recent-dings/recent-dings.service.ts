import { Inject, Injectable } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowRecentDingsDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import {
  RECENT_DINGS_LIMIT,
  toDings,
  windowStart,
} from './recent-dings.helpers';
import { loadDingRows } from './recent-dings.queries';

/**
 * ROK-1919 — `GET plugins/wow/guilds/:id/recent-dings`. Same audience as the
 * hub (D7: anyone `HubVisibleGuard` lets through, visitors included — level
 * and names are already on the page), so no per-viewer branch.
 */
@Injectable()
export class RecentDingsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** The guild's last-30-day dings, newest first, at most 20. */
  async recentDings(guildId: number): Promise<WowRecentDingsDto> {
    const rows = await loadDingRows(
      this.db,
      guildId,
      windowStart(Date.now()),
      RECENT_DINGS_LIMIT * 2,
    );
    return { dings: toDings(rows) };
  }
}
