import { and, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildEventCardDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

/**
 * ROK-2185 item 2 — the hub event cards' member signup count: of an upcoming
 * event's live signups, how many belong to the hub's member set (each hub
 * kind supplies its own set). Core, so every hub kind shares it.
 */

type Db = PostgresJsDatabase<typeof schema>;

/** `event_signups` aliased `s`, the alias `LIVE_SIGNUP` is written against. */
const s = alias(schema.eventSignups, 's');

/**
 * The live-signup predicate behind a hub card's `signupCount` (raw SQL over
 * the alias `s`): signed up or tentative; departed and declined excluded.
 */
export const LIVE_SIGNUP: SQL = sql.raw(
  `s.status in ('signed_up', 'tentative')`,
);

/**
 * Per event id, how many live signups are by a user in `memberUserIds`.
 * Events with none are absent from the map. One select, counted in JS;
 * empty inputs answer an empty map without a query.
 */
export async function countMemberSignups(
  db: Db,
  eventIds: readonly number[],
  memberUserIds: readonly number[],
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (eventIds.length === 0 || memberUserIds.length === 0) return counts;
  const members = new Set(memberUserIds);
  const rows = await db
    .select({ eventId: s.eventId, userId: s.userId })
    .from(s)
    .where(and(inArray(s.eventId, [...eventIds]), LIVE_SIGNUP));
  for (const r of rows) {
    if (r.userId === null || !members.has(r.userId)) continue;
    counts.set(r.eventId, (counts.get(r.eventId) ?? 0) + 1);
  }
  return counts;
}

/**
 * The cards with `memberSignupCount` filled (0 when no member signed up), so
 * the client can tell "none" from an old server that never sent it.
 */
export async function withMemberSignupCounts(
  db: Db,
  cards: GuildEventCardDto[],
  memberUserIds: readonly number[],
): Promise<GuildEventCardDto[]> {
  const ids = cards.map((c) => c.id);
  const counts = await countMemberSignups(db, ids, memberUserIds);
  return cards.map((c) => ({ ...c, memberSignupCount: counts.get(c.id) ?? 0 }));
}
