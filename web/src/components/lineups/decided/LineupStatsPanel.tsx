/**
 * Stats panel showing Voters, Nominated, and Total Votes (ROK-989).
 * Three-column layout with numeric highlights.
 */
import type { JSX } from 'react';

interface LineupStatsPanelProps {
  totalVoters: number;
  nominatedCount: number;
  totalVotes: number;
}

/** Single stat column with label and value. */
function StatColumn({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="flex flex-col items-center">
      <span className="text-xl font-bold text-foreground">{value}</span>
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  );
}

/** Three-column stats panel for the decided view. */
export function LineupStatsPanel({
  totalVoters,
  nominatedCount,
  totalVotes,
}: LineupStatsPanelProps): JSX.Element {
  return (
    <div
      data-testid="lineup-stats-panel"
      className="grid grid-cols-3 gap-4 bg-surface border border-edge rounded-xl px-4 py-3 mt-6"
    >
      <StatColumn label="Voters" value={totalVoters} />
      <StatColumn label="Nominated" value={nominatedCount} />
      <StatColumn label="Total Votes" value={totalVotes} />
    </div>
  );
}
