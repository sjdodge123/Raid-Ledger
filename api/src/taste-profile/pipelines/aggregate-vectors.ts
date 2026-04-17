import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  computeAxisIdf,
  computeTasteVector,
  type GameMetadata,
  type UserGameSignal,
} from '../taste-vector.helpers';
import { deriveArchetype } from '../archetype.helpers';
import { computeSignalHash, type SignalSummary } from '../signal-hash.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Main entry point — iterates users, recomputes when signals changed. */
export async function runAggregateVectors(db: Db): Promise<void> {
  const users = await db.select({ id: schema.users.id }).from(schema.users);
  const gameMap = await loadGameMetadata(db);
  const axisIdf = computeAxisIdf(gameMap);

  for (const { id: userId } of users) {
    const signals = await loadUserSignals(db, userId);
    if (signals.length === 0) continue;

    const signalHash = await computeUserSignalHash(db, userId);
    const existing = await db
      .select()
      .from(schema.playerTasteVectors)
      .where(eq(schema.playerTasteVectors.userId, userId))
      .limit(1);
    if (existing.length > 0 && existing[0].signalHash === signalHash) continue;

    const { dimensions, vector } = computeTasteVector(signals, gameMap, axisIdf);
    const intensityMetrics = existing[0]?.intensityMetrics ?? {
      intensity: 0,
      focus: 0,
      breadth: 0,
      consistency: 0,
    };

    const coPlayPartners = await coPlayPartnerCount(db, userId);
    const archetype = deriveArchetype({
      ...intensityMetrics,
      coPlayPartners,
    });

    await db
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

async function loadUserSignals(
  db: Db,
  userId: number,
): Promise<UserGameSignal[]> {
  const interests = await db
    .select()
    .from(schema.gameInterests)
    .where(eq(schema.gameInterests.userId, userId));

  const presence = await db
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

  const signups = await db
    .select({ eventId: schema.eventSignups.eventId })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.userId, userId));

  const voice = await db
    .select({ eventId: schema.eventVoiceSessions.eventId })
    .from(schema.eventVoiceSessions)
    .where(
      and(
        eq(schema.eventVoiceSessions.userId, userId),
        sql`${schema.eventVoiceSessions.classification} IN ('full', 'partial')`,
      ),
    );

  const events = await db
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

async function loadGameMetadata(db: Db): Promise<Map<number, GameMetadata>> {
  const rows = await db
    .select({
      id: schema.games.id,
      genres: schema.games.genres,
      gameModes: schema.games.gameModes,
      themes: schema.games.themes,
      itadTags: schema.games.itadTags,
    })
    .from(schema.games);
  const map = new Map<number, GameMetadata>();
  for (const r of rows) {
    const rawTags = Array.isArray(r.itadTags) ? (r.itadTags as string[]) : [];
    map.set(r.id, {
      gameId: r.id,
      genres: r.genres ?? [],
      gameModes: r.gameModes ?? [],
      themes: r.themes ?? [],
      tags: rawTags.map((t) => t.toLowerCase()),
    });
  }
  return map;
}

async function computeUserSignalHash(db: Db, userId: number): Promise<string> {
  const [interests] = await db.execute<{
    count: string;
    max_updated: Date | null;
  }>(sql`
    SELECT COUNT(*)::text AS count, MAX(created_at) AS max_updated
    FROM ${schema.gameInterests}
    WHERE user_id = ${userId}
  `);
  const [rollups] = await db.execute<{
    count: string;
    max_period: string | null;
  }>(sql`
    SELECT COUNT(*)::text AS count, MAX(period_start::text) AS max_period
    FROM ${schema.gameActivityRollups}
    WHERE user_id = ${userId}
  `);
  const [signups] = await db.execute<{
    count: string;
    max_updated: Date | null;
  }>(sql`
    SELECT COUNT(*)::text AS count, MAX(signed_up_at) AS max_updated
    FROM ${schema.eventSignups}
    WHERE user_id = ${userId}
  `);
  const [voice] = await db.execute<{
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

async function coPlayPartnerCount(db: Db, userId: number): Promise<number> {
  const rows = await db.execute<{ c: number }>(sql`
    SELECT COUNT(*)::int AS c
    FROM player_co_play
    WHERE user_id_a = ${userId} OR user_id_b = ${userId}
  `);
  return Number(rows[0]?.c ?? 0);
}
