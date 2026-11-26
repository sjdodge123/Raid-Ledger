import type { LineupDetailResponseDto } from '@raid-ledger/contract';

/**
 * ROK-2349: archived and aborted lineups accept no further edits — the same
 * condition that renders the NominationGrid read-only also hides the invitee
 * panel's "Invite more" and per-chip remove controls.
 */
export function isLineupReadOnly(
  status: LineupDetailResponseDto['status'],
  isAborted: boolean,
): boolean {
  return isAborted || status === 'archived';
}
