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
import { CommonGroundHero, type CommonGroundMode } from './CommonGroundHero';
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
 * Compact Search trigger embedded in the sticky JourneyHero (ROK-1297
 * round 5b). Mirrors the Common Ground header's Search button but stays
 * reachable while the user scrolls past the Common Ground panel.
 */
function StickyHeroSearchButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Search the game library"
      data-testid="sticky-hero-search"
      className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 active:bg-emerald-500/30 text-sm font-medium text-emerald-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <svg
        aria-hidden="true"
        className="w-4 h-4 stroke-current"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx={11} cy={11} r={7} />
        <path d="m20 20-3-3" />
      </svg>
      <span>Search</span>
    </button>
  );
}

/**
 * Compact jump-to-nominations affordance embedded in the sticky
 * JourneyHero (ROK-1297 round 5b). Smooth-scrolls to the Nominated
 * Games section without leaving the sticky header on screen.
 */
function StickyHeroJumpButton({
  count,
  previews,
  onClick,
}: {
  count: number;
  previews: readonly LineupEntryResponseDto[];
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="sticky-hero-jump"
      aria-label={`Jump to your ${count} nominated games`}
      className="flex-1 min-h-[44px] inline-flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 active:bg-emerald-500/30 transition-colors"
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium text-emerald-100">
          {count} yours
        </span>
        <span className="flex -space-x-1.5">
          {previews.map((e) =>
            e.gameCoverUrl ? (
              <img
                key={e.id}
                src={e.gameCoverUrl}
                alt=""
                className="w-5 h-5 rounded object-cover border border-emerald-500/40 bg-overlay/50"
                loading="lazy"
              />
            ) : (
              <span
                key={e.id}
                aria-hidden="true"
                className="w-5 h-5 rounded border border-emerald-500/40 bg-overlay/50"
              />
            ),
          )}
        </span>
      </span>
      <svg
        aria-hidden="true"
        className="w-4 h-4 stroke-current text-emerald-200 flex-shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5v14" />
        <path d="m19 12-7 7-7-7" />
      </svg>
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
  // ROK-1297 round-5b: search mode lives here (lifted from CommonGroundHero)
  // so the sticky JourneyHero header can host a duplicate Search trigger
  // that's reachable even when scrolled past the panel.
  const [commonGroundMode, setCommonGroundMode] =
    useState<CommonGroundMode>('suggestions');
  const nominate = useNominateGame();

  const jumpToNominations = (): void => {
    const target = document.querySelector(
      '[data-testid="nominations-list"]',
    );
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
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
      {/* Sticky JourneyHero (ROK-1297 round 5b): the operator wants both
          the Search trigger AND the jump-to-nominations affordance built
          INTO the sticky element so they remain reachable while the user
          scrolls through Common Ground tiles. Mobile-only action row sits
          inside the sticky wrapper. */}
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
        <div className="md:hidden flex items-center gap-2 mt-2 px-1">
          <StickyHeroSearchButton
            onClick={() => setCommonGroundMode('search')}
            disabled={commonGroundMode === 'search'}
          />
          {lineup.entries.length > 0 && (
            <StickyHeroJumpButton
              count={lineup.entries.length}
              previews={lineup.entries.slice(0, 3)}
              onClick={jumpToNominations}
            />
          )}
        </div>
      </div>
      <CommonGroundHero
        lineupId={lineup.id}
        canParticipate={canParticipate}
        onTileNominate={handleTileNominate}
        onTileOpenDrawer={handleTileOpenDrawer}
        mode={commonGroundMode}
        onModeChange={setCommonGroundMode}
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
