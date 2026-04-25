import { desc, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CommunityEngagementResponseDto,
  IntensityHistogramBucketDto,
  WeeklyActiveUsersPointDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

const WEEKS_WINDOW = 12;
const HISTOGRAM_BUCKETS = 10;
const HISTOGRAM_MAX_HOURS = 50;

/**
 * Engagement payload: 12 weeks of weekly-active-users (distinct users
 * with a weekly intensity snapshot) and a 10-bucket histogram of the
 * most recent week's total hours.
 */
export async function buildEngagementSection(
  db: Db,
  snapshotDate: string,
): Promise<CommunityEngagementResponseDto> {
  const weeklyActiveUsers = await computeWeeklyActive(db);
  const latestWeek = weeklyActiveUsers[weeklyActiveUsers.length - 1]?.weekStart;
  const intensityHistogram = latestWeek
    ? await computeHistogram(db, latestWeek)
    : emptyHistogram();
  return { snapshotDate, weeklyActiveUsers, intensityHistogram };
}

async function computeWeeklyActive(
  db: Db,
): Promise<WeeklyActiveUsersPointDto[]> {
  const rows = await db
    .select({
      weekStart: schema.playerIntensitySnapshots.weekStart,
      activeUsers: sql<number>`count(distinct ${schema.playerIntensitySnapshots.userId})`,
    })
    .from(schema.playerIntensitySnapshots)
    .groupBy(schema.playerIntensitySnapshots.weekStart)
    .orderBy(desc(schema.playerIntensitySnapshots.weekStart))
    .limit(WEEKS_WINDOW);
  return rows
    .map((r) => ({
      weekStart: String(r.weekStart),
      activeUsers: Number(r.activeUsers),
    }))
    .reverse();
}

async function computeHistogram(
  db: Db,
  weekStart: string,
): Promise<IntensityHistogramBucketDto[]> {
  const rows = await db
    .select({ totalHours: schema.playerIntensitySnapshots.totalHours })
    .from(schema.playerIntensitySnapshots)
    .where(sql`${schema.playerIntensitySnapshots.weekStart} = ${weekStart}`);
  const buckets = emptyHistogram();
  for (const r of rows) {
    const hrs = Number(r.totalHours);
    const idx = bucketIndex(hrs);
    buckets[idx].userCount += 1;
  }
  return buckets;
}

function emptyHistogram(): IntensityHistogramBucketDto[] {
  const step = HISTOGRAM_MAX_HOURS / HISTOGRAM_BUCKETS;
  const out: IntensityHistogramBucketDto[] = [];
  for (let i = 0; i < HISTOGRAM_BUCKETS; i++) {
    out.push({
      bucketStart: i * step,
      bucketEnd: (i + 1) * step,
      userCount: 0,
    });
  }
  return out;
}

function bucketIndex(hours: number): number {
  const step = HISTOGRAM_MAX_HOURS / HISTOGRAM_BUCKETS;
  if (hours <= 0) return 0;
  const idx = Math.min(Math.floor(hours / step), HISTOGRAM_BUCKETS - 1);
  return idx;
}
