/**
 * Voting podium showing top 3 games in 2nd-1st-3rd layout (ROK-989).
 * Renders "THIS WEEK'S PODIUM" header with sorted entries.
 */
import { useMemo } from 'react';
import type { JSX } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { PodiumCard } from './PodiumCard';

interface VotingPodiumProps {
  entries: LineupEntryResponseDto[];
}

/** Sort entries by voteCount descending, ownerCount as tiebreaker. */
function sortByVoteCount(
  entries: LineupEntryResponseDto[],
): LineupEntryResponseDto[] {
  return [...entries].sort((a, b) => {
    if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
    return b.ownerCount - a.ownerCount;
  });
}

/** Arrange top 3 in podium order: 2nd, 1st, 3rd. */
function podiumOrder(
  top3: LineupEntryResponseDto[],
): { entry: LineupEntryResponseDto; rank: number }[] {
  const result: { entry: LineupEntryResponseDto; rank: number }[] = [];
  if (top3[1]) result.push({ entry: top3[1], rank: 2 });
  if (top3[0]) result.push({ entry: top3[0], rank: 1 });
  if (top3[2]) result.push({ entry: top3[2], rank: 3 });
  return result;
}

/** Podium section with "THIS WEEK'S PODIUM" header and top 3 cards. */
export function VotingPodium({ entries }: VotingPodiumProps): JSX.Element {
  const sorted = useMemo(() => sortByVoteCount(entries), [entries]);
  const top3 = sorted.slice(0, 3);
  const ordered = useMemo(() => podiumOrder(top3), [top3]);

  return (
    <section className="mt-8 mb-6">
      <h2 className="text-sm font-bold tracking-widest text-muted uppercase mb-6 text-center">
        THIS WEEK&apos;S PODIUM
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        {ordered.map(({ entry, rank }) => (
          <div key={entry.id} className={rank === 1 ? 'sm:-mt-8' : rank === 2 ? 'sm:-mt-2' : ''}>
            <PodiumCard entry={entry} rank={rank} />
          </div>
        ))}
      </div>
    </section>
  );
}
