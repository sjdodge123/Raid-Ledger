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

interface BatchedInputs {
  gameMap: Map<number, GameMetadata>;
  existingByUser: Map<
    number,
    { signalHash: string; intensityMetrics: SignalSummary extends never ? never : NonNullable<unknown> }
  >;
  coPlayCounts: Map<number, number>;
  eventGameId: Map<number, number>;
  interestsByUser: Map<number, Array<typeof schema.gameInterests.$inferSelect>>;
  presenceByUser: Map<number, Array<{ gameId: number | null; totalSeconds: number }>>;
  signupsByUser: Map<number, number[]>;
  voiceByUser: Map<number, number[]>;
  hashByUser: Map<number, string>;
}

/** Main entry point — iterates users, recomputes when signals changed.
 *
 * All per-user state is batch-loaded up front to avoid an N+1 round-trip
 * pattern (9+ queries × user count). Writes are still per-user because
 * drizzle-orm's onConflictDoUpdate is single-row; a future pass could
 * batch them with INSERT ... VALUES (...), (...) ON CONFLICT.
 */
export async function runAggregateVectors(db: Db): Promise<void> {
  const users = await db.select({ id: schema.users.id }).from(schema.users);
  const batch = await loadBatch(db);
  const axisIdf = computeAxisIdf(batch.gameMap);

  for (const { id: userId } of users) {
    const signals = assembleSignals(userId, batch);
    if (signals.length === 0) continue;

    const signalHash = batch.hashByUser.get(userId) ?? '';
    const existing = batch.existingByUser.get(userId);
    if (existing && existing.signalHash === signalHash) continue;

    await upsertVector(db, userId, signals, signalHash, batch, axisIdf);
  }
}

async function upsertVector(
  db: Db,
  userId: number,
  signals: UserGameSignal[],
  signalHash: string,
  batch: BatchedInputs,
  axisIdf: ReturnType<typeof computeAxisIdf>,
): Promise<void> {
  const { dimensions, vector } = computeTasteVector(
    signals,
    batch.gameMap,
    axisIdf,
  );
  const existing = batch.existingByUser.get(userId);
  const intensityMetrics =
    (existing?.intensityMetrics as {
      intensity: number;
      focus: number;
      breadth: number;
      consistency: number;
    }) ?? { intensity: 0, focus: 0, breadth: 0, consistency: 0 };
  const coPlayPartners = batch.coPlayCounts.get(userId) ?? 0;
  const archetype = deriveArchetype({ ...intensityMetrics, coPlayPartners });

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

async function loadBatch(db: Db): Promise<BatchedInputs> {
  const gameMap = await loadGameMetadata(db);
  const [
    interests,
    presence,
    signups,
    voice,
    events,
    existingVectors,
    coPlayRows,
    hashComponents,
  ] = await Promise.all([
    db.select().from(schema.gameInterests),
    db
      .select({
        userId: schema.gameActivityRollups.userId,
        gameId: schema.gameActivityRollups.gameId,
        totalSeconds: schema.gameActivityRollups.totalSeconds,
      })
      .from(schema.gameActivityRollups)
      .where(eq(schema.gameActivityRollups.period, 'week')),
    db
      .select({
        userId: schema.eventSignups.userId,
        eventId: schema.eventSignups.eventId,
      })
      .from(schema.eventSignups),
    db
      .select({
        userId: schema.eventVoiceSessions.userId,
        eventId: schema.eventVoiceSessions.eventId,
      })
      .from(schema.eventVoiceSessions)
      .where(
        sql`${schema.eventVoiceSessions.classification} IN ('full', 'partial')`,
      ),
    db.select({ id: schema.events.id, gameId: schema.events.gameId }).from(schema.events),
    db.select().from(schema.playerTasteVectors),
    loadCoPlayCounts(db),
    loadSignalHashComponents(db),
  ]);

  const interestsByUser = groupBy(interests, (i) => i.userId);
  const presenceByUser = groupBy(presence, (p) => p.userId);
  const signupsByUser = groupMap(
    signups.filter((s): s is { userId: number; eventId: number } =>
      s.userId !== null,
    ),
    (s) => s.userId,
    (s) => s.eventId,
  );
  const voiceByUser = groupMap(
    voice.filter((v): v is { userId: number; eventId: number } =>
      v.userId !== null,
    ),
    (v) => v.userId,
    (v) => v.eventId,
  );
  const eventGameId = new Map(
    events
      .filter((e) => e.gameId !== null)
      .map((e) => [e.id, e.gameId as number]),
  );
  const existingByUser = new Map(
    existingVectors.map((v) => [
      v.userId,
      { signalHash: v.signalHash, intensityMetrics: v.intensityMetrics },
    ]),
  );
  const hashByUser = new Map<number, string>();
  for (const [userId, summary] of hashComponents) {
    hashByUser.set(userId, computeSignalHash(summary));
  }

  return {
    gameMap,
    existingByUser,
    coPlayCounts: coPlayRows,
    eventGameId,
    interestsByUser,
    presenceByUser,
    signupsByUser,
    voiceByUser,
    hashByUser,
  };
}

function assembleSignals(userId: number, batch: BatchedInputs): UserGameSignal[] {
  const byGame = new Map<number, UserGameSignal>();
  const touch = (gameId: number): UserGameSignal => {
    const existing = byGame.get(gameId);
    if (existing) return existing;
    const fresh: UserGameSignal = { gameId };
    byGame.set(gameId, fresh);
    return fresh;
  };

  for (const row of batch.interestsByUser.get(userId) ?? []) {
    const sig = touch(row.gameId);
    switch (row.source) {
      case 'steam_library':
        sig.steamOwnership = {
          playtimeForever: row.playtimeForever ?? 0,
          playtime2weeks: row.playtime2weeks ?? 0,
        };
        break;
      case 'steam_wishlist':
        sig.steamWishlist = true;
        break;
      case 'manual':
        sig.manualHeart = true;
        break;
      case 'poll':
        sig.pollSource = true;
        break;
      default:
        break;
    }
  }
  for (const p of batch.presenceByUser.get(userId) ?? []) {
    if (p.gameId === null) continue;
    const sig = touch(p.gameId);
    sig.presenceWeeklyHours =
      (sig.presenceWeeklyHours ?? 0) + p.totalSeconds / 3600;
  }
  for (const eventId of batch.signupsByUser.get(userId) ?? []) {
    const gameId = batch.eventGameId.get(eventId);
    if (gameId) touch(gameId).eventSignup = true;
  }
  for (const eventId of batch.voiceByUser.get(userId) ?? []) {
    const gameId = batch.eventGameId.get(eventId);
    if (gameId) touch(gameId).voiceAttendance = true;
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
    const rawTags = Array.isArray(r.itadTags) ? r.itadTags : [];
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

async function loadCoPlayCounts(db: Db): Promise<Map<number, number>> {
  const rows = await db.execute<{ user_id: number; c: number }>(sql`
    SELECT user_id, COUNT(*)::int AS c FROM (
      SELECT user_id_a AS user_id FROM player_co_play
      UNION ALL
      SELECT user_id_b AS user_id FROM player_co_play
    ) t GROUP BY user_id
  `);
  const map = new Map<number, number>();
  for (const r of rows as unknown as Array<{ user_id: number; c: number }>) {
    map.set(r.user_id, Number(r.c));
  }
  return map;
}

async function loadSignalHashComponents(
  db: Db,
): Promise<Map<number, SignalSummary>> {
  const interests = await db.execute<{
    user_id: number;
    count: string;
    max_updated: Date | null;
  }>(sql`
    SELECT user_id, COUNT(*)::text AS count, MAX(created_at) AS max_updated
    FROM ${schema.gameInterests} GROUP BY user_id
  `);
  const rollups = await db.execute<{
    user_id: number;
    count: string;
    max_period: string | null;
  }>(sql`
    SELECT user_id, COUNT(*)::text AS count, MAX(period_start::text) AS max_period
    FROM ${schema.gameActivityRollups} GROUP BY user_id
  `);
  const signups = await db.execute<{
    user_id: number;
    count: string;
    max_updated: Date | null;
  }>(sql`
    SELECT user_id, COUNT(*)::text AS count, MAX(signed_up_at) AS max_updated
    FROM ${schema.eventSignups} GROUP BY user_id
  `);
  const voice = await db.execute<{
    user_id: number;
    count: string;
    max_updated: Date | null;
  }>(sql`
    SELECT user_id, COUNT(*)::text AS count, MAX(last_leave_at) AS max_updated
    FROM ${schema.eventVoiceSessions} GROUP BY user_id
  `);

  const summaries = new Map<number, SignalSummary>();
  const ensure = (userId: number): SignalSummary => {
    const existing = summaries.get(userId);
    if (existing) return existing;
    const fresh: SignalSummary = {
      gameInterests: { count: 0, maxUpdatedAt: null },
      gameActivityRollups: { count: 0, maxPeriodStart: null },
      eventSignups: { count: 0, maxUpdatedAt: null },
      eventVoiceSessions: { count: 0, maxLastLeaveAt: null },
    };
    summaries.set(userId, fresh);
    return fresh;
  };

  for (const r of interests as unknown as Array<{
    user_id: number;
    count: string;
    max_updated: Date | null;
  }>) {
    ensure(r.user_id).gameInterests = {
      count: Number(r.count),
      maxUpdatedAt: r.max_updated,
    };
  }
  for (const r of rollups as unknown as Array<{
    user_id: number;
    count: string;
    max_period: string | null;
  }>) {
    ensure(r.user_id).gameActivityRollups = {
      count: Number(r.count),
      maxPeriodStart: r.max_period,
    };
  }
  for (const r of signups as unknown as Array<{
    user_id: number;
    count: string;
    max_updated: Date | null;
  }>) {
    ensure(r.user_id).eventSignups = {
      count: Number(r.count),
      maxUpdatedAt: r.max_updated,
    };
  }
  for (const r of voice as unknown as Array<{
    user_id: number;
    count: string;
    max_updated: Date | null;
  }>) {
    ensure(r.user_id).eventVoiceSessions = {
      count: Number(r.count),
      maxLastLeaveAt: r.max_updated,
    };
  }

  return summaries;
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

function groupMap<T, K, V>(
  rows: T[],
  key: (row: T) => K,
  value: (row: T) => V,
): Map<K, V[]> {
  const map = new Map<K, V[]>();
  for (const row of rows) {
    const k = key(row);
    const v = value(row);
    const list = map.get(k);
    if (list) list.push(v);
    else map.set(k, [v]);
  }
  return map;
}
