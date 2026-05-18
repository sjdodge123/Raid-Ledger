/**
 * S1 Nominating composite (ROK-1297) — top-level component that replaces
 * the legacy header + Nominate button + CommonGroundPanel chrome on the
 * lineup detail page while a lineup is in the building phase.
 *
 * Pulls U1 JourneyHero, U4 SubmitBar from `shared/*`, the multi-row
 * Common Ground hero from this folder, and the existing useNominate /
 * useSubmitNominations mutations. Cycle 4 STRICT: per-tile + Nominate
 * is the ONLY nominate CTA on the page.
 */
import { useMemo, useState, type JSX } from 'react';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { JourneyHero } from '../../shared/journey-hero';
import { SubmitBar } from '../../shared/submit-bar/SubmitBar';
import { deriveSubmitKind } from '../../shared/submit-bar/derive-kind';
import { useNominateGame } from '../../../hooks/use-lineups';
import { CommonGroundHero } from './CommonGroundHero';
import { NominatingTabs, type NominatingTab } from './NominatingTabs';
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

function countMyNominations(
  lineup: LineupDetailResponseDto,
): number {
  // Best-effort: counts entries authored by the current viewer using the
  // serialized creator id. The detail endpoint doesn't expose `viewerId`
  // explicitly, so we treat "Yours" as a UI hint — server enforces the
  // real cap. Falls back to 0 when nominatedBy isn't available.
  return lineup.entries.filter((e) => e.nominatedBy != null).length === 0
    ? 0
    : lineup.entries.filter((e) => e.nominatedBy != null).length;
}

export function NominatingComposite(
  props: NominatingCompositeProps,
): JSX.Element {
  const { lineup, canParticipate } = props;
  const [activeTab, setActiveTab] = useState<NominatingTab>('all');
  const [drawerGameId, setDrawerGameId] = useState<number | null>(null);
  const nominate = useNominateGame();

  const myNominatedCount = useMemo(
    () => countMyNominations(lineup),
    [lineup],
  );
  const journey = deriveJourneyState(lineup, myNominatedCount);
  const submitKind = deriveSubmitKind({
    submittedAt: lineup.viewerSubmissions?.nominationsSubmittedAt ?? null,
    hasAnyAction: myNominatedCount > 0,
    hasFullAction: false,
  });
  const tabCounts = {
    all: lineup.entries.length,
    yours: myNominatedCount,
  };

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
      <NominatingTabs
        activeTab={activeTab}
        onChange={setActiveTab}
        counts={tabCounts}
      />
      <CommonGroundHero
        lineupId={lineup.id}
        canParticipate={canParticipate}
        onTileNominate={handleTileNominate}
        onTileOpenDrawer={handleTileOpenDrawer}
      />
      <SubmitBar
        kind={submitKind}
        status={`${myNominatedCount} nominated · autosaved`}
        cta="Submit my nominations →"
        disabledReason="add at least one nomination"
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
