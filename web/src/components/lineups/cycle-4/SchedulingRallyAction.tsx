/**
 * "Rally" — the leader card's nudge to every poll member who still owes a
 * vote (ROK-1618).
 *
 * Wider than the Manage-poll sheet's "Remind Voters": the server resolves the
 * recurring nudge's own audience (no stance on any still-future slot, aged
 * past the member-age guard, not deactivated) and shares its 24h per-member
 * dedup, so a rally can never out-spam the automated nudge.
 *
 * Row-only: it is rendered exclusively inside {@link SchedulingLeaderMenu},
 * which already applies the organiser gate, so this component does not repeat
 * it. The post-success disable is time-boxed by the SERVER's `cooldownUntil`
 * rather than a hardcoded constant — an empty-audience rally refunds the
 * cooldown and comes back `cooldownUntil: now`, which must leave the row
 * immediately usable (mirrors `SchedulingRemindAction`'s timer otherwise).
 *
 * The cooldown is session-only by design (D4): after a reload the row
 * re-enables and a press returns the server's 429, which the hook toasts.
 */
import { useEffect, type JSX } from 'react';
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
}

/** Whole hours left on a cooldown, never rounded down to a useless "0h". */
function hoursLeft(untilMs: number): number {
  return Math.max(1, Math.ceil((untilMs - Date.now()) / (60 * 60 * 1000)));
}

/** Title / subline / aria-label for the row's current state. */
function rallyCopy(args: {
  isPending: boolean;
  cooldownUntilMs: number;
  pending: number | undefined;
}): { title: string; subline: string | null; ariaLabel: string } {
  const { isPending, cooldownUntilMs, pending } = args;
  if (isPending) return { title: 'Rallying…', subline: null, ariaLabel: 'Rallying…' };
  if (cooldownUntilMs > Date.now()) {
    const subline = `You can do this again in ${hoursLeft(cooldownUntilMs)}h`;
    return { title: 'Rallied ✓', subline, ariaLabel: `Rallied ✓ — ${subline}` };
  }
  const subline = pending === 0 ? 'Everyone has voted' : pending != null && pending > 0 ? `${pending} haven't voted` : null;
  return { title: 'Rally', subline, ariaLabel: subline ? `Rally — ${subline}` : 'Rally' };
}

/** The Rally menu/sheet row — see file-level docstring. */
export function SchedulingRallyAction(
  props: SchedulingRallyActionProps,
): JSX.Element {
  const { lineupId, matchId, pendingVoterCount } = props;
  const rally = useRallyNonVoters();
  const { data, reset } = rally;
  const cooldownUntilMs = data ? Date.parse(data.cooldownUntil) : 0;
  // Re-enable the row when the server's window elapses on a page left open
  // (the same Codex P2 fix `SchedulingRemindAction` carries); the server's
  // 429 stays the real gate either way.
  useEffect(() => {
    const remaining = cooldownUntilMs - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => reset(), remaining);
    return () => clearTimeout(timer);
  }, [cooldownUntilMs, reset]);
  const copy = rallyCopy({
    isPending: rally.isPending,
    cooldownUntilMs,
    pending: pendingVoterCount,
  });
  return (
    <SchedulingSheetRow
      title={copy.title}
      subline={copy.subline}
      ariaLabel={copy.ariaLabel}
      testId="scheduling-leader-rally"
      onClick={() => rally.mutate({ lineupId, matchId })}
      disabled={
        rally.isPending || pendingVoterCount === 0 || cooldownUntilMs > Date.now()
      }
    />
  );
}
