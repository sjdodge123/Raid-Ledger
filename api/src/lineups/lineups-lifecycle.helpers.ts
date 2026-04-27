/**
 * Lifecycle helpers extracted from LineupsService to stay
 * under the 300-line file limit (ROK-932).
 */
import {
  BadRequestException,
  ConflictException,
  type Logger,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { clearLinkedEventsByLineup } from './standalone-poll/standalone-poll-query.helpers';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CreateLineupDto,
  UpdateLineupStatusDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LineupStatus } from '../drizzle/schema';
import type { SettingsService } from '../settings/settings.service';
import type { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { VALID_TRANSITIONS, VALID_REVERSIONS } from './lineups-query.helpers';
import {
  computeTransitionDeadline,
  getNextPhase,
  buildTransitionValues,
} from './lineups-phase.helpers';
import { buildMatchesForLineup } from './lineups-matching.helpers';
import { addInvitees } from './lineups-invitees.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Insert a new lineup row with phase scheduling fields (ROK-1065).
 *
 * ROK-1065 removed the "only one active lineup" 409 — multiple lineups may
 * run concurrently. Private lineups seed their invitee roster inside the
 * same transaction so the detail response is immediately consistent.
 */
export function insertLineup(
  db: Db,
  dto: CreateLineupDto,
  userId: number,
  phaseDeadline: Date | null,
  overrides: Record<string, number | undefined> | null,
) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(schema.communityLineups)
      .values({
        title: dto.title,
        description: dto.description ?? null,
        createdBy: userId,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        phaseDeadline,
        phaseDurationOverride: overrides,
        matchThreshold: dto.matchThreshold ?? undefined,
        maxVotesPerPlayer: dto.votesPerPlayer ?? undefined,
        defaultTiebreakerMode: dto.defaultTiebreakerMode ?? undefined,
        // ROK-1064: per-lineup Discord channel override (nullable).
        channelOverrideId: dto.channelOverrideId ?? null,
        // ROK-1065: visibility defaults to 'public' when not provided.
        visibility: dto.visibility ?? 'public',
      })
      .returning();
    const [row] = rows;
    if (row && dto.inviteeUserIds && dto.inviteeUserIds.length > 0) {
      await addInvitees(tx as Db, row.id, dto.inviteeUserIds);
    }
    return rows;
  });
}

/**
 * Apply a status transition with phase scheduling.
 *
 * ROK-1118: the UPDATE is conditional on the lineup's current status to
 * make concurrent auto-advance callers safe. If two voters race to close
 * the quorum, both will compute `expectedPre = 'voting'` from their own
 * snapshot, but only one UPDATE will match the row's actual status —
 * the loser sees `rowCount === 0` and we throw `ConflictException`. The
 * manual `PATCH /lineups/:id/status` path surfaces this as 409;
 * `maybeAutoAdvance` swallows it.
 */
export async function applyStatusUpdate(
  db: Db,
  settings: SettingsService,
  phaseQueue: LineupPhaseQueueService,
  id: number,
  dto: UpdateLineupStatusDto,
  lineup: typeof schema.communityLineups.$inferSelect,
) {
  const phaseDeadline = await computeTransitionDeadline(
    dto.status,
    lineup,
    settings,
  );
  const values = buildTransitionValues(dto, phaseDeadline);
  const expectedPre = lineup.status;
  const updated = await db
    .update(schema.communityLineups)
    .set(values)
    .where(
      and(
        eq(schema.communityLineups.id, id),
        eq(schema.communityLineups.status, expectedPre),
      ),
    )
    .returning({ id: schema.communityLineups.id });
  if (updated.length === 0) {
    throw new ConflictException(
      `Lineup ${id} status changed concurrently; expected '${expectedPre}'`,
    );
  }

  const nextPhase = getNextPhase(dto.status);
  if (nextPhase && phaseDeadline) {
    await phaseQueue.scheduleTransition(
      id,
      nextPhase,
      phaseDeadline.getTime() - Date.now(),
    );
  }
  if (dto.status === 'archived') {
    await clearLinkedEventsByLineup(db, id);
  }
}

/** Run the matching algorithm (never blocks the caller). */
export async function runMatchingAlgorithm(
  db: Db,
  lineupId: number,
  logger: Logger,
): Promise<void> {
  try {
    await buildMatchesForLineup(db, lineupId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Matching failed for lineup ${lineupId}: ${msg}`);
  }
}

/** Validate a status transition is legal. */
export function validateTransition(
  current: LineupStatus,
  dto: UpdateLineupStatusDto,
): void {
  const isForward = VALID_TRANSITIONS[current] === dto.status;
  const isReverse = VALID_REVERSIONS[current] === dto.status;
  if (!isForward && !isReverse) {
    throw new BadRequestException(
      `Cannot transition from '${current}' to '${dto.status}'`,
    );
  }
}
