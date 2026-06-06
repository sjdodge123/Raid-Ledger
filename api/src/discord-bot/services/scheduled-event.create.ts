import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import {
  resolveVoiceForCreate,
  saveScheduledEventId,
} from './scheduled-event.db-helpers';
import { tryCreateNewEvent } from './scheduled-event.discord-ops';
import { withCapacityRecovery } from './scheduled-event.capacity';
import {
  findExistingGuildSE,
  type GuildSEShape,
} from './scheduled-event.gc.helpers';
import type { ScheduledEventData } from './scheduled-event.helpers';

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
    const all = await this.guild.scheduledEvents.fetch();
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

  if (await adoptExistingGuildSE(db, logger, eventId, eventData, seCache)) {
    return;
  }

  await withCapacityRecovery(guild, db, logger, () =>
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
  );
}

/** Pre-create liveness check: adopt a live guild SE matching this event's
 *  title+start, skipping the create. Returns true when adopted (ROK-1347). */
async function adoptExistingGuildSE(
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
  eventId: number,
  eventData: ScheduledEventData,
  seCache: GuildSECache,
): Promise<boolean> {
  const existing = findExistingGuildSE(
    await seCache.get(),
    eventData.title,
    eventData.startTime,
  );
  if (!existing) return false;
  logger.warn(`Skip SE ${eventId}: live guild SE ${existing.id} matches`);
  await saveScheduledEventId(db, eventId, existing.id);
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
  try {
    const se = await tryCreateNewEvent(
      guild,
      eventId,
      eventData,
      vc,
      description,
    );
    await saveScheduledEventId(db, eventId, se.id);
    seCache.invalidate();
  } catch (err) {
    if (!isTimeoutError(err)) throw err;
    seCache.invalidate();
    const confirmed = findExistingGuildSE(
      await seCache.get(),
      eventData.title,
      eventData.startTime,
    );
    if (!confirmed) throw err;
    logger.warn(
      `Adopt SE ${confirmed.id} for event ${eventId} after create timeout`,
    );
    await saveScheduledEventId(db, eventId, confirmed.id);
  }
}
