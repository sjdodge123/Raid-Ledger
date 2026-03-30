/**
 * Decided matches view — fetches and renders tiered match cards (ROK-989).
 * Parses ?rally=gameId for auto-scroll highlighting.
 * Conditionally renders tier sections only when they contain matches.
 */
import { useMemo } from 'react';
import type { JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GroupedMatchesResponseDto } from '@raid-ledger/contract';
import { useLineupMatches } from '../../../hooks/use-lineup-matches';
import { MatchTierSection } from './MatchTierSection';
import { SchedulingMatchCard } from './SchedulingMatchCard';
import { AlmostThereCard } from './AlmostThereCard';
import { RallyRow } from './RallyRow';
import { CarriedForwardSection } from './CarriedForwardSection';

interface DecidedMatchesViewProps {
  lineupId: number;
}

/** Loading skeleton for the matches area. */
function MatchesSkeleton(): JSX.Element {
  return (
    <div className="space-y-4 mt-6 animate-pulse">
      {[1, 2].map((i) => (
        <div key={i} className="h-24 bg-zinc-800 rounded-xl" />
      ))}
    </div>
  );
}

/** Empty state when no matches were generated. */
function MatchesEmpty(): JSX.Element {
  return (
    <div className="text-center py-8 text-muted text-sm mt-4">
      No matches were generated from voting results.
    </div>
  );
}

/** Scheduling tier grid. */
function SchedulingTier({ data }: { data: GroupedMatchesResponseDto }): JSX.Element | null {
  if (data.scheduling.length === 0) return null;
  return (
    <MatchTierSection tier="scheduling">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.scheduling.map((m) => (
          <SchedulingMatchCard key={m.id} match={m} totalVoters={data.totalVoters} />
        ))}
      </div>
    </MatchTierSection>
  );
}

/** Almost There tier grid. */
function AlmostThereTier({ data, lineupId }: { data: GroupedMatchesResponseDto; lineupId: number }): JSX.Element | null {
  if (data.almostThere.length === 0) return null;
  return (
    <MatchTierSection tier="almostThere">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.almostThere.map((m) => (
          <AlmostThereCard key={m.id} match={m} lineupId={lineupId} matchThreshold={data.matchThreshold} />
        ))}
      </div>
    </MatchTierSection>
  );
}

/** Rally Your Crew tier list. */
function RallyTier({
  data, lineupId, rallyGameId,
}: {
  data: GroupedMatchesResponseDto; lineupId: number; rallyGameId: number | null;
}): JSX.Element | null {
  if (data.rallyYourCrew.length === 0) return null;
  return (
    <MatchTierSection tier="rallyYourCrew">
      {data.rallyYourCrew.map((m) => (
        <RallyRow key={m.id} match={m} lineupId={lineupId} matchThreshold={data.matchThreshold} isRallied={rallyGameId === m.gameId} />
      ))}
    </MatchTierSection>
  );
}

/** Parse rally game ID from URL search params. */
function useRallyGameId(): number | null {
  const [searchParams] = useSearchParams();
  return useMemo(() => {
    const raw = searchParams.get('rally');
    return raw ? parseInt(raw, 10) : null;
  }, [searchParams]);
}

/** Decided matches view with tiered sections. */
export function DecidedMatchesView({ lineupId }: DecidedMatchesViewProps): JSX.Element {
  const { data, isLoading } = useLineupMatches(lineupId);
  const rallyGameId = useRallyGameId();

  if (isLoading) return <MatchesSkeleton />;
  if (!data) return <MatchesEmpty />;

  const hasAny = data.scheduling.length > 0 || data.almostThere.length > 0 || data.rallyYourCrew.length > 0;
  if (!hasAny) return <MatchesEmpty />;

  return (
    <div className="space-y-4 mt-6">
      <SchedulingTier data={data} />
      <AlmostThereTier data={data} lineupId={lineupId} />
      <RallyTier data={data} lineupId={lineupId} rallyGameId={rallyGameId} />
      <CarriedForwardSection entries={data.carriedForward} />
    </div>
  );
}
