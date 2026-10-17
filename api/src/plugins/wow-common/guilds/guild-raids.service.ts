import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  GuildViewerStatusSchema,
  type GuildEventCardDto,
  type GuildRaidsDto,
  type GuildRecentEventDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  GuildAccessService,
  type GuildActor,
} from '../../../guilds/guild-access.service';
import { findGuild } from './guild-queries.helpers';
import {
  ATTENDANCE_WINDOW_WEEKS,
  neededFor,
  nextRaidOf,
  toAttendanceRows,
  toComposition,
  toSchedule,
} from './guild-raids.helpers';
import {
  loadAttendance,
  loadCompositionSource,
  loadRecent,
  loadScheduleRows,
  loadUpcoming,
  type CompositionSource,
  type RecentRow,
  type UpcomingRow,
} from './guild-raids.queries';
import { loadRosterRows } from './guild-roster.helpers';

const WEEK_MS = 7 * 24 * 3600 * 1000;

function toCard(row: UpcomingRow): GuildEventCardDto {
  const status = GuildViewerStatusSchema.safeParse(row.viewerStatus);
  return {
    id: row.id,
    title: row.title,
    startTime: row.duration[0].toISOString(),
    endTime: row.duration[1].toISOString(),
    signupCount: row.signupCount,
    needed: neededFor(row.slotConfig, row.maxAttendees),
    viewerStatus: status.success ? status.data : null,
  };
}

function toRecent(row: RecentRow): GuildRecentEventDto {
  return {
    id: row.id,
    title: row.title,
    startTime: row.duration[0].toISOString(),
    signedUp: row.signedUp,
    attended: row.recorded > 0 ? row.attended : null,
  };
}

function compositionOf(
  comp: CompositionSource | null,
): GuildRaidsDto['composition'] {
  return comp ? toComposition(comp.event, comp.filled, comp.benched) : null;
}

/**
 * ROK-1787 — `GET /plugins/wow/guilds/:id/raids`: the Raids tab + Overview
 * widgets. 403 unless the viewer may view (members + staff), 404 missing.
 * Uncached: `viewerStatus` is per viewer (spec P5).
 */
@Injectable()
export class GuildRaidsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
  ) {}

  async raids(actor: GuildActor, guildId: number): Promise<GuildRaidsDto> {
    await this.assertViewable(actor, guildId);
    const now = new Date();
    const since = new Date(now.getTime() - ATTENDANCE_WINDOW_WEEKS * WEEK_MS);
    const [upcoming, recent, schedule, comp, attendance, members] =
      await Promise.all([
        loadUpcoming(this.db, guildId, actor.id, now),
        loadRecent(this.db, guildId, since, now),
        loadScheduleRows(this.db, guildId, now),
        loadCompositionSource(this.db, guildId, now),
        loadAttendance(this.db, guildId, since, now),
        loadRosterRows(this.db, guildId),
      ]);
    const cards = upcoming.map(toCard);
    return {
      upcoming: cards,
      recent: recent.map(toRecent),
      schedule: toSchedule(schedule),
      composition: compositionOf(comp),
      attendance: {
        windowWeeks: ATTENDANCE_WINDOW_WEEKS,
        rows: toAttendanceRows(
          members,
          attendance.attendedByUser,
          attendance.of,
        ),
      },
      nextRaid: nextRaidOf(cards, now),
    };
  }

  /** 403 before 404, like the guild page (no existence leak to non-members). */
  private async assertViewable(
    actor: GuildActor,
    guildId: number,
  ): Promise<void> {
    if (!(await this.access.canView(actor, guildId))) {
      throw new ForbiddenException('Not a member of this guild');
    }
    const guild = await findGuild(this.db, guildId);
    if (!guild) throw new NotFoundException('Guild not found');
  }
}
