import { eq, and, isNotNull, gte, sum, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import * as tables from '../../drizzle/schema';
import type { Logger } from '@nestjs/common';

/** Minimum cumulative playtime (seconds) to trigger auto-heart */
export const AUTO_HEART_THRESHOLD_SECONDS = 18_000; // 5 hours

/** Equivalent threshold in minutes for Steam playtime */
const AUTO_HEART_THRESHOLD_MINUTES = 300; // 5 hours

/**
 * Auto-heart games where a user's cumulative playtime exceeds threshold.
 * Checks both Discord presence sessions and Steam library playtime.
 */
export async function autoHeartCheck(
  db: PostgresJsDatabase<typeof schema>,
  logger: Logger,
): Promise<void> {
  const [discordCandidates, steamCandidates] = await Promise.all([
    findHeartCandidates(db),
    findSteamHeartCandidates(db),
  ]);
  const candidates = deduplicateCandidates(discordCandidates, steamCandidates);
  if (candidates.length === 0) return;

  const candidateUserIds = [...new Set(candidates.map((c) => c.userId))];
  const toInsert = await filterCandidates(db, candidates, candidateUserIds);

  if (toInsert.length === 0) return;

  await db
    .insert(tables.gameInterests)
    .values(
      toInsert.map((row) => ({
        userId: row.userId,
        gameId: row.gameId!,
        source: 'discord',
      })),
    )
    .onConflictDoNothing();

  logger.log(`Auto-hearted ${toInsert.length} game(s) for users`);
}

async function findHeartCandidates(
  db: PostgresJsDatabase<typeof schema>,
): Promise<Array<{ userId: number; gameId: number | null }>> {
  return db
    .select({
      userId: tables.gameActivitySessions.userId,
      gameId: tables.gameActivitySessions.gameId,
    })
    .from(tables.gameActivitySessions)
    .where(
      and(
        isNotNull(tables.gameActivitySessions.gameId),
        isNotNull(tables.gameActivitySessions.endedAt),
      ),
    )
    .groupBy(
      tables.gameActivitySessions.userId,
      tables.gameActivitySessions.gameId,
    )
    .having(
      gte(
        sum(tables.gameActivitySessions.durationSeconds),
        String(AUTO_HEART_THRESHOLD_SECONDS),
      ),
    );
}

/** Find Steam library games with 5+ hours playtime. */
async function findSteamHeartCandidates(
  db: PostgresJsDatabase<typeof schema>,
): Promise<Array<{ userId: number; gameId: number | null }>> {
  return db
    .select({
      userId: tables.gameInterests.userId,
      gameId: tables.gameInterests.gameId,
    })
    .from(tables.gameInterests)
    .where(
      and(
        eq(tables.gameInterests.source, 'steam_library'),
        gte(tables.gameInterests.playtimeForever, AUTO_HEART_THRESHOLD_MINUTES),
      ),
    );
}

/** Merge Discord and Steam candidates, deduplicating by userId+gameId. */
function deduplicateCandidates(
  ...sources: Array<Array<{ userId: number; gameId: number | null }>>
): Array<{ userId: number; gameId: number | null }> {
  const seen = new Set<string>();
  const result: Array<{ userId: number; gameId: number | null }> = [];
  for (const candidates of sources) {
    for (const c of candidates) {
      const key = `${c.userId}:${c.gameId}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(c);
      }
    }
  }
  return result;
}

async function filterCandidates(
  db: PostgresJsDatabase<typeof schema>,
  candidates: Array<{ userId: number; gameId: number | null }>,
  userIds: number[],
): Promise<Array<{ userId: number; gameId: number | null }>> {
  const exclusionSets = await buildExclusionSets(db, userIds);

  return candidates.filter((c) => {
    if (!c.gameId) return false;
    if (exclusionSets.optedOut.has(c.userId)) return false;
    const key = `${c.userId}:${c.gameId}`;
    return (
      !exclusionSets.existing.has(key) && !exclusionSets.suppressed.has(key)
    );
  });
}

async function fetchOptedOutUsers(
  db: PostgresJsDatabase<typeof schema>,
): Promise<Set<number>> {
  const rows = await db
    .select({ userId: tables.userPreferences.userId })
    .from(tables.userPreferences)
    .where(
      and(
        eq(tables.userPreferences.key, 'autoHeartGames'),
        sql`${tables.userPreferences.value}::text = 'false'`,
      ),
    );
  return new Set(rows.map((r) => r.userId));
}

async function fetchExistingInterests(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
): Promise<Set<string>> {
  const rows = await db
    .select({
      userId: tables.gameInterests.userId,
      gameId: tables.gameInterests.gameId,
    })
    .from(tables.gameInterests)
    .where(
      and(
        inArray(tables.gameInterests.userId, userIds),
        inArray(tables.gameInterests.source, ['manual', 'discord']),
      ),
    );
  return new Set(rows.map((r) => `${r.userId}:${r.gameId}`));
}

async function fetchSuppressions(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
): Promise<Set<string>> {
  const rows = await db
    .select({
      userId: tables.gameInterestSuppressions.userId,
      gameId: tables.gameInterestSuppressions.gameId,
    })
    .from(tables.gameInterestSuppressions)
    .where(inArray(tables.gameInterestSuppressions.userId, userIds));
  return new Set(rows.map((r) => `${r.userId}:${r.gameId}`));
}

async function buildExclusionSets(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
): Promise<{
  optedOut: Set<number>;
  existing: Set<string>;
  suppressed: Set<string>;
}> {
  const [optedOut, existing, suppressed] = await Promise.all([
    fetchOptedOutUsers(db),
    fetchExistingInterests(db, userIds),
    fetchSuppressions(db, userIds),
  ]);
  return { optedOut, existing, suppressed };
}
