/**
 * Compute lineup phase-state envelope for hero copy selection (ROK-1209).
 *
 * Precedence: aborted > phase-complete > deadline-missed > deadline-soon >
 * plenty-of-time.
 */
import type { LineupDetailResponseDto } from '@raid-ledger/contract';

export type PhaseState =
    | 'aborted'
    | 'phase-complete'
    | 'deadline-missed'
    | 'deadline-soon'
    | 'plenty-of-time';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface DeadlineLineup {
    status: LineupDetailResponseDto['status'];
    phaseDeadline?: string | null;
}

export function getPhaseState(
    lineup: DeadlineLineup,
    abortedAt: string | null,
    now: number = Date.now(),
): PhaseState {
    if (abortedAt != null) return 'aborted';
    if (lineup.status === 'archived') return 'phase-complete';

    const deadline = lineup.phaseDeadline
        ? new Date(lineup.phaseDeadline).getTime()
        : null;
    if (deadline == null) return 'plenty-of-time';
    if (now > deadline) return 'deadline-missed';
    if (deadline - now < ONE_DAY_MS) return 'deadline-soon';
    return 'plenty-of-time';
}
