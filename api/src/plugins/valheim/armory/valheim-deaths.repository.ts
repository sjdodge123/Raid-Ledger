import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimPlayerDeaths: deaths, pelicanServers: servers, games } = schema;

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
}
