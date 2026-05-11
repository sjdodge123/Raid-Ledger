/**
 * Constants for lineup phase transition queue (ROK-946).
 */
import type { LineupStatus } from '../../drizzle/schema';

export const LINEUP_PHASE_QUEUE = 'lineup-phase-transition';

/** ROK-946: Deadline-driven status flip job name. */
export const LINEUP_PHASE_TRANSITION = 'phase-transition';

/** ROK-1253: Pre-advance grace re-evaluation job name. */
export const LINEUP_GRACE_ADVANCE = 'grace-advance';

export interface LineupPhaseJobData {
  lineupId: number;
  targetStatus: string;
}

/** ROK-1253: Grace re-evaluation job payload. */
export interface LineupGraceAdvanceJobData {
  lineupId: number;
}

/** Maps current phase → next phase. */
export const NEXT_PHASE: Record<string, LineupStatus | null> = {
  building: 'voting',
  voting: 'decided',
  decided: 'archived',
  archived: null,
};

/** Maps current phase → which duration key to use for scheduling. */
export const PHASE_DURATION_KEY: Record<string, string> = {
  building: 'building',
  voting: 'voting',
  decided: 'decided',
};

/** Default phase durations in hours (fallbacks). */
export const DEFAULT_DURATIONS = {
  building: 48,
  voting: 24,
  decided: 72,
} as const;
