import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  sql,
} from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { pelicanServers, type PelicanServerRow } from '../../drizzle/schema';
import {
  lockActivePlugin,
  type PelicanDb as Db,
  type PelicanExecutor as Executor,
} from './pelican-plugin-lock.helpers';
import type { ListedServer } from './pelican-sync.helpers';

export type { PelicanTx } from './pelican-plugin-lock.helpers';

/** Counts written by one complete listing. */
export interface PelicanListingCounts {
  upserted: number;
  markedMissing: number;
  restored: number;
}

/** Live state from `GET /servers/{id}/resources` (Lane 3 writes it). */
export interface PelicanStatusWrite {
  currentState: string;
  isSuspended: boolean;
}

/** Drizzle access to `pelican_servers` (ROK-1772). */
@Injectable()
export class PelicanServersRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /**
   * Upsert + missing-mark in one transaction (D4, D5). Writes nothing and
   * returns `null` when the plugin is no longer active: the share lock on
   * its `plugins` row makes a concurrent deactivate (which must precede
   * uninstall) wait for this commit, so uninstall's `deleteAll` always runs
   * after these rows land and cannot leave any behind (D13).
   */
  applyListing(
    servers: ListedServer[],
    now: Date,
  ): Promise<PelicanListingCounts | null> {
    return this.db.transaction(async (tx) => {
      if (!(await lockActivePlugin(tx))) return null;
      const restored = await this.countMissing(tx, servers);
      const upserted = await this.upsertListed(tx, servers, now);
      const markedMissing = await this.markMissing(
        tx,
        servers.map((s) => s.panelUuid),
        now,
      );
      return { upserted, markedMissing, restored };
    });
  }

  /**
   * Upsert by `panel_uuid`. Updates ONLY `identifier`, `name`,
   * `last_synced_at` and `missing_since` — never the admin mapping
   * (`game_id`, `show_on_calendar`, `timezone`) or the status columns (D4).
   */
  async upsertListed(
    tx: Executor,
    servers: ListedServer[],
    now: Date,
  ): Promise<number> {
    if (servers.length === 0) return 0;
    const rows = await tx
      .insert(pelicanServers)
      .values(servers.map((s) => ({ ...s, lastSyncedAt: now })))
      .onConflictDoUpdate({
        target: pelicanServers.panelUuid,
        set: {
          identifier: sql`excluded.identifier`,
          name: sql`excluded.name`,
          lastSyncedAt: now,
          missingSince: null,
        },
      })
      .returning({ id: pelicanServers.id });
    return rows.length;
  }

  /**
   * Stamp `missing_since` on present rows absent from a COMPLETE listing.
   * Rows already missing keep their first timestamp (D5). An empty
   * `seenUuids` marks every row — an empty 200 is a real answer.
   */
  async markMissing(
    tx: Executor,
    seenUuids: string[],
    now: Date,
  ): Promise<number> {
    const notSeen =
      seenUuids.length === 0
        ? undefined
        : notInArray(pelicanServers.panelUuid, seenUuids);
    const rows = await tx
      .update(pelicanServers)
      .set({ missingSince: now })
      .where(and(isNull(pelicanServers.missingSince), notSeen))
      .returning({ id: pelicanServers.id });
    return rows.length;
  }

  /** Rows the status poll covers: mapped, visible, not missing (D6). */
  listPollable(): Promise<PelicanServerRow[]> {
    return this.db
      .select()
      .from(pelicanServers)
      .where(
        and(
          isNotNull(pelicanServers.gameId),
          eq(pelicanServers.showOnCalendar, true),
          isNull(pelicanServers.missingSince),
        ),
      );
  }

  /** Record one successful resources call. A failed call writes nothing (D7). */
  async writeStatus(
    id: number,
    status: PelicanStatusWrite,
    checkedAt: Date,
  ): Promise<void> {
    await this.db
      .update(pelicanServers)
      .set({
        currentState: status.currentState.slice(0, 32),
        isSuspended: status.isSuspended,
        statusCheckedAt: checkedAt,
      })
      .where(eq(pelicanServers.id, id));
  }

  /** Uninstall (D13): the FK cascade empties `pelican_schedules`. */
  async deleteAll(): Promise<void> {
    await this.db.delete(pelicanServers);
  }

  private async countMissing(
    tx: Executor,
    servers: ListedServer[],
  ): Promise<number> {
    if (servers.length === 0) return 0;
    const rows = await tx
      .select({ id: pelicanServers.id })
      .from(pelicanServers)
      .where(
        and(
          isNotNull(pelicanServers.missingSince),
          inArray(
            pelicanServers.panelUuid,
            servers.map((s) => s.panelUuid),
          ),
        ),
      );
    return rows.length;
  }
}
