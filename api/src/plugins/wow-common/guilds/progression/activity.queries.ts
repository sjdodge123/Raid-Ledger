import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  GUILD_ACTIVITY_MAX,
  GUILD_ACTIVITY_WINDOW_DAYS,
  type WowGuildActivityDto,
  type WowProgressionInstanceDto,
} from '@raid-ledger/contract';
import * as schema from '../../../../drizzle/schema';
import { endedBetween, guildEvents } from '../guild-raids.queries';
import { characterLink, inLatestSnapshot } from '../guild-membership.helpers';
import { ownerIsActive } from '../guild-roster.helpers';
import { loadDingRows } from '../recent-dings/recent-dings.queries';
import {
  activityWindowStart,
  addMonthsUtc,
  dingEntries,
  eventEntries,
  firstKillEntries,
  joinEntries,
  mergeActivity,
  milestoneEntries,
  type ActivityMemberRow,
  type EndedEventRow,
} from './activity.helpers';

/**
 * ROK-1789 Part B — read queries behind the guild Progression tab's activity
 * feed (B5–B8). No access logic here: the route checks `canView` first.
 */

type Db = PostgresJsDatabase<typeof schema>;

const { guilds, guildMembers, characters, events } = schema;

const DAY_MS = 86_400_000;
/** Covers month-end clamping (Jan 31 + 1 month = Feb 28) in the SQL prefilter. */
const CLAMP_SLACK_MS = 4 * DAY_MS;

/**
 * Members in the guild's latest snapshot matching `extra`, each LEFT-joined
 * to the active RL character it links to (as `loadDingRows`). A member can
 * repeat (a GUID matching two characters); the helpers keep the first row,
 * which is the region-matched, then lowest-id character.
 */
async function loadMembers(
  db: Db,
  guildId: number,
  extra: SQL | undefined,
): Promise<ActivityMemberRow[]> {
  return db
    .select({
      memberId: guildMembers.id,
      characterName: guildMembers.characterName,
      characterId: characters.id,
      className: guildMembers.class,
      createdAt: guildMembers.createdAt,
      guildCreatedAt: guilds.createdAt,
    })
    .from(guildMembers)
    .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
    .leftJoin(characters, and(characterLink(), ownerIsActive()))
    .where(and(eq(guildMembers.guildId, guildId), inLatestSnapshot(), extra))
    .orderBy(
      asc(guildMembers.id),
      sql`${characters.region} IS NULL`,
      asc(characters.id),
    );
}

/** Current members first seen by RL inside `[since, now]` (new-member rows). */
export async function loadMemberJoinRows(
  db: Db,
  guildId: number,
  since: Date,
  now: Date,
): Promise<ActivityMemberRow[]> {
  return loadMembers(
    db,
    guildId,
    and(gte(guildMembers.createdAt, since), lte(guildMembers.createdAt, now)),
  );
}

/**
 * Current members whose 1-, 6- or 12-month anniversary can fall inside
 * `[since, now]`. A loose prefilter; `milestoneEntries` does the exact test.
 */
export async function loadMilestoneRows(
  db: Db,
  guildId: number,
  since: Date,
  now: Date,
): Promise<ActivityMemberRow[]> {
  const oldest = addMonthsUtc(since, -12).getTime() - CLAMP_SLACK_MS;
  const newest = addMonthsUtc(now, -1).getTime() + CLAMP_SLACK_MS;
  return loadMembers(
    db,
    guildId,
    and(
      gte(guildMembers.createdAt, new Date(oldest)),
      lte(guildMembers.createdAt, new Date(newest)),
    ),
  );
}

/** Guild events that ended inside the window, newest first (Q-B19). */
export async function loadEndedEventRows(
  db: Db,
  guildId: number,
  since: Date,
  now: Date,
): Promise<EndedEventRow[]> {
  const rows = await db
    .select({ id: events.id, title: events.title, duration: events.duration })
    .from(events)
    .where(and(guildEvents(guildId), endedBetween(since, now)))
    .orderBy(desc(sql`upper(${events.duration})`))
    .limit(GUILD_ACTIVITY_MAX);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    endedAt: r.duration[1],
  }));
}

/**
 * The guild's 30-day activity feed (B5–B8). `instances` is the progression
 * half already built for the same page (first kills come from its bosses),
 * so the route loads pulls once.
 */
export async function loadGuildActivity(
  db: Db,
  guildId: number,
  now: Date,
  instances: readonly WowProgressionInstanceDto[],
): Promise<WowGuildActivityDto> {
  const since = activityWindowStart(now);
  const [joins, members, ended, dings] = await Promise.all([
    loadMemberJoinRows(db, guildId, since, now),
    loadMilestoneRows(db, guildId, since, now),
    loadEndedEventRows(db, guildId, since, now),
    loadDingRows(db, guildId, since, GUILD_ACTIVITY_MAX * 2),
  ]);
  const entries = mergeActivity([
    firstKillEntries(instances, since, now),
    joinEntries(joins),
    milestoneEntries(members, since, now),
    eventEntries(ended),
    dingEntries(dings),
  ]);
  return { entries, windowDays: GUILD_ACTIVITY_WINDOW_DAYS };
}
