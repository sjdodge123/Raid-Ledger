/**
 * Lifecycle helpers extracted from LineupsService to stay
 * under the 300-line file limit (ROK-932).
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CreateLineupDto,
  UpdateLineupStatusDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type { LineupStatus } from '../drizzle/schema';
import type { SettingsService } from '../settings/settings.service';
import type { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import {
  findActiveLineup,
  VALID_TRANSITIONS,
  VALID_REVERSIONS,
} from './lineups-query.helpers';
import {
  computeTransitionDeadline,
  getNextPhase,
  buildTransitionValues,
} from './lineups-phase.helpers';
import { buildMatchesForLineup } from './lineups-matching.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Insert a new lineup row with phase scheduling fields. */
export function insertLineup(
  db: Db,
  dto: CreateLineupDto,
  userId: number,
  phaseDeadline: Date | null,
  overrides: Record<string, number | undefined> | null,
) {
  return db.transaction(async (tx) => {
    const [existing] = await findActiveLineup(tx);
    if (existing) throw new ConflictException('A lineup is already active');
    return tx
      .insert(schema.communityLineups)
      .values({
        createdBy: userId,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        phaseDeadline,
        phaseDurationOverride: overrides,
        matchThreshold: dto.matchThreshold ?? undefined,
        maxVotesPerPlayer: dto.votesPerPlayer ?? undefined,
      })
      .returning();
  });
}

/** Apply a status transition with phase scheduling. */
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
  await db
    .update(schema.communityLineups)
    .set(values)
    .where(eq(schema.communityLineups.id, id));

  const nextPhase = getNextPhase(dto.status);
  if (nextPhase && phaseDeadline) {
    await phaseQueue.scheduleTransition(
      id,
      nextPhase,
      phaseDeadline.getTime() - Date.now(),
    );
  }
}

/** Run the matching algorithm (never blocks the caller). */
export async function runMatchingAlgorithm(
  db: Db,
  lineupId: number,
): Promise<void> {
  try {
    await buildMatchesForLineup(db, lineupId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Matching failed for lineup ${lineupId}: ${msg}`);
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
