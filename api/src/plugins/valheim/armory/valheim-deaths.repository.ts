import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  count,
  eq,
  inArray,
  isNull,
  max,
  min,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
const {
  valheimPlayerDeaths: deaths,
  valheimProfiles: profiles,
  pelicanServers: servers,
  games,
} = schema;

/** A console death ready to store (ROK-1930 L1). */
export interface LogDeathInput {
  characterName: string;
  steamId: string | null;
  /** The parser's zone-less line timestamp, verbatim — part of the dedupe key. */
  loggedAt: string;
  occurredAt: Date;
}

/** What the death sink needs to know about a Pelican server. */
export interface DeathServerContext {
  gameSlug: string | null;
  timezone: string | null;
}

/** One `(steamId, characterName)` bucket of stored deaths (D7 input). */
export interface DeathGroupRow {
  steamId: string | null;
  characterName: string;
  deaths: number;
  firstDeathAt: Date | null;
  lastDeathAt: Date | null;
}

/** A character profile on the server (D7 name resolution, D9 characterId). */
export interface DeathProfileRow {
  id: number;
  steamId: string;
  name: string;
  capturedAt: Date;
}

/** Everything the Deaths widget mapper needs for one server. */
export interface DeathCounts {
  groups: DeathGroupRow[];
  profiles: DeathProfileRow[];
}

/**
 * ROK-1930: Valheim player deaths. Every write is ONE statement that cannot
 * violate the unique key (no catch-and-retry — under postgres.js a failed
 * statement poisons a surrounding transaction).
 */
@Injectable()
export class ValheimDeathsRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** The server's mapped game slug and own timezone, or null when unknown. */
  async findServerContext(
    pelicanServerId: number,
  ): Promise<DeathServerContext | null> {
    const [row] = await this.db
      .select({ gameSlug: games.slug, timezone: servers.timezone })
      .from(servers)
      .leftJoin(games, eq(games.id, servers.gameId))
      .where(eq(servers.id, pelicanServerId));
    return row ?? null;
  }

  /**
   * Store a log death once per `(server, character, loggedAt)` (D4/D5).
   * A repeat whose SteamID is now known attributes the stored row when it
   * had none; an attributed row is never re-attributed. Returns true when
   * a new row was inserted.
   */
  async recordLogDeath(
    pelicanServerId: number,
    death: LogDeathInput,
  ): Promise<boolean> {
    const inserted = await this.db
      .insert(deaths)
      .values({ pelicanServerId, source: 'log', ...death })
      .onConflictDoNothing({
        target: [deaths.pelicanServerId, deaths.characterName, deaths.loggedAt],
        where: sql`source = 'log'`,
      })
      .returning({ id: deaths.id });
    if (inserted.length > 0) return true;
    if (death.steamId !== null)
      await this.attribute(pelicanServerId, death, death.steamId);
    return false;
  }

  private async attribute(
    pelicanServerId: number,
    death: LogDeathInput,
    steamId: string,
  ): Promise<void> {
    await this.db
      .update(deaths)
      .set({ steamId })
      .where(
        and(
          eq(deaths.pelicanServerId, pelicanServerId),
          eq(deaths.characterName, death.characterName),
          eq(deaths.loggedAt, death.loggedAt),
          eq(deaths.source, 'log'),
          isNull(deaths.steamId),
        ),
      );
  }
  /**
   * L2 (D7/D9): every stored death on the server bucketed by
   * `(steam_id, character_name)`, plus the server's profiles that can
   * attribute a NULL-steam bucket by name or give a SteamID its newest
   * character. The mapper merges buckets into one bar per player.
   */
  async countByPlayer(pelicanServerId: number): Promise<DeathCounts> {
    const groups = await this.db
      .select({
        steamId: deaths.steamId,
        characterName: deaths.characterName,
        deaths: count(),
        firstDeathAt: min(deaths.occurredAt),
        lastDeathAt: max(deaths.occurredAt),
      })
      .from(deaths)
      .where(eq(deaths.pelicanServerId, pelicanServerId))
      .groupBy(deaths.steamId, deaths.characterName);
    const profileRows = await this.profilesFor(pelicanServerId, groups);
    return { groups, profiles: profileRows };
  }

  private async profilesFor(
    pelicanServerId: number,
    groups: DeathGroupRow[],
  ): Promise<DeathProfileRow[]> {
    const steamIds = [...new Set(groups.flatMap((g) => g.steamId ?? []))];
    const names = [
      ...new Set(
        groups.filter((g) => g.steamId === null).map((g) => g.characterName),
      ),
    ];
    const match: SQL[] = [];
    if (steamIds.length > 0) match.push(inArray(profiles.steamId, steamIds));
    if (names.length > 0) match.push(inArray(profiles.name, names));
    if (match.length === 0) return [];
    return this.db
      .select({
        id: profiles.id,
        steamId: profiles.steamId,
        name: profiles.name,
        capturedAt: profiles.capturedAt,
      })
      .from(profiles)
      .where(and(eq(profiles.pelicanServerId, pelicanServerId), or(...match)));
  }
}
