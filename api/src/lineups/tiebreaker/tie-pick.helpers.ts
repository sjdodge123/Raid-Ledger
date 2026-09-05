/**
 * ROK-1374 — the reversible GAME pick (LEAD CORRECTION 2026-09-05, D15/D16).
 *
 * A tied vote parks the lineup on a tie hold; a human then picks one of the
 * tied GAMES (not a tiebreaker mode — any elimination-shaped mechanism was
 * rejected for the abundance case). The pick claims the SAME grace window a
 * ready quorum claims, so:
 *
 *   - the countdown the group already understands is what makes it reversible,
 *   - the grace job that fires afterwards runs the ordinary
 *     `voting → decided` transition carrying `decidedGameId`, and
 *   - there is exactly one scheduler in the system, not two.
 *
 * Nothing here selects a winner. Every write below is downstream of an
 * explicit human action (operator answers Q1–Q3, 2026-09-03).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  type Logger,
} from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { UserRole } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { isOperatorOrAdmin } from '../../events/controller.helpers';
import type { SettingsService } from '../../settings/settings.service';
import type { LineupPhaseQueueService } from '../queue/lineup-phase.queue';
import type { LineupsGateway } from '../lineups.gateway';
import {
  claimGraceWindow,
  readGraceWindowMs,
} from '../lineups-auto-advance.helpers';
import { readTieHold, type TieHoldState } from './tie-hold.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;

/** The JWT identity a pick is attributed to. */
export interface TiePickActor {
  id: number;
  role: UserRole;
}

/** Collaborators the pick needs; mirrors `AutoAdvanceDeps`' relevant subset. */
export interface TiePickDeps {
  db: Db;
  settings: SettingsService;
  phaseQueue: LineupPhaseQueueService;
  lineupsGateway: LineupsGateway;
  logger: Logger;
}

/**
 * D15: row-scoped authorisation — the lineup creator OR an operator/admin.
 * A `@Roles()` decorator cannot express "creator", which is why the start
 * route drops its role guard in favour of this call.
 */
export function assertCanPickTiebreaker(
  lineup: LineupRow,
  user: TiePickActor,
): void {
  if (isOperatorOrAdmin(user.role)) return;
  if (lineup.createdBy === user.id) return;
  throw new ForbiddenException(
    'Only the lineup creator or an operator can do this',
  );
}

/**
 * Record a pick of one of the tied games and arm the grace window.
 *
 * Re-picking a different game while the claim is still pending overwrites the
 * game and KEEPS the existing claim: `claimGraceWindow` is conditional on
 * `pending_advance_at IS NULL`, so it returns null and we must not enqueue a
 * second job for a window that is already counting down.
 */
export async function pickTieGame(
  deps: TiePickDeps,
  lineup: LineupRow,
  user: TiePickActor,
  gameId: number,
): Promise<TieHoldState | null> {
  assertCanPickTiebreaker(lineup, user);
  assertPickable(lineup, gameId);
  const now = new Date();
  await deps.db
    .update(schema.communityLineups)
    .set({
      tiePickGameId: gameId,
      tiePickAt: now,
      tiePickBy: user.id,
      updatedAt: now,
    })
    .where(eq(schema.communityLineups.id, lineup.id));
  await armGraceWindow(deps, lineup);
  deps.logger.log(`Lineup ${lineup.id}: tie pick ${gameId} by user ${user.id}`);
  return readTieHold(deps.db, lineup.id);
}

/** E8 / E9 + "must be one of `tie_game_ids`", in that order. */
function assertPickable(lineup: LineupRow, gameId: number): void {
  if (lineup.tieDetectedAt === null) {
    throw new BadRequestException('NO_TIE_HOLD');
  }
  // An expired hold is terminal (D13): the sweep archived the lineup, so a
  // pick would stamp columns nothing reads, claim a grace window on an
  // archived row and enqueue a job that bails — and undo would 409 it forever.
  if (lineup.tieExpiredAt !== null) {
    throw new ConflictException('TIE_HOLD_EXPIRED');
  }
  if (lineup.status !== 'voting') {
    throw new ConflictException('TIE_PICK_FINAL');
  }
  if (!(lineup.tieGameIds ?? []).includes(gameId)) {
    throw new BadRequestException('GAME_NOT_TIED');
  }
  // 409 rather than the 400 `assertNoActiveTiebreaker` raises: a running
  // bracket/veto owns the outcome, and changing that helper would alter the
  // existing `POST /tiebreaker` response.
  if (lineup.activeTiebreakerId !== null) {
    throw new ConflictException('TIEBREAKER_ACTIVE');
  }
}

/** Claim + schedule + broadcast, exactly as `scheduleOrAdvance` does. */
async function armGraceWindow(
  deps: TiePickDeps,
  lineup: LineupRow,
): Promise<void> {
  const graceMs = await readGraceWindowMs(deps.settings);
  const pendingAdvanceAt = await claimGraceWindow(
    deps.db,
    lineup.id,
    lineup.status,
    graceMs,
  );
  if (!pendingAdvanceAt) return;
  await deps.phaseQueue.scheduleGraceAdvance(lineup.id, graceMs);
  deps.lineupsGateway.emitGraceScheduled(lineup.id, pendingAdvanceAt);
}

/**
 * Reverse a pick while its grace window is still counting down.
 *
 * `409 TIE_PICK_FINAL` once the lineup has left `voting`: the advance fired,
 * the group has a decision, and un-deciding it is a different operation
 * (revert) with its own audit trail.
 */
export async function undoTiePick(
  deps: TiePickDeps,
  lineup: LineupRow,
  user: TiePickActor,
): Promise<TieHoldState | null> {
  assertCanPickTiebreaker(lineup, user);
  if (lineup.tiePickGameId === null) {
    throw new BadRequestException('NO_PICK');
  }
  if (lineup.status !== 'voting') {
    throw new ConflictException('TIE_PICK_FINAL');
  }
  // The row read above can be stale by the time this runs: if the grace job
  // fires in between, the lineup is already `decided` and the pick is final.
  // The clear is therefore conditional, and the 409 comes from the write.
  const cleared = await deps.db
    .update(schema.communityLineups)
    .set({
      tiePickGameId: null,
      tiePickAt: null,
      tiePickBy: null,
      pendingAdvanceAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.communityLineups.id, lineup.id),
        eq(schema.communityLineups.status, 'voting'),
        isNotNull(schema.communityLineups.tiePickGameId),
      ),
    )
    .returning({ id: schema.communityLineups.id });
  if (cleared.length === 0) {
    throw new ConflictException('TIE_PICK_FINAL');
  }
  await deps.phaseQueue.cancelGraceAdvance(lineup.id);
  return readTieHold(deps.db, lineup.id);
}
