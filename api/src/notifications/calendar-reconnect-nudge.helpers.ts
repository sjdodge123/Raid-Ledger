/**
 * ROK-1866: the "reconnect your calendar" nudge — one notification per
 * connection per `needs_reconnect` episode (D1). The episode is the lifetime
 * of `calendar_connections.reconnect_nudged_at`: claimed here atomically,
 * cleared by a reconnect (`reconnectSet`).
 */
import { ButtonBuilder, ButtonStyle } from 'discord.js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { CreateNotificationInput } from './notification.types';

type Db = PostgresJsDatabase<typeof schema>;

/** The Calendars section lives on the Integrations page (Q3). */
export const CALENDAR_RECONNECT_PATH = '/profile/integrations';

export interface ClaimedReconnectNudge {
  userId: number;
  provider: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  apple: 'iCloud',
};

/**
 * Claim the episode: only the caller whose UPDATE returns the row sends.
 * Matches only a `needs_reconnect` row not yet nudged whose user is still
 * active (D6: a deactivated user is skipped AND left unclaimed).
 */
export async function claimReconnectNudge(
  db: Db,
  connectionId: number,
): Promise<ClaimedReconnectNudge | null> {
  const c = schema.calendarConnections;
  const u = schema.users;
  const [row] = await db
    .update(c)
    .set({ reconnectNudgedAt: new Date() })
    .where(
      and(
        eq(c.id, connectionId),
        eq(c.status, 'needs_reconnect'),
        isNull(c.reconnectNudgedAt),
        sql`exists (select 1 from ${u} where ${u.id} = ${c.userId} and ${u.deactivatedAt} is null)`,
      ),
    )
    .returning({ userId: c.userId, provider: c.provider });
  return row ?? null;
}

function nudgeCopy(provider: string): { title: string; message: string } {
  const label = PROVIDER_LABELS[provider] ?? 'connected';
  if (provider === 'apple') {
    return {
      title: `Reconnect your ${label} calendar`,
      message:
        "Your app-specific password was revoked, so your iCloud calendar isn't syncing. Reconnect it with a new password.",
    };
  }
  return {
    title: `Reconnect your ${label} calendar`,
    message: `Raid Ledger lost access to your ${label} calendar, so game nights aren't syncing. Reconnect it on your Integrations page.`,
  };
}

/** D5 copy; `payload.url` is the same-origin path the bell item opens. */
export function buildReconnectNudgeInput(
  nudge: ClaimedReconnectNudge,
  connectionId: number,
): CreateNotificationInput {
  return {
    userId: nudge.userId,
    type: 'calendar_needs_reconnect',
    ...nudgeCopy(nudge.provider),
    payload: {
      connectionId,
      provider: nudge.provider,
      url: CALENDAR_RECONNECT_PATH,
    },
  };
}

/** The DM's primary button: "Reconnect calendar" → the Calendars page. */
export function buildCalendarReconnectButton(
  _payload: Record<string, unknown> | undefined,
  clientUrl: string,
): ButtonBuilder {
  return new ButtonBuilder()
    .setLabel('Reconnect calendar')
    .setStyle(ButtonStyle.Link)
    .setURL(`${clientUrl}${CALENDAR_RECONNECT_PATH}`);
}
