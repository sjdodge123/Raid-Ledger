import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AiSuggestionsResponseDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** TTL for a successful suggestion payload — 24 hours. */
export const FRESH_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * TTL for a parse-fail or empty-candidate-pool payload — 1 hour.
 *
 * Failures are cached shorter so a transient provider hiccup doesn't
 * freeze the UI for a full day, but long enough to avoid re-running on
 * every page load (see llm-output.helpers when both parse attempts
 * fail and the voter-scope fallback when no candidates pass).
 */
export const EMPTY_TTL_MS = 60 * 60 * 1000;

/** Stored row shape — payload is the response DTO minus `cached`. */
export type StoredPayload = Omit<AiSuggestionsResponseDto, 'cached'>;

/** Look up the latest suggestions row for a given lineup + voter hash. */
export async function findLatestByHash(
  db: Db,
  lineupId: number,
  voterSetHash: string,
): Promise<typeof schema.lineupAiSuggestions.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(schema.lineupAiSuggestions)
    .where(
      and(
        eq(schema.lineupAiSuggestions.lineupId, lineupId),
        eq(schema.lineupAiSuggestions.voterSetHash, voterSetHash),
      ),
    )
    .orderBy(desc(schema.lineupAiSuggestions.generatedAt))
    .limit(1);
  return row ?? null;
}

/**
 * True when `generatedAt` is still within the given TTL window. Empty
 * payloads use a shorter TTL than successful ones — pass the right
 * constant for your caller.
 */
export function isFresh(generatedAt: Date, ttlMs: number): boolean {
  return Date.now() - generatedAt.getTime() < ttlMs;
}

/**
 * Upsert a suggestions row on the (lineup_id, voter_set_hash) unique
 * key. ON CONFLICT DO UPDATE so the race where two concurrent requests
 * both write resolves cleanly (second write wins the most recent
 * `generated_at`).
 */
export async function upsertSuggestion(
  db: Db,
  params: {
    lineupId: number;
    voterSetHash: string;
    payload: StoredPayload;
    provider: string;
    model: string;
  },
): Promise<void> {
  await db
    .insert(schema.lineupAiSuggestions)
    .values({
      lineupId: params.lineupId,
      voterSetHash: params.voterSetHash,
      payload: params.payload,
      provider: params.provider,
      model: params.model,
    })
    .onConflictDoUpdate({
      target: [
        schema.lineupAiSuggestions.lineupId,
        schema.lineupAiSuggestions.voterSetHash,
      ],
      set: {
        payload: params.payload,
        provider: params.provider,
        model: params.model,
        generatedAt: sql`now()`,
      },
    });
}

/** Drop every cached row for a lineup. Called on nominate / invitee changes. */
export async function deleteAllForLineup(
  db: Db,
  lineupId: number,
): Promise<void> {
  await db
    .delete(schema.lineupAiSuggestions)
    .where(eq(schema.lineupAiSuggestions.lineupId, lineupId));
}

/**
 * Provider injected into `LineupsService`. Keeps the service surface
 * small — only one method to stub in tests — and breaks any potential
 * import cycle through the full orchestration service.
 *
 * Failures are swallowed with a logger.warn so a stale-cache row never
 * fails a parent mutation (architect spec reconcile #4).
 */
@Injectable()
export class AiSuggestionsCacheInvalidator {
  private readonly logger = new Logger(AiSuggestionsCacheInvalidator.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
  ) {}

  async invalidateForLineup(lineupId: number): Promise<void> {
    try {
      await deleteAllForLineup(this.db, lineupId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to invalidate AI suggestions cache for lineup ${lineupId}: ${message}`,
      );
    }
  }
}
