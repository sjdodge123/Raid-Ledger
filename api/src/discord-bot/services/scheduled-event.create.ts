import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { resolveVoiceForCreate } from './scheduled-event.db-helpers';
import {
  getEventLiveState,
  saveScheduledEventId,
  clearScheduledEventIdBySeId,
  applyCreateEntryGuard,
  type EventLiveState,
} from './scheduled-event.revalidate';
import {
  tryCreateNewEvent,
  tryDeleteEvent,
} from './scheduled-event.discord-ops';
import { withCapacityRecovery } from './scheduled-event.capacity';
import {
  findExistingGuildSE,
  hasRLFingerprint,
  type GuildSEShape,
} from './scheduled-event.gc.helpers';
import {
  buildScheduledEventName,
  timedDiscordCall,
  type ScheduledEventData,
} from './scheduled-event.helpers';

type Guild = NonNullable<ReturnType<DiscordBotClientService['getGuild']>>;

interface VoiceChannelResolver {
  resolveVoiceChannelForScheduledEvent(
    gameId?: number | null,
    recurrenceGroupId?: string | null,
  ): Promise<string | null>;
}

/** Inputs the create helper needs to resolve the voice channel + description
 *  before the idempotent create (ROK-1347 — folded in from the service). */
export interface CreatePreamble {
  gameId?: number | null;
  voiceChannelOverride?: string | null;
  channelResolver: VoiceChannelResolver;
  describe: (eventId: number, eventData: ScheduledEventData) => Promise<string>;
}

/** Generous bound for the guild-wide SE fetch (see GuildSECache.get). */
export const GUILD_SE_FETCH_TIMEOUT_MS = 30_000;

/**
 * Per-reconciliation-batch cache of the guild's scheduled events. Fetching the
 * (up to 100) guild SEs once and reusing it across all candidates avoids N
 * fetches for N candidates during the idempotent create check (ROK-1347).
 */
export class GuildSECache {
  private cached: GuildSEShape[] | null = null;
  constructor(private readonly guild: Guild) {}

  async get(): Promise<GuildSEShape[]> {
    if (this.cached) return this.cached;
    // ROK-1391: bound the guild-wide fetch — un-timed it could hold a create in
    // flight for minutes, the root-cause stall that let a stale-payload create
    // land after a newer poll-start teardown. The bound must be GENEROUS: this
    // fetch legitimately queues 10-20s behind discord.js rate-limit buckets
    // under SE churn, and the default 5s killed every create in that state
    // (staleness itself is already neutralized by the entry guard + post-bind
    // compensation, so a slow fetch is safe — only a pathological hang is not).
    const all = await timedDiscordCall(
      'scheduledEvents.fetch',
      () => this.guild.scheduledEvents.fetch(),
      undefined,
      GUILD_SE_FETCH_TIMEOUT_MS,
    );
    this.cached = [...all.values()] as GuildSEShape[];
    return this.cached;
  }

  /** Invalidate after a create so a later candidate sees the new SE. */
  invalidate(): void {
    this.cached = null;
  }
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && /Discord API timeout/.test(err.message);
}

/**
 * Idempotent Discord Scheduled Event creation (ROK-1347).
 *
 * 1. Pre-create liveness check: if the guild already has an SE matching this
 *    event's title + start, adopt its id and skip the create (prevents the
 *    duplicate-SE-per-event mechanism that pinned prod at the 100-SE cap).
 * 2. Create wrapped in `withCapacityRecovery` (30038 → GC sweep + retry).
 * 3. Timeout-after-success recovery: if the create call times out (Discord
 *    created the SE but responded slowly), re-fetch and adopt the id by
 *    title+start before treating the call as failed — the race that orphaned
 *    SEs and left the row NULL for the next tick to re-create.
 */
export async function createScheduledEventIdempotent(
  guild: Guild,
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  eventId: number,
  eventData: ScheduledEventData,
  preamble: CreatePreamble,
  cache?: GuildSECache,
): Promise<void> {
  // ROK-1391: revalidate against live state before the create — a fire-and-forget
  // create can carry a stale pre-reschedule payload minutes after the row moved
  // (see applyCreateEntryGuard: skip on open poll / cancel, else fresh-time sub).
  const guarded = await applyCreateEntryGuard(db, logger, eventId, eventData);
  if (!guarded) return;
  eventData = guarded;
  const vc = await resolveVoiceForCreate(
    db,
    eventId,
    preamble.gameId,
    preamble.voiceChannelOverride,
    preamble.channelResolver,
  );
  if (!vc) {
    logger.warn(`Skip SE ${eventId}: no voice channel`);
    return;
  }
  const description = await preamble.describe(eventId, eventData);
  const seCache = cache ?? new GuildSECache(guild);

  if (
    await adoptExistingGuildSE(guild, db, logger, eventId, eventData, seCache)
  ) {
    return;
  }

  await withCapacityRecovery(
    guild,
    db,
    logger,
    () =>
      createOrAdoptOnTimeout({
        guild,
        db,
        logger,
        eventId,
        eventData,
        vc,
        description,
        seCache,
      }),
    // GC inside capacity recovery deletes guild SEs — drop the cached snapshot
    // so the retry's adopt path re-fetches live state (review medium).
    () => seCache.invalidate(),
  );
}

/** Pre-create liveness check: adopt a live guild SE matching this event's
 *  title+start, skipping the create. Returns true when adopted (ROK-1347). */
async function adoptExistingGuildSE(
  guild: Guild,
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  eventId: number,
  eventData: ScheduledEventData,
  seCache: GuildSECache,
): Promise<boolean> {
  // ROK-1350: the SE is created under buildScheduledEventName (title + game),
  // so adopt/match by that same name — matching by the bare title would miss a
  // renamed SE and let the next reconcile create a duplicate.
  const existing = findExistingGuildSE(
    await seCache.get(),
    buildScheduledEventName(eventData),
    eventData.startTime,
  );
  if (!existing) return false;
  // Title+start match alone could be an OPERATOR-created SE — adopting it
  // would let RL edit/complete/delete someone else's event. Only adopt SEs
  // carrying RL's own description fingerprint (Codex P2).
  if (!hasRLFingerprint(existing, eventId)) {
    logger.warn(
      `SE ${existing.id} matches event ${eventId} by title+start but lacks ` +
        `the RL fingerprint — not adopting (likely operator-created)`,
    );
    return false;
  }
  logger.warn(`Skip SE ${eventId}: live guild SE ${existing.id} matches`);
  await bindOrCompensate(guild, db, logger, eventId, existing.id, eventData);
  return true;
}

interface CreateAttempt {
  guild: Guild;
  db: PostgresJsDatabase<typeof schema>;
  logger: Logger;
  eventId: number;
  eventData: ScheduledEventData;
  vc: string;
  description: string;
  seCache: GuildSECache;
}

/** Create the SE; on a create TIMEOUT (Discord may have created it but replied
 *  slowly) re-fetch and adopt by title+start instead of letting the next tick
 *  create a duplicate (ROK-1347). */
async function createOrAdoptOnTimeout(a: CreateAttempt): Promise<void> {
  const { guild, db, logger, eventId, eventData, vc, description, seCache } = a;
  let seId: string;
  try {
    const se = await tryCreateNewEvent(
      guild,
      eventId,
      eventData,
      vc,
      description,
    );
    seId = se.id;
    seCache.invalidate();
  } catch (err) {
    if (!isTimeoutError(err)) throw err;
    seCache.invalidate();
    // ROK-1350: confirm by the same name tryCreateNewEvent wrote
    // (buildScheduledEventName), not the bare title — otherwise a renamed SE
    // created just before the timeout isn't found, the DB id stays unset, and
    // the next reconcile duplicates it.
    const confirmed = findExistingGuildSE(
      await seCache.get(),
      buildScheduledEventName(eventData),
      eventData.startTime,
    );
    // Same operator-SE safety as the pre-create check: only adopt when the SE
    // carries RL's description fingerprint (the SE we just created does — we
    // wrote that description) (Codex P2).
    if (!confirmed || !hasRLFingerprint(confirmed, eventId)) throw err;
    logger.warn(
      `Adopt SE ${confirmed.id} for event ${eventId} after create timeout`,
    );
    seId = confirmed.id;
  }
  await bindOrCompensate(guild, db, logger, eventId, seId, eventData);
}

/**
 * Post-create/adopt reconciliation for the reschedule-poll lock-in race
 * (ROK-1391). ORDERING IS LOAD-BEARING: conditional-bind FIRST, THEN re-read
 * live state, THEN compensate. Binding before the re-read (Dekker-style
 * write-before-read) closes the interleave where a concurrent poll-start
 * teardown reads the binding as NULL and returns early, then our bind lands and
 * a flagged-poll SE survives. When the bind lost the row, or the row now carries
 * an open poll / cancellation / a different start than the SE we created, delete
 * our SE and clear only the binding that still points at it.
 */
async function bindOrCompensate(
  guild: Guild,
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  eventId: number,
  seId: string,
  eventData: ScheduledEventData,
): Promise<void> {
  const { bound } = await saveScheduledEventId(db, eventId, seId);
  const live = await getEventLiveState(db, eventId);
  const decision = compensationDecision(bound, live, eventData.startTime);
  if (decision === 'none') return;
  // Codex HIGH: on a PURE start drift, the lock-in `event.updated` path may have
  // already edited OUR bound SE to the fresh time. Deleting it then would open an
  // availability gap until reconcile — re-fetch and keep the SE when it already
  // carries the fresh start. (Not applied to force legs: an open poll / cancel /
  // lost-bind SE must go regardless of its current time.)
  if (
    decision === 'start-mismatch' &&
    (await seRepairedToFreshStart(guild, seId, live!.startIso))
  ) {
    logger.log(
      `SE ${seId} for event ${eventId} already repaired to the fresh start — keeping`,
    );
    return;
  }
  logger.warn(
    `Compensating SE ${seId} for event ${eventId} after bind (${decision})`,
  );
  await tryDeleteEvent(guild, eventId, seId);
  await clearScheduledEventIdBySeId(db, seId);
}

type CompensationDecision = 'none' | 'force' | 'start-mismatch';

/** Classify a just-bound SE: `force` (bind lost the row, row hard-deleted, or an
 *  open poll / cancellation — delete unconditionally), `start-mismatch` (row start
 *  drifted — delete only if the SE wasn't repaired), or `none` (ROK-1391). */
function compensationDecision(
  bound: boolean,
  live: EventLiveState | null,
  createdStartIso: string,
): CompensationDecision {
  if (!bound) return 'force';
  if (!live) return 'force'; // row hard-deleted between bind and re-read
  if (live.reschedulingPollId != null) return 'force';
  if (live.cancelledAt != null) return 'force';
  if (new Date(live.startIso).getTime() !== new Date(createdStartIso).getTime())
    return 'start-mismatch';
  return 'none';
}

/** Re-fetch our SE and report whether its actual start now equals the live row's
 *  start — i.e. the lock-in edit already repaired it. A 10070 (SE gone) or any
 *  fetch error returns false so compensation proceeds (ROK-1391, Codex HIGH).
 *  Uses the same generous bound as the guild-wide fetch: under the rate-limit
 *  churn that motivated it, a merely-slow re-fetch must NOT read as "not repaired"
 *  and delete a now-correct SE. */
async function seRepairedToFreshStart(
  guild: Guild,
  seId: string,
  liveStartIso: string,
): Promise<boolean> {
  try {
    const se = await timedDiscordCall(
      'scheduledEvents.fetch',
      () => guild.scheduledEvents.fetch(seId),
      undefined,
      GUILD_SE_FETCH_TIMEOUT_MS,
    );
    const actualStart = (se as { scheduledStartTimestamp?: number | null })
      ?.scheduledStartTimestamp;
    return (
      actualStart != null && actualStart === new Date(liveStartIso).getTime()
    );
  } catch {
    return false;
  }
}
