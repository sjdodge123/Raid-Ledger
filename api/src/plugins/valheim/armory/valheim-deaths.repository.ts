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
  type SQL,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  deathPostWindowSec,
  withDeathNameLock,
} from '../screenshots/valheim-death-name-lock';
import { mergeOrInsertLogDeath } from './valheim-deaths-merge.sql';

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
   * Store a log death once per `(server, character, loggedAt)` (D4/D5),
   * merging into a death inferred from a Discord death post when one sits
   * in the window (ROK-1941 SQL B, under the D9 lock). A repeat whose
   * SteamID is now known attributes the stored row when it had none; an
   * attributed row is never re-attributed. True only for a new row.
   */
  async recordLogDeath(
    pelicanServerId: number,
    death: LogDeathInput,
  ): Promise<boolean> {
    const windowSec = deathPostWindowSec();
    return withDeathNameLock(
      this.db,
      pelicanServerId,
      death.characterName,
      async (tx) => {
        if (await mergeOrInsertLogDeath(tx, pelicanServerId, death, windowSec))
          return true;
        if (death.steamId !== null)
          await attribute(tx, pelicanServerId, death, death.steamId);
        return false;
      },
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
    const onServer = eq(profiles.pelicanServerId, pelicanServerId);
    const match: SQL[] = [];
    if (steamIds.length > 0) match.push(inArray(profiles.steamId, steamIds));
    if (names.length > 0) match.push(this.sameSteamAsNamed(onServer, names));
    if (match.length === 0) return [];
    return this.db
      .select({
        id: profiles.id,
        steamId: profiles.steamId,
        name: profiles.name,
        capturedAt: profiles.capturedAt,
      })
      .from(profiles)
      .where(and(onServer, or(...match)));
  }

  /**
   * Every profile sharing a SteamID with a name-matched one — so D9's newest
   * character wins for an all-NULL-steam player as it does for an attributed one.
   */
  private sameSteamAsNamed(onServer: SQL, names: string[]): SQL {
    return inArray(
      profiles.steamId,
      this.db
        .select({ steamId: profiles.steamId })
        .from(profiles)
        .where(and(onServer, inArray(profiles.name, names))),
    );
  }
}

/** Fill the SteamID on a stored, unattributed log row (replay case). */
async function attribute(
  tx: Db,
  pelicanServerId: number,
  death: LogDeathInput,
  steamId: string,
): Promise<void> {
  await tx
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
