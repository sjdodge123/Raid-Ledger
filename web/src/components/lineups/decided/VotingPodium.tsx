/**
 * Voting podium showing top 3 games in 2nd-1st-3rd layout (ROK-989).
 * Renders "THIS WEEK'S PODIUM" header with stepped pedestals.
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

/** Pedestal config per rank: height, gradient, border accent. */
const PEDESTAL: Record<number, { height: string; gradient: string; border: string; text: string }> = {
  1: { height: 'h-20', gradient: 'from-yellow-500/30 to-yellow-700/10', border: 'border-yellow-500/40', text: 'text-yellow-400' },
  2: { height: 'h-14', gradient: 'from-zinc-400/20 to-zinc-600/10', border: 'border-zinc-400/30', text: 'text-zinc-400' },
  3: { height: 'h-10', gradient: 'from-amber-700/20 to-amber-900/10', border: 'border-amber-700/30', text: 'text-amber-600' },
};

/** Podium pedestal block beneath a card. */
function Pedestal({ rank }: { rank: number }): JSX.Element {
  const p = PEDESTAL[rank] ?? PEDESTAL[3];
  return (
    <div className={`${p.height} bg-gradient-to-b ${p.gradient} border-x border-b border-t ${p.border} rounded-b-lg flex items-center justify-center`}>
      <span className={`text-3xl font-black ${p.text} opacity-60`}>{rank}</span>
    </div>
  );
}

/** Podium section with header, cards, and pedestals. */
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
          <div key={entry.id} className="flex flex-col">
            <PodiumCard entry={entry} rank={rank} />
            <Pedestal rank={rank} />
          </div>
        ))}
      </div>
    </section>
  );
}
