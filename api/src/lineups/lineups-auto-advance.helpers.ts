/**
 * Auto-advance orchestration for lineup status (ROK-1118 / ROK-1253).
 *
 * Called fire-and-forget after every nominate / vote / unnominate. Loads the
 * lineup, routes to the building or voting quorum check, then either:
 *
 *   - schedules a grace-advance BullMQ job (default), or
 *   - clears a stale `pending_advance_at` if quorum has broken, or
 *   - escapes immediately via `runStatusTransition` when grace = 0.
 *
 * Pause stickiness (ROK-1253): if an operator reverted the lineup recently
 * (`auto_advance_paused_at` within `LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS`), the
 * helper bails out early so auto-callers can't immediately re-advance.
 *
 * Errors are caught and logged — the caller's mutation must never fail
 * because the advance attempt failed.
 */
import type { Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { LineupStatus } from '../drizzle/schema';
import { SETTING_KEYS, type SettingKey } from '../drizzle/schema/app-settings';
import type { ActivityLogService } from '../activity-log/activity-log.service';
import type { SettingsService } from '../settings/settings.service';
import type { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import type { LineupNotificationService } from './lineup-notification.service';
import { findLineupById } from './lineups-query.helpers';
import { runStatusTransition } from './lineups-transition.helpers';
import {
  checkBuildingQuorum,
  checkVotingQuorum,
} from './quorum/quorum-check.helpers';
import type { LineupsGateway } from './lineups.gateway';

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;

export interface AutoAdvanceDeps {
  db: Db;
  activityLog: ActivityLogService;
  settings: SettingsService;
  phaseQueue: LineupPhaseQueueService;
  lineupNotifications: LineupNotificationService;
  lineupsGateway: LineupsGateway;
  logger: Logger;
}

const NEXT_STATUS: Partial<Record<LineupStatus, LineupStatus>> = {
  building: 'voting',
  voting: 'decided',
};

/** ROK-1253: 5min default grace window. */
const DEFAULT_GRACE_MS = 300_000;
/** ROK-1253: 24h default revert-pause TTL. */
const DEFAULT_PAUSE_TTL_MS = 86_400_000;

/**
 * ROK-1253: Pause clears lazily on the next call to `maybeAutoAdvance` or
 * `grace-advance` job. A lineup whose pause TTL has elapsed but has no user
 * activity will remain paused on disk indefinitely — this is intentional;
 * the row only matters when an action triggers re-evaluation.
 */
export async function isPauseActive(
  db: Db,
  settings: SettingsService,
  lineup: LineupRow,
): Promise<boolean> {
  if (lineup.autoAdvancePausedAt === null) return false;
  const ttlMs = await readMsSetting(
    settings,
    SETTING_KEYS.LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS,
    DEFAULT_PAUSE_TTL_MS,
  );
  const elapsed = Date.now() - lineup.autoAdvancePausedAt.getTime();
  if (elapsed < ttlMs) return true;
  // Lazy clear: best-effort opportunistic write so the next caller doesn't
  // re-evaluate the same expired stamp.
  await db
    .update(schema.communityLineups)
    .set({ autoAdvancePausedAt: null })
    .where(eq(schema.communityLineups.id, lineup.id));
  return false;
}

/** Clear a previously-scheduled pending advance + cancel its BullMQ job. */
async function clearPendingAdvance(
  deps: AutoAdvanceDeps,
  lineupId: number,
): Promise<void> {
  await deps.db
    .update(schema.communityLineups)
    .set({ pendingAdvanceAt: null, updatedAt: new Date() })
    .where(eq(schema.communityLineups.id, lineupId));
  await deps.phaseQueue.cancelGraceAdvance(lineupId);
}

/**
 * Race-safe claim of the grace window. Returns the deadline this caller
 * wrote if THIS caller won the write; null if another caller already set
 * `pending_advance_at`. Pattern mirrors `applyStatusUpdate`'s conditional
 * UPDATE (architect correction #2). ROK-1253 rework: return the deadline
 * so the caller can broadcast it via the gateway.
 */
async function claimGraceWindow(
  db: Db,
  lineupId: number,
  fromStatus: LineupStatus,
  graceMs: number,
): Promise<Date | null> {
  const deadline = new Date(Date.now() + graceMs);
  const result = await db
    .update(schema.communityLineups)
    .set({ pendingAdvanceAt: deadline, updatedAt: new Date() })
    .where(
      and(
        eq(schema.communityLineups.id, lineupId),
        eq(schema.communityLineups.status, fromStatus),
        isNull(schema.communityLineups.pendingAdvanceAt),
      ),
    )
    .returning({ id: schema.communityLineups.id });
  return result.length > 0 ? deadline : null;
}

/** Try to auto-advance a lineup to its next phase if quorum is met. */
export async function maybeAutoAdvance(
  deps: AutoAdvanceDeps,
  lineupId: number,
): Promise<void> {
  try {
    const [lineup] = await findLineupById(deps.db, lineupId);
    if (!lineup) return;
    const status = lineup.status;
    if (!NEXT_STATUS[status]) return;
    if (await isPauseActive(deps.db, deps.settings, lineup)) return;

    const ready =
      status === 'building'
        ? (await checkBuildingQuorum(deps.db, deps.settings, lineup)).ready
        : (await checkVotingQuorum(deps.db, lineup)).ready;
    if (!ready) {
      if (lineup.pendingAdvanceAt !== null) {
        await clearPendingAdvance(deps, lineupId);
      }
      return;
    }
    await scheduleOrAdvance(deps, lineup);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.warn(`maybeAutoAdvance(${lineupId}) skipped: ${msg}`);
  }
}

/**
 * Quorum is ready and pause is inactive — either claim the grace window
 * (default) or advance immediately when grace=0 (escape hatch).
 */
async function scheduleOrAdvance(
  deps: AutoAdvanceDeps,
  lineup: LineupRow,
): Promise<void> {
  if (lineup.pendingAdvanceAt !== null) return;
  const graceMs = await readMsSetting(
    deps.settings,
    SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS,
    DEFAULT_GRACE_MS,
  );
  const nextStatus = NEXT_STATUS[lineup.status]!;
  if (graceMs === 0) {
    await runStatusTransition(deps, lineup.id, { status: nextStatus });
    return;
  }
  const pendingAdvanceAt = await claimGraceWindow(
    deps.db,
    lineup.id,
    lineup.status,
    graceMs,
  );
  if (!pendingAdvanceAt) return;
  await deps.phaseQueue.scheduleGraceAdvance(lineup.id, graceMs);
  // ROK-1253 rework: broadcast grace-scheduled so subscribed clients render
  // the GraceCountdownBanner immediately instead of waiting for the React
  // Query 15s poll. Mirrors the emitStatusChange that fires when the grace
  // window completes (lineup-phase.processor.ts).
  deps.lineupsGateway.emitGraceScheduled(lineup.id, pendingAdvanceAt);
}

/** Read a non-negative integer setting (ms), falling back on missing/invalid. */
async function readMsSetting(
  settings: SettingsService,
  key: SettingKey,
  fallback: number,
): Promise<number> {
  const raw = await settings.get(key);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}
