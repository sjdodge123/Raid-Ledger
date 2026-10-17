/**
 * Quick Play "offer to clear" read (ROK-1451 AC7).
 *
 * Fully DERIVED — no column, no table, no dismissal state, nothing that can
 * drift. An offer exists when the caller holds a live intent on game G AND
 * took part in an ad-hoc (Quick Play) session for G that STARTED AFTER the
 * intent was created. A session from before the intent proves nothing.
 *
 * Read-only by construction: this module contains no INSERT/UPDATE/DELETE.
 * A Quick Play session must never clear an intent on its own (AC7c) — only
 * `DELETE /lfg/:gameId` does that.
 */
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { LfgClearOfferDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LfgDb } from './lfg-query.helpers';
import { LFG_LIST_LIMIT } from './lfg.constants';

/** Row shape returned by the offers query before projection. */
interface ClearOfferRow {
  gameId: number;
  gameName: string;
  gameCoverUrl: string | null;
  intentId: number;
  eventId: number;
  playedAt: Date;
}

/**
 * Join predicate: an ad-hoc session for the intent's game that STARTED AFTER
 * the intent was created. A session from before the intent proves nothing.
 */
function qualifyingSession() {
  return and(
    eq(schema.events.gameId, schema.lfgIntents.gameId),
    eq(schema.events.isAdHoc, true),
    sql`lower(${schema.events.duration}) > ${schema.lfgIntents.createdAt}`,
  );
}

/** Join predicate: the caller actually took part in that session. */
function callerParticipated() {
  return and(
    eq(schema.adHocParticipants.eventId, schema.events.id),
    eq(schema.adHocParticipants.userId, schema.lfgIntents.userId),
  );
}

/** Project a raw offer row onto the wire DTO. */
function toClearOffer(row: ClearOfferRow): LfgClearOfferDto {
  return {
    gameId: row.gameId,
    gameName: row.gameName,
    gameCoverUrl: row.gameCoverUrl,
    intentId: row.intentId,
    eventId: row.eventId,
    playedAt: row.playedAt.toISOString(),
  };
}

/**
 * `GET /lfg/offers` — at most ONE offer per live intent (M3).
 *
 * A player who joins the same Quick Play game repeatedly used to get an offer
 * row per session, so the result set was multiplicative in a surface the UI
 * renders one card from. `DISTINCT ON (lfg_intents.id)` with `joined_at DESC`
 * keeps the most recent qualifying session for each intent; the JS re-sort
 * then restores the "most recently played first" ordering the DTO promises,
 * which `DISTINCT ON` cannot express in its own ORDER BY.
 *
 * @param db - Drizzle handle.
 * @param viewerId - Caller whose intents and sessions to match.
 * @returns Offers, most recently played first. Never mutates anything.
 */
export async function listClearOffers(
  db: LfgDb,
  viewerId: number,
): Promise<LfgClearOfferDto[]> {
  const rows = await db
    .selectDistinctOn([schema.lfgIntents.id], {
      gameId: schema.games.id,
      gameName: schema.games.name,
      gameCoverUrl: schema.games.coverUrl,
      intentId: schema.lfgIntents.id,
      eventId: schema.events.id,
      playedAt: schema.adHocParticipants.joinedAt,
    })
    .from(schema.lfgIntents)
    .innerJoin(schema.games, eq(schema.games.id, schema.lfgIntents.gameId))
    .innerJoin(schema.events, qualifyingSession())
    .innerJoin(schema.adHocParticipants, callerParticipated())
    .where(
      and(
        eq(schema.lfgIntents.userId, viewerId),
        eq(schema.lfgIntents.status, 'active'),
        gt(schema.lfgIntents.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(schema.lfgIntents.id), desc(schema.adHocParticipants.joinedAt))
    .limit(LFG_LIST_LIMIT);
  return rows
    .map(toClearOffer)
    .sort((l, r) => r.playedAt.localeCompare(l.playedAt));
}
