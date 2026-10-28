import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import {
  MAX_BAR_PICTURES,
  type DeathPictureBucket,
} from './valheim-deaths-pictures.mappers';
import type { DeathBucketRef } from './valheim-deaths.mappers';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimPlayerDeaths: deaths, hubMedia: media, guilds } = schema;

/**
 * ROK-1941 D13 — per `(steam_id, character_name)` death bucket on one
 * server: the newest 3 linked pictures that are neither hidden nor removed,
 * and how many such pictures the bucket has. Hidden media are excluded for
 * every viewer here (the Gallery still shows them to editors). Built with
 * the query builder over a join, so every column renders table-qualified.
 */
@Injectable()
export class ValheimDeathsPicturesRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  async bucketsFor(serverId: number): Promise<DeathPictureBucket[]> {
    const r = this.ranked(serverId);
    const rows = await this.db
      .select()
      .from(r)
      .where(lte(r.rn, MAX_BAR_PICTURES))
      .orderBy(asc(r.steamId), asc(r.characterName), asc(r.rn));
    const buckets = new Map<string, DeathPictureBucket>();
    for (const r of rows) {
      const key = `${r.steamId ?? ''}\u0000${r.characterName}`;
      const b = buckets.get(key) ?? {
        steamId: r.steamId,
        characterName: r.characterName,
        count: Number(r.total),
        pictures: [],
      };
      b.pictures.push({
        mediaId: r.mediaId,
        guildId: r.guildId,
        capturedAt: r.capturedAt,
      });
      buckets.set(key, b);
    }
    return [...buckets.values()];
  }

  /** ROK-2027 — the Pelican server behind hub `guildId`, or null (1:1). */
  async serverIdOfHub(guildId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ serverId: guilds.pelicanServerId })
      .from(guilds)
      .where(eq(guilds.id, guildId))
      .limit(1);
    return row?.serverId ?? null;
  }

  /**
   * ROK-2027 D4 — every media id linked to a death in `buckets` on the
   * server. Visibility-agnostic on purpose: core's Gallery `visible()`
   * applies hidden/removed/other-hub rules to these ids.
   */
  async mediaIdsFor(
    serverId: number,
    buckets: DeathBucketRef[],
  ): Promise<number[]> {
    if (buckets.length === 0) return [];
    const inBucket = buckets.map((b) =>
      and(
        b.steamId === null
          ? isNull(deaths.steamId)
          : eq(deaths.steamId, b.steamId),
        eq(deaths.characterName, b.characterName),
      ),
    );
    const rows = await this.db
      .select({ id: deaths.hubMediaId })
      .from(deaths)
      .where(
        and(
          eq(deaths.pelicanServerId, serverId),
          isNotNull(deaths.hubMediaId),
          or(...inBucket),
        ),
      );
    return rows.flatMap((r) => (r.id === null ? [] : [r.id]));
  }

  /** Visible linked pictures, ranked newest-first within each bucket. */
  private ranked(serverId: number) {
    const bucket = sql`partition by ${deaths.steamId}, ${deaths.characterName}`;
    return this.db
      .select({
        steamId: deaths.steamId,
        characterName: deaths.characterName,
        mediaId: media.id,
        guildId: media.guildId,
        capturedAt: media.capturedAt,
        rn: sql<number>`row_number() over (${bucket} order by ${desc(media.capturedAt)}, ${desc(media.id)})`.as(
          'rn',
        ),
        total: sql<string>`count(*) over (${bucket})`.as('total'),
      })
      .from(deaths)
      .innerJoin(media, eq(media.id, deaths.hubMediaId))
      .where(
        and(
          eq(deaths.pelicanServerId, serverId),
          isNull(media.removedAt),
          isNull(media.hiddenAt),
        ),
      )
      .as('ranked');
  }
}
