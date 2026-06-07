import { Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { tryDeleteEvent } from './scheduled-event.discord-ops';
import {
  clearReconcileBackoff,
  findRLTrackedSEs,
} from './scheduled-event.db-helpers';
import {
  classifyUntrackedSEs,
  type GuildSEShape,
} from './scheduled-event.gc.helpers';

type Guild = NonNullable<ReturnType<DiscordBotClientService['getGuild']>>;

/** Cap deletes per invocation so a ~80-orphan recovery doesn't burst the
 *  Discord rate limit; the endpoint is re-runnable until empty (ROK-1347). */
export const RECOVERY_DELETE_BATCH = 25;

export interface RecoveryDuplicate {
  eventId: number;
  seId: string;
  title: string;
  start: string;
}

export interface RecoveryResult {
  dryRun: boolean;
  guildSeCount: number;
  rlBound: number;
  reclaimableDuplicates: RecoveryDuplicate[];
  /**
   * ROK-1355: untracked SEs whose description carries the configured
   * CLIENT_URL's `/events/<id>` fingerprint but match NO live RL event —
   * stale RL-created duplicates of already-ended events. Populated (and
   * deleted on dryRun=false) only when `includeStale` is requested.
   */
  staleReclaimable: RecoveryDuplicate[];
  operatorOrphans: number;
  deleted: number;
  failures: Array<{ seId: string; code?: number; retryAfter?: number }>;
}

/**
 * Operator-gated recovery for the 80-orphan production freeze (ROK-1347).
 *
 * Lists guild SEs, classifies RL-created duplicates (untracked but matching a
 * live RL event already bound to a DIFFERENT SE) vs genuine operator orphans.
 * dryRun → returns the candidate set without touching Discord. dryRun=false →
 * deletes up to RECOVERY_DELETE_BATCH duplicates, then clears the capacity
 * backoff on the affected events so the next reconcile tick recreates any
 * missing SEs immediately. Never deletes operator orphans. Re-runnable.
 */
export async function recoverOrphanScheduledEvents(
  guild: Guild,
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  opts: { dryRun: boolean; staleClientUrl?: string | null },
): Promise<RecoveryResult> {
  const all = await guild.scheduledEvents.fetch();
  const seValues = [...all.values()] as GuildSEShape[];
  const seIds = seValues.map((s) => s.id);

  const rlRows = seIds.length ? await findRLTrackedSEs(db, seIds) : [];
  const rlIds = new Set(rlRows.map((r) => r.discordScheduledEventId));
  const untracked = seValues.filter((s) => !rlIds.has(s.id));

  const { reclaimable, operatorOrphanCount } = await classifyUntrackedSEs(
    db,
    untracked,
  );
  const duplicates = toRecoveryDuplicates(reclaimable, seValues);

  // ROK-1355: stale pass — fingerprint-only reclaim of RL-created SEs whose
  // event has already ended (no live match possible). Gated on the caller
  // providing the configured CLIENT_URL.
  const reclaimedIds = new Set(reclaimable.map((r) => r.seId));
  const stale = opts.staleClientUrl
    ? classifyStaleRLSEs(untracked, reclaimedIds, opts.staleClientUrl)
    : [];

  const base: RecoveryResult = {
    dryRun: opts.dryRun,
    guildSeCount: seIds.length,
    rlBound: rlIds.size,
    reclaimableDuplicates: duplicates,
    staleReclaimable: stale,
    operatorOrphans: operatorOrphanCount - stale.length,
    deleted: 0,
    failures: [],
  };
  if (opts.dryRun) return base;

  return executeRecovery(guild, db, logger, base, [...duplicates, ...stale]);
}

/**
 * ROK-1355: classify untracked SEs (already excluded: tracked + live-match
 * reclaimable) whose description carries `{clientUrl}/events/<id>` — the
 * fingerprint ONLY RL-created SEs have. Operator-created Discord events never
 * contain the app's event URL, so this is safe to delete even without a live
 * RL event to pair against (the event ended; its duplicate outlived it).
 */
function classifyStaleRLSEs(
  untracked: GuildSEShape[],
  alreadyReclaimedIds: Set<string>,
  clientUrl: string,
): RecoveryDuplicate[] {
  const prefix = `${clientUrl.replace(/\/+$/, '')}/events/`;
  const out: RecoveryDuplicate[] = [];
  for (const se of untracked) {
    if (alreadyReclaimedIds.has(se.id)) continue;
    const desc = se.description ?? '';
    const idx = desc.indexOf(prefix);
    if (idx === -1) continue;
    const m = /^(\d+)/.exec(desc.slice(idx + prefix.length));
    if (!m) continue;
    const startMs =
      se.scheduledStartTimestamp ?? se.scheduledStartAt?.getTime() ?? null;
    out.push({
      eventId: Number(m[1]),
      seId: se.id,
      title: se.name ?? '',
      start: startMs != null ? new Date(startMs).toISOString() : '',
    });
  }
  return out;
}

function toRecoveryDuplicates(
  reclaimable: Array<{ eventId: number; seId: string }>,
  seValues: GuildSEShape[],
): RecoveryDuplicate[] {
  const byId = new Map(seValues.map((s) => [s.id, s]));
  return reclaimable.map((d) => {
    const se = byId.get(d.seId);
    const startMs =
      se?.scheduledStartTimestamp ?? se?.scheduledStartAt?.getTime() ?? null;
    return {
      eventId: d.eventId,
      seId: d.seId,
      title: se?.name ?? '',
      start: startMs != null ? new Date(startMs).toISOString() : '',
    };
  });
}

async function executeRecovery(
  guild: Guild,
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  result: RecoveryResult,
  duplicates: RecoveryDuplicate[],
): Promise<RecoveryResult> {
  const batch = duplicates.slice(0, RECOVERY_DELETE_BATCH);
  const deletedDups: RecoveryDuplicate[] = [];
  for (const dup of batch) {
    if (await deleteDuplicate(guild, logger, dup, result)) {
      deletedDups.push(dup);
    }
  }
  // Only SUCCESSFULLY deleted duplicates may clear a (flipped) binding — a
  // failed delete means the SE is still live on Discord, and nulling its
  // binding would make the next tick mint another duplicate (Codex P2,
  // fix/batch-2026-06-06).
  await reconcileBoundIds(db, deletedDups);
  // Clearing backoff lets the next reconcile recreate any genuinely missing SE.
  await clearReconcileBackoff(
    db,
    deletedDups.map((d) => d.eventId),
  );
  return result;
}

/** Delete one duplicate SE, recording deleted/failure into `result`. */
async function deleteDuplicate(
  guild: Guild,
  logger: Logger,
  dup: RecoveryDuplicate,
  result: RecoveryResult,
): Promise<boolean> {
  const outcome = await tryDeleteEvent(guild, dup.eventId, dup.seId);
  if (outcome.deleted) {
    result.deleted++;
    return true;
  }
  result.failures.push({
    seId: dup.seId,
    code: outcome.code,
    retryAfter: outcome.retryAfter,
  });
  logger.warn(
    `Recovery delete SE ${dup.seId} (event ${dup.eventId}) failed: code=${
      outcome.code ?? 'unknown'
    }${outcome.retryAfter ? ` retryAfter=${outcome.retryAfter}s` : ''}`,
  );
  return false;
}

/**
 * If the duplicate we just deleted was actually the id stored on the event row
 * (shouldn't happen — duplicates are by definition the non-bound copy — but a
 * binding could have flipped between classification and delete), null it so the
 * next reconcile recreates it. Bound ids that survive are left untouched.
 */
async function reconcileBoundIds(
  db: PostgresJsDatabase<typeof schema>,
  batch: RecoveryDuplicate[],
): Promise<void> {
  if (batch.length === 0) return;
  const rows = await db
    .select({
      id: schema.events.id,
      seId: schema.events.discordScheduledEventId,
    })
    .from(schema.events)
    .where(
      inArray(
        schema.events.id,
        batch.map((b) => b.eventId),
      ),
    );
  const deletedSeByEvent = new Map(batch.map((b) => [b.eventId, b.seId]));
  for (const row of rows) {
    if (row.seId && row.seId === deletedSeByEvent.get(row.id)) {
      await db
        .update(schema.events)
        .set({ discordScheduledEventId: null })
        .where(eq(schema.events.id, row.id));
    }
  }
}
