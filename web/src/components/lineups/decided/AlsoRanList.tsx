/**
 * "Also Ran" list for entries ranked 4th+ in the decided view (ROK-989).
 * Shows position number, thumbnail, name, vote bar, and decreasing opacity.
 */
import { useMemo } from 'react';
import type { JSX } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';

interface AlsoRanListProps {
  entries: LineupEntryResponseDto[];
  maxVotes: number;
}

/** Opacity scale: 4th=60%, 5th=40%, 6th+=30%. */
function entryOpacity(index: number): string {
  if (index === 0) return 'opacity-60';
  if (index === 1) return 'opacity-40';
  return 'opacity-30';
}

/** Vote bar width as percentage of the top vote count. */
function voteBarWidth(voteCount: number, maxVotes: number): string {
  if (maxVotes <= 0) return '0%';
  return `${Math.round((voteCount / maxVotes) * 100)}%`;
}

/** Tiny game thumbnail or placeholder. */
function EntryThumb({ url, name }: { url: string | null; name: string }): JSX.Element {
  return (
    <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0">
      {url ? (
        <img src={url} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-zinc-700" />
      )}
    </div>
  );
}

/** Single also-ran entry row. */
function AlsoRanEntry({
  entry, rank, maxVotes, opacityClass,
}: {
  entry: LineupEntryResponseDto;
  rank: number;
  maxVotes: number;
  opacityClass: string;
}): JSX.Element {
  return (
    <div data-testid="also-ran-entry" className={`flex items-center gap-3 px-3 py-2 ${opacityClass}`}>
      <span className="text-xs font-bold text-dim w-5 text-right">{rank}</span>
      <EntryThumb url={entry.gameCoverUrl} name={entry.gameName} />
      <span className="text-sm text-secondary truncate flex-1">{entry.gameName}</span>
      <div className="w-20 h-1.5 bg-zinc-700 rounded-full overflow-hidden flex-shrink-0">
        <div className="h-full bg-zinc-400 rounded-full" style={{ width: voteBarWidth(entry.voteCount, maxVotes) }} />
      </div>
      <span className="text-[10px] text-dim w-6 text-right">{entry.voteCount}</span>
    </div>
  );
}

/** Also Ran section listing entries ranked 4th and below. */
export function AlsoRanList({ entries, maxVotes }: AlsoRanListProps): JSX.Element | null {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.voteCount - a.voteCount),
    [entries],
  );

  if (sorted.length === 0) return null;

  return (
    <section data-testid="also-ran-section" className="mt-4">
      <h3 className="text-xs font-semibold text-dim uppercase tracking-wider mb-2 px-1">
        Also Ran
      </h3>
      <div className="bg-surface border border-edge rounded-lg divide-y divide-edge/50">
        {sorted.map((entry, i) => (
          <AlsoRanEntry
            key={entry.id}
            entry={entry}
            rank={i + 4}
            maxVotes={maxVotes}
            opacityClass={entryOpacity(i)}
          />
        ))}
      </div>
    </section>
  );
}
