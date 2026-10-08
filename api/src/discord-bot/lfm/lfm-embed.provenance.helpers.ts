/**
 * ROK-1454 D9 / TDB:953 — which conversion, if any, ended an LFM row's group.
 *
 * The restart reconcile's only surviving evidence of HOW a group ended while
 * the bot was down is the provenance an intent carries: the FK it converted
 * into and (since TDB:953) `converted_at`, the DB-clock instant it did.
 * Re-exported through `lfm-embed.db-helpers` — import it from there, so the
 * unit specs' module mock covers it.
 */
import { and, asc, desc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { LfgConversionTarget } from '../../lfg/lfg-write.helpers';

/** The two provenance FKs, as the reconcile reads them (D9). */
const PROVENANCE = {
  pollId: schema.lfgIntents.convertedToPollId,
  eventId: schema.lfgIntents.convertedToEventId,
};

/** The intent converted INTO something — either FK is set. */
function hasProvenance() {
  return or(
    isNotNull(schema.lfgIntents.convertedToPollId),
    isNotNull(schema.lfgIntents.convertedToEventId),
  );
}

/** A provenance row as the target `convertedView` renders. */
function toTarget(row: {
  pollId: number | null;
  eventId: number | null;
}): LfgConversionTarget {
  if (row.pollId !== null) return { pollId: row.pollId };
  return { eventId: row.eventId as number };
}

/**
 * Newest conversion provenance for a game, or null (D9).
 *
 * Used only by the restart reconcile, where the transition payload is long
 * gone and the row itself is the only surviving evidence of what happened.
 * Newest first, because an older group for the same game converted months ago.
 *
 * TDB:953 — the bound is `converted_at > postedAfter` wherever the stamp
 * exists. The `expires_at` bound is only a partial discriminator (an older
 * group whose hands have not yet expired passes it), so it survives ONLY as
 * the fallback for legacy rows converted before the stamp did (NULL, ruled
 * 2026-10-08: no backfill — they age out within the LFG expiry window).
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose open row is being reconciled.
 * @returns The most recent conversion target, or null when none exists.
 * @param postedAfter - When the message being reconciled was posted (its own
 *   DB-stamped `posted_at`); only provenance after that can be its group's.
 */
export async function latestConversionTarget(
  db: LfgDb,
  gameId: number,
  postedAfter: Date,
): Promise<LfgConversionTarget | null> {
  const [row] = await db
    .select(PROVENANCE)
    .from(schema.lfgIntents)
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.status, 'converted'),
        or(
          gt(schema.lfgIntents.convertedAt, postedAfter),
          // Legacy: conversion never resets the clock, so the row's own
          // group's hands still expire after `postedAfter` (E6).
          and(
            isNull(schema.lfgIntents.convertedAt),
            gt(schema.lfgIntents.expiresAt, postedAfter),
          ),
        ),
        hasProvenance(),
      ),
    )
    .orderBy(desc(schema.lfgIntents.id))
    .limit(1);
  return row ? toTarget(row) : null;
}

/**
 * TDB:953 — the conversion that ended THIS row's group, or null.
 *
 * The group was live when its message was posted, so a conversion stamped
 * after `posted_at` is its ending — even if a NEW group for the game has
 * since crossed the floor. The FIRST such conversion is the one that ended
 * it (a later one belongs to a group formed after). Compared in SQL against
 * the row's own `posted_at`: both are zone-less DB-clock stamps, so no JS
 * Date (and no millisecond truncation) ever sits on one side. A NULL legacy
 * stamp never matches — those keep {@link latestConversionTarget}'s fallback.
 *
 * @param db - Drizzle handle.
 * @param row - The `open` row being reconciled.
 * @returns The conversion target that ended the row's group, or null.
 */
export async function conversionSincePosted(
  db: LfgDb,
  row: { id: string; gameId: number },
): Promise<LfgConversionTarget | null> {
  const [hit] = await db
    .select(PROVENANCE)
    .from(schema.lfgIntents)
    .innerJoin(schema.lfgGroupMessages, eq(schema.lfgGroupMessages.id, row.id))
    .where(
      and(
        eq(schema.lfgIntents.gameId, row.gameId),
        eq(schema.lfgIntents.status, 'converted'),
        gt(schema.lfgIntents.convertedAt, schema.lfgGroupMessages.postedAt),
        hasProvenance(),
      ),
    )
    .orderBy(asc(schema.lfgIntents.convertedAt), asc(schema.lfgIntents.id))
    .limit(1);
  return hit ? toTarget(hit) : null;
}
