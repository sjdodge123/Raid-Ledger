/**
 * Tier 1 ("Scheduling Now") hero match card (ROK-989).
 * Full card with cover art, vote bar, member avatars,
 * and disabled "Schedule This" CTA.
 */
import type { JSX } from 'react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { MemberAvatarGroup } from './MemberAvatarGroup';

interface SchedulingMatchCardProps {
  match: MatchDetailResponseDto;
  totalVoters: number;
}

/** Vote percentage bar. */
function VoteBar({
  voteCount,
  totalVoters,
}: {
  voteCount: number;
  totalVoters: number;
}): JSX.Element {
  const pct = totalVoters > 0 ? Math.round((voteCount / totalVoters) * 100) : 0;
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-2 bg-zinc-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-cyan-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-muted font-medium">{pct}%</span>
    </div>
  );
}

/** Cover image with gradient overlay. */
function CardCover({ match }: { match: MatchDetailResponseDto }): JSX.Element {
  return (
    <div className="relative h-36 overflow-hidden rounded-t-lg">
      {match.gameCoverUrl ? (
        <img src={match.gameCoverUrl} alt={match.gameName} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-zinc-800" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-surface/90 to-transparent" />
      <h4 className="absolute bottom-2 left-3 text-sm font-bold text-white">
        {match.gameName}
      </h4>
    </div>
  );
}

/** Card body with vote stats, members, and schedule CTA. */
function CardBody({ match, totalVoters }: SchedulingMatchCardProps): JSX.Element {
  return (
    <div className="px-4 py-3">
      <span className="text-xs text-dim">
        {match.voteCount} votes ({match.members.length} players)
      </span>
      <VoteBar voteCount={match.voteCount} totalVoters={totalVoters} />
      <div className="mt-3 mb-3">
        <MemberAvatarGroup members={match.members} />
      </div>
      <button type="button" disabled title="Scheduling features coming soon"
        className="w-full py-2 text-sm font-medium text-zinc-400 bg-zinc-700 rounded-lg cursor-not-allowed">
        Schedule This &rarr;
      </button>
    </div>
  );
}

/** Hero card for Tier 1 scheduling matches. */
export function SchedulingMatchCard({ match, totalVoters }: SchedulingMatchCardProps): JSX.Element {
  return (
    <div data-testid="match-card" className="bg-surface border border-cyan-500/30 rounded-lg overflow-hidden">
      <CardCover match={match} />
      <CardBody match={match} totalVoters={totalVoters} />
    </div>
  );
}
