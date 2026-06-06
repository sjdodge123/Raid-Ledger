import { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import {
  clearScheduledEventId,
  findRLTrackedSEs,
} from './scheduled-event.db-helpers';
import { tryDeleteEvent } from './scheduled-event.discord-ops';
import {
  classifyUntrackedSEs,
  type GuildSEShape,
} from './scheduled-event.gc.helpers';

type Guild = NonNullable<ReturnType<DiscordBotClientService['getGuild']>>;

const gcLogger = new Logger('ScheduledEventGC');

/** A single orphan/duplicate whose delete attempt did NOT free the SE. */
export interface DeleteFailure {
  eventId: number | null;
  seId: string;
  code?: number;
}

/**
 * Result of a GC sweep. `freed` counts ONLY confirmed deletes; `deleteFailures`
 * records every attempt that returned `deleted: false` with the Discord code so
 * a `freed=0 && orphanCount>0` outcome is always accompanied by a per-orphan
 * logged reason (ROK-1347 invariant).
 */
export interface GcResult {
  freed: number;
  /** Operator-owned SEs (no live RL match) — never deleted, just counted. */
  orphanCount: number;
  deleteFailures: DeleteFailure[];
}

/**
 * Sweep the guild's uncompleted scheduled events. Two free paths:
 *
 *   1. Stale RL-tracked rows (cancelled / >1h past end) — matched via the
 *      `discord_scheduled_event_id` binding.
 *   2. RL-created DUPLICATE SEs — guild SEs NOT in the binding table but whose
 *      name+start matches a live RL event already bound to a DIFFERENT SE id.
 *      These are the timeout-after-success orphans that pinned prod at the
 *      100-SE cap (ROK-1347); GC deletes them and they DO count toward `freed`.
 *
 * Genuine operator-owned SEs (no live RL match) are counted in `orphanCount`
 * and NEVER deleted. Every failed delete is logged per-orphan with its Discord
 * code so the invariant "freed=0 with orphanCount>0 ⇒ a logged per-orphan
 * error" holds.
 */
export async function gcStaleRLScheduledEvents(
  guild: Guild,
  db: PostgresJsDatabase<typeof schema>,
): Promise<GcResult> {
  const all = await guild.scheduledEvents.fetch();
  const seValues = [...all.values()] as GuildSEShape[];
  const seIds = seValues.map((s) => s.id);
  if (seIds.length === 0)
    return { freed: 0, orphanCount: 0, deleteFailures: [] };

  const rlRows = await findRLTrackedSEs(db, seIds);
  const rlIds = new Set(rlRows.map((r) => r.discordScheduledEventId));

  const deleteFailures: DeleteFailure[] = [];
  let freed = 0;

  // Path 1: stale RL-tracked SEs.
  for (const row of rlRows) {
    if (!row.isStale) continue;
    if (
      await deleteOrRecord(
        guild,
        row.id,
        row.discordScheduledEventId,
        deleteFailures,
      )
    ) {
      await clearScheduledEventId(db, row.id);
      freed++;
    }
  }

  // Path 2: untracked guild SEs → reclassify RL duplicates vs operator orphans.
  const untracked = seValues.filter((s) => !rlIds.has(s.id));
  const { reclaimable, operatorOrphanCount } = await classifyUntrackedSEs(
    db,
    untracked,
  );
  for (const dup of reclaimable) {
    if (await deleteOrRecord(guild, dup.eventId, dup.seId, deleteFailures)) {
      freed++;
    }
  }

  return { freed, orphanCount: operatorOrphanCount, deleteFailures };
}

/** Delete one SE; on failure record + log the Discord code. Returns whether
 *  the SE is now gone (so the caller counts it toward `freed`). */
async function deleteOrRecord(
  guild: Guild,
  eventId: number | null,
  seId: string,
  failures: DeleteFailure[],
): Promise<boolean> {
  const outcome = await tryDeleteEvent(guild, eventId ?? 0, seId);
  if (outcome.deleted) return true;
  failures.push({ eventId, seId, code: outcome.code });
  gcLogger.error(
    `GC failed to delete SE ${seId} (event ${eventId ?? 'unknown'}): code=${
      outcome.code ?? 'unknown'
    }${outcome.retryAfter ? ` retryAfter=${outcome.retryAfter}s` : ''}`,
  );
  return false;
}
