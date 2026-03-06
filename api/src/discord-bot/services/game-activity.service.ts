import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, isNull, lt } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import {
  FLUSH_INTERVAL_MS,
  MAX_SESSION_DURATION_SECONDS,
  type ActivitySource,
  type BufferedEvent,
  type SessionOpenEvent,
  type SessionCloseEvent,
  resolveGameNames,
  processOpenEvents,
  processCloseEvents,
  closeOrphanedSessions,
  aggregateRollups,
  autoHeartCheck,
} from './game-activity.helpers';

export type { ActivitySource } from './game-activity.helpers';

/**
 * GameActivityService — handles game session tracking from Discord presence
 * updates (ROK-442).
 */
@Injectable()
export class GameActivityService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(GameActivityService.name);
  private buffer: BufferedEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  /** Cache of discord activity name -> game ID (or null if unmatched) */
  private gameNameCache = new Map<string, number | null>();

  /**
   * Tracks active sources per user+game combination (ROK-591).
   * Key: `${userId}:${discordActivityName}`, Value: set of active sources.
   */
  private activeSources = new Map<string, Set<ActivitySource>>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) =>
        this.logger.error(`Buffer flush failed: ${err}`),
      );
    }, FLUSH_INTERVAL_MS);

    await closeOrphanedSessions(this.db, this.logger);
  }

  onApplicationShutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.activeSources.clear();
  }

  /**
   * Buffer a game activity start event.
   * @param source — 'presence' or 'voice'. Defaults to 'presence'.
   */
  bufferStart(
    userId: number,
    discordActivityName: string,
    startedAt: Date,
    source: ActivitySource = 'presence',
  ): void {
    const sourceKey = `${userId}:${discordActivityName}`;
    const sources = this.activeSources.get(sourceKey);

    if (sources) {
      sources.add(source);
      return;
    }

    this.activeSources.set(sourceKey, new Set([source]));
    const gameId = this.gameNameCache.get(discordActivityName);

    this.buffer.push({
      type: 'open',
      userId,
      gameId: gameId !== undefined ? gameId : null,
      discordActivityName,
      startedAt,
    });
  }

  /**
   * Buffer a game activity stop event.
   * @param source — 'presence' or 'voice'. Defaults to 'presence'.
   */
  bufferStop(
    userId: number,
    discordActivityName: string,
    endedAt: Date,
    source: ActivitySource = 'presence',
  ): void {
    const sourceKey = `${userId}:${discordActivityName}`;
    const sources = this.activeSources.get(sourceKey);

    if (sources) {
      sources.delete(source);
      if (sources.size > 0) return;
      this.activeSources.delete(sourceKey);
    }

    this.buffer.push({
      type: 'close',
      userId,
      discordActivityName,
      endedAt,
    });
  }

  /** Check if a source is currently active for a user+game. */
  hasActiveSource(
    userId: number,
    discordActivityName: string,
    source: ActivitySource,
  ): boolean {
    const sourceKey = `${userId}:${discordActivityName}`;
    return this.activeSources.get(sourceKey)?.has(source) ?? false;
  }

  /** Get all active sources for a user+game. */
  getActiveSources(
    userId: number,
    discordActivityName: string,
  ): Set<ActivitySource> | undefined {
    return this.activeSources.get(`${userId}:${discordActivityName}`);
  }

  /** Flush buffered events to the database. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0);

    const unresolvedNames = new Set<string>();
    for (const ev of events) {
      if (
        ev.type === 'open' &&
        !this.gameNameCache.has(ev.discordActivityName)
      ) {
        unresolvedNames.add(ev.discordActivityName);
      }
    }

    if (unresolvedNames.size > 0) {
      await resolveGameNames(this.db, [...unresolvedNames], this.gameNameCache);
    }

    const opens = events.filter(
      (e): e is SessionOpenEvent => e.type === 'open',
    );
    const closes = events.filter(
      (e): e is SessionCloseEvent => e.type === 'close',
    );

    await processOpenEvents(this.db, opens, this.gameNameCache, this.logger);
    await processCloseEvents(this.db, closes, this.logger);

    if (opens.length > 0 || closes.length > 0) {
      this.logger.debug(
        `Flushed ${opens.length} opens + ${closes.length} closes`,
      );
    }
  }

  /** Sweep stale sessions every 15 min. */
  @Cron('30 */15 * * * *', {
    name: 'GameActivityService_sweepStaleSessions',
  })
  async sweepStaleSessions(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'GameActivityService_sweepStaleSessions',
      async () => {
        const cutoff = new Date(
          Date.now() - MAX_SESSION_DURATION_SECONDS * 1000,
        );
        const result = await this.db
          .update(schema.gameActivitySessions)
          .set({
            endedAt: new Date(),
            durationSeconds: MAX_SESSION_DURATION_SECONDS,
          })
          .where(
            and(
              isNull(schema.gameActivitySessions.endedAt),
              lt(schema.gameActivitySessions.startedAt, cutoff),
            ),
          )
          .returning({ id: schema.gameActivitySessions.id });

        if (result.length > 0) {
          this.logger.log(`Swept ${result.length} stale session(s)`);
        }
      },
    );
  }

  /** Daily rollup cron at 5 AM. */
  @Cron('40 0 5 * * *', {
    name: 'GameActivityService_dailyRollup',
  })
  async dailyRollup(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'GameActivityService_dailyRollup',
      async () => {
        await aggregateRollups(this.db, this.logger);
        await autoHeartCheck(this.db, this.logger);
      },
    );
  }

  /** @VisibleForTesting */
  async aggregateRollups(): Promise<void> {
    await aggregateRollups(this.db, this.logger);
  }

  /** @VisibleForTesting */
  async autoHeartCheck(): Promise<void> {
    await autoHeartCheck(this.db, this.logger);
  }
}
