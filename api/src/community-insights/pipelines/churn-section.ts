import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CommunityChurnResponseDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type {
  ChurnDetectionService,
  ChurnInputRow,
} from '../churn-detection.service';

type Db = PostgresJsDatabase<typeof schema>;

export interface ChurnSectionSettings {
  thresholdPct: number;
  baselineWeeks: number;
  recentWeeks: number;
}

export async function buildChurnSection(
  db: Db,
  snapshotDate: string,
  churn: ChurnDetectionService,
  settings: ChurnSectionSettings,
): Promise<CommunityChurnResponseDto> {
  const inputs = await loadChurnInputs(db);
  const result = churn.findAtRiskPlayers(inputs, settings);
  return { snapshotDate, ...result };
}

async function loadChurnInputs(db: Db): Promise<ChurnInputRow[]> {
  const rows = await db
    .select({
      userId: schema.playerIntensitySnapshots.userId,
      weekStart: schema.playerIntensitySnapshots.weekStart,
      totalHours: schema.playerIntensitySnapshots.totalHours,
      username: schema.users.username,
      avatar: schema.users.avatar,
    })
    .from(schema.playerIntensitySnapshots)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.playerIntensitySnapshots.userId),
    )
    .orderBy(asc(schema.playerIntensitySnapshots.weekStart));
  return groupByUser(rows);
}

interface RawRow {
  userId: number;
  weekStart: string | Date;
  totalHours: string | number;
  username: string;
  avatar: string | null;
}

function groupByUser(rows: RawRow[]): ChurnInputRow[] {
  const byUser = new Map<number, ChurnInputRow>();
  for (const r of rows) {
    const existing = byUser.get(r.userId);
    const week = {
      weekStart: String(r.weekStart),
      totalHours: Number(r.totalHours),
    };
    if (existing) {
      existing.weeks.push(week);
    } else {
      byUser.set(r.userId, {
        userId: r.userId,
        username: r.username,
        avatar: r.avatar,
        weeks: [week],
      });
    }
  }
  return Array.from(byUser.values());
}
