/**
 * Decided page composite (ROK-1299).
 * JourneyHero on top (action tone), a personal "Your matches" section with
 * per-match "Pick a time →" CTAs, an "Other matches in this lineup" section
 * (no CTAs), an optional leftover-voters affordance, and CarriedForward
 * below. No podium, no page-level Submit, no AlsoRanList/LineupStatsPanel.
 */
import { useMemo } from 'react';
import type { JSX } from 'react';
import type {
  GroupedMatchesResponseDto,
  LineupDetailResponseDto,
  MatchDetailResponseDto,
} from '@raid-ledger/contract';
import { useAuth } from '../../../hooks/use-auth';
import { useLineupMatches } from '../../../hooks/use-lineup-matches';
import { JourneyHero } from '../../shared/journey-hero/JourneyHero';
import { LineupHeroMeta } from '../LineupHeroMeta';
import { CarriedForwardSection } from './CarriedForwardSection';
import { MatchCard } from './MatchCard';
import { LeftoverVotersRow } from './LeftoverVotersRow';

interface DecidedViewProps {
  lineup: LineupDetailResponseDto;
}

interface MatchPartition {
  mine: MatchDetailResponseDto[];
  others: MatchDetailResponseDto[];
}

function partitionMatches(
  data: GroupedMatchesResponseDto | undefined,
  userId: number | undefined,
): MatchPartition {
  if (!data) return { mine: [], others: [] };
  const all = [...data.scheduling, ...data.almostThere, ...data.rallyYourCrew];
  const mine: MatchDetailResponseDto[] = [];
  const others: MatchDetailResponseDto[] = [];
  for (const m of all) {
    const isMine =
      userId != null && m.members.some((mem) => mem.userId === userId);
    if (isMine) mine.push(m);
    else others.push(m);
  }
  return { mine, others };
}

function leftoverVoterCount(
  data: GroupedMatchesResponseDto | undefined,
): number {
  if (!data) return 0;
  // Only voted-source members count — bandwagon joiners didn't vote, so
  // including them would deflate the leftover count.
  const matchedVoterIds = new Set<number>();
  for (const m of [
    ...data.scheduling,
    ...data.almostThere,
    ...data.rallyYourCrew,
  ]) {
    for (const mem of m.members) {
      if (mem.source === 'voted') matchedVoterIds.add(mem.userId);
    }
  }
  return Math.max(0, data.totalVoters - matchedVoterIds.size);
}

function buildHeroProps(
  mineCount: number,
  totalMatches: number,
  totalVoters: number,
  matchedVoters: number,
) {
  const task =
    totalMatches > 0
      ? `We matched ${matchedVoters} of ${totalVoters} voters into ${totalMatches} ${
          totalMatches === 1 ? 'game' : 'games'
        }.`
      : 'No matches were generated from voting results.';
  const sub =
    mineCount > 0
      ? `You're in ${mineCount} ${mineCount === 1 ? 'match' : 'matches'}.`
      : "You're not in any matches yet.";
  return { task, sub };
}

function YourMatches({
  matches,
  lineupId,
  schedulingEnabled,
}: {
  matches: MatchDetailResponseDto[];
  lineupId: number;
  schedulingEnabled: boolean;
}): JSX.Element | null {
  if (matches.length === 0) return null;
  return (
    <section data-testid="decided-your-matches-section" className="mt-3 mb-2">
      <div className="text-[10px] uppercase tracking-wider text-emerald-300 mb-1">
        Your matches ({matches.length})
      </div>
      {matches.map((m) => (
        <MatchCard
          key={m.id}
          match={m}
          lineupId={lineupId}
          isPersonal
          schedulingEnabled={schedulingEnabled}
        />
      ))}
    </section>
  );
}

function OtherMatches({
  matches,
  lineupId,
  schedulingEnabled,
}: {
  matches: MatchDetailResponseDto[];
  lineupId: number;
  schedulingEnabled: boolean;
}): JSX.Element | null {
  if (matches.length === 0) return null;
  return (
    <section data-testid="decided-other-matches-section" className="mb-2">
      <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
        Other matches in this lineup ({matches.length})
      </div>
      {matches.map((m) => (
        <MatchCard
          key={m.id}
          match={m}
          lineupId={lineupId}
          isPersonal={false}
          schedulingEnabled={schedulingEnabled}
        />
      ))}
    </section>
  );
}

function useDecidedState(lineup: LineupDetailResponseDto) {
  const { user } = useAuth();
  const { data } = useLineupMatches(lineup.id);
  const { mine, others } = useMemo(
    () => partitionMatches(data, user?.id),
    [data, user?.id],
  );
  const leftover = useMemo(() => leftoverVoterCount(data), [data]);
  const totalVoters = data?.totalVoters ?? 0;
  const matchedVoters = Math.max(0, totalVoters - leftover);
  const hero = buildHeroProps(
    mine.length,
    mine.length + others.length,
    totalVoters,
    matchedVoters,
  );
  return {
    mine,
    others,
    leftover,
    hero,
    carriedForward: data?.carriedForward ?? [],
  };
}

export function DecidedView({ lineup }: DecidedViewProps): JSX.Element {
  const { mine, others, leftover, hero, carriedForward } =
    useDecidedState(lineup);
  // ROK-1302: a scheduling-opted-out lineup terminates at Decided — drop the
  // 4-step framing + "before scheduling" copy so it doesn't read as a broken
  // scheduling phase.
  const terminal = lineup.includeSchedulingPhase === false;
  return (
    <div data-testid="decided-composite-view">
      <JourneyHero
        phase="decided"
        tone="action"
        badge={terminal ? 'Decided' : 'Step 3 of 4 · Decided'}
        task={hero.task}
        sub={<LineupHeroMeta lineup={lineup} phaseContext={hero.sub} />}
        hint={
          terminal
            ? 'Tap any game to learn more.'
            : 'Tap any game to learn more before scheduling.'
        }
        hideSchedulePhase={terminal}
      />
      <YourMatches
        matches={mine}
        lineupId={lineup.id}
        schedulingEnabled={lineup.includeSchedulingPhase}
      />
      <OtherMatches
        matches={others}
        lineupId={lineup.id}
        schedulingEnabled={lineup.includeSchedulingPhase}
      />
      <LeftoverVotersRow leftoverCount={leftover} />
      <CarriedForwardSection entries={carriedForward} />
    </div>
  );
}
