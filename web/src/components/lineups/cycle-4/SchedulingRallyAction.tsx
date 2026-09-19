/**
 * "Rally" — the leader card's nudge to every poll member who has not answered
 * the LEADING time (ROK-1618).
 *
 * Different from the Manage-poll sheet's "Remind Voters", which is poll-wide:
 * the server resolves this audience from the leading slot (no YES and no NO
 * on it, aged past the member-age guard, not deactivated) and shares the
 * recurring nudge's 24h per-member dedup, so a rally can never out-spam it.
 * A member who voted on some OTHER time is still in the audience — that is
 * the prod case the any-future-slot rule got wrong.
 *
 * Row-only: it is rendered exclusively inside `SchedulingLeaderMenu`, which
 * already applies the organiser gate, so this component does not repeat it.
 *
 * The post-success disable is armed from the SERVER's `cooldownUntil`, not
 * from "the call succeeded": a rally that finds nobody to nudge refunds the
 * cooldown and answers `cooldownUntil: now`, which must leave the row usable.
 * The cooldown is session-only by design (D4) — after a reload the row
 * re-enables and a press returns the server's 429, which the hook toasts.
 * It is OWNED BY `SchedulingLeaderMenu` (`useArmedCooldown`) and handed down,
 * because the phone sheet unmounts this row on every close.
 */
import { type JSX } from 'react';
import { useRallyNonVoters } from '../../../hooks/use-scheduling';
import { SchedulingSheetRow } from './scheduling-sheet-row';

export interface SchedulingRallyActionProps {
  lineupId: number;
  matchId: number;
  /**
   * Poll members with no stance on the LEADING slot, or `undefined` when the
   * page cannot compute it — the row then draws no subline rather than a
   * wrong one. `0` is AC8's empty state: present, disabled, "Everyone has
   * answered this time".
   */
  pendingVoterCount?: number;
  /** Hours left on the menu-owned session cooldown, or `null` when idle. */
  cooldownHours: number | null;
  /** Arm that cooldown from the server's `cooldownUntil`. */
  onArm: (cooldownUntil: string) => void;
}

/**
 * Idle subline: AC8's empty state, "N haven't answered this time", or
 * nothing. "this time" is load-bearing — the audience is the LEADING slot's
 * non-answerers, not the poll's (ROK-1618 operator ruling).
 */
function idleSubline(pending: number | undefined): string | null {
  if (pending === 0) return 'Everyone has answered this time';
  if (pending == null || pending <= 0) return null;
  return pending === 1
    ? "1 hasn't answered this time"
    : `${pending} haven't answered this time`;
}

/** Title / subline / aria-label for the row's current state — pure. */
function rallyCopy(args: {
  isPending: boolean;
  cooldownHours: number | null;
  pending: number | undefined;
}): { title: string; subline: string | null; ariaLabel: string } {
  const { isPending, cooldownHours, pending } = args;
  if (isPending) return { title: 'Rallying…', subline: null, ariaLabel: 'Rallying…' };
  if (cooldownHours !== null) {
    const subline = `You can do this again in ${cooldownHours}h`;
    return { title: 'Rallied ✓', subline, ariaLabel: `Rallied ✓ — ${subline}` };
  }
  const subline = idleSubline(pending);
  return { title: 'Rally', subline, ariaLabel: subline ? `Rally — ${subline}` : 'Rally' };
}

/** The Rally menu/sheet row — see file-level docstring. */
export function SchedulingRallyAction(
  props: SchedulingRallyActionProps,
): JSX.Element {
  const { lineupId, matchId, pendingVoterCount, cooldownHours, onArm } = props;
  const rally = useRallyNonVoters();
  const copy = rallyCopy({
    isPending: rally.isPending,
    cooldownHours,
    pending: pendingVoterCount,
  });
  return (
    <SchedulingSheetRow
      title={copy.title}
      subline={copy.subline}
      showSubline
      keepMenuOpen
      ariaLabel={copy.ariaLabel}
      testId="scheduling-leader-rally"
      onClick={() =>
        rally.mutate(
          { lineupId, matchId },
          { onSuccess: (res) => onArm(res.cooldownUntil) },
        )
      }
      disabled={
        rally.isPending || pendingVoterCount === 0 || cooldownHours !== null
      }
    />
  );
}
