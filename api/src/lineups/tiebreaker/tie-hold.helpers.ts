/**
 * ROK-1374 — the tie hold (D2, D4, D13).
 *
 * A completed vote with no decidable winner parks the lineup on
 * `community_lineups` rather than in `community_lineup_tiebreakers`: that
 * table's `mode` is NOT NULL, so "tied, nobody has picked a mode yet" cannot
 * be represented there without making the column nullable and rippling a 5th
 * status through the whole tiebreaker subsystem. The hold is a property of the
 * lineup, exactly like `pendingAdvanceAt`.
 *
 * The hold RECORDS and NOTIFIES. It never picks a winner — no coin flip, no
 * ownership heuristic, not even as a fallback (operator answers Q1–Q3,
 * 2026-09-03). Expiry archives the lineup undecided; it does not decide.
 */
import { BadRequestException } from '@nestjs/common';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { TieResult } from './tiebreaker-detect.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;

/** D13: a tie hold survives one week past the intended end of voting. */
export const TIE_HOLD_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Derived from the columns on every read, never stored. A `tie_status` column
 * would be a second source of truth alongside `tie_detected_at` /
 * `tie_pick_at` / `tie_expired_at` and would drift from them.
 */
export type TieHoldStatus = 'none' | 'awaiting_pick' | 'picked' | 'expired';

/** Read model for the tie hold, assembled from the `tie_*` columns. */
export interface TieHoldState {
  status: TieHoldStatus;
  detectedAt: Date | null;
  expiresAt: Date | null;
  expiredAt: Date | null;
  tiedGameIds: number[];
  voteCount: number | null;
  pickMode: 'bracket' | 'veto' | null;
  pickAt: Date | null;
  pickBy: number | null;
  announceChannelId: string | null;
  announceMessageId: string | null;
}

/** Outcome of `openTieHold`. `opened` is the announce edge (D4). */
export interface OpenTieHoldResult {
  /**
   * True ONLY on the null→set edge. Three code paths reach `openTieHold` and
   * BullMQ retries them, so without this guard a single tie would announce up
   * to 3× and DM the whole roster 3×. Dispatch is keyed off this flag alone.
   */
  opened: boolean;
  detectedAt: Date;
  expiresAt: Date;
}

/**
 * D13: `max(phase deadline at detection, detectedAt) + 7 days`, falling back
 * to `detectedAt + 7 days` when the lineup has no phase deadline.
 *
 * The `max` matters because detection can happen either BEFORE the deadline
 * (grace re-check) or AT it (deadline job) — the window must always be a full
 * week past the intended end of voting, never a week from an early detection.
 */
export function computeTieExpiresAt(
  phaseDeadline: Date | null,
  detectedAt: Date,
): Date {
  const anchorMs = Math.max(
    phaseDeadline?.getTime() ?? Number.NEGATIVE_INFINITY,
    detectedAt.getTime(),
  );
  return new Date(anchorMs + TIE_HOLD_GRACE_MS);
}

/**
 * Open (or refresh) the tie hold for a lineup. Idempotent and announce-once.
 *
 * `tie_detected_at` and `tie_expires_at` are written by a CONDITIONAL update
 * guarded on `tie_detected_at IS NULL`, so concurrent callers race safely:
 * exactly one gets a row back and therefore `opened: true`. Re-entry refreshes
 * the tied ids and vote count (a vote can change while the hold is open) but
 * never re-stamps the detection or expiry timestamps.
 */
export async function openTieHold(
  db: Db,
  lineup: LineupRow,
  tie: TieResult,
  now: Date = new Date(),
): Promise<OpenTieHoldResult> {
  const expiresAt = computeTieExpiresAt(lineup.phaseDeadline, now);
  const opened = await db
    .update(schema.communityLineups)
    .set({
      tieDetectedAt: now,
      tieExpiresAt: expiresAt,
      tieGameIds: tie.tiedGameIds,
      tieVoteCount: tie.voteCount,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.communityLineups.id, lineup.id),
        isNull(schema.communityLineups.tieDetectedAt),
      ),
    )
    .returning({ id: schema.communityLineups.id });
  if (opened.length === 1) return { opened: true, detectedAt: now, expiresAt };
  return refreshTieHold(db, lineup.id, tie, now);
}

/** Re-entry path: refresh the payload, preserve the announce-once stamps. */
async function refreshTieHold(
  db: Db,
  lineupId: number,
  tie: TieResult,
  now: Date,
): Promise<OpenTieHoldResult> {
  const [row] = await db
    .update(schema.communityLineups)
    .set({
      tieGameIds: tie.tiedGameIds,
      tieVoteCount: tie.voteCount,
      updatedAt: now,
    })
    .where(eq(schema.communityLineups.id, lineupId))
    .returning({
      detectedAt: schema.communityLineups.tieDetectedAt,
      expiresAt: schema.communityLineups.tieExpiresAt,
    });
  return {
    opened: false,
    detectedAt: row?.detectedAt ?? now,
    expiresAt: row?.expiresAt ?? computeTieExpiresAt(null, now),
  };
}

/**
 * Stamp `tie_expired_at` on an OPEN hold. Returns true only on the edge, so
 * the expiry sweep DMs once. Writes no winner — expiry archives the lineup as
 * undecided and the decided game stays null (D13, operator answer Q2).
 */
export async function expireTieHold(
  db: Db,
  lineupId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(schema.communityLineups)
    .set({ tieExpiredAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.communityLineups.id, lineupId),
        isNotNull(schema.communityLineups.tieDetectedAt),
        isNull(schema.communityLineups.tieExpiredAt),
      ),
    )
    .returning({ id: schema.communityLineups.id });
  return rows.length === 1;
}

/** Load a lineup and derive its tie-hold read model. Null when not found. */
export async function readTieHold(
  db: Db,
  lineupId: number,
): Promise<TieHoldState | null> {
  const [row] = await db
    .select()
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  return row ? deriveTieHold(row) : null;
}

/** Pure projection of the `tie_*` columns onto the read model. */
export function deriveTieHold(lineup: LineupRow): TieHoldState {
  return {
    status: deriveTieHoldStatus(lineup),
    detectedAt: lineup.tieDetectedAt,
    expiresAt: lineup.tieExpiresAt,
    expiredAt: lineup.tieExpiredAt,
    tiedGameIds: lineup.tieGameIds ?? [],
    voteCount: lineup.tieVoteCount,
    pickMode: lineup.tiePickMode,
    pickAt: lineup.tiePickAt,
    pickBy: lineup.tiePickBy,
    announceChannelId: lineup.tieAnnounceChannelId,
    announceMessageId: lineup.tieAnnounceMessageId,
  };
}

/** Expiry outranks a pick: an expired hold is terminal either way. */
function deriveTieHoldStatus(lineup: LineupRow): TieHoldStatus {
  if (lineup.tieDetectedAt === null) return 'none';
  if (lineup.tieExpiredAt !== null) return 'expired';
  if (lineup.tiePickAt !== null) return 'picked';
  return 'awaiting_pick';
}

/**
 * Extract the tie payload from a failed transition.
 *
 * Deliberately narrow: only a `BadRequestException` whose response body is the
 * `guardTiebreakerOnTransition` shape (`TIEBREAKER_REQUIRED` + `tiedGameIds` +
 * `voteCount`) yields a tie. A plain `Error('TIEBREAKER_REQUIRED')` returns
 * null and therefore takes the caller's generic-failure path — that is the
 * exact shape `lineup-auto-advance-grace.integration.spec.ts` (REWORK-4)
 * rejects with, and it must keep behaving as a generic failure.
 *
 * A payload-less `BadRequestException({ message: 'TIEBREAKER_REQUIRED' })`
 * also returns null: there is nothing to record, and inventing an empty hold
 * would announce a tie with no games in it.
 */
export function readTieFromTransitionError(err: unknown): TieResult | null {
  if (!(err instanceof BadRequestException)) return null;
  const res: unknown = err.getResponse();
  if (typeof res !== 'object' || res === null) return null;
  const body = res as Record<string, unknown>;
  if (body.message !== 'TIEBREAKER_REQUIRED') return null;
  if (!Array.isArray(body.tiedGameIds) || body.tiedGameIds.length === 0) {
    return null;
  }
  if (typeof body.voteCount !== 'number') return null;
  const tiedGameIds = body.tiedGameIds.filter(
    (id): id is number => typeof id === 'number',
  );
  if (tiedGameIds.length === 0) return null;
  return { tiedGameIds, voteCount: body.voteCount };
}
