import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import type { ReportedDeathPoint } from './valheim-reported-death-pins';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimPlayerDeaths: d, valheimProfiles: p } = schema;

/** A reported death on one world, with the profile it belongs to. */
export interface ReportedDeathRow extends ReportedDeathPoint {
  profileId: number;
  /** The profile's name — labels the pin when the character has no map row. */
  characterName: string;
}

interface RawRow {
  profileId: number;
  characterName: string;
  x: number | null;
  z: number | null;
  reportedAt: Date | null;
}

/** Rows with a position + `at` (always so for reported rows) — narrowed, not cast. */
function positioned(rows: RawRow[]): ReportedDeathRow[] {
  return rows.flatMap(({ profileId, characterName, x, z, reportedAt }) =>
    x === null || z === null || reportedAt === null
      ? []
      : [{ profileId, characterName, x, z, reportedAt }],
  );
}

/**
 * ROK-1931 (D8) — the stored deaths the mod reported (`reported_at` set,
 * the row may since have merged with a log/discord death), joined to the
 * profile on its identity `(server, steam_id, player_id)`. Selects no
 * SteamID, playerId or worldUid out (D13).
 */
@Injectable()
export class ValheimReportedDeathsRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** Character scope: one character's reported deaths on `worldUid`. */
  async forCharacter(
    profileId: number,
    worldUid: string,
  ): Promise<ReportedDeathPoint[]> {
    const rows = await this.onWorld(worldUid, [eq(p.id, profileId)]);
    return rows.map(({ x, z, reportedAt }) => ({ x, z, reportedAt }));
  }

  /** Players scope: every (or the given) character's on one server's world. */
  forWorld(
    serverId: number,
    worldUid: string,
    players?: readonly number[],
  ): Promise<ReportedDeathRow[]> {
    const scope = [eq(d.pelicanServerId, serverId)];
    if (players) scope.push(inArray(p.id, [...players]));
    return this.onWorld(worldUid, scope);
  }

  private async onWorld(worldUid: string, scope: SQL[]) {
    const rows = await this.db
      .select({
        profileId: p.id,
        characterName: p.name,
        x: d.x,
        z: d.z,
        reportedAt: d.reportedAt,
      })
      .from(d)
      .innerJoin(
        p,
        and(
          eq(p.pelicanServerId, d.pelicanServerId),
          eq(p.steamId, d.steamId),
          eq(p.playerId, d.playerId),
        ),
      )
      .where(and(eq(d.worldUid, worldUid), isNotNull(d.reportedAt), ...scope))
      .orderBy(asc(d.reportedAt), asc(d.id));
    return positioned(rows);
  }
}
