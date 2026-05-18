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
import { useScrollDirection } from '../../../hooks/use-scroll-direction';
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

/**
 * Mobile-only jump affordance (ROK-1297 round 5). Surfaces the count of
 * nominated games + up to 6 thumbnail previews with a smooth-scroll
 * button that lands the user on the Nominated Games section without
 * scrolling past the entire Common Ground grid.
 */
function NominationsJumpStrip({
  entries,
}: {
  entries: readonly LineupEntryResponseDto[];
}): JSX.Element {
  const preview = entries.slice(0, 6);
  const handleJump = (): void => {
    const target = document.querySelector('[data-testid="nominations-list"]');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <button
      type="button"
      onClick={handleJump}
      data-testid="nominations-jump-strip"
      aria-label={`Jump to your ${entries.length} nominated games`}
      className="md:hidden w-full flex items-center justify-between gap-3 min-h-[56px] px-3 py-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 active:bg-emerald-500/15 transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold text-emerald-100">
          {entries.length} nominated
        </span>
        <div className="flex -space-x-2">
          {preview.map((e) =>
            e.gameCoverUrl ? (
              <img
                key={e.id}
                src={e.gameCoverUrl}
                alt=""
                className="w-7 h-7 rounded-md object-cover border border-emerald-500/30 bg-overlay/50"
                loading="lazy"
              />
            ) : (
              <div
                key={e.id}
                aria-hidden="true"
                className="w-7 h-7 rounded-md border border-emerald-500/30 bg-overlay/50"
              />
            ),
          )}
        </div>
      </div>
      <span className="text-xs text-emerald-200 inline-flex items-center gap-1 flex-shrink-0">
        Jump
        <svg
          aria-hidden="true"
          className="w-4 h-4 stroke-current"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14" />
          <path d="m19 12-7 7-7-7" />
        </svg>
      </span>
    </button>
  );
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
  // ROK-1297 round-4b: sync the sticky JourneyHero with the global Header's
  // mobile auto-hide. On mobile, scrolling down past 100px hides the
  // header (`-translate-y-full`); we slide the hero away by the same
  // amount so they leave/return together. On desktop the hook returns
  // null so the hero stays parked under the always-visible header.
  const scrollDir = useScrollDirection();
  const heroHidden = scrollDir === 'down';

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
      {/* Sticky JourneyHero (ROK-1297 round-4b): sits UNDER the global
          Header (Header.tsx is `sticky top-0` at ~64px tall on mobile
          and ~56px on desktop). On mobile, the Header auto-hides on
          scroll-down — we mirror that with `useScrollDirection` so the
          hero hides/reappears in lockstep. `top-14` (56px) parks the
          hero under the desktop header; on mobile the slightly taller
          header overlaps a couple pixels which the hero's translucent
          backdrop covers cleanly. */}
      <div
        className={`sticky top-14 z-20 bg-background/95 backdrop-blur-sm rounded-md py-1 transition-transform duration-200 will-change-transform md:translate-y-0 ${
          heroHidden ? '-translate-y-[200%]' : 'translate-y-0'
        }`}
      >
        <JourneyHero
          phase="nominating"
          active={0}
          tone={journey.tone}
          badge={journey.badge}
          task={journey.task}
          sub={journey.sub}
        />
      </div>
      {/* Mobile jump-to-nominations strip (ROK-1297 round 5). Desktop has
          space for the Nominated Games section adjacent to Common Ground,
          but mobile users would have to scroll past the entire 3-themed-row
          grid to reach their current nominations. This compact strip
          surfaces the count + a thumbnail preview right under the
          JourneyHero with a smooth-scroll affordance to jump down. */}
      {lineup.entries.length > 0 && (
        <NominationsJumpStrip entries={lineup.entries} />
      )}
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
