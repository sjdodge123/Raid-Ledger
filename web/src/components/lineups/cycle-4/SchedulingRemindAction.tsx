/**
 * Creator/operator "Remind Voters" nudge for the scheduling toolbar
 * (ROK-1395). One-shot, spam-safe reminder to poll members who haven't
 * voted yet. Gated like the per-row Lock affordance (lineup creator OR
 * admin/operator via `canBypassThreshold`); hidden in read-only polls. The
 * server enforces a 1h per-match cooldown (429 → error toast) and a 24h
 * per-recipient dedup, so the button stays disabled after one success.
 */
import { useEffect, type JSX } from 'react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { useRemindVoters } from '../../../hooks/use-scheduling';
import { useAuth } from '../../../hooks/use-auth';
import { canBypassThreshold } from '../../../pages/scheduling/threshold';
import { SCHEDULING_ACTION_BUTTON } from './scheduling-action-button';

/** Mirrors the server's MANUAL_REMIND_COOLDOWN_TTL (1h, api-side). */
const REMIND_COOLDOWN_MS = 60 * 60 * 1000;

export interface SchedulingRemindActionProps {
  lineupId: number;
  matchId: number;
  match: MatchDetailResponseDto;
  readOnly: boolean;
}

/** Creator/operator-only Remind Voters button — see file-level docstring. */
export function SchedulingRemindAction(
  props: SchedulingRemindActionProps,
): JSX.Element | null {
  const { lineupId, matchId, match, readOnly } = props;
  const { user } = useAuth();
  const remind = useRemindVoters();
  const { isSuccess, reset } = remind;
  // Time-box the post-success disable to the server cooldown — a page left
  // mounted past the hour must re-enable the action (Codex P2); the server's
  // 429 stays the real gate either way.
  useEffect(() => {
    if (!isSuccess) return;
    const timer = setTimeout(() => reset(), REMIND_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [isSuccess, reset]);
  if (!canBypassThreshold(user, match) || readOnly) return null;
  const label = remind.isPending
    ? 'Reminding…'
    : remind.isSuccess
      ? 'Reminded ✓'
      : 'Remind Voters';
  // ROK-1582: the phone row is three equal columns, so the idle label is
  // shortened there. The accessible name always carries the full label (and
  // the in-flight/success copy), which is what tests and AT read.
  const shortLabel = remind.isPending || remind.isSuccess ? label : 'Remind';
  return (
    <button
      type="button"
      onClick={() => remind.mutate({ lineupId, matchId })}
      disabled={remind.isPending || remind.isSuccess}
      aria-label={label}
      className={SCHEDULING_ACTION_BUTTON}
    >
      <span className="sm:hidden">{shortLabel}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
