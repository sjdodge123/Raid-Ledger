/**
 * Banner for active standalone scheduling polls on the events page (ROK-977).
 * Shows links to polls the user can participate in.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { useActiveStandalonePolls } from '../../hooks/use-standalone-poll';
import type { ActiveStandalonePoll } from '../../lib/api/standalone-poll-api';

function PollLink({ poll }: { poll: ActiveStandalonePoll }): JSX.Element {
  return (
    <Link
      to={`/community-lineup/${poll.lineupId}/schedule/${poll.matchId}`}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface hover:bg-overlay transition-colors text-sm"
    >
      {poll.gameCoverUrl && (
        <img src={poll.gameCoverUrl} alt={poll.gameName} className="w-5 h-5 rounded object-cover" />
      )}
      <span className="text-foreground font-medium">{poll.gameName}</span>
      <span className="text-muted text-xs">
        {poll.slotCount} {poll.slotCount === 1 ? 'slot' : 'slots'}
      </span>
      <span className="text-cyan-400 text-xs font-medium">Vote →</span>
    </Link>
  );
}

/** Banner shown on the events page when standalone scheduling polls are active. */
export function StandalonePollBanner(): JSX.Element | null {
  const { data: polls, isLoading } = useActiveStandalonePolls();

  if (isLoading || !polls || polls.length === 0) return null;

  return (
    <div
      data-testid="standalone-poll-banner"
      className="mx-4 mb-4 p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/30"
    >
      <p className="text-sm font-medium text-cyan-300 mb-2">
        Active scheduling polls
      </p>
      <div className="flex flex-wrap gap-2">
        {polls.map((poll) => (
          <PollLink key={poll.matchId} poll={poll} />
        ))}
      </div>
    </div>
  );
}
