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
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { JourneyHero } from '../../shared/journey-hero';
import { LineupParticipantsButton } from '../LineupParticipantsButton';
import { useNominateGame } from '../../../hooks/use-lineups';
import { useAuth } from '../../../hooks/use-auth';
import { CommonGroundHero } from './CommonGroundHero';
import { CommonGroundFilterEntry } from '../CommonGroundFilters';
import { commonGroundActiveFilterCount } from '../common-ground-filter-count';
import { useCommonGroundState } from '../use-common-ground-state';
import { MyNominationsDrawer } from './MyNominationsDrawer';
import { ExistingNominations } from './ExistingNominations';
import { StickyHeroJumpButton } from './sticky-hero-buttons';
import { SearchInput } from '../../ui/search-input';
import { FilterEntryTrigger } from '../../ui/filter-entry';
import { GameResearchDrawer } from '../../games/GameResearchDrawer';
import { LineupHeroMeta } from '../LineupHeroMeta';

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

/**
 * ROK-1444: " · voting opens at N%" when the lineup carries an early-advance
 * target. Empty when the target is off (deadline-only) or has been permanently
 * disarmed by an operator revert, or never armed at all, so the copy never
 * promises an advance that cannot happen.
 */
function targetSuffix(lineup: LineupDetailResponseDto): string {
  if (lineup.nominationTargetPct == null) return '';
  if (lineup.nominationTargetDisarmedAt != null) return '';
  // Codex P2: an UNARMED target can never fire (carry-over seeded the lineup
  // at or above its target, so there is no rising edge left to cross).
  // Promising early voting there would be a lie.
  if (!lineup.nominationTargetArmed) return '';
  return ` · voting opens at ${lineup.nominationTargetPct}%`;
}

/**
 * ROK-1444: group size for the roster-fit flags.
 *
 * Base is Common Ground's `participantCount` — the people actually IN this
 * lineup (nominators + voters, or invitees + creator when private) — NOT
 * `votingEligibleCount`, which on a public lineup is the whole community and
 * flagged every co-op game on the dev env ("group is 249").
 *
 * Codex P2: that count only reaches public invitees once they nominate or
 * vote, so a public lineup seeded with explicit invitees (ROK-1440) reported
 * `participantCount = 1` and stayed silent for a group of five. Take the
 * larger of the two views; for a private lineup `participantCount` is already
 * invitees + creator, so the max is a no-op there.
 *
 * Returns undefined below two people: a "group" of one cannot outgrow a co-op
 * cap, and flagging a synced-zero game at "group is 1" would be noise.
 */
function rosterSize(
  lineup: LineupDetailResponseDto,
  participantCount: number,
): number | undefined {
  // Codex round-5 P2: count DISTINCT people. `addInvitees` does not exclude
  // the creator, so a creator who is also in the invitee list would otherwise
  // be counted twice and report the group one person too large — enough to
  // wrongly flag a 4-player co-op game for a real four-person roster.
  const invited = new Set(lineup.invitees.map((i) => i.id));
  invited.add(lineup.createdBy.id);
  const size = Math.max(participantCount, invited.size);
  return size >= 2 ? size : undefined;
}

function deriveJourneyState(
  lineup: LineupDetailResponseDto,
  myNominatedCount: number,
): JourneyState {
  // ROK-1348: the people-denominator is the eligible voter pool (private =
  // creator + invitees; public = totalMembers), NOT the community-wide
  // totalMembers — a 3-invitee private lineup no longer reads "by 13 voters".
  const eligible = lineup.votingEligibleCount;
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
    // ROK-1348: the entry count is no longer paired with the voter count
    // (the old "X of Y nominated by Y voters" wrongly used the same Y for
    // both the nomination target and the voter pool).
    // ROK-1444: the nomination CAP is published beside the count. It is the
    // denominator the early-advance target is measured against and it moves
    // (+5 per extra nominator), so leaving it implicit meant nobody could see
    // the bar they were nominating toward.
    sub: `${lineup.entries.length} / ${lineup.nominationCap} nominated by ${eligible} ${eligible === 1 ? 'voter' : 'voters'}${targetSuffix(lineup)}`,
    tone: 'action',
  };
}

export function NominatingComposite(
  props: NominatingCompositeProps,
): JSX.Element {
  const { lineup, canParticipate } = props;
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  const [drawerGameId, setDrawerGameId] = useState<number | null>(null);
  // ROK-1659: the Common Ground filters sit behind the shared funnel
  // standard — toolbar funnel from 1024px, Filters FAB + sheet below.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // ROK-1297 round 5h: replace the smooth-scroll-to-section flow with a
  // proper drawer so the user can review/remove their nominations
  // without leaving the Common Ground context.
  const [nominationsDrawerOpen, setNominationsDrawerOpen] = useState(false);
  const nominate = useNominateGame();
  // ROK-1297 round 5l: own the Common Ground state at the composite level
  // so the sticky JourneyHero hosts the search box and the filter entry
  // (reachable halfway down the page, not back at the Common Ground panel).
  const commonGroundState = useCommonGroundState(lineup.id, canParticipate);
  const {
    mergedData,
    isLoading: cgLoading,
    aiSuggestionsByGameId,
    atCap: cgAtCap,
    filters,
    setFilters,
    filtersRestored,
    coopDataAvailable,
    search,
    setSearch,
    participantCount,
  } = commonGroundState;
  const stickyHeaderRef = useRef<HTMLDivElement | null>(null);

  // ROK-1297 round 5r: when the typed query changes, the filtered Common Ground response may collapse from N tiles to a
  // few — the user's existing scroll position can land them deep inside
  // a now-tiny grid (or off the bottom of it), with the matching tile
  // visually behind the expanded sticky. Re-anchor on query change so
  // the first tile lands just below the sticky.
  //
  // We only adjust scroll position when the user has actively typed a new
  // query (auto-scrolling on focus was rejected by the operator).
  useEffect(() => {
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
  }, [search]);

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
      {/* Sticky JourneyHero toolbar (ROK-1297 round 5b): hosts the search
          box, the Filters funnel (1024px and up), the jump-to-nominations
          affordance and the inline filter panel, and stays pinned under the
          global Header (`top-14`) at EVERY width so those controls remain
          reachable while the user scrolls through Common Ground tiles.

          ROK-1601: it no longer auto-hides on mobile scroll-down. The hide
          translated the sticky box off-screen, but a transform does not
          collapse the box, so it left a blank band its own height tall. */}
      <div
        ref={stickyHeaderRef}
        data-testid="nominating-hero-toolbar"
        className="sticky top-14 z-20 py-3 bg-backdrop lg:bg-surface lg:rounded-md lg:px-3"
      >
        <JourneyHero
          phase="nominating"
          active={0}
          tone={journey.tone}
          badge={journey.badge}
          task={journey.task}
          action={<LineupParticipantsButton lineupId={lineup.id} size="hero" />}
          sub={
            <LineupHeroMeta lineup={lineup} phaseContext={journey.sub} />
          }
        />
        <div className="flex items-center gap-2 mt-2 px-1">
          <div className="flex-1 min-w-0">
            <SearchInput
              value={search}
              onChange={setSearch}
              label="Search games"
              placeholder="Search games..."
              data-testid="sticky-hero-search"
            />
          </div>
          <FilterEntryTrigger
            activeCount={commonGroundActiveFilterCount(filters, coopDataAvailable)}
            isOpen={filtersOpen}
            onOpenChange={setFiltersOpen}
          />
          {lineup.entries.length > 0 && (
            <StickyHeroJumpButton
              count={lineup.entries.length}
              onClick={() => setNominationsDrawerOpen(true)}
            />
          )}
        </div>
        {/* ROK-1659: the inline panel opens right under the toolbar from
            1024px; below that this renders the Filters FAB + BottomSheet. */}
        <div className={filtersOpen ? 'px-1 lg:mt-2' : 'px-1'}>
          <CommonGroundFilterEntry
            filters={filters}
            onChange={setFilters}
            participantCount={participantCount}
            suppressAutoSeed={filtersRestored}
            coopDataAvailable={coopDataAvailable}
            isOpen={filtersOpen}
            onOpenChange={setFiltersOpen}
          />
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
        nominatingId={
          nominate.isPending ? nominate.variables?.body?.gameId ?? null : null
        }
      />
      {/* Nominations section is mobile-hidden — the StickyHeroJumpButton
          opens MyNominationsDrawer there. Desktop keeps the inline list. */}
      <div className="hidden lg:block">
        <ExistingNominations
          entries={[...lineup.entries]}
          lineupId={lineup.id}
          participantCount={rosterSize(lineup, participantCount)}
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
        // ROK-1444 (Codex P3): the drawer is the MOBILE nominations list, so
        // it needs the same roster size or fit warnings never show below md.
        participantCount={rosterSize(lineup, participantCount)}
      />
    </section>
  );
}
