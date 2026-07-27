/**
 * ROK-1419: non-series channel_bindings uniqueness helpers.
 *
 * Backs the two partial unique indexes restored by migration 0161:
 *   channel_bindings_nonseries_game_unique     (guild,channel,purpose,game)
 *                                              WHERE rgid IS NULL AND game IS NOT NULL
 *   channel_bindings_nonseries_nullgame_unique (guild,channel,purpose)
 *                                              WHERE rgid IS NULL AND game IS NULL
 *
 * The pure matcher `findConflictingBinding` mirrors those predicates so the
 * service can reject a slot collision with an operator-facing message BEFORE
 * hitting the DB; `mapUniqueViolation` is the backstop that converts the raw
 * 23505 (races, the /bind path) into the same ConflictException.
 */
import { ConflictException } from '@nestjs/common';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

const NONSERIES_CONSTRAINT_PREFIX = 'channel_bindings_nonseries_';
const CONFLICT_CODE = 'BINDING_SLOT_OCCUPIED';

/** Fields needed to evaluate a non-series uniqueness collision. */
export interface BindingConflictInput {
  id?: string;
  guildId: string;
  channelId: string;
  bindingPurpose: string;
  gameId: number | null;
  recurrenceGroupId: string | null;
}

/** Both NULL, or both the same non-null game. Mirrors the partial-index split. */
function sameGameNullness(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a === b;
}

/**
 * The existing row that would collide with `candidate` under EITHER partial
 * index, or undefined. A conflict is a DIFFERENT row (id !== candidate.id) with
 * the same (guild, channel, purpose), recurrence_group_id NULL on BOTH, and
 * matching game-nullness. Series rows (rgid != null) are invisible to the
 * indexes and never conflict.
 */
export function findConflictingBinding<T extends BindingConflictInput>(
  candidate: BindingConflictInput,
  existing: T[],
): T | undefined {
  if (candidate.recurrenceGroupId != null) return undefined;
  return existing.find(
    (row) =>
      row.id !== candidate.id &&
      row.recurrenceGroupId == null &&
      row.guildId === candidate.guildId &&
      row.channelId === candidate.channelId &&
      row.bindingPurpose === candidate.bindingPurpose &&
      sameGameNullness(row.gameId, candidate.gameId),
  );
}

/** Operator-facing description of a slot collision. */
export function describeBindingConflict(
  conflict: BindingConflictInput,
): string {
  const scope =
    conflict.gameId == null
      ? 'without a specific game'
      : `for game ${conflict.gameId}`;
  return (
    `That channel already has a "${conflict.bindingPurpose}" binding ` +
    `${scope}. Remove or edit the existing binding first.`
  );
}

/**
 * Convert a 23505 raised by a `channel_bindings_nonseries_*` index into a
 * ConflictException; rethrow every other error untouched (a 23505 on a
 * different constraint, or any non-23505). Always throws.
 */
export function mapUniqueViolation(err: unknown): never {
  const e = err as {
    code?: string;
    constraint?: string;
    constraint_name?: string;
    message?: string;
  };
  const constraint = e?.constraint_name ?? e?.constraint ?? '';
  const isNonseries =
    e?.code === '23505' &&
    (constraint.startsWith(NONSERIES_CONSTRAINT_PREFIX) ||
      (typeof e?.message === 'string' &&
        e.message.includes(NONSERIES_CONSTRAINT_PREFIX)));
  if (isNonseries) {
    throw new ConflictException({
      message:
        'That channel already has a binding of this kind. Remove or edit the existing one first.',
      code: CONFLICT_CODE,
    });
  }
  throw err;
}

/** Wrap a write so a non-series 23505 surfaces as a 409, else propagate. */
export async function mappingConflicts<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    mapUniqueViolation(err); // always throws
  }
}

/**
 * Pre-check `existing` (optionally flipping to `newPurpose`) against its
 * non-series siblings on the same channel; throw a ConflictException with the
 * operator message if the resolved triple already occupies a slot.
 */
export async function assertNoBindingConflict(
  db: PostgresJsDatabase<typeof schema>,
  existing: BindingConflictInput & { id: string },
  newPurpose?: string,
): Promise<void> {
  if (existing.recurrenceGroupId != null) return; // series rows never conflict
  const candidate: BindingConflictInput = {
    ...existing,
    bindingPurpose: newPurpose ?? existing.bindingPurpose,
  };
  const cb = schema.channelBindings;
  const siblings = await db
    .select()
    .from(cb)
    .where(
      and(
        eq(cb.guildId, existing.guildId),
        eq(cb.channelId, existing.channelId),
        isNull(cb.recurrenceGroupId),
      ),
    );
  const hit = findConflictingBinding(candidate, siblings);
  if (hit) {
    throw new ConflictException({
      message: describeBindingConflict(hit),
      code: CONFLICT_CODE,
    });
  }
}

/**
 * Find an existing binding matching (guild, channel, series, game). Relocated
 * verbatim from ChannelBindingsService to free lines under the 300 cap (the
 * app key stays WIDER than the DB key on purpose — do NOT narrow it: matching
 * on game is what stops /bind ever creating the dual-row the index rejects).
 * Handles NULL comparisons explicitly (PostgreSQL NULL != NULL).
 */
export async function findExistingBinding(
  db: PostgresJsDatabase<typeof schema>,
  opts: {
    guildId: string;
    channelId: string;
    gameId: number | null;
    recurrenceGroupId?: string | null;
  },
): Promise<{ id: string } | undefined> {
  const cb = schema.channelBindings;
  const conditions = [
    eq(cb.guildId, opts.guildId),
    eq(cb.channelId, opts.channelId),
    opts.recurrenceGroupId
      ? eq(cb.recurrenceGroupId, opts.recurrenceGroupId)
      : sql`${cb.recurrenceGroupId} IS NULL`,
    opts.gameId != null
      ? eq(cb.gameId, opts.gameId)
      : sql`${cb.gameId} IS NULL`,
  ];
  const [existing] = await db
    .select({ id: cb.id })
    .from(cb)
    .where(and(...conditions))
    .limit(1);
  return existing;
}

/**
 * Remove existing SAME-SLOT series bindings, returning replaced channel IDs.
 * Relocated verbatim from ChannelBindingsService (ROK-1415 line-budget move).
 *
 * ROK-1351: scoped by `channelType` so a series can hold a voice (host) slot
 * and a text (announce) slot simultaneously. Re-binding the voice slot only
 * deletes the prior voice row; the text announce row survives (and vice versa).
 */
export async function cleanupSeriesBindings(
  db: PostgresJsDatabase<typeof schema>,
  guildId: string,
  channelId: string,
  channelType: string,
  recurrenceGroupId?: string | null,
): Promise<string[]> {
  if (!recurrenceGroupId) return [];
  const deleted = await db
    .delete(schema.channelBindings)
    .where(
      and(
        eq(schema.channelBindings.guildId, guildId),
        eq(schema.channelBindings.recurrenceGroupId, recurrenceGroupId),
        isNotNull(schema.channelBindings.recurrenceGroupId),
        eq(schema.channelBindings.channelType, channelType),
      ),
    )
    .returning({ channelId: schema.channelBindings.channelId });
  return deleted.map((d) => d.channelId).filter((id) => id !== channelId);
}
