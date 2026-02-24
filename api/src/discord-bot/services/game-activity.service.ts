import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and, isNull, lt, sql, isNotNull, gte } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { CronJobService } from '../../cron-jobs/cron-job.service';

/** Maximum session duration in seconds (24 hours) */
const MAX_SESSION_DURATION_SECONDS = 24 * 60 * 60;

/** How often to flush the in-memory buffer to the database (ms) */
const FLUSH_INTERVAL_MS = 30_000;

interface SessionOpenEvent {
  type: 'open';
  userId: number;
  gameId: number | null;
  discordActivityName: string;
  startedAt: Date;
}

interface SessionCloseEvent {
  type: 'close';
  userId: number;
  discordActivityName: string;
  endedAt: Date;
}

type BufferedEvent = SessionOpenEvent | SessionCloseEvent;

/**
 * GameActivityService — handles game session tracking from Discord presence
 * updates (ROK-442).
 *
 * Responsibilities:
 * - Buffers presence events in memory and flushes to DB periodically
 * - Resolves Discord activity names to game IDs via exact match + mappings table
 * - Sweeps stale sessions (users who went offline without explicit stop)
 * - Closes leftover sessions on startup (from prior bot restart)
 * - Aggregates sessions into rollups via daily cron
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

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Start the periodic flush timer
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) =>
        this.logger.error(`Buffer flush failed: ${err}`),
      );
    }, FLUSH_INTERVAL_MS);

    // Close any sessions left open from a prior restart
    await this.closeOrphanedSessions();
  }

  onApplicationShutdown(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // ─── Public API (called by ActivityListener) ──────────────────

  /**
   * Buffer a game activity start event.
   */
  bufferStart(
    userId: number,
    discordActivityName: string,
    startedAt: Date,
  ): void {
    // Resolve game ID synchronously from cache if possible
    const gameId = this.gameNameCache.get(discordActivityName);
    if (gameId !== undefined) {
      this.buffer.push({
        type: 'open',
        userId,
        gameId,
        discordActivityName,
        startedAt,
      });
      return;
    }

    // If not cached, push with a sentinel and resolve during flush
    this.buffer.push({
      type: 'open',
      userId,
      gameId: null, // will be resolved in flush
      discordActivityName,
      startedAt,
    });
  }

  /**
   * Buffer a game activity stop event.
   */
  bufferStop(userId: number, discordActivityName: string, endedAt: Date): void {
    this.buffer.push({
      type: 'close',
      userId,
      discordActivityName,
      endedAt,
    });
  }

  // ─── Periodic flush ───────────────────────────────────────────

  /**
   * Flush buffered events to the database. Called every 30 seconds.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Drain the buffer
    const events = this.buffer.splice(0);

    // Collect unique activity names that need resolution
    const unresolvedNames = new Set<string>();
    for (const ev of events) {
      if (
        ev.type === 'open' &&
        !this.gameNameCache.has(ev.discordActivityName)
      ) {
        unresolvedNames.add(ev.discordActivityName);
      }
    }

    // Resolve game IDs for uncached names
    if (unresolvedNames.size > 0) {
      await this.resolveGameNames([...unresolvedNames]);
    }

    // Process opens
    const opens = events.filter(
      (e): e is SessionOpenEvent => e.type === 'open',
    );
    for (const ev of opens) {
      // Re-resolve game ID from cache (may have been resolved during this flush)
      const resolvedGameId = this.gameNameCache.get(ev.discordActivityName);
      const gameId = resolvedGameId !== undefined ? resolvedGameId : null;

      try {
        await this.db.insert(schema.gameActivitySessions).values({
          userId: ev.userId,
          gameId,
          discordActivityName: ev.discordActivityName,
          startedAt: ev.startedAt,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to insert session for user ${ev.userId} / "${ev.discordActivityName}": ${err}`,
        );
      }
    }

    // Process closes
    const closes = events.filter(
      (e): e is SessionCloseEvent => e.type === 'close',
    );
    for (const ev of closes) {
      try {
        // Find the open session for this user + activity name
        const [session] = await this.db
          .select({
            id: schema.gameActivitySessions.id,
            startedAt: schema.gameActivitySessions.startedAt,
          })
          .from(schema.gameActivitySessions)
          .where(
            and(
              eq(schema.gameActivitySessions.userId, ev.userId),
              eq(
                schema.gameActivitySessions.discordActivityName,
                ev.discordActivityName,
              ),
              isNull(schema.gameActivitySessions.endedAt),
            ),
          )
          .orderBy(schema.gameActivitySessions.startedAt)
          .limit(1);

        if (session) {
          const durationSeconds = Math.floor(
            (ev.endedAt.getTime() - session.startedAt.getTime()) / 1000,
          );
          const cappedDuration = Math.min(
            durationSeconds,
            MAX_SESSION_DURATION_SECONDS,
          );

          await this.db
            .update(schema.gameActivitySessions)
            .set({
              endedAt: ev.endedAt,
              durationSeconds: cappedDuration,
            })
            .where(eq(schema.gameActivitySessions.id, session.id));
        }
      } catch (err) {
        this.logger.warn(
          `Failed to close session for user ${ev.userId} / "${ev.discordActivityName}": ${err}`,
        );
      }
    }

    if (opens.length > 0 || closes.length > 0) {
      this.logger.debug(
        `Flushed ${opens.length} opens + ${closes.length} closes`,
      );
    }
  }

  // ─── Game name resolution ─────────────────────────────────────

  /**
   * Resolve Discord activity names to game IDs.
   * 1. Exact match against games.name
   * 2. Lookup in discord_game_mappings table
   * 3. Store null for unmatched names
   */
  private async resolveGameNames(names: string[]): Promise<void> {
    for (const name of names) {
      // 1. Check discord_game_mappings first (admin overrides take priority)
      const [mapping] = await this.db
        .select({ gameId: schema.discordGameMappings.gameId })
        .from(schema.discordGameMappings)
        .where(eq(schema.discordGameMappings.discordActivityName, name))
        .limit(1);

      if (mapping) {
        this.gameNameCache.set(name, mapping.gameId);
        continue;
      }

      // 2. Exact match against games.name
      const [game] = await this.db
        .select({ id: schema.games.id })
        .from(schema.games)
        .where(eq(schema.games.name, name))
        .limit(1);

      if (game) {
        this.gameNameCache.set(name, game.id);
        continue;
      }

      // 3. Unmatched — store null
      this.gameNameCache.set(name, null);
    }
  }

  // ─── Stale session sweep (every 15 min) ───────────────────────

  @Cron('0 */15 * * * *', {
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
          this.logger.log(
            `Swept ${result.length} stale session(s) older than 24h`,
          );
        }
      },
    );
  }

  // ─── Rollup cron (daily at 5 AM) ─────────────────────────────

  @Cron('0 5 * * *', {
    name: 'GameActivityService_dailyRollup',
  })
  async dailyRollup(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'GameActivityService_dailyRollup',
      async () => {
        await this.aggregateRollups();
      },
    );
  }

  /**
   * Aggregate closed sessions with non-null game_id into rollup rows.
   * Produces day, week, and month period rows.
   * Uses upsert (ON CONFLICT UPDATE) for idempotency.
   */
  async aggregateRollups(): Promise<void> {
    // Process sessions closed in the last 48 hours to catch any stragglers
    const since = new Date();
    since.setHours(since.getHours() - 48);

    const closedSessions = await this.db
      .select({
        userId: schema.gameActivitySessions.userId,
        gameId: schema.gameActivitySessions.gameId,
        startedAt: schema.gameActivitySessions.startedAt,
        durationSeconds: schema.gameActivitySessions.durationSeconds,
      })
      .from(schema.gameActivitySessions)
      .where(
        and(
          isNotNull(schema.gameActivitySessions.endedAt),
          isNotNull(schema.gameActivitySessions.gameId),
          isNotNull(schema.gameActivitySessions.durationSeconds),
          gte(schema.gameActivitySessions.endedAt, since),
        ),
      );

    if (closedSessions.length === 0) {
      this.logger.debug('No closed sessions to roll up');
      return;
    }

    // Group by user + game + period
    const rollupMap = new Map<
      string,
      {
        userId: number;
        gameId: number;
        period: string;
        periodStart: string;
        totalSeconds: number;
      }
    >();

    for (const session of closedSessions) {
      if (!session.gameId || !session.durationSeconds) continue;

      const sessionDate = session.startedAt;

      // Day period
      const dayStart = this.formatDate(sessionDate);
      this.addToRollupMap(
        rollupMap,
        session.userId,
        session.gameId,
        'day',
        dayStart,
        session.durationSeconds,
      );

      // Week period (ISO week, Monday start)
      const weekStart = this.getWeekStart(sessionDate);
      this.addToRollupMap(
        rollupMap,
        session.userId,
        session.gameId,
        'week',
        weekStart,
        session.durationSeconds,
      );

      // Month period
      const monthStart = `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, '0')}-01`;
      this.addToRollupMap(
        rollupMap,
        session.userId,
        session.gameId,
        'month',
        monthStart,
        session.durationSeconds,
      );
    }

    // Upsert rollup rows
    let upsertCount = 0;
    for (const rollup of rollupMap.values()) {
      await this.db
        .insert(schema.gameActivityRollups)
        .values({
          userId: rollup.userId,
          gameId: rollup.gameId,
          period: rollup.period,
          periodStart: rollup.periodStart,
          totalSeconds: rollup.totalSeconds,
        })
        .onConflictDoUpdate({
          target: [
            schema.gameActivityRollups.userId,
            schema.gameActivityRollups.gameId,
            schema.gameActivityRollups.period,
            schema.gameActivityRollups.periodStart,
          ],
          set: {
            totalSeconds: sql`${schema.gameActivityRollups.totalSeconds} + ${rollup.totalSeconds}`,
          },
        });
      upsertCount++;
    }

    this.logger.log(
      `Rolled up ${closedSessions.length} session(s) into ${upsertCount} rollup row(s)`,
    );
  }

  // ─── Startup cleanup ─────────────────────────────────────────

  /**
   * Close any sessions left open from a prior bot restart.
   * Sets ended_at to now and caps duration at 24h.
   */
  private async closeOrphanedSessions(): Promise<void> {
    const now = new Date();
    const cutoff = new Date(
      now.getTime() - MAX_SESSION_DURATION_SECONDS * 1000,
    );

    // Sessions started more than 24h ago — cap at max duration
    const staleResult = await this.db
      .update(schema.gameActivitySessions)
      .set({
        endedAt: now,
        durationSeconds: MAX_SESSION_DURATION_SECONDS,
      })
      .where(
        and(
          isNull(schema.gameActivitySessions.endedAt),
          lt(schema.gameActivitySessions.startedAt, cutoff),
        ),
      )
      .returning({ id: schema.gameActivitySessions.id });

    // Sessions started within last 24h — compute actual duration
    const recentResult = await this.db
      .update(schema.gameActivitySessions)
      .set({
        endedAt: now,
        durationSeconds: sql`EXTRACT(EPOCH FROM ${now.toISOString()}::timestamp - ${schema.gameActivitySessions.startedAt})::integer`,
      })
      .where(
        and(
          isNull(schema.gameActivitySessions.endedAt),
          gte(schema.gameActivitySessions.startedAt, cutoff),
        ),
      )
      .returning({ id: schema.gameActivitySessions.id });

    const total = staleResult.length + recentResult.length;
    if (total > 0) {
      this.logger.log(
        `Closed ${total} orphaned session(s) from prior restart (${staleResult.length} stale, ${recentResult.length} recent)`,
      );
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private addToRollupMap(
    map: Map<
      string,
      {
        userId: number;
        gameId: number;
        period: string;
        periodStart: string;
        totalSeconds: number;
      }
    >,
    userId: number,
    gameId: number,
    period: string,
    periodStart: string,
    durationSeconds: number,
  ): void {
    const key = `${userId}:${gameId}:${period}:${periodStart}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalSeconds += durationSeconds;
    } else {
      map.set(key, {
        userId,
        gameId,
        period,
        periodStart,
        totalSeconds: durationSeconds,
      });
    }
  }

  private formatDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  private getWeekStart(date: Date): string {
    const d = new Date(date);
    const day = d.getDay();
    // Adjust to Monday (ISO week start)
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return this.formatDate(d);
  }
}
