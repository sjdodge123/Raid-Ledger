/**
 * S1 Nominating composite (ROK-1297) — top-level component that replaces
 * the legacy header + Nominate button + CommonGroundPanel chrome on the
 * lineup detail page while a lineup is in the building phase.
 *
 * Wires the U1 JourneyHero, the multi-row Common Ground hero (which
 * owns its own inline `Search` mode — see CommonGroundHero), and the
 * existing nominations grid. Nominations autosave; per the operator
 * browser-test (Linear 2026-05-18 comment 52025e97) the U4 SubmitBar
 * is intentionally NOT mounted here — there is no "submit" verb on
 * this page. Tabs were removed in the second rework cycle (operator
 * preferred a single nominations list).
 */
import { useMemo, useState, type JSX } from 'react';
import type {
  LineupDetailResponseDto,
  LineupEntryResponseDto,
} from '@raid-ledger/contract';
import { JourneyHero } from '../../shared/journey-hero';
import { useNominateGame, useRemoveNomination } from '../../../hooks/use-lineups';
import { useAuth } from '../../../hooks/use-auth';
import { CommonGroundHero } from './CommonGroundHero';
import { NominationCard } from '../NominationCard';
import { GameResearchDrawer } from '../../games/GameResearchDrawer';

export interface NominatingCompositeProps {
  lineup: LineupDetailResponseDto;
  canParticipate: boolean;
}

interface JourneyState {
  badge: string;
  task: string;
  sub: string;
  tone: 'action' | 'waiting';
}

function deriveJourneyState(
  lineup: LineupDetailResponseDto,
  myNominatedCount: number,
): JourneyState {
  const totalVoters = lineup.totalVoters || lineup.totalMembers || 0;
  const submitted =
    lineup.viewerSubmissions?.nominationsSubmittedAt != null;
  const badge = 'Step 1 of 4 · Nominating';
  if (submitted) {
    return {
      badge,
      task: "You're done nominating.",
      sub: `${myNominatedCount} nominated · waiting on the rest of the group`,
      tone: 'waiting',
    };
  }
  return {
    badge,
    task: 'Add games to the running.',
    sub: `${lineup.entries.length} of ${totalVoters || '?'} nominated by ${totalVoters} voters.`,
    tone: 'action',
  };
}

function ExistingNominations({
  entries,
  lineupId,
}: {
  entries: LineupEntryResponseDto[];
  lineupId: number;
}): JSX.Element {
  const removeMutation = useRemoveNomination();
  const handleRemove = (gameId: number): void => {
    removeMutation.mutate({ lineupId, gameId });
  };
  if (entries.length === 0) {
    return (
      <div className="text-center py-8" data-testid="nominations-empty">
        <p className="text-muted text-sm">
          No nominations match this filter yet.
        </p>
      </div>
    );
  }
  return (
    <section data-testid="nominations-list">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">
          Nominated Games
        </h2>
        <span className="text-xs text-muted">{entries.length} shown</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {entries.map((entry) => (
          <NominationCard
            key={entry.id}
            entry={entry}
            onRemove={handleRemove}
          />
        ))}
      </div>
    </section>
  );
}

export function NominatingComposite(
  props: NominatingCompositeProps,
): JSX.Element {
  const { lineup, canParticipate } = props;
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  const [drawerGameId, setDrawerGameId] = useState<number | null>(null);
  const nominate = useNominateGame();

  const myNominatedCount = useMemo(() => {
    if (viewerId == null) return 0;
    return lineup.entries.filter((e) => e.nominatedBy.id === viewerId).length;
  }, [lineup.entries, viewerId]);

  const journey = deriveJourneyState(lineup, myNominatedCount);

  const handleTileNominate = (gameId: number): void => {
    if (!canParticipate) return;
    nominate.mutate({ lineupId: lineup.id, body: { gameId } });
  };

  const handleTileOpenDrawer = (gameId: number): void => {
    setDrawerGameId(gameId);
  };

  return (
    <section
      data-testid="nominating-composite-view"
      className="space-y-3"
    >
      <JourneyHero
        phase="nominating"
        active={0}
        tone={journey.tone}
        badge={journey.badge}
        task={journey.task}
        sub={journey.sub}
      />
      <CommonGroundHero
        lineupId={lineup.id}
        canParticipate={canParticipate}
        onTileNominate={handleTileNominate}
        onTileOpenDrawer={handleTileOpenDrawer}
      />
      <ExistingNominations
        entries={[...lineup.entries]}
        lineupId={lineup.id}
      />
      {drawerGameId != null && (
        <GameResearchDrawer
          isOpen={true}
          gameId={drawerGameId}
          onClose={() => setDrawerGameId(null)}
        />
      )}
    </section>
  );
}
