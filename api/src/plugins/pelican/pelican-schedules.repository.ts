import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  pelicanSchedules,
  pelicanServers,
  type NewPelicanSchedule,
  type PelicanScheduleRow,
} from '../../drizzle/schema';
import {
  lockActivePlugin,
  type PelicanDb,
} from './pelican-plugin-lock.helpers';

/**
 * A stored schedule of a servable server, plus the server facts S5 needs.
 * Never carries the server's `panel_uuid` or `identifier`.
 */
export interface PelicanServableSchedule extends PelicanScheduleRow {
  gameId: number;
  /** RAW panel name — the projection redacts it before it reaches members. */
  serverName: string;
  serverTimezone: string | null;
}

/** What the admin tz self-check reads (ROK-1096 D11) — no payloads. */
export type PelicanActiveScheduleCron = Pick<
  PelicanScheduleRow,
  | 'serverId'
  | 'cronMinute'
  | 'cronHour'
  | 'cronDayOfMonth'
  | 'cronMonth'
  | 'cronDayOfWeek'
  | 'isActive'
  | 'nextRunAt'
>;

/** Drizzle access to `pelican_schedules` (ROK-1773). */
@Injectable()
export class PelicanSchedulesRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: PelicanDb) {}

  /**
   * Full replace of one server's schedules in ONE transaction (D4): delete
   * every row of `serverId`, insert `rows` (already payload-free, carrying
   * `serverId`). `false` = the plugin is no longer active and nothing was
   * written. No catch inside the transaction — a failed statement poisons it,
   * so a throw rolls the whole replace back and the old rows stay.
   */
  replaceForServer(
    serverId: number,
    rows: NewPelicanSchedule[],
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      if (!(await lockActivePlugin(tx))) return false;
      await tx
        .delete(pelicanSchedules)
        .where(eq(pelicanSchedules.serverId, serverId));
      if (rows.length > 0) await tx.insert(pelicanSchedules).values(rows);
      return true;
    });
  }

  /**
   * The single read path (D7): schedules of mapped, visible, not-missing
   * servers only. Rows of unmapped/hidden servers stay stored but are never
   * returned. `gameIds` narrows to those games; an empty array returns none.
   */
  async listServable(gameIds?: number[]): Promise<PelicanServableSchedule[]> {
    if (gameIds !== undefined && gameIds.length === 0) return [];
    const rows = await this.db
      .select({
        schedule: pelicanSchedules,
        gameId: pelicanServers.gameId,
        serverName: pelicanServers.name,
        serverTimezone: pelicanServers.timezone,
      })
      .from(pelicanSchedules)
      .innerJoin(
        pelicanServers,
        eq(pelicanSchedules.serverId, pelicanServers.id),
      )
      .where(
        and(
          isNotNull(pelicanServers.gameId),
          eq(pelicanServers.showOnCalendar, true),
          isNull(pelicanServers.missingSince),
          gameIds === undefined
            ? undefined
            : inArray(pelicanServers.gameId, gameIds),
        ),
      );
    return rows.flatMap(({ schedule, gameId, serverName, serverTimezone }) =>
      gameId === null
        ? []
        : [{ ...schedule, gameId, serverName, serverTimezone }],
    );
  }

  /**
   * Active schedules of `serverIds` for the admin tz self-check (D11). No
   * mapping/visibility filter — the admin sees hidden and unmapped servers.
   */
  async listActiveForServers(
    serverIds: number[],
  ): Promise<PelicanActiveScheduleCron[]> {
    if (serverIds.length === 0) return [];
    return this.db
      .select({
        serverId: pelicanSchedules.serverId,
        cronMinute: pelicanSchedules.cronMinute,
        cronHour: pelicanSchedules.cronHour,
        cronDayOfMonth: pelicanSchedules.cronDayOfMonth,
        cronMonth: pelicanSchedules.cronMonth,
        cronDayOfWeek: pelicanSchedules.cronDayOfWeek,
        isActive: pelicanSchedules.isActive,
        nextRunAt: pelicanSchedules.nextRunAt,
      })
      .from(pelicanSchedules)
      .where(
        and(
          inArray(pelicanSchedules.serverId, serverIds),
          eq(pelicanSchedules.isActive, true),
        ),
      );
  }
}
