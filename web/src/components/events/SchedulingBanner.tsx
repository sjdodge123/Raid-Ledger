/**
 * Scheduling poll banner for the events view (ROK-965).
 * Shows when the current user has active scheduling polls to vote on.
 */
import type { JSX } from 'react';
import { useSchedulingBanner } from '../../hooks/use-scheduling';
import { NavChip } from '../ui/nav-chip';

/** Single poll entry inside the banner. */
function PollEntry({ lineupId, poll }: {
  lineupId: number;
  poll: { matchId: number; gameName: string; gameCoverUrl: string | null; memberCount: number; slotCount: number };
}): JSX.Element {
  return (
    <NavChip to={`/community-lineup/${lineupId}/schedule/${poll.matchId}`}>
      {poll.gameCoverUrl && (
        <img src={poll.gameCoverUrl} alt={poll.gameName} className="w-5 h-5 rounded object-cover" />
      )}
      <span className="text-foreground font-medium">{poll.gameName}</span>
      <span className="text-muted text-xs">
        {poll.slotCount} {poll.slotCount === 1 ? 'slot' : 'slots'}
      </span>
      <span className="text-emerald-400 text-xs font-medium">Vote</span>
    </NavChip>
  );
}

/**
 * Banner shown at the top of the events page when the user
 * has active scheduling polls to participate in.
 */
export function SchedulingBanner(): JSX.Element | null {
  const { data, isLoading } = useSchedulingBanner();

  if (isLoading || !data || data.polls.length === 0) return null;

  return (
    <div
      data-testid="scheduling-poll-banner"
      className="mx-4 mb-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30"
    >
      <p className="text-sm font-medium text-emerald-300 mb-2">
        Help schedule your next game night!
      </p>
      <div className="flex flex-wrap gap-2">
        {data.polls.map((poll) => (
          <PollEntry
            key={poll.matchId}
            lineupId={data.lineupId}
            poll={poll}
          />
        ))}
      </div>
    </div>
  );
}
