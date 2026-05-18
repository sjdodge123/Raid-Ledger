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
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type {
  LineupDetailResponseDto,
  LineupEntryResponseDto,
} from '@raid-ledger/contract';
import { JourneyHero } from '../../shared/journey-hero';
import { useNominateGame, useRemoveNomination } from '../../../hooks/use-lineups';
import { useAuth } from '../../../hooks/use-auth';
import { useScrollDirection } from '../../../hooks/use-scroll-direction';
import { CommonGroundHero } from './CommonGroundHero';
import { CommonGroundFilters } from '../CommonGroundFilters';
import { useCommonGroundState } from '../use-common-ground-state';
import { MyNominationsDrawer } from './MyNominationsDrawer';

type CommonGroundMode = 'suggestions' | 'search';
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
      className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-sm font-semibold text-white shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
 * Games section without leaving the sticky header on screen. Visual
 * structure mirrors `StickyHeroSearchButton` (icon + label) so the
 * two buttons read as a uniform pair.
 */
function StickyHeroJumpButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="sticky-hero-jump"
      aria-label={`Jump to your ${count} nominated games`}
      className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-sm font-semibold text-white shadow-md transition-colors whitespace-nowrap"
    >
      <svg
        aria-hidden="true"
        className="w-4 h-4 stroke-current flex-shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5v14" />
        <path d="m19 12-7 7-7-7" />
      </svg>
      <span>Nominations · {count}</span>
    </button>
  );
}

/**
 * Compact Regenerate trigger embedded in the sticky JourneyHero (round
 * 5d). Bumps the external trigger counter on CommonGroundHero so the
 * same refetch + shuffle flow runs as the in-panel Regenerate button.
 */
function StickyHeroRegenerateButton({
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
      aria-label="Regenerate Common Ground suggestions"
      data-testid="sticky-hero-regenerate"
      className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-sm font-semibold text-white shadow-md transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <svg
        aria-hidden="true"
        className="w-4 h-4 stroke-current flex-shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
      <span>Refresh</span>
    </button>
  );
}

/**
 * Replaces the Search button on mobile when search mode is active —
 * single tap returns to suggestions.
 */
function StickyHeroBackButton({
  onClick,
}: {
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back to Common Ground suggestions"
      data-testid="sticky-hero-back"
      className="flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-sm font-semibold text-white shadow-md transition-colors whitespace-nowrap"
    >
      <svg
        aria-hidden="true"
        className="w-4 h-4 stroke-current flex-shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </svg>
      <span>Back</span>
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
  // ROK-1297 round 5h: replace the smooth-scroll-to-section flow with a
  // proper drawer so the user can review/remove their nominations
  // without leaving the Common Ground context.
  const [nominationsDrawerOpen, setNominationsDrawerOpen] = useState(false);
  const nominate = useNominateGame();
  // ROK-1297 round 5l: own the Common Ground state at the composite level
  // so the sticky JourneyHero can render the CommonGroundFilters inline
  // (the filters need to live INSIDE the sticky wrapper — operator
  // feedback: tapping Search halfway down the page should reveal filters
  // right there, not back at the Common Ground panel).
  const commonGroundState = useCommonGroundState(lineup.id, canParticipate);
  const {
    mergedData,
    isLoading: cgLoading,
    aiSuggestionsByGameId,
    atCap: cgAtCap,
    filters,
    setFilters,
    search,
    setSearch,
    availableTags,
    participantCount,
  } = commonGroundState;
  // ROK-1297 round-4b: sync the sticky JourneyHero with the global Header's
  // mobile auto-hide. On mobile, scrolling down past 100px hides the
  // header (`-translate-y-full`); we slide the hero away by the same
  // amount so they leave/return together. On desktop the hook returns
  // null so the hero stays parked under the always-visible header.
  //
  // ROK-1297 round 5g: gate the hide behind an IntersectionObserver
  // "stuck" sentinel. Before the wrapper actually pins to top:14, hiding
  // it via translate-y leaves a 199px ghost slot in the document flow —
  // the operator saw this as "leaves empty DOM space" / "jumps to the
  // sticky position." Once stuck, hiding is safe because the natural
  // flow slot has already scrolled above the viewport.
  const scrollDir = useScrollDirection();
  const stuckSentinelRef = useRef<HTMLDivElement | null>(null);
  const [isStuck, setIsStuck] = useState(false);
  useEffect(() => {
    const sentinel = stuckSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);
  // ROK-1297 round 5m: keep the sticky hero visible while the operator
  // is in search mode. Auto-hiding while the filter bar is expanded
  // makes the entire filter row vanish on the first scroll-down — the
  // operator can't see what they're filtering against.
  const heroHidden =
    scrollDir === 'down' && isStuck && commonGroundMode !== 'search';

  const stickyHeaderRef = useRef<HTMLDivElement | null>(null);

  // ROK-1297 round 5r: when the typed query changes WHILE in search mode,
  // the filtered Common Ground response may collapse from N tiles to a
  // few — the user's existing scroll position can land them deep inside
  // a now-tiny grid (or off the bottom of it), with the matching tile
  // visually behind the expanded sticky. Re-anchor on query change so
  // the first tile lands just below the sticky.
  //
  // This is distinct from auto-scrolling on the Search button press
  // (which the operator rejected): we only adjust scroll position when
  // the user has actively typed a new query.
  useEffect(() => {
    if (commonGroundMode !== 'search') return;
    if (!search.trim()) return;
    const id = requestAnimationFrame(() => {
      const cg = document.querySelector('[data-testid="common-ground-hero"]');
      const sticky = stickyHeaderRef.current;
      if (!cg || !sticky) return;
      const stickyBottom = sticky.getBoundingClientRect().bottom;
      const cgTop = cg.getBoundingClientRect().top;
      const delta = cgTop - stickyBottom - 8;
      // Only fire when the CG hero is meaningfully off-position. Skip
      // small deltas to avoid jitter on each keystroke.
      if (Math.abs(delta) < 24) return;
      window.scrollBy({ top: delta, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [search, commonGroundMode]);

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
      {/* Sentinel just above the sticky wrapper (ROK-1297 round 5g). When
          it scrolls off-screen the IntersectionObserver flips `isStuck`
          true, and only then is the wrapper allowed to translate-hide
          on scroll-down. Otherwise the hide leaves a 199px ghost slot
          in document flow. */}
      <div ref={stuckSentinelRef} aria-hidden="true" className="h-px" />
      {/* Sticky JourneyHero (ROK-1297 round 5b): the operator wants both
          the Search trigger AND the jump-to-nominations affordance built
          INTO the sticky element so they remain reachable while the user
          scrolls through Common Ground tiles. Mobile-only action row sits
          inside the sticky wrapper. */}
      <div
        ref={stickyHeaderRef}
        className={`sticky top-14 z-20 bg-background/95 backdrop-blur-sm rounded-md py-1 will-change-transform md:translate-y-0 ${
          heroHidden ? '-translate-y-[200%]' : 'translate-y-0'
        }`}
        style={{ transition: 'transform 300ms ease-in-out' }}
      >
        <JourneyHero
          phase="nominating"
          active={0}
          tone={journey.tone}
          badge={journey.badge}
          task={journey.task}
          sub={journey.sub}
        />
        <div className="flex items-center gap-2 mt-2 px-1">
          {commonGroundMode === 'search' ? (
            <StickyHeroBackButton
              onClick={() => setCommonGroundMode('suggestions')}
            />
          ) : (
            <StickyHeroSearchButton
              onClick={() => setCommonGroundMode('search')}
              disabled={false}
            />
          )}
          {lineup.entries.length > 0 && (
            <StickyHeroJumpButton
              count={lineup.entries.length}
              onClick={() => setNominationsDrawerOpen(true)}
            />
          )}
        </div>
        {/* ROK-1297 round 5l: filter bar lives INSIDE the sticky wrapper.
            Tapping Search while scrolled deep into Common Ground expands
            the filters right there, not back at the panel header (which
            could be off-screen). */}
        {/* ROK-1297 round 5q: switch from grid-template-rows 0fr↔1fr to
            max-height. Browsers transition max-height reliably on every
            toggle; the grid-rows trick worked on first open but the
            second cycle could skip the animation. 600px is a sane cap
            for the four-control filter bar at our widest breakpoint —
            the natural height never exceeds that, so the transition
            visually completes at the natural size. */}
        <div
          className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
          style={{
            maxHeight: commonGroundMode === 'search' ? '600px' : '0px',
          }}
        >
          <div className="mt-2 px-1">
            <div className="p-3 rounded-md border border-emerald-500/30 bg-surface shadow-lg">
              <CommonGroundFilters
                filters={filters}
                onChange={setFilters}
                availableTags={availableTags}
                search={search}
                onSearchChange={setSearch}
                participantCount={participantCount}
              />
            </div>
          </div>
        </div>
      </div>
      <CommonGroundHero
        canParticipate={canParticipate}
        onTileNominate={handleTileNominate}
        onTileOpenDrawer={handleTileOpenDrawer}
        mergedData={mergedData}
        isLoading={cgLoading}
        aiSuggestionsByGameId={aiSuggestionsByGameId}
        atCap={cgAtCap}
      />
      {/* Nominations section is mobile-hidden — the StickyHeroJumpButton
          opens MyNominationsDrawer there. Desktop keeps the inline list. */}
      <div className="hidden md:block">
        <ExistingNominations
          entries={[...lineup.entries]}
          lineupId={lineup.id}
        />
      </div>
      {drawerGameId != null && (
        <GameResearchDrawer
          isOpen={true}
          gameId={drawerGameId}
          onClose={() => setDrawerGameId(null)}
        />
      )}
      <MyNominationsDrawer
        isOpen={nominationsDrawerOpen}
        onClose={() => setNominationsDrawerOpen(false)}
        entries={lineup.entries}
        lineupId={lineup.id}
      />
    </section>
  );
}
