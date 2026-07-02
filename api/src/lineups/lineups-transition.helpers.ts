/**
 * Status transition helpers extracted from lineups.service.ts (ROK-1063).
 * Keeps the service under the 300-line ESLint limit.
 */
import { Logger, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  LineupDetailResponseDto,
  UpdateLineupStatusDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import type { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { guardTiebreakerOnTransition } from './tiebreaker/tiebreaker-detect.helpers';
import type { LineupNotificationService } from './lineup-notification.service';
import {
  countVotesPerGame,
  findLineupById,
  validateDecidedGame,
} from './lineups-query.helpers';
import {
  applyStatusUpdate,
  healClearedEventEmbeds,
  runMatchingAlgorithm,
  validateTransition,
} from './lineups-lifecycle.helpers';
import { buildDetailResponse } from './lineups-response.helpers';
import { logTransition } from './lineups-activity.helpers';
import { applyRevertSideEffects } from './lineups-revert.helpers';
import {
  fireVotingOpen,
  fireDecidedNotifications,
} from './lineups-notify-hooks.helpers';
import type { LineupsGateway } from './lineups.gateway';
import type { EmbedSyncQueueService } from '../discord-bot/queues/embed-sync.queue';

type Db = PostgresJsDatabase<typeof schema>;

export interface TransitionDeps {
  db: Db;
  activityLog: ActivityLogService;
  phaseQueue: LineupPhaseQueueService;
  lineupNotifications: LineupNotificationService;
  lineupsGateway: LineupsGateway;
  logger: Logger;
  /** ROK-1370: heals RESCHEDULING embeds when an archive clears linked polls. */
  embedSyncQueue?: EmbedSyncQueueService;
}

/**
 * Orchestrate a lineup status transition with validation, update, and hooks.
 *
 * ROK-1253: `actorId` is forwarded to the revert side-effect helper so
 * `lineup_auto_advance_paused` activity entries credit the operator. Auto-
 * advance callers (no human actor) pass null; we still log the pause but
 * without an actor — matching `logTransition`'s null-actor pattern.
 */
export async function runStatusTransition(
  deps: TransitionDeps,
  id: number,
  dto: UpdateLineupStatusDto,
  actorId: number | null = null,
): Promise<LineupDetailResponseDto> {
  const [lineup] = await findLineupById(deps.db, id);
  if (!lineup) throw new NotFoundException('Lineup not found');

  validateTransition(lineup.status, dto);
  if (dto.status === 'decided' && dto.decidedGameId) {
    await validateDecidedGame(deps.db, id, dto.decidedGameId);
  }

  await guardTiebreakerOnTransition(deps.db, id, lineup.status, dto);
  await autoPickDecidedGameId(deps.db, id, dto);
  // ROK-1363: capture the NEW phase deadline so the voting-open hook keys off
  // the freshly-written voting deadline, not the stale pre-update one read at
  // line 60.
  const newPhaseDeadline = await applyStatusUpdate(
    deps.db,
    deps.phaseQueue,
    id,
    dto,
    lineup,
    healClearedEventEmbeds(deps.embedSyncQueue, deps.logger),
  );
  // ROK-1118: emit immediately after the conditional UPDATE succeeds so
  // subscribed clients see the phase flip without polling. The timestamp
  // matches the row's `updatedAt` we just wrote (within milliseconds).
  deps.lineupsGateway.emitStatusChange(id, dto.status, new Date());
  if (dto.status === 'decided') {
    await runMatchingAlgorithm(deps.db, id, deps.logger);
  }
  await logTransition(deps.db, deps.activityLog, id, dto);
  // ROK-1253: cancel any pending grace job and emit the pause activity
  // entry when this transition is a reversion. The pause-stamp itself was
  // already written atomically inside applyStatusUpdate.
  await applyRevertSideEffects(
    { db: deps.db, activityLog: deps.activityLog, phaseQueue: deps.phaseQueue },
    id,
    lineup.status,
    dto.status,
    actorId ?? lineup.createdBy,
  );

  if (dto.status === 'voting') {
    fireVotingOpen(
      deps.lineupNotifications,
      deps.logger,
      deps.db,
      id,
      newPhaseDeadline,
    );
  }
  if (dto.status === 'decided') {
    fireDecidedNotifications(
      deps.lineupNotifications,
      deps.logger,
      deps.db,
      id,
    );
  }
  return buildDetailResponse(deps.db, id);
}

/**
 * ROK-1263 / ROK-1253 rework: if the operator (or grace job) requested
 * `decided` without naming a winner, derive it from the vote leaderboard.
 * `guardTiebreakerOnTransition` already covers two cases (operator-chosen,
 * resolved-tiebreaker) and throws TIEBREAKER_REQUIRED on ties. The only
 * remaining case is "unique top vote-getter, no tiebreaker run" — auto-pick
 * it here so the row never lands in `decided` with `decided_game_id = NULL`.
 *
 * Defensive: re-runs `validateDecidedGame` because votes reference
 * `games.id` directly, so a removed nomination with stale votes is
 * theoretically possible — bail to existing behaviour rather than land a
 * foreign-mismatch winner.
 */
async function autoPickDecidedGameId(
  db: TransitionDeps['db'],
  lineupId: number,
  dto: UpdateLineupStatusDto,
): Promise<void> {
  if (dto.status !== 'decided' || dto.decidedGameId) return;
  const derived = await deriveTopVotedGame(db, lineupId);
  if (derived === null) return;
  await validateDecidedGame(db, lineupId, derived);
  dto.decidedGameId = derived;
}

/**
 * Pick the unique top vote-getter for a lineup. Returns null when there
 * are zero votes (caller leaves `decidedGameId` undefined — matches the
 * previous behaviour and keeps the surface area minimal). Tied tops are
 * handled by `guardTiebreakerOnTransition` BEFORE we get here, so by the
 * time this function is called any tie has either been resolved (winner
 * inlined onto `dto`) or rejected (TIEBREAKER_REQUIRED). The ORDER BY uses
 * gameId ASC as the deterministic tiebreaker for the rare race where the
 * tie-detection snapshot disagrees with this query's snapshot.
 */
async function deriveTopVotedGame(
  db: TransitionDeps['db'],
  lineupId: number,
): Promise<number | null> {
  const counts = await countVotesPerGame(db, lineupId);
  if (counts.length === 0) return null;
  const sorted = [...counts].sort(
    (a, b) => b.voteCount - a.voteCount || a.gameId - b.gameId,
  );
  return sorted[0].gameId;
}
