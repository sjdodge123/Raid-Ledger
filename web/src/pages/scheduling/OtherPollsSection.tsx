/**
 * Other Scheduling Polls section (ROK-965).
 * Shows links to other active scheduling polls the current user is a member of.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { OtherPollsResponseDto } from '@raid-ledger/contract';

interface OtherPollsSectionProps {
  lineupId: number;
  data: OtherPollsResponseDto | undefined;
  isLoading: boolean;
}

/** Single poll link card. */
function PollLinkCard({ lineupId, poll }: {
  lineupId: number;
  poll: OtherPollsResponseDto['polls'][number];
}): JSX.Element {
  return (
    <Link
      to={`/community-lineup/${lineupId}/schedule/${poll.matchId}`}
      className="flex items-center gap-3 p-3 rounded-lg bg-panel border border-edge hover:border-dim transition-colors"
    >
      {poll.gameCoverUrl && (
        <img
          src={poll.gameCoverUrl}
          alt={poll.gameName}
          className="w-10 h-10 rounded object-cover flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {poll.gameName}
        </p>
        <p className="text-xs text-muted">
          {poll.memberCount} {poll.memberCount === 1 ? 'member' : 'members'}
        </p>
      </div>
    </Link>
  );
}

/** Section listing other scheduling polls the user belongs to. */
export function OtherPollsSection({
  lineupId,
  data,
  isLoading,
}: OtherPollsSectionProps): JSX.Element | null {
  if (isLoading || !data || data.polls.length === 0) return null;

  return (
    <div data-testid="other-scheduling-polls" className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
        Your Other Scheduling Polls
      </h3>
      <div className="space-y-2">
        {data.polls.map((poll) => (
          <PollLinkCard key={poll.matchId} lineupId={lineupId} poll={poll} />
        ))}
      </div>
    </div>
  );
}
