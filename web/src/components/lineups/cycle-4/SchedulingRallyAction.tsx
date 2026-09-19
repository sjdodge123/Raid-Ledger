/**
 * "Rally" — the leader card's nudge to every poll member who still owes a
 * vote (ROK-1618).
 *
 * Wider than the Manage-poll sheet's "Remind Voters": the server resolves the
 * recurring nudge's own audience (no stance on any still-future slot, aged
 * past the member-age guard, not deactivated) and shares its 24h per-member
 * dedup, so a rally can never out-spam the automated nudge.
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
   * Poll members who have not voted yet, or `undefined` when the page cannot
   * compute it — the row then draws no subline rather than a wrong one. `0`
   * is AC8's empty state: present, disabled, "Everyone has voted".
   */
  pendingVoterCount?: number;
  /** Hours left on the menu-owned session cooldown, or `null` when idle. */
  cooldownHours: number | null;
  /** Arm that cooldown from the server's `cooldownUntil`. */
  onArm: (cooldownUntil: string) => void;
}

/** Idle subline: AC8's empty state, "N haven't voted", or nothing. */
function idleSubline(pending: number | undefined): string | null {
  if (pending === 0) return 'Everyone has voted';
  return pending != null && pending > 0 ? `${pending} haven't voted` : null;
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
