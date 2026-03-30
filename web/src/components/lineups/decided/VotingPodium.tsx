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
/** Laurel wreath SVG for the champion pedestal. */
function LaurelWreath(): JSX.Element {
  return (
    <svg data-testid="crown-icon" viewBox="0 0 120 80" className="absolute inset-0 w-full h-full opacity-50" fill="none">
      {/* Left branch */}
      <path d="M15 70 C12 50, 10 35, 18 12" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" />
      <ellipse cx="10" cy="58" rx="8" ry="3.5" transform="rotate(-40 10 58)" fill="#22c55e" opacity="0.5" />
      <ellipse cx="9" cy="42" rx="7" ry="3" transform="rotate(-35 9 42)" fill="#22c55e" opacity="0.5" />
      <ellipse cx="12" cy="27" rx="7" ry="3" transform="rotate(-25 12 27)" fill="#22c55e" opacity="0.5" />
      {/* Right branch */}
      <path d="M105 70 C108 50, 110 35, 102 12" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" />
      <ellipse cx="110" cy="58" rx="8" ry="3.5" transform="rotate(40 110 58)" fill="#22c55e" opacity="0.5" />
      <ellipse cx="111" cy="42" rx="7" ry="3" transform="rotate(35 111 42)" fill="#22c55e" opacity="0.5" />
      <ellipse cx="108" cy="27" rx="7" ry="3" transform="rotate(25 108 27)" fill="#22c55e" opacity="0.5" />
    </svg>
  );
}

/** Podium pedestal block beneath a card. */
function Pedestal({ rank }: { rank: number }): JSX.Element {
  const p = PEDESTAL[rank] ?? PEDESTAL[3];
  return (
    <div className={`relative ${p.height} bg-gradient-to-b ${p.gradient} border-x border-b border-t ${p.border} rounded-b-lg flex items-center justify-center overflow-hidden`}>
      {rank === 1 && <LaurelWreath />}
      <span className={`relative z-10 text-3xl font-black ${p.text} opacity-60`}>{rank}</span>
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
