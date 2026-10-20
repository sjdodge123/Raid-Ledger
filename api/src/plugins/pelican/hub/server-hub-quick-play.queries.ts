import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdHocStatusEnum, type HubQuickPlayItem } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Default and maximum page size of `GET plugins/pelican/hubs/:id/quick-play`. */
export const QUICK_PLAY_DEFAULT_LIMIT = 20;
export const QUICK_PLAY_MAX_LIMIT = 50;

/** Parse the `limit` query param into [1, MAX]; junk → the default. */
export function clampQuickPlayLimit(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return QUICK_PLAY_DEFAULT_LIMIT;
  return Math.min(n, QUICK_PLAY_MAX_LIMIT);
}

/** Ad-hoc events with a participant on this Pelican server, newest first. */
export async function listQuickPlays(
  db: Db,
  pelicanServerId: number,
  limit: number,
): Promise<HubQuickPlayItem[]> {
  const e = schema.events;
  const p = schema.adHocParticipants;
  const rows = await db
    .select({
      eventId: e.id,
      duration: e.duration,
      status: e.adHocStatus,
      participantCount: sql<number>`count(${p.id})::int`,
    })
    .from(e)
    .innerJoin(p, eq(p.eventId, e.id))
    .where(and(eq(e.isAdHoc, true), eq(p.pelicanServerId, pelicanServerId)))
    .groupBy(e.id)
    .orderBy(desc(sql`lower(${e.duration})`), desc(e.id))
    .limit(limit);
  return rows.map(toQuickPlayItem);
}

type QuickPlayRow = {
  eventId: number;
  duration: [Date, Date];
  status: string | null;
  participantCount: number;
};

function toQuickPlayItem(r: QuickPlayRow): HubQuickPlayItem {
  const parsed = AdHocStatusEnum.safeParse(r.status);
  const status = parsed.success ? parsed.data : 'ended';
  return {
    eventId: r.eventId,
    startedAt: r.duration[0].toISOString(),
    endedAt: status === 'ended' ? r.duration[1].toISOString() : null,
    status,
    participantCount: r.participantCount,
  };
}
