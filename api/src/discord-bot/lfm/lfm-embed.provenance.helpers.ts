/**
 * ROK-1454 D9 / TDB:953 — which conversion, if any, ended an LFM row's group.
 *
 * The restart reconcile's only surviving evidence of HOW a group ended while
 * the bot was down is the provenance an intent carries: the FK it converted
 * into and (since TDB:953) `converted_at`, the DB-clock instant it did.
 * Re-exported through `lfm-embed.db-helpers` — import it from there, so the
 * unit specs' module mock covers it.
 */
import { and, desc, eq, gt, isNotNull, or, sql, type SQL } from 'drizzle-orm';
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
 * TDB:953 — how far BEFORE its row's `posted_at` a group's own conversion
 * can be stamped. Do NOT "clean this up" to a strict `converted_at >
 * posted_at`: an LFG-Now spawn converts its group (`LfgNowSpawnService.
 * onLfmReached` -> `convertGroup`, `lfg-now-spawn.service.ts` /
 * `lfg-now-spawn.helpers.ts`) while `postText` (`lfm-embed.post.helpers.ts`)
 * is still awaiting `sendEmbed`, and only then does `insertLfmMessage` stamp
 * `posted_at`. So that group's stamp normally lands one Discord round-trip
 * BEFORE its own row. Thirty seconds covers that round-trip (a 2-minute
 * window admitted the PREVIOUS group's conversion whenever the next group
 * posted inside it — Codex r3); an older group's corpse (converted before
 * this group even formed) falls outside it.
 */
export const OWN_CONVERSION_GRACE = sql.raw(`interval '30 seconds'`);

/**
 * TDB:953 — the ORDER BY both lookups share, in two tiers (Codex P2 on r2).
 *
 * The Codex case: an OLDER group converted before this row was posted, its
 * hands still unexpired, and THIS row's own group converted later. The
 * predicate admits both (the corpse via the `expires_at` leg or the grace),
 * and a flat `converted_at ASC` returned the corpse — the row closed against
 * the wrong event/poll. So a conversion stamped AFTER the bound outranks
 * everything else:
 * - tier 1, `afterBound` holds: `converted_at ASC` — the first conversion
 *   after posting ended this row's group; a later one is a newer group's.
 * - tier 2, everything else the predicate admits (NULL-stamped legacy rows,
 *   the `expires_at` fallback, the grace window): `id DESC`, D9's newest-first.
 *
 * @param afterBound - `converted_at > <bound>`; a NULL stamp falls to tier 2.
 */
function afterBoundFirst(afterBound: SQL): SQL[] {
  return [
    sql`case when ${afterBound} then 0 else 1 end`,
    sql`case when ${afterBound} then ${schema.lfgIntents.convertedAt} end asc nulls last`,
    desc(schema.lfgIntents.id),
  ];
}

/**
 * Conversion provenance for a game's ended group, or null (D9).
 *
 * Used only by the restart reconcile's below-the-floor path (`endedView`),
 * where the transition payload is long gone and the intents are the only
 * surviving evidence of what happened.
 *
 * TDB:953 — the bound is `converted_at > postedAfter` OR `expires_at >
 * postedAfter`. The `expires_at` leg stays for EVERY row, stamped or not:
 * conversion never resets the clock, so the row's own group's hands still
 * expire after `postedAfter` (E6) — that is what ties an LFG-Now spawn,
 * stamped BEFORE its row's `posted_at` (see {@link OWN_CONVERSION_GRACE}),
 * to its row, and what still covers legacy rows converted before the stamp
 * existed (NULL, ruled 2026-10-08: no backfill).
 *
 * Order: {@link afterBoundFirst} with `converted_at > postedAfter` — a
 * conversion stamped after posting outranks one the `expires_at` leg alone
 * admits (an older group's corpse, or this group's spawn-order stamp), the
 * EARLIEST such stamp winning; the rest keep D9's newest-first.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose open row is being reconciled.
 * @param postedAfter - When the message being reconciled was posted (its own
 *   DB-stamped `posted_at`); only provenance after that can be its group's.
 * @returns The conversion target, or null when none qualifies.
 */
export async function latestConversionTarget(
  db: LfgDb,
  gameId: number,
  postedAfter: Date,
): Promise<LfgConversionTarget | null> {
  const afterPost = gt(schema.lfgIntents.convertedAt, postedAfter);
  const [row] = await db
    .select(PROVENANCE)
    .from(schema.lfgIntents)
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        eq(schema.lfgIntents.status, 'converted'),
        or(afterPost, gt(schema.lfgIntents.expiresAt, postedAfter)),
        hasProvenance(),
      ),
    )
    .orderBy(...afterBoundFirst(afterPost))
    .limit(1);
  return row ? toTarget(row) : null;
}

/**
 * TDB:953 — the conversion that ended THIS row's group, or null.
 *
 * Runs ABOVE the live floor, so it must not admit an older group's corpse:
 * it matches STAMPED rows only, converted no earlier than
 * {@link OWN_CONVERSION_GRACE} before the row's `posted_at` — the group was
 * live when its message was posted, so such a conversion is its ending even
 * if a NEW group for the game has since crossed the floor. Order:
 * {@link afterBoundFirst} with `converted_at > posted_at` (no grace) — a
 * conversion strictly after the post outranks a grace-window stamp, which may
 * be an older group's corpse (the Codex case); the FIRST strictly-later one
 * wins (a later one belongs to a group formed after). Compared in SQL against
 * the row's own `posted_at`: both are zone-less DB-clock stamps, so no JS
 * Date (and no millisecond truncation) ever sits on one side. A NULL legacy
 * stamp never matches — those keep {@link latestConversionTarget}'s path.
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
        gt(
          schema.lfgIntents.convertedAt,
          sql`${schema.lfgGroupMessages.postedAt} - ${OWN_CONVERSION_GRACE}`,
        ),
        hasProvenance(),
      ),
    )
    .orderBy(
      ...afterBoundFirst(
        gt(schema.lfgIntents.convertedAt, schema.lfgGroupMessages.postedAt),
      ),
    )
    .limit(1);
  return hit ? toTarget(hit) : null;
}
