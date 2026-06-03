/**
 * Phase-transition helpers for the lineup operator ⋮ menu (ROK-1323).
 *
 * The menu offers both "Advance to {next}" and "Revert to {prev}" — the same
 * idx±1 capability the legacy PhaseBreadcrumb had (preservation-risk #3). These
 * pure helpers resolve the adjacent phases so the menu component stays under
 * the ESLint line limits.
 */
import type { LineupStatusDto } from '@raid-ledger/contract';
import { PHASES, PHASE_LABELS } from './lineup-phases';

export interface AdjacentPhase {
  status: LineupStatusDto;
  label: string;
}

/** The phase one step forward (idx+1), or null at the terminal phase. */
export function nextPhase(status: LineupStatusDto): AdjacentPhase | null {
  const idx = PHASES.indexOf(status);
  if (idx < 0 || idx >= PHASES.length - 1) return null;
  const status_ = PHASES[idx + 1];
  return { status: status_, label: PHASE_LABELS[status_] };
}

/** The phase one step back (idx−1), or null at the first phase. */
export function prevPhase(status: LineupStatusDto): AdjacentPhase | null {
  const idx = PHASES.indexOf(status);
  if (idx <= 0) return null;
  const status_ = PHASES[idx - 1];
  return { status: status_, label: PHASE_LABELS[status_] };
}
