/**
 * The early-advance clause appended to the nominating hero's sub line.
 *
 * ROK-1444: " · voting opens at N%" only while the target can actually fire.
 * Deadline-only (no target) and unarmed (carry-over seeded the lineup at or
 * above its target, so there is no rising edge left to cross) stay silent, so
 * the copy never promises an advance that cannot happen.
 *
 * ROK-1710: a lineup disarmed by an operator revert says so, instead of looking
 * the same as a lineup that never had a target. Editing the target re-arms it.
 */
import type { LineupDetailResponseDto } from '@raid-ledger/contract';

export const DISARMED_TARGET_COPY = 'Early advance is off — this lineup was reverted';

type TargetFields = Pick<
  LineupDetailResponseDto,
  'nominationTargetPct' | 'nominationTargetDisarmedAt' | 'nominationTargetArmed'
>;

export function targetSuffix(lineup: TargetFields): string {
  if (lineup.nominationTargetPct == null) return '';
  if (lineup.nominationTargetDisarmedAt != null) return ` · ${DISARMED_TARGET_COPY}`;
  if (!lineup.nominationTargetArmed) return '';
  return ` · voting opens at ${lineup.nominationTargetPct}%`;
}
