/**
 * Startup rehydration for the lineup phase queue (ROK-946 / ROK-1253).
 *
 * ROK-1443 (D15): extracted from `lineup-phase.processor.ts`, which sat at
 * 284/300 counted lines before the building-deadline guard landed. Behaviour
 * is unchanged — only the home moved.
 */
import type { Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { LineupStatus } from '../../drizzle/schema';
import { NEXT_PHASE } from './lineup-phase.constants';
import type { LineupPhaseQueueService } from './lineup-phase.queue';

type Lineup = typeof schema.communityLineups.$inferSelect;

export interface RehydrateDeps {
  db: PostgresJsDatabase<typeof schema>;
  queueService: LineupPhaseQueueService;
  logger: Logger;
}

/**
 * Rehydrate pending jobs on startup for active lineups (phase deadlines
 * AND grace windows). ROK-1253 rework: a restart between
 * `scheduleGraceAdvance` and the job firing would otherwise leave the
 * lineup with `pending_advance_at` set but no scheduled work — the row
 * sits stuck until the next mutation or the much later `phaseDeadline`
 * job fires.
 */
export async function rehydratePendingJobs(deps: RehydrateDeps): Promise<void> {
  const activeStatuses: LineupStatus[] = ['building', 'voting', 'decided'];
  const lineups = await deps.db
    .select()
    .from(schema.communityLineups)
    .where(inArray(schema.communityLineups.status, activeStatuses));

  const withDeadline = lineups.filter((l) => l.phaseDeadline !== null);
  // ROK-1253 rework v2 (Codex round 2 P1): include EVERY non-null
  // pendingAdvanceAt row — not just future ones. `rehydrateGraceJob`
  // already clamps overdue deadlines to delay=0 via `Math.max(0, ...)`,
  // so an overdue grace just fires immediately on restart. Filtering by
  // `> now` would silently drop lineups that expired during downtime
  // and leave them stuck.
  const withPendingGrace = lineups.filter((l) => l.pendingAdvanceAt !== null);

  if (withDeadline.length === 0 && withPendingGrace.length === 0) return;

  deps.logger.log(
    `Rehydrating ${withDeadline.length} phase + ${withPendingGrace.length} grace job(s)`,
  );

  for (const lineup of withDeadline) {
    await rehydrateOneLineup(deps, lineup);
  }
  for (const lineup of withPendingGrace) {
    await rehydrateGraceJob(deps, lineup);
  }
}

/** Rehydrate a single lineup's phase job. */
async function rehydrateOneLineup(
  deps: RehydrateDeps,
  lineup: Lineup,
): Promise<void> {
  const next = NEXT_PHASE[lineup.status];
  if (!next || !lineup.phaseDeadline) return;

  const delayMs = Math.max(0, lineup.phaseDeadline.getTime() - Date.now());
  await deps.queueService.scheduleTransition(lineup.id, next, delayMs);
}

/**
 * ROK-1253 rework: re-enqueue a delayed grace-advance job for any lineup
 * whose `pending_advance_at` is still in the future. `scheduleGraceAdvance`
 * is idempotent — it removes any stale job before re-adding.
 */
async function rehydrateGraceJob(
  deps: RehydrateDeps,
  lineup: Lineup,
): Promise<void> {
  if (!lineup.pendingAdvanceAt) return;
  const delayMs = Math.max(0, lineup.pendingAdvanceAt.getTime() - Date.now());
  await deps.queueService.scheduleGraceAdvance(lineup.id, delayMs);
}
