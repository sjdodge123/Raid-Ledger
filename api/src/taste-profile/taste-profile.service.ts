import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type {
  TasteProfileArchetype,
  TasteProfileDimensionsDto,
} from '@raid-ledger/contract';
import { CronJobService } from '../cron-jobs/cron-job.service';
import {
  computeTasteVector,
  type GameMetadata,
  type UserGameSignal,
} from './taste-vector.helpers';
import {
  computeIntensityMetrics,
  type CommunityStats,
  type WeeklySnapshotInput,
} from './intensity-rollup.helpers';
import { aggregateCoPlay } from './co-play-graph.helpers';
import { deriveArchetype } from './archetype.helpers';
import { computeSignalHash, type SignalSummary } from './signal-hash.helpers';

@Injectable()
export class TasteProfileService {
  private readonly logger = new Logger(TasteProfileService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cronJobService: CronJobService,
  ) {}

  // ─── Cron wrappers ────────────────────────────────────────────

  @Cron('0 30 5 * * *', { name: 'TasteProfileService_aggregateVectors' })
  async aggregateVectorsCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'TasteProfileService_aggregateVectors',
      () => this.aggregateVectors(),
    );
  }

  @Cron('0 45 5 * * *', { name: 'TasteProfileService_buildCoPlayGraph' })
  async buildCoPlayGraphCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'TasteProfileService_buildCoPlayGraph',
      () => this.buildCoPlayGraph(),
    );
  }

  @Cron('0 0 6 * * 0', {
    name: 'TasteProfileService_weeklyIntensityRollup',
  })
  async weeklyIntensityRollupCron(): Promise<void> {
    await this.cronJobService.executeWithTracking(
      'TasteProfileService_weeklyIntensityRollup',
      () => this.weeklyIntensityRollup(),
    );
  }

  // ─── Core pipelines ───────────────────────────────────────────

  async aggregateVectors(): Promise<void> {
    const users = await this.db
      .select({ id: schema.users.id })
      .from(schema.users);
    const gameMap = await this.loadGameMetadata();

    for (const { id: userId } of users) {
      const signals = await this.loadUserSignals(userId);
      if (signals.length === 0) continue;

      const signalHash = await this.computeUserSignalHash(userId);
      const existing = await this.db
        .select()
        .from(schema.playerTasteVectors)
        .where(eq(schema.playerTasteVectors.userId, userId))
        .limit(1);
      if (existing.length > 0 && existing[0].signalHash === signalHash) {
        continue; // inputs unchanged — skip recomputation
      }

      const { dimensions, vector } = computeTasteVector(signals, gameMap);
      const intensityMetrics = existing[0]?.intensityMetrics ?? {
        intensity: 0,
        focus: 0,
        breadth: 0,
        consistency: 0,
      };

      const coPlayCount = await this.coPlayPartnerCount(userId);
      const archetype = deriveArchetype({
        ...intensityMetrics,
        coPlayPartners: coPlayCount,
      });

      await this.db
        .insert(schema.playerTasteVectors)
        .values({
          userId,
          vector,
          dimensions,
          intensityMetrics,
          archetype,
          signalHash,
        })
        .onConflictDoUpdate({
          target: schema.playerTasteVectors.userId,
          set: {
            vector,
            dimensions,
            intensityMetrics,
            archetype,
            signalHash,
            computedAt: new Date(),
          },
        });
    }
  }

  async weeklyIntensityRollup(): Promise<void> {
    const weekStart = this.currentWeekStart();
    const users = await this.db
      .select({ id: schema.users.id })
      .from(schema.users);

    // Community distribution for percentile rank.
    const allWeekly = await this.db
      .select({
        userId: schema.gameActivityRollups.userId,
        total: sql<number>`sum(${schema.gameActivityRollups.totalSeconds})`,
      })
      .from(schema.gameActivityRollups)
      .where(
        and(
          eq(schema.gameActivityRollups.period, 'week'),
          eq(
            schema.gameActivityRollups.periodStart,
            weekStart.toISOString().slice(0, 10),
          ),
        ),
      )
      .groupBy(schema.gameActivityRollups.userId);
    const totalHoursDistribution = allWeekly.map((r) => Number(r.total) / 3600);
    const maxUniqueGames = await this.maxUniqueGamesThisWeek(weekStart);
    const community: CommunityStats = {
      totalHoursDistribution,
      maxUniqueGames,
    };

    for (const { id: userId } of users) {
      const snap = await this.buildWeeklySnapshot(userId, weekStart);
      if (!snap) continue;

      const metrics = computeIntensityMetrics(snap.input, community);

      await this.db
        .insert(schema.playerIntensitySnapshots)
        .values({
          userId,
          weekStart: weekStart.toISOString().slice(0, 10),
          totalHours: snap.input.totalHours.toFixed(2),
          gameBreakdown: snap.gameBreakdown,
          uniqueGames: snap.input.uniqueGames,
          longestSessionHours: snap.input.longestSessionHours.toFixed(2),
          longestSessionGameId: snap.longestGameId,
        })
        .onConflictDoUpdate({
          target: [
            schema.playerIntensitySnapshots.userId,
            schema.playerIntensitySnapshots.weekStart,
          ],
          set: {
            totalHours: snap.input.totalHours.toFixed(2),
            gameBreakdown: snap.gameBreakdown,
            uniqueGames: snap.input.uniqueGames,
            longestSessionHours: snap.input.longestSessionHours.toFixed(2),
            longestSessionGameId: snap.longestGameId,
          },
        });

      // Also refresh this user's intensityMetrics JSONB on their vector.
      await this.db
        .update(schema.playerTasteVectors)
        .set({ intensityMetrics: metrics })
        .where(eq(schema.playerTasteVectors.userId, userId));
    }
  }

  async buildCoPlayGraph(): Promise<void> {
    const voiceSessions = await this.db
      .select()
      .from(schema.eventVoiceSessions);
    const events = await this.db.select().from(schema.events);
    const eventGameMap = new Map(events.map((e) => [e.id, e.gameId]));

    const voiceSessionsByEvent = new Map<
      number,
      Array<{
        eventId: number;
        userId: number | null;
        gameId: number | null;
        segments: Array<{
          joinAt: string;
          leaveAt: string | null;
          durationSec: number;
        }>;
      }>
    >();
    for (const vs of voiceSessions) {
      const list = voiceSessionsByEvent.get(vs.eventId) ?? [];
      list.push({
        eventId: vs.eventId,
        userId: vs.userId,
        gameId: eventGameMap.get(vs.eventId) ?? null,
        segments: vs.segments ?? [],
      });
      voiceSessionsByEvent.set(vs.eventId, list);
    }

    const signups = await this.db
      .select()
      .from(schema.eventSignups)
      .where(sql`${schema.eventSignups.status} IN ('signed_up', 'confirmed')`);
    const signupsByEvent = new Map<
      number,
      Array<{ eventId: number; userId: number | null; gameId: number | null }>
    >();
    for (const s of signups) {
      const list = signupsByEvent.get(s.eventId) ?? [];
      list.push({
        eventId: s.eventId,
        userId: s.userId,
        gameId: eventGameMap.get(s.eventId) ?? null,
      });
      signupsByEvent.set(s.eventId, list);
    }

    const aggregates = aggregateCoPlay(voiceSessionsByEvent, signupsByEvent);

    // Wipe and reinsert — canonical ordering + pair count is small relative
    // to the team size, and this gives deterministic results.
    await this.db.delete(schema.playerCoPlay);
    if (aggregates.length === 0) return;

    await this.db.insert(schema.playerCoPlay).values(
      aggregates.map((a) => ({
        userIdA: a.userIdA,
        userIdB: a.userIdB,
        sessionCount: a.sessionCount,
        totalMinutes: a.totalMinutes,
        lastPlayedAt: a.lastPlayedAt,
        gamesPlayed: a.gamesPlayed,
      })),
    );
  }

  // ─── Query helpers (exposed for the controller) ───────────────

  async getTasteProfile(userId: number): Promise<{
    userId: number;
    dimensions: TasteProfileDimensionsDto;
    intensityMetrics: {
      intensity: number;
      focus: number;
      breadth: number;
      consistency: number;
    };
    archetype: TasteProfileArchetype;
    coPlayPartners: Array<{
      userId: number;
      username: string;
      avatar: string | null;
      sessionCount: number;
      totalMinutes: number;
      lastPlayedAt: string;
    }>;
    computedAt: string;
  } | null> {
    const user = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (user.length === 0) return null;

    const vec = await this.db
      .select()
      .from(schema.playerTasteVectors)
      .where(eq(schema.playerTasteVectors.userId, userId))
      .limit(1);

    const coPlayPartners = await this.topCoPlayPartners(userId);
    const now = new Date().toISOString();

    if (vec.length === 0) {
      return {
        userId,
        dimensions: zeroedDimensions(),
        intensityMetrics: {
          intensity: 0,
          focus: 0,
          breadth: 0,
          consistency: 0,
        },
        archetype: 'Casual',
        coPlayPartners,
        computedAt: now,
      };
    }

    const row = vec[0];
    return {
      userId,
      dimensions: row.dimensions,
      intensityMetrics: row.intensityMetrics,
      archetype: row.archetype,
      coPlayPartners,
      computedAt: row.computedAt.toISOString(),
    };
  }

  async findSimilarPlayers(
    userId: number,
    limit: number,
  ): Promise<
    Array<{
      userId: number;
      username: string;
      avatar: string | null;
      archetype: TasteProfileArchetype;
      similarity: number;
    }>
  > {
    const clamped = Math.max(1, Math.min(limit, 50));
    const anchor = await this.db
      .select()
      .from(schema.playerTasteVectors)
      .where(eq(schema.playerTasteVectors.userId, userId))
      .limit(1);
    if (anchor.length === 0) return [];

    const anchorVector = `[${anchor[0].vector.join(',')}]`;
    const rows = await this.db.execute<{
      user_id: number;
      username: string;
      avatar: string | null;
      archetype: TasteProfileArchetype;
      distance: string;
    }>(sql`
      SELECT v.user_id, u.username, u.avatar, v.archetype,
             (v.vector <=> ${anchorVector}::vector) AS distance
      FROM player_taste_vectors v
      JOIN users u ON u.id = v.user_id
      WHERE v.user_id <> ${userId}
      ORDER BY distance ASC
      LIMIT ${clamped}
    `);

    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      avatar: r.avatar,
      archetype: r.archetype,
      similarity: Math.max(0, 1 - Number(r.distance)),
    }));
  }

  // ─── Private helpers ──────────────────────────────────────────

  private async loadUserSignals(userId: number): Promise<UserGameSignal[]> {
    const interests = await this.db
      .select()
      .from(schema.gameInterests)
      .where(eq(schema.gameInterests.userId, userId));

    const presence = await this.db
      .select({
        gameId: schema.gameActivityRollups.gameId,
        totalSeconds: schema.gameActivityRollups.totalSeconds,
      })
      .from(schema.gameActivityRollups)
      .where(
        and(
          eq(schema.gameActivityRollups.userId, userId),
          eq(schema.gameActivityRollups.period, 'week'),
        ),
      );

    const signups = await this.db
      .select({ eventId: schema.eventSignups.eventId })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.userId, userId));

    const voice = await this.db
      .select({ eventId: schema.eventVoiceSessions.eventId })
      .from(schema.eventVoiceSessions)
      .where(
        and(
          eq(schema.eventVoiceSessions.userId, userId),
          sql`${schema.eventVoiceSessions.classification} IN ('full', 'partial')`,
        ),
      );

    const events = await this.db
      .select({ id: schema.events.id, gameId: schema.events.gameId })
      .from(schema.events);
    const eventGame = new Map(events.map((e) => [e.id, e.gameId]));

    const byGame = new Map<number, UserGameSignal>();
    const touch = (gameId: number): UserGameSignal => {
      const existing = byGame.get(gameId);
      if (existing) return existing;
      const fresh: UserGameSignal = { gameId };
      byGame.set(gameId, fresh);
      return fresh;
    };

    for (const row of interests) {
      const signal = touch(row.gameId);
      switch (row.source) {
        case 'steam_library':
          signal.steamOwnership = {
            playtimeForever: row.playtimeForever ?? 0,
            playtime2weeks: row.playtime2weeks ?? 0,
          };
          break;
        case 'steam_wishlist':
          signal.steamWishlist = true;
          break;
        case 'manual':
          signal.manualHeart = true;
          break;
        case 'poll':
          signal.pollSource = true;
          break;
        default:
          break;
      }
    }

    for (const p of presence) {
      if (p.gameId === null) continue;
      const signal = touch(p.gameId);
      signal.presenceWeeklyHours =
        (signal.presenceWeeklyHours ?? 0) + p.totalSeconds / 3600;
    }

    for (const s of signups) {
      const gameId = eventGame.get(s.eventId);
      if (!gameId) continue;
      touch(gameId).eventSignup = true;
    }

    for (const v of voice) {
      const gameId = eventGame.get(v.eventId);
      if (!gameId) continue;
      touch(gameId).voiceAttendance = true;
    }

    return [...byGame.values()];
  }

  private async loadGameMetadata(): Promise<Map<number, GameMetadata>> {
    const rows = await this.db
      .select({
        id: schema.games.id,
        genres: schema.games.genres,
        gameModes: schema.games.gameModes,
        themes: schema.games.themes,
      })
      .from(schema.games);
    const map = new Map<number, GameMetadata>();
    for (const r of rows) {
      map.set(r.id, {
        gameId: r.id,
        genres: r.genres ?? [],
        gameModes: r.gameModes ?? [],
        themes: r.themes ?? [],
      });
    }
    return map;
  }

  private async computeUserSignalHash(userId: number): Promise<string> {
    const [interests] = await this.db.execute<{
      count: string;
      max_updated: Date | null;
    }>(sql`
      SELECT COUNT(*)::text AS count, MAX(created_at) AS max_updated
      FROM ${schema.gameInterests}
      WHERE user_id = ${userId}
    `);
    const [rollups] = await this.db.execute<{
      count: string;
      max_period: string | null;
    }>(sql`
      SELECT COUNT(*)::text AS count, MAX(period_start::text) AS max_period
      FROM ${schema.gameActivityRollups}
      WHERE user_id = ${userId}
    `);
    const [signups] = await this.db.execute<{
      count: string;
      max_updated: Date | null;
    }>(sql`
      SELECT COUNT(*)::text AS count, MAX(signed_up_at) AS max_updated
      FROM ${schema.eventSignups}
      WHERE user_id = ${userId}
    `);
    const [voice] = await this.db.execute<{
      count: string;
      max_updated: Date | null;
    }>(sql`
      SELECT COUNT(*)::text AS count, MAX(last_leave_at) AS max_updated
      FROM ${schema.eventVoiceSessions}
      WHERE user_id = ${userId}
    `);

    const summary: SignalSummary = {
      gameInterests: {
        count: Number(interests.count),
        maxUpdatedAt: interests.max_updated,
      },
      gameActivityRollups: {
        count: Number(rollups.count),
        maxPeriodStart: rollups.max_period,
      },
      eventSignups: {
        count: Number(signups.count),
        maxUpdatedAt: signups.max_updated,
      },
      eventVoiceSessions: {
        count: Number(voice.count),
        maxLastLeaveAt: voice.max_updated,
      },
    };
    return computeSignalHash(summary);
  }

  private async coPlayPartnerCount(userId: number): Promise<number> {
    const rows = await this.db.execute<{ c: number }>(sql`
      SELECT COUNT(*)::int AS c
      FROM player_co_play
      WHERE user_id_a = ${userId} OR user_id_b = ${userId}
    `);
    return Number(rows[0]?.c ?? 0);
  }

  private async topCoPlayPartners(userId: number): Promise<
    Array<{
      userId: number;
      username: string;
      avatar: string | null;
      sessionCount: number;
      totalMinutes: number;
      lastPlayedAt: string;
    }>
  > {
    const rows = await this.db.execute<{
      user_id: number;
      username: string;
      avatar: string | null;
      session_count: number;
      total_minutes: number;
      last_played_at: Date;
    }>(sql`
      SELECT
        CASE WHEN user_id_a = ${userId} THEN user_id_b ELSE user_id_a END AS user_id,
        u.username, u.avatar, p.session_count, p.total_minutes, p.last_played_at
      FROM player_co_play p
      JOIN users u ON u.id = CASE WHEN user_id_a = ${userId} THEN user_id_b ELSE user_id_a END
      WHERE user_id_a = ${userId} OR user_id_b = ${userId}
      ORDER BY p.session_count DESC, p.total_minutes DESC
      LIMIT 10
    `);
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      avatar: r.avatar,
      sessionCount: r.session_count,
      totalMinutes: r.total_minutes,
      lastPlayedAt: r.last_played_at.toISOString(),
    }));
  }

  private currentWeekStart(): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  private async maxUniqueGamesThisWeek(weekStart: Date): Promise<number> {
    const rows = await this.db.execute<{ c: number }>(sql`
      SELECT MAX(c)::int AS c FROM (
        SELECT COUNT(DISTINCT game_id) AS c
        FROM game_activity_rollups
        WHERE period = 'week' AND period_start = ${weekStart.toISOString().slice(0, 10)}
        GROUP BY user_id
      ) t
    `);
    return Number(rows[0]?.c ?? 0);
  }

  private async buildWeeklySnapshot(
    userId: number,
    weekStart: Date,
  ): Promise<{
    input: WeeklySnapshotInput;
    gameBreakdown: Array<{
      gameId: number;
      hours: number;
      source: string;
    }>;
    longestGameId: number | null;
  } | null> {
    const rollups = await this.db
      .select()
      .from(schema.gameActivityRollups)
      .where(
        and(
          eq(schema.gameActivityRollups.userId, userId),
          eq(schema.gameActivityRollups.period, 'week'),
          eq(
            schema.gameActivityRollups.periodStart,
            weekStart.toISOString().slice(0, 10),
          ),
        ),
      );
    if (rollups.length === 0) return null;

    const totalHours = rollups.reduce(
      (acc, r) => acc + r.totalSeconds / 3600,
      0,
    );
    const gameBreakdown = rollups.map((r) => ({
      gameId: r.gameId,
      hours: Number((r.totalSeconds / 3600).toFixed(2)),
      source: 'presence',
    }));
    const longest = rollups.reduce((a, b) =>
      b.totalSeconds > a.totalSeconds ? b : a,
    );
    const longestSessionHours = Number(
      (longest.totalSeconds / 3600).toFixed(2),
    );

    // Rolling 8-week history for consistency score.
    const historyRows = await this.db
      .select({
        total: sql<number>`sum(${schema.gameActivityRollups.totalSeconds})`,
        periodStart: schema.gameActivityRollups.periodStart,
      })
      .from(schema.gameActivityRollups)
      .where(
        and(
          eq(schema.gameActivityRollups.userId, userId),
          eq(schema.gameActivityRollups.period, 'week'),
          gte(
            schema.gameActivityRollups.periodStart,
            new Date(weekStart.getTime() - 8 * 7 * 24 * 3600 * 1000)
              .toISOString()
              .slice(0, 10),
          ),
        ),
      )
      .groupBy(schema.gameActivityRollups.periodStart)
      .orderBy(desc(schema.gameActivityRollups.periodStart));
    const weeklyHistory = historyRows.map((r) => Number(r.total) / 3600);

    return {
      input: {
        totalHours: Number(totalHours.toFixed(2)),
        longestSessionHours,
        uniqueGames: rollups.length,
        weeklyHistory,
      },
      gameBreakdown,
      longestGameId: longest.gameId,
    };
  }
}

function zeroedDimensions(): TasteProfileDimensionsDto {
  return {
    co_op: 0,
    pvp: 0,
    rpg: 0,
    survival: 0,
    strategy: 0,
    social: 0,
    mmo: 0,
  };
}
