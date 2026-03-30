import type { JSX } from 'react';
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useInfiniteEvents } from "../hooks/use-events";
import { useAuth } from "../hooks/use-auth";
import { useGameTime } from "../hooks/use-game-time";
import { useGameRegistry } from "../hooks/use-game-registry";
import { EventCard, EventCardSkeleton } from "../components/events/event-card";
import { MobileEventCard, MobileEventCardSkeleton } from "../components/events/mobile-event-card";
import { EventsEmptyState } from "../components/events/events-empty-state";
import { EventsMobileToolbar, type EventsTab } from "../components/events/events-mobile-toolbar";
import { EventPlansList } from "../components/events/event-plans-list";
import { InfiniteScrollSentinel } from "../components/ui/infinite-scroll-sentinel";
import { PullToRefresh } from "../components/ui/pull-to-refresh";
import { FAB } from "../components/ui/fab";
import { SchedulingBanner } from "../components/events/SchedulingBanner";
import type { EventResponseDto, GameTimeSlot } from "@raid-ledger/contract";
import { eventOverlapsGameTime } from "./events/events-helpers";
import { EventsPageHeader } from "./events/EventsPageHeader";
import { buildGenreOptions, filterEventsByGenre, type GenreOption } from "./events/genre-filter-helpers";

/**
 * Events List Page - displays upcoming events in a responsive grid
 */
function buildEventQueryParams(activeTab: EventsTab) {
  const params: import('../lib/api-client').EventListParams = {};
  switch (activeTab) {
    case 'past': params.upcoming = false; break;
    case 'mine': params.upcoming = true; params.signedUpAs = 'me'; break;
    default: params.upcoming = true; break;
  }
  return params;
}

function useGameTimeOverlaps(items: EventResponseDto[], gameTimeSlots: GameTimeSlot[] | undefined) {
  const slotSet = useMemo(() => {
    if (!gameTimeSlots?.length) return null;
    const set = new Set<string>();
    for (const slot of gameTimeSlots) set.add(`${slot.dayOfWeek}-${slot.hour}`);
    return set;
  }, [gameTimeSlots]);

  const overlapSet = useMemo(() => {
    if (!items.length || !slotSet) return null;
    const set = new Set<number>();
    for (const event of items) { if (eventOverlapsGameTime(event, slotSet)) set.add(event.id); }
    return set;
  }, [items, slotSet]);

  return { slotSet, overlapSet };
}

function filterAndSortEvents(items: EventResponseDto[], searchQuery: string, overlapSet: Set<number> | null, filterGameTime: boolean, activeTab: EventsTab) {
  if (!items.length) return items;
  let result = items;
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    result = result.filter((e) => e.title.toLowerCase().includes(q) || e.game?.name?.toLowerCase().includes(q));
  }
  if (overlapSet && activeTab !== 'past') {
    result = [...result].sort((a, b) => {
      const diff = (overlapSet.has(a.id) ? 0 : 1) - (overlapSet.has(b.id) ? 0 : 1);
      return diff !== 0 ? diff : new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
  }
  if (filterGameTime && overlapSet) result = result.filter((e) => overlapSet.has(e.id));
  return result;
}

function useEventsPageState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const genreFilter = searchParams.get("genre") || undefined;
  const tabParam = searchParams.get('tab') as EventsTab | null;
  const [activeTab, setActiveTab] = useState<EventsTab>(
    tabParam && ['upcoming', 'past', 'mine', 'plans'].includes(tabParam) ? tabParam : 'upcoming',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [filterGameTime, setFilterGameTime] = useState(false);
  return { searchParams, setSearchParams, genreFilter, activeTab, setActiveTab, searchQuery, setSearchQuery, filterGameTime, setFilterGameTime };
}

function handleGenreChange(genreKey: string | undefined, searchParams: URLSearchParams, setSearchParams: (p: URLSearchParams) => void): void {
  const next = new URLSearchParams(searchParams);
  if (genreKey) { next.set('genre', genreKey); } else { next.delete('genre'); }
  next.delete('gameId'); // clean up legacy param
  setSearchParams(next);
}

export function EventsPage() {
  const navigate = useNavigate();
  const state = useEventsPageState();
  const eventQueryParams = useMemo(() => buildEventQueryParams(state.activeTab), [state.activeTab]);
  const { items, isLoading, error, isFetchingNextPage, hasNextPage, sentinelRef, refetch } = useInfiniteEvents(eventQueryParams);
  const { isAuthenticated } = useAuth();
  const { data: gameTime } = useGameTime({ enabled: isAuthenticated });
  const { games: registryGames } = useGameRegistry();

  const genreOptions = useMemo(() => buildGenreOptions(registryGames), [registryGames]);
  const genreFiltered = useMemo(() => filterEventsByGenre(items, registryGames, state.genreFilter), [items, registryGames, state.genreFilter]);
  const genreLabel = useMemo(() => genreOptions.find((o) => o.key === state.genreFilter)?.label ?? null, [genreOptions, state.genreFilter]);

  const { slotSet, overlapSet } = useGameTimeOverlaps(genreFiltered, gameTime?.slots as GameTimeSlot[] | undefined);
  const displayEvents = useMemo(() => filterAndSortEvents(genreFiltered, state.searchQuery, overlapSet, state.filterGameTime, state.activeTab), [genreFiltered, overlapSet, state.filterGameTime, state.searchQuery, state.activeTab]);

  if (error) return <EventsErrorState message={error.message} />;

  return (
    <PullToRefresh onRefresh={refetch}>
      <div className="pb-20 md:pb-0">
        <SchedulingBanner />
        <EventsMobileToolbar activeTab={state.activeTab} onTabChange={state.setActiveTab} searchQuery={state.searchQuery} onSearchChange={state.setSearchQuery}
          genreOptions={genreOptions} selectedGenre={state.genreFilter} onGenreChange={(key) => handleGenreChange(key, state.searchParams, state.setSearchParams)} />
        <EventsContent activeTab={state.activeTab} setActiveTab={state.setActiveTab} searchQuery={state.searchQuery} setSearchQuery={state.setSearchQuery}
          isAuthenticated={isAuthenticated} genreLabel={genreLabel} genreOptions={genreOptions} genreFilter={state.genreFilter}
          searchParams={state.searchParams} setSearchParams={state.setSearchParams} isLoading={isLoading} displayEvents={displayEvents}
          filterGameTime={state.filterGameTime} setFilterGameTime={state.setFilterGameTime} slotSet={slotSet} overlapSet={overlapSet}
          sentinelRef={sentinelRef} isFetchingNextPage={isFetchingNextPage} hasNextPage={hasNextPage} navigate={navigate} />
        {isAuthenticated && <FAB onClick={() => navigate('/events/new')} label="Create Event" />}
      </div>
    </PullToRefresh>
  );
}

function EventsErrorState({ message }: { message: string }) {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-red-400 mb-2">Failed to load events</h2>
        <p className="text-muted">{message}</p>
      </div>
    </div>
  );
}

function EventsContent({ activeTab, setActiveTab, searchQuery, setSearchQuery, isAuthenticated, genreLabel, genreOptions,
  genreFilter, searchParams, setSearchParams, isLoading, displayEvents, filterGameTime, setFilterGameTime, slotSet, overlapSet,
  sentinelRef, isFetchingNextPage, hasNextPage, navigate }: {
  activeTab: EventsTab; setActiveTab: (t: EventsTab) => void; searchQuery: string; setSearchQuery: (q: string) => void;
  isAuthenticated: boolean; genreLabel: string | null; genreOptions: GenreOption[];
  genreFilter: string | undefined; searchParams: URLSearchParams; setSearchParams: (p: URLSearchParams) => void;
  isLoading: boolean; displayEvents: EventResponseDto[]; filterGameTime: boolean; setFilterGameTime: (v: boolean) => void;
  slotSet: Set<string> | null; overlapSet: Set<number> | null;
  sentinelRef: React.RefCallback<HTMLDivElement>; isFetchingNextPage: boolean; hasNextPage: boolean; navigate: (path: string) => void;
}) {
  return (
    <div className="py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <EventsPageHeader activeTab={activeTab} filteredGameName={genreLabel} isAuthenticated={isAuthenticated} />
        <DesktopFilterTabs isAuthenticated={isAuthenticated} activeTab={activeTab} onTabChange={setActiveTab}
          searchQuery={searchQuery} onSearchChange={setSearchQuery} genreOptions={genreOptions}
          genreFilter={genreFilter} searchParams={searchParams} setSearchParams={setSearchParams} />
        {activeTab === 'plans' ? <EventPlansList /> : (
          <>
            <GenreFilterChip genreFilter={genreFilter} genreLabel={genreLabel} searchParams={searchParams} setSearchParams={setSearchParams} />
            <GameTimeFilter slotSet={slotSet} filterGameTime={filterGameTime} setFilterGameTime={setFilterGameTime} overlapSet={overlapSet} />
            <EventsGrid isLoading={isLoading} displayEvents={displayEvents} filterGameTime={filterGameTime} setFilterGameTime={setFilterGameTime} overlapSet={overlapSet} navigate={navigate} />
            {!isLoading && displayEvents.length > 0 && <InfiniteScrollSentinel sentinelRef={sentinelRef} isFetchingNextPage={isFetchingNextPage} hasNextPage={hasNextPage} />}
          </>
        )}
      </div>
    </div>
  );
}

const TAB_LABELS: ReadonlyArray<readonly [EventsTab, string]> = [['upcoming', 'Upcoming'], ['past', 'Past'], ['mine', 'My Events'], ['plans', 'Plans']];

function DesktopTabButtons({ activeTab, onTabChange }: { activeTab: EventsTab; onTabChange: (t: EventsTab) => void }) {
  return (
    <div className="flex gap-1 bg-panel rounded-lg p-1">
      {TAB_LABELS.map(([key, label]) => (
        <button key={key} onClick={() => onTabChange(key)}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === key ? 'bg-surface text-foreground shadow-sm' : 'text-muted hover:text-foreground'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function DesktopSearchInput({ searchQuery, onSearchChange }: { searchQuery: string; onSearchChange: (q: string) => void }) {
  return (
    <div className="relative flex-1 max-w-xs">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input type="text" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search events..." aria-label="Search events"
        className="w-full pl-10 pr-4 py-2 bg-panel/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-muted focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
    </div>
  );
}

function DesktopFilterTabs({ isAuthenticated, activeTab, onTabChange, searchQuery, onSearchChange, genreOptions, genreFilter, searchParams, setSearchParams }: {
  isAuthenticated: boolean; activeTab: EventsTab; onTabChange: (t: EventsTab) => void; searchQuery: string; onSearchChange: (q: string) => void;
  genreOptions: GenreOption[]; genreFilter: string | undefined; searchParams: URLSearchParams; setSearchParams: (p: URLSearchParams) => void;
}): JSX.Element | null {
  if (!isAuthenticated) return null;
  return (
    <div className="hidden md:flex items-center gap-4 mb-6">
      <DesktopTabButtons activeTab={activeTab} onTabChange={onTabChange} />
      <DesktopSearchInput searchQuery={searchQuery} onSearchChange={onSearchChange} />
      {genreOptions.length > 0 && (
        <select value={genreFilter ?? ''} onChange={(e) => handleGenreChange(e.target.value || undefined, searchParams, setSearchParams)} aria-label="Filter by genre"
          className="max-w-[10rem] truncate px-3 py-2 bg-panel/50 border border-edge rounded-lg text-sm text-foreground focus:ring-2 focus:ring-emerald-500 focus:outline-none appearance-none pr-8">
          <option value="">All Games</option>
          {genreOptions.map((opt) => (<option key={opt.key} value={opt.key}>{opt.label}</option>))}
        </select>
      )}
    </div>
  );
}

function GenreFilterChip({ genreFilter, genreLabel, searchParams, setSearchParams }: {
  genreFilter: string | undefined; genreLabel: string | null; searchParams: URLSearchParams; setSearchParams: (p: URLSearchParams) => void;
}): JSX.Element | null {
  if (!genreFilter || !genreLabel) return null;
  return (
    <div className="mb-4">
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">
        {genreLabel}
        <button onClick={() => handleGenreChange(undefined, searchParams, setSearchParams)}
          className="flex items-center justify-center min-w-[44px] min-h-[44px] -mr-3 rounded-full hover:bg-violet-500/30 transition-colors" aria-label="Clear genre filter">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </span>
    </div>
  );
}

function GameTimeFilter({ slotSet, filterGameTime, setFilterGameTime, overlapSet }: {
  slotSet: Set<string> | null; filterGameTime: boolean; setFilterGameTime: (v: boolean) => void; overlapSet: Set<number> | null;
}): JSX.Element | null {
  if (!slotSet) return null;
  return (
    <div className="mb-6">
      <button onClick={() => setFilterGameTime(!filterGameTime)}
        className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${filterGameTime ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/40" : "bg-surface text-muted border-edge hover:text-foreground hover:border-dim"}`}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Inside Game Time
        {overlapSet && (<span className={`px-1.5 py-0.5 text-xs rounded-full ${filterGameTime ? "bg-cyan-500/30" : "bg-panel"}`}>{overlapSet.size}</span>)}
      </button>
    </div>
  );
}

function EventsEmptyFilterMsg({ filterGameTime, setFilterGameTime }: { filterGameTime: boolean; setFilterGameTime: (v: boolean) => void }) {
  if (!filterGameTime) return <EventsEmptyState />;
  return (
    <div className="col-span-full text-center py-12">
      <p className="text-muted">No events match your game time schedule.</p>
      <button onClick={() => setFilterGameTime(false)} className="mt-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors">Clear filter</button>
    </div>
  );
}

function EventsGrid({ isLoading, displayEvents, filterGameTime, setFilterGameTime, overlapSet, navigate }: {
  isLoading: boolean; displayEvents: EventResponseDto[]; filterGameTime: boolean; setFilterGameTime: (v: boolean) => void;
  overlapSet: Set<number> | null; navigate: (path: string) => void;
}): JSX.Element {
  const empty = <EventsEmptyFilterMsg filterGameTime={filterGameTime} setFilterGameTime={setFilterGameTime} />;
  return (
    <>
      <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {isLoading ? Array.from({ length: 8 }).map((_, i) => <EventCardSkeleton key={i} />)
          : displayEvents.length === 0 ? empty
          : displayEvents.map((event) => <EventCard key={event.id} event={event} signupCount={event.signupCount} matchesGameTime={overlapSet?.has(event.id)} onClick={() => navigate(`/events/${event.id}`)} />)}
      </div>
      <div className="md:hidden space-y-3">
        {isLoading ? Array.from({ length: 4 }).map((_, i) => <MobileEventCardSkeleton key={i} />)
          : displayEvents.length === 0 ? empty
          : displayEvents.map((event) => <MobileEventCard key={event.id} event={event} signupCount={event.signupCount} matchesGameTime={overlapSet?.has(event.id)} onClick={() => navigate(`/events/${event.id}`)} />)}
      </div>
    </>
  );
}
