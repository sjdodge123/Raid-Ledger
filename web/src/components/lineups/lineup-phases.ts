import type { LineupStatusDto } from '@raid-ledger/contract';

/** Ordered lineup phase progression: building -> voting -> decided -> scheduling -> archived */
export const PHASES: LineupStatusDto[] = [
  'building',
  'voting',
  'decided',
  'scheduling',
  'archived',
];

/** Human-readable labels for each lineup phase. */
export const PHASE_LABELS: Record<LineupStatusDto, string> = {
  building: 'Nominating',
  voting: 'Voting',
  scheduling: 'Scheduling',
  decided: 'Decided',
  archived: 'Archived',
};
