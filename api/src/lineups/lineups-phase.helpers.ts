/**
 * Phase scheduling helpers for lineup service (ROK-946).
 * Extracted to keep lineups.service.ts within the 300-line limit.
 */
import type {
  CreateLineupDto,
  UpdateLineupStatusDto,
} from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import { DEFAULT_DURATIONS, NEXT_PHASE } from './queue/lineup-phase.constants';

type Lineup = typeof schema.communityLineups.$inferSelect;

/** Check if any duration params were provided. */
export function hasDurationParams(dto: CreateLineupDto): boolean {
  return !!(
    dto.buildingDurationHours ||
    dto.votingDurationHours ||
    dto.decidedDurationHours
  );
}

/** Build duration overrides from create DTO. */
export function buildOverrides(dto: CreateLineupDto) {
  return {
    building: dto.buildingDurationHours ?? undefined,
    voting: dto.votingDurationHours ?? undefined,
    decided: dto.decidedDurationHours ?? undefined,
  };
}

/** Compute initial phaseDeadline for building phase. */
export function computeInitialDeadline(dto: CreateLineupDto): Date {
  const hours = dto.buildingDurationHours ?? DEFAULT_DURATIONS.building;
  return new Date(Date.now() + hours * 3_600_000);
}

/** Compute phaseDeadline for a status transition. */
export function computeTransitionDeadline(
  newStatus: string,
  lineup: Lineup,
): Date | null {
  if (newStatus === 'archived') return null;

  const overrides = lineup.phaseDurationOverride;
  if (overrides && typeof overrides === 'object') {
    const key = newStatus as keyof typeof overrides;
    const val = key !== 'standalone' ? overrides[key] : undefined;
    if (typeof val === 'number') {
      return new Date(Date.now() + val * 3_600_000);
    }
  }

  const key = newStatus as keyof typeof DEFAULT_DURATIONS;
  const hours = DEFAULT_DURATIONS[key] ?? 48;
  return new Date(Date.now() + hours * 3_600_000);
}

/** Get the next phase for the given status. */
export function getNextPhase(status: string): string | null {
  return NEXT_PHASE[status] ?? null;
}

/** Build the status update values for a transition. */
export function buildTransitionValues(
  dto: UpdateLineupStatusDto,
  phaseDeadline: Date | null,
): Partial<typeof schema.communityLineups.$inferInsert> {
  const values: Partial<typeof schema.communityLineups.$inferInsert> = {
    status: dto.status,
    updatedAt: new Date(),
    phaseDeadline,
  };
  if (dto.status === 'voting' && dto.votingDeadline) {
    values.votingDeadline = new Date(dto.votingDeadline);
  }
  if (dto.status === 'decided' && dto.decidedGameId) {
    values.decidedGameId = dto.decidedGameId;
  }
  return values;
}
