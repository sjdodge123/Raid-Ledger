/**
 * "Rally" — the leader card's nudge to every poll member who has not answered
 * the LEADING time (ROK-1618).
 *
 * Different from the Manage-poll sheet's "Remind Voters", which is poll-wide:
 * the server resolves this audience from the leading slot (no YES and no NO
 * on it, not deactivated, NO member-age floor — a member added an hour ago is
 * exactly who the organiser wants to reach) and dedups each member on the
 * rally's own 6h key, independent of the recurring nudge's 24h one.
 * A member who voted on some OTHER time is still in the audience — that is
 * the prod case the any-future-slot rule got wrong.
 *
 * Row-only: it is rendered exclusively inside `SchedulingTimeMenu`, which
 * already applies the organiser gate, so this component does not repeat it.
 *
 * ROK-1635: the menu now sits on EVERY time card, so the slot is no longer
 * implied — `slotId` is sent with the request and the audience count is that
 * slot's non-answerers. The server still defaults to the leading time when no
 * slot is given, which is the legacy path this component no longer uses.
 *
 * The post-success disable is armed from the SERVER's `cooldownUntil`, not
 * from "the call succeeded": a rally that finds nobody to nudge refunds the
 * cooldown and answers `cooldownUntil: now`, which must leave the row usable.
 * The cooldown is session-only by design (D4) — after a reload the row
 * re-enables and a press returns the server's 429, which the hook toasts.
 * It is owned ABOVE the menu (`useArmedCooldown` in the composite) and handed
 * down, because the phone sheet unmounts this row on every close AND the 6h
 * cooldown is per POLL — one rally must disable the row on every card.
 */
import { type JSX } from 'react';
import { useRallyNonVoters } from '../../../hooks/use-scheduling';
import { SchedulingSheetRow } from './scheduling-sheet-row';

export interface SchedulingRallyActionProps {
  lineupId: number;
  matchId: number;
  /** The time this rally is for (ROK-1635) — sent verbatim to the server. */
  slotId: number;
  /**
   * Poll members with no stance on THIS slot, or `undefined` when the
   * page cannot compute it — the row then draws no subline rather than a
   * wrong one. `0` is AC8's empty state: present, disabled, "Everyone has
   * answered this time".
   */
  pendingVoterCount?: number;
  /** Hours left on the menu-owned session cooldown, or `null` when idle. */
  cooldownHours: number | null;
  /** Arm that cooldown from the server's `cooldownUntil`. */
  onArm: (cooldownUntil: string) => void;
  /** `scheduling-leader-rally` on the card, `scheduling-slot-rally` on a row. */
  testId: string;
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
  const { lineupId, matchId, slotId, pendingVoterCount } = props;
  const { cooldownHours, onArm, testId } = props;
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
      testId={testId}
      onClick={() =>
        rally.mutate(
          { lineupId, matchId, slotId },
          { onSuccess: (res) => onArm(res.cooldownUntil) },
        )
      }
      disabled={
        rally.isPending || pendingVoterCount === 0 || cooldownHours !== null
      }
    />
  );
}
