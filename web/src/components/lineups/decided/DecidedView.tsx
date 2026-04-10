/**
 * Top-level orchestrator for the decided phase view (ROK-989).
 * Renders the podium, action buttons, match tiers, stats panel,
 * and also-ran list from the lineup detail data.
 */
import { useMemo } from 'react';
import type { JSX } from 'react';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { VotingPodium } from './VotingPodium';
import { AlsoRanList } from './AlsoRanList';
import { PodiumActionButtons } from './PodiumActionButtons';
import { LineupStatsPanel } from './LineupStatsPanel';
import { DecidedMatchesView } from './DecidedMatchesView';

interface DecidedViewProps {
  lineup: LineupDetailResponseDto;
}

/** Sort entries by vote count descending, with tiebreaker winner pinned to #1. */
function sortedEntries(
  entries: LineupDetailResponseDto['entries'],
  decidedGameId?: number | null,
): LineupDetailResponseDto['entries'] {
  return [...entries].sort((a, b) => {
    // Tiebreaker winner always first
    if (decidedGameId) {
      if (a.gameId === decidedGameId) return -1;
      if (b.gameId === decidedGameId) return 1;
    }
    if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
    return b.ownerCount - a.ownerCount;
  });
}

/** Sum all entry vote counts. */
function sumVotes(entries: LineupDetailResponseDto['entries']): number {
  return entries.reduce((acc, e) => acc + e.voteCount, 0);
}

/** Decided phase view with podium, matches, and stats. */
export function DecidedView({ lineup }: DecidedViewProps): JSX.Element {
  const sorted = useMemo(
    () => sortedEntries(lineup.entries, lineup.decidedGameId),
    [lineup.entries, lineup.decidedGameId],
  );
  const top3 = sorted.slice(0, 3);
  const alsoRan = sorted.slice(3);
  const maxVotes = top3[0]?.voteCount ?? 0;
  const totalVotes = useMemo(() => sumVotes(lineup.entries), [lineup.entries]);

  return (
    <div>
      {top3.length > 0 && <VotingPodium entries={top3} />}

      <PodiumActionButtons />

      <AlsoRanList entries={alsoRan} maxVotes={maxVotes} />

      <DecidedMatchesView lineupId={lineup.id} entries={lineup.entries} />

      <LineupStatsPanel
        totalVoters={lineup.totalVoters}
        nominatedCount={lineup.entries.length}
        totalVotes={totalVotes}
      />
    </div>
  );
}
