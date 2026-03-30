import type { LineupStatusDto } from '@raid-ledger/contract';

/** Ordered lineup phase progression: building -> voting -> decided -> archived */
export const PHASES: LineupStatusDto[] = [
  'building',
  'voting',
  'decided',
  'archived',
];

/** Human-readable labels for each lineup phase. */
export const PHASE_LABELS: Record<LineupStatusDto, string> = {
  building: 'Nominating',
  voting: 'Voting',
  decided: 'Decided',
  archived: 'Archived',
};
