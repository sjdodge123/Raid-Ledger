/**
 * Phase scheduling helpers for lineup service (ROK-946).
 * Extracted to keep lineups.service.ts within the 300-line limit.
 */
import type {
  CreateLineupDto,
  UpdateLineupStatusDto,
} from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import type { SettingsService } from '../settings/settings.service';
import { getLineupDurationDefaults } from './queue/lineup-phase-settings.helpers';
import { NEXT_PHASE } from './queue/lineup-phase.constants';

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
export async function computeInitialDeadline(
  dto: CreateLineupDto,
  settings: SettingsService,
): Promise<Date> {
  const defaults = await getLineupDurationDefaults(settings);
  const hours = dto.buildingDurationHours ?? defaults.building;
  return new Date(Date.now() + hours * 3_600_000);
}

/** Compute phaseDeadline for a status transition. */
export async function computeTransitionDeadline(
  newStatus: string,
  lineup: Lineup,
  settings: SettingsService,
): Promise<Date | null> {
  if (newStatus === 'archived') return null;

  const overrides = lineup.phaseDurationOverride;
  if (overrides && typeof overrides === 'object') {
    const key = newStatus as keyof typeof overrides;
    if (key in overrides && overrides[key] != null) {
      return new Date(Date.now() + overrides[key] * 3_600_000);
    }
  }

  const defaults = await getLineupDurationDefaults(settings);
  const key = newStatus as keyof typeof defaults;
  const hours = defaults[key] ?? 48;
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
