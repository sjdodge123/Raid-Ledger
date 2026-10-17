/**
 * ROK-1374 — the grace/deadline processor's tie-hold edges.
 *
 * Extracted from `lineup-phase.processor.ts`, which sits at the 300-line cap.
 * The processor hands these its db, logger, the notification composition and
 * the ONE thing it owns that they need: releasing the grace claim. Nothing
 * here touches BullMQ; announcing is best effort inside `announceTie*` (E5).
 */
import type { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { OrchestrationDeps } from '../lineup-notification-public-dispatch.helpers';
import {
  clearTiePick,
  openTieHold,
  readTieFromTransitionError,
} from '../tiebreaker/tie-hold.helpers';
import {
  announceTieDecided,
  announceTieDetected,
} from '../tiebreaker/tie-notify.helpers';
import type { TieResult } from '../tiebreaker/tiebreaker-detect.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;

/** What the processor lends to the tie edges. */
export interface TieHoldDeps {
  db: Db;
  logger: Logger;
  /** `LineupNotificationService.tieDeps` — the announce + DM composition. */
  tieDeps: OrchestrationDeps;
  /** Null `pending_advance_at`; the processor owns the claim (ROK-1253). */
  releaseClaim: (lineupId: number) => Promise<void>;
}

/** The picked game left the tie (a vote moved): the pick no longer stands. */
export async function dropStalePick(
  deps: TieHoldDeps,
  lineup: LineupRow,
  pick: number,
  tie: TieResult,
): Promise<void> {
  await clearTiePick(deps.db, lineup.id);
  deps.logger.warn(
    `Lineup ${lineup.id}: pick ${pick} dropped — no longer among the tied ` +
      `games [${tie.tiedGameIds.join(', ')}]; the hold stays open`,
  );
}

/**
 * ROK-1374 (D3/D4): record the tie on the lineup row, THEN release the grace
 * claim. `pendingAdvanceAt` must still be cleared — leaving it set re-creates
 * the ROK-1253 deadlock that the clear was added to fix — but the `tie_*`
 * columns now carry the state the UI renders, so releasing the claim no
 * longer means going silent.
 *
 * Deliberately not wrapped in try/catch: if the hold cannot be recorded we
 * must NOT clear the claim and call it done. Letting it throw makes BullMQ
 * retry, and the retry converges (quorum reports the same tie again).
 */
export async function holdForTie(
  deps: TieHoldDeps,
  lineup: LineupRow,
  tie: TieResult,
): Promise<void> {
  const hold = await openTieHold(deps.db, lineup, tie);
  // D4: announce on the null→set edge only, and BEFORE the claim is
  // released: the edge is burned the moment `openTieHold` stamps the row, so
  // a throw between the stamp and the announce (the release below on a
  // transient DB error → BullMQ retry → `opened: false`) would lose it.
  if (hold.opened) {
    await announceTieDetected(deps.tieDeps, deps.logger, lineup, tie);
  }
  await deps.releaseClaim(lineup.id);
  deps.logger.warn(
    `Lineup ${lineup.id} held on a tie of ${tie.tiedGameIds.length} games ` +
      `at ${tie.voteCount} vote(s)${hold.opened ? ' (newly detected)' : ''}`,
  );
}

/** The pick's transition is final once the row reads `decided` (D7 edit). */
export async function announceDecidedIfLanded(
  deps: TieHoldDeps,
  lineupId: number,
): Promise<void> {
  const [after] = await deps.db
    .select()
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (after?.status !== 'decided') return;
  await announceTieDecided(deps.tieDeps, deps.db, deps.logger, after);
}

/**
 * ROK-1374 (D3): open a tie hold when `err` is the tiebreaker guard's own
 * `TIEBREAKER_REQUIRED` 400. Returns whether one was recorded so the deadline
 * path can release any outstanding grace claim on the same edge.
 *
 * D4: the deadline job and the grace-catch reach the announce edge exactly
 * like the grace re-check does — a tie first detected HERE announces too.
 */
export async function recordTieFromError(
  deps: TieHoldDeps,
  lineup: LineupRow,
  err: unknown,
): Promise<boolean> {
  const tie = readTieFromTransitionError(err);
  if (!tie) return false;
  const hold = await openTieHold(deps.db, lineup, tie);
  if (hold.opened) {
    await announceTieDetected(deps.tieDeps, deps.logger, lineup, tie);
  }
  return true;
}
