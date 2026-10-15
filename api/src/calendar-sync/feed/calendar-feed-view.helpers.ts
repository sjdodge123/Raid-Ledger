/**
 * ROK-1599: the user-facing shape of the subscribe feed — its URL — plus the
 * fire-and-forget fetch stamp. The URL carries the bearer token: hand it only
 * to its owner, and never log it (the Sentry + perf scrubbers redact
 * `/cal/u/<token>`).
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CalendarFeed } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  getClientUrl,
  type SettingsCore,
} from '../../settings/settings-bot.helpers';
import { loadFeedToken } from './calendar-feed-token.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The public path prefix nginx serves the API under. */
export const FEED_PUBLIC_PATH = '/api/cal/u';

/** `<client>/api/cal/u/<token>.ics` (trailing slashes on the client trimmed). */
export function buildFeedUrl(clientUrl: string, token: string): string {
  return `${clientUrl.replace(/\/+$/, '')}${FEED_PUBLIC_PATH}/${token}.ics`;
}

/** The feed as the owner sees it, or null when they have none. */
export async function loadFeedView(
  db: Db,
  svc: SettingsCore,
  userId: number,
): Promise<CalendarFeed | null> {
  const token = await loadFeedToken(db, userId);
  if (token === null) return null;
  return { url: buildFeedUrl(await getClientUrl(svc), token) };
}

/** Stamp `last_fetched_at`. Callers fire and forget; it never fails a feed. */
export async function touchFeedFetched(db: Db, userId: number): Promise<void> {
  await db
    .update(schema.calendarFeeds)
    .set({ lastFetchedAt: sql`now()` })
    .where(eq(schema.calendarFeeds.userId, userId));
}
