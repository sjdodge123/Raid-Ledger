/**
 * Still-waiting-on-voters panel for private voting lineups (ROK-1258).
 *
 * Surfaced when a private lineup is in `voting` and the API has flagged
 * invitees who have not yet cast their full vote allotment. Lets the
 * creator see exactly who is gating quorum so they can either nudge them
 * or remove them via the existing invitee management UI.
 *
 * Empty / non-applicable cases (public lineup, non-voting status, every
 * invitee at allotment) are caller-gated — the panel always renders when
 * mounted.
 */
import { type JSX } from 'react';
import type { LineupInviteeResponseDto } from '@raid-ledger/contract';

export interface StillWaitingPanelProps {
  voters: LineupInviteeResponseDto[];
}

export function StillWaitingPanel({
  voters,
}: StillWaitingPanelProps): JSX.Element {
  return (
    <section
      data-testid="still-waiting-panel"
      className="mt-4 p-4 rounded-lg border border-sky-500/30 bg-sky-500/5"
    >
      <h2 className="text-sm font-semibold text-primary mb-2">
        Still waiting on {voters.length}{' '}
        {voters.length === 1 ? 'voter' : 'voters'}
      </h2>
      <p className="text-xs text-muted mb-3">
        These invitees have not used all of their votes yet. Quorum will close
        automatically once the voting deadline passes, or sooner if the
        creator removes them from the lineup.
      </p>
      <ul
        data-testid="still-waiting-voters"
        className="flex flex-wrap gap-2 text-xs"
      >
        {voters.map((v) => (
          <li
            key={v.id}
            className="px-2 py-1 rounded-md bg-sky-500/10 text-primary"
          >
            {v.displayName}
          </li>
        ))}
      </ul>
    </section>
  );
}
