import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import type { ServerPinMapRow } from './valheim-server-pins.mappers';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimMaps: maps, valheimProfiles: profiles } = schema;

/**
 * ROK-1943 — the map rows on one world of one server (optionally only the
 * given characters'), with the linked profile's name. Same select / join /
 * order as `ValheimDeathPinsRepository`; selects no SteamID (D13). Pin
 * filtering happens in `toServerPinsResponse`.
 */
@Injectable()
export class ValheimServerPinsRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** `players` given → only maps whose profile id is in it (unlinked maps drop out). */
  mapsOnWorld(
    serverId: number,
    worldUid: string,
    players?: readonly number[],
  ): Promise<ServerPinMapRow[]> {
    const scope = [
      eq(maps.pelicanServerId, serverId),
      eq(maps.worldUid, worldUid),
    ];
    if (players) scope.push(inArray(maps.profileId, [...players]));
    return this.db
      .select({
        profileId: maps.profileId,
        name: profiles.name,
        pins: maps.pins,
      })
      .from(maps)
      .leftJoin(profiles, eq(profiles.id, maps.profileId))
      .where(and(...scope))
      .orderBy(asc(maps.id));
  }
}
