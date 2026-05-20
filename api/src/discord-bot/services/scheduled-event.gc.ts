import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import {
  clearScheduledEventId,
  findRLTrackedSEs,
} from './scheduled-event.db-helpers';
import { tryDeleteEvent } from './scheduled-event.discord-ops';

type Guild = NonNullable<ReturnType<DiscordBotClientService['getGuild']>>;

/** Grace window before a past-due (but never cancelled) event is considered stale.
 *  Matches the `completeScheduledEvents` cron's 5-min cadence × buffer (ROK-1332). */
const STALE_PAST_DUE_GRACE_MS = 60 * 60 * 1000;

/**
 * Sweep the guild's uncompleted scheduled events looking for RL-tracked rows
 * that should have been deleted/completed already (cancelled or >1h past
 * end-time). Deletes the stale ones from Discord, nulls their event row's
 * discord_scheduled_event_id, and returns a `{ freed, orphanCount }` tally
 * the caller uses to decide whether to retry a 30038 (ROK-1332).
 *
 * orphanCount = SEs visible to the bot that RL never created — operator-owned
 * events. NEVER deleted; just counted so the WARN can tell the operator
 * whether the cap is RL's fault or theirs.
 */
export async function gcStaleRLScheduledEvents(
  guild: Guild,
  db: PostgresJsDatabase<typeof schema>,
): Promise<{ freed: number; orphanCount: number }> {
  const all = await guild.scheduledEvents.fetch();
  const seIds = [...all.keys()];
  if (seIds.length === 0) return { freed: 0, orphanCount: 0 };

  const rlRows = await findRLTrackedSEs(db, seIds);
  const rlIds = new Set(rlRows.map((r) => r.discordScheduledEventId));
  const orphanCount = seIds.length - rlIds.size;

  const staleThreshold = new Date(Date.now() - STALE_PAST_DUE_GRACE_MS);
  let freed = 0;
  for (const row of rlRows) {
    const isStale =
      row.cancelledAt !== null || row.durationUpper < staleThreshold;
    if (!isStale) continue;
    await tryDeleteEvent(guild, row.id, row.discordScheduledEventId);
    await clearScheduledEventId(db, row.id);
    freed++;
  }

  return { freed, orphanCount };
}
