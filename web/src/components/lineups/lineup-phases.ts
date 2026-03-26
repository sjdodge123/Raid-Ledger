import type { LineupStatusDto } from '@raid-ledger/contract';

/** Ordered lineup phase progression: building -> voting -> scheduling -> decided -> archived */
export const PHASES: LineupStatusDto[] = [
  'building',
  'voting',
  'scheduling',
  'decided',
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
