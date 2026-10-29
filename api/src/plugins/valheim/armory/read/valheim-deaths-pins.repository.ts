import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import type { DeathPinMapRow } from './valheim-deaths-pins.mappers';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimMaps: maps, valheimProfiles: profiles } = schema;

/**
 * ROK-1930 L4a — every character's map row on one world of one server, with
 * the linked profile's name. Selects no SteamID (D13); pin filtering happens
 * in `toDeathPinsResponse`.
 */
@Injectable()
export class ValheimDeathPinsRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  mapsOnWorld(serverId: number, worldUid: string): Promise<DeathPinMapRow[]> {
    return this.db
      .select({
        profileId: maps.profileId,
        name: profiles.name,
        pins: maps.pins,
      })
      .from(maps)
      .leftJoin(profiles, eq(profiles.id, maps.profileId))
      .where(
        and(eq(maps.pelicanServerId, serverId), eq(maps.worldUid, worldUid)),
      )
      .orderBy(asc(maps.id));
  }
}
