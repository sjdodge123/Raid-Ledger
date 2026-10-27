import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { HubKindRegistry } from '../../../guilds/hub-kind.registry';
import {
  STEAM_STATS_APP_IDS,
  STEAM_STATS_HUB_KINDS,
} from './steam-stats.constants';

type Db = PostgresJsDatabase<typeof schema>;

/** One linked member to fetch for an app. */
export interface SteamStatsTarget {
  userId: number;
  steamId: string;
}

/**
 * ROK-1953 D5 — who the refresh fetches. Live hub = an enabled kind whose
 * game's `steam_app_id` is on the enable list, not archived (`archived_at`
 * NULL and `status <> 'archived'`; every non-community kind is always
 * `active`, `guilds_status_kind_check`). Members come from the hub kind's
 * own `memberUserIds`, so the target set cannot drift from the read gate.
 */
@Injectable()
export class SteamStatsTargetsRepository {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly hubKinds: HubKindRegistry,
  ) {}

  /** Enabled app id → its live hub ids (only apps with at least one hub). */
  async liveHubsByApp(): Promise<Map<number, number[]>> {
    const g = schema.guilds;
    const rows = await this.db
      .select({ guildId: g.id, appId: schema.games.steamAppId })
      .from(g)
      .innerJoin(schema.games, eq(schema.games.id, g.gameId))
      .where(
        and(
          inArray(g.kind, [...STEAM_STATS_HUB_KINDS]),
          inArray(schema.games.steamAppId, [...STEAM_STATS_APP_IDS]),
          isNull(g.archivedAt),
          ne(g.status, 'archived'),
        ),
      )
      .orderBy(asc(g.id));
    const byApp = new Map<number, number[]>();
    for (const r of rows) {
      if (r.appId === null) continue;
      byApp.set(r.appId, [...(byApp.get(r.appId) ?? []), r.guildId]);
    }
    return byApp;
  }

  /**
   * Distinct live members of `guildIds` with a Steam link (and not
   * deactivated), least-recently fetched for `appId` first (never-fetched
   * first). `onlyUserId` narrows to one user (the on-link refresh, D6).
   */
  async targetsFor(
    appId: number,
    guildIds: readonly number[],
    onlyUserId?: number,
  ): Promise<SteamStatsTarget[]> {
    const members = await this.memberIds(guildIds);
    const ids =
      onlyUserId === undefined
        ? [...members]
        : [...members].filter((id) => id === onlyUserId);
    if (ids.length === 0) return [];
    const u = schema.users;
    const s = schema.steamUserAppStats;
    const rows = await this.db
      .select({ userId: u.id, steamId: u.steamId })
      .from(u)
      .leftJoin(s, and(eq(s.userId, u.id), eq(s.appId, appId)))
      .where(
        and(inArray(u.id, ids), isNotNull(u.steamId), isNull(u.deactivatedAt)),
      )
      .orderBy(sql`${s.fetchedAt} ASC NULLS FIRST`, asc(u.id));
    return rows.flatMap((r) =>
      r.steamId === null ? [] : [{ userId: r.userId, steamId: r.steamId }],
    );
  }

  /** Union of live members over the hubs; a hub whose kind is inactive adds none. */
  private async memberIds(guildIds: readonly number[]): Promise<Set<number>> {
    const out = new Set<number>();
    for (const guildId of guildIds) {
      const adapter = await this.hubKinds.forGuild(guildId);
      if (!adapter) continue;
      for (const id of await adapter.memberUserIds(guildId)) out.add(id);
    }
    return out;
  }
}
