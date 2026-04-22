import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  computeAxisIdf,
  computeTasteVector,
  type GameMetadata,
  type UserGameSignal,
} from '../taste-vector.helpers';
import { deriveArchetype } from '../archetype.helpers';
import { computeSignalHash } from '../signal-hash.helpers';
import {
  groupBy,
  groupMap,
  loadGameMetadata,
  loadSignalHashComponents,
} from './aggregate-vectors-loaders';

type Db = PostgresJsDatabase<typeof schema>;

interface BatchedInputs {
  gameMap: Map<number, GameMetadata>;
  existingByUser: Map<
    number,
    { signalHash: string; intensityMetrics: NonNullable<unknown> }
  >;
  eventGameId: Map<number, number>;
  interestsByUser: Map<number, Array<typeof schema.gameInterests.$inferSelect>>;
  presenceByUser: Map<
    number,
    Array<{ gameId: number | null; totalSeconds: number }>
  >;
  signupsByUser: Map<number, number[]>;
  voiceByUser: Map<number, number[]>;
  hashByUser: Map<number, string>;
}

type IntensityMetrics = {
  intensity: number;
  focus: number;
  breadth: number;
  consistency: number;
};

/** Main entry point — iterates users, recomputes when signals changed.
 *
 * All per-user state is batch-loaded up front to avoid an N+1 round-trip
 * pattern (9+ queries × user count). Writes are still per-user because
 * drizzle-orm's onConflictDoUpdate is single-row.
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
  const intensityMetrics = (existing?.intensityMetrics as IntensityMetrics) ?? {
    intensity: 0,
    focus: 0,
    breadth: 0,
    consistency: 0,
  };
  // ROK-1083: deriveArchetype now returns a composed ArchetypeDto. The
  // jsonb column persists it as-is (Drizzle handles jsonb serialization).
  const archetype = deriveArchetype({ intensityMetrics, dimensions });

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
    db
      .select({ id: schema.events.id, gameId: schema.events.gameId })
      .from(schema.events),
    db.select().from(schema.playerTasteVectors),
    loadSignalHashComponents(db),
  ]);

  const interestsByUser = groupBy(interests, (i) => i.userId);
  const presenceByUser = groupBy(presence, (p) => p.userId);
  const signupsByUser = groupMap(
    signups.filter(
      (s): s is { userId: number; eventId: number } => s.userId !== null,
    ),
    (s) => s.userId,
    (s) => s.eventId,
  );
  const voiceByUser = groupMap(
    voice.filter(
      (v): v is { userId: number; eventId: number } => v.userId !== null,
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
    eventGameId,
    interestsByUser,
    presenceByUser,
    signupsByUser,
    voiceByUser,
    hashByUser,
  };
}

function applyInterestSignal(
  sig: UserGameSignal,
  row: typeof schema.gameInterests.$inferSelect,
): void {
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

function assembleSignals(
  userId: number,
  batch: BatchedInputs,
): UserGameSignal[] {
  const byGame = new Map<number, UserGameSignal>();
  const touch = (gameId: number): UserGameSignal => {
    const existing = byGame.get(gameId);
    if (existing) return existing;
    const fresh: UserGameSignal = { gameId };
    byGame.set(gameId, fresh);
    return fresh;
  };

  for (const row of batch.interestsByUser.get(userId) ?? []) {
    applyInterestSignal(touch(row.gameId), row);
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
