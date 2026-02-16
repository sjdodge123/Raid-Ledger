import { useMemo, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useEvents } from "../hooks/use-events";
import { useAuth } from "../hooks/use-auth";
import { useGameTime } from "../hooks/use-game-time";
import { EventCard, EventCardSkeleton } from "../components/events/event-card";
import { MobileEventCard, MobileEventCardSkeleton } from "../components/events/mobile-event-card";
import { EventsEmptyState } from "../components/events/events-empty-state";
import { EventsMobileToolbar, type EventsTab } from "../components/events/events-mobile-toolbar";
import { FAB } from "../components/ui/fab";
import type { EventResponseDto, GameTimeSlot } from "@raid-ledger/contract";

/**
 * Convert JS Date.getDay() (0=Sunday) to game-time dayOfWeek (0=Monday).
 */
function toGameTimeDow(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1;
}

/**
 * Check if an event overlaps with any game time slot.
 * Checks every hour the event spans, not just the start hour.
 */
function eventOverlapsGameTime(
  event: EventResponseDto,
  slotSet: Set<string>,
): boolean {
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  // Walk hour-by-hour through the event duration
  const cursor = new Date(start);
  cursor.setMinutes(0, 0, 0); // snap to hour boundary
  if (cursor < start) cursor.setHours(cursor.getHours() + 1);

  while (cursor < end) {
    const key = `${toGameTimeDow(cursor.getDay())}-${cursor.getHours()}`;
    if (slotSet.has(key)) return true;
    cursor.setHours(cursor.getHours() + 1);
  }
  return false;
}

/**
 * Events List Page - displays upcoming events in a responsive grid
 */
export function EventsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const gameIdFilter = searchParams.get("gameId") || undefined;

  // Filter state — shared between mobile toolbar and desktop tabs
  const [activeTab, setActiveTab] = useState<EventsTab>('upcoming');
  const [searchQuery, setSearchQuery] = useState('');

  // Build query params based on the active mobile tab (ROK-329)
  const eventQueryParams = useMemo(() => {
    const params: import('../lib/api-client').EventListParams = {
      ...(gameIdFilter ? { gameId: gameIdFilter } : {}),
    };
    switch (activeTab) {
      case 'past':
        params.upcoming = false;
        break;
      case 'mine':
        params.upcoming = true;
        params.signedUpAs = 'me';
        break;
      case 'upcoming':
      default:
        params.upcoming = true;
        break;
    }
    return params;
  }, [activeTab, gameIdFilter]);

  const { data, isLoading, error } = useEvents(eventQueryParams);
  const { isAuthenticated } = useAuth();
  const { data: gameTime } = useGameTime({ enabled: isAuthenticated });

  const gameTimeSlots = gameTime?.slots;
  const events = data?.data;

  // Derive game name from the first loaded event when filtering by game
  const filteredGameName = useMemo(() => {
    if (!gameIdFilter || !events?.length) return null;
    return events[0]?.game?.name ?? null;
  }, [gameIdFilter, events]);

  // Build a Set of "dow-hour" keys for O(1) lookup
  const slotSet = useMemo(() => {
    if (!gameTimeSlots?.length) return null;
    const set = new Set<string>();
    for (const slot of gameTimeSlots as GameTimeSlot[]) {
      set.add(`${slot.dayOfWeek}-${slot.hour}`);
    }
    return set;
  }, [gameTimeSlots]);

  const [filterGameTime, setFilterGameTime] = useState(false);

  // Pre-compute which events overlap with game time
  const overlapSet = useMemo(() => {
    if (!events || !slotSet) return null;
    const set = new Set<number>();
    for (const event of events) {
      if (eventOverlapsGameTime(event, slotSet)) {
        set.add(event.id);
      }
    }
    return set;
  }, [events, slotSet]);

  // Sort events: game-time overlaps first, then filter if toggle is on + mobile search
  const displayEvents = useMemo(() => {
    if (!events) return events;
    let result = events;
    // Client-side search filter (ROK-329)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((e) =>
        e.title.toLowerCase().includes(q) ||
        e.game?.name?.toLowerCase().includes(q)
      );
    }
    if (overlapSet) {
      result = [...result].sort((a, b) => {
        const aOverlaps = overlapSet.has(a.id) ? 0 : 1;
        const bOverlaps = overlapSet.has(b.id) ? 0 : 1;
        return aOverlaps - bOverlaps;
      });
    }
    if (filterGameTime && overlapSet) {
      result = result.filter((e) => overlapSet.has(e.id));
    }
    return result;
  }, [events, overlapSet, filterGameTime, searchQuery]);

  if (error) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-red-400 mb-2">
            Failed to load events
          </h2>
          <p className="text-muted">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-20 md:pb-0">
      <EventsMobileToolbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <div className="py-8 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Page Header */}
          <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                {filteredGameName
                  ? `${filteredGameName} Events`
                  : activeTab === 'past'
                    ? 'Past Events'
                    : activeTab === 'mine'
                      ? 'My Events'
                      : 'Upcoming Events'}
              </h1>
              <p className="text-muted">
                {filteredGameName
                  ? `Showing events for ${filteredGameName}`
                  : activeTab === 'past'
                    ? 'Browse completed gaming sessions'
                    : activeTab === 'mine'
                      ? 'Events you\'ve signed up for'
                      : 'Discover and sign up for gaming sessions'}
              </p>
            </div>
            {isAuthenticated && (
              <Link
                to="/events/new"
                className="hidden md:inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-foreground font-semibold rounded-lg transition-colors shadow-lg shadow-emerald-600/25"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Create Event
              </Link>
            )}
          </div>

          {/* Desktop Filter Tabs — hidden on mobile where the sticky toolbar handles this */}
          {isAuthenticated && (
            <div className="hidden md:flex items-center gap-4 mb-6">
              <div className="flex gap-1 bg-panel rounded-lg p-1">
                {([['upcoming', 'Upcoming'], ['past', 'Past'], ['mine', 'My Events']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === key
                      ? 'bg-surface text-foreground shadow-sm'
                      : 'text-muted hover:text-foreground'
                      }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* Desktop search */}
              <div className="relative flex-1 max-w-xs">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search events..."
                  aria-label="Search events"
                  className="w-full pl-10 pr-4 py-2 bg-panel/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-muted focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Game Filter Chip */}
          {gameIdFilter && (
            <div className="mb-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30">
                🎮 {filteredGameName ?? "Loading..."}
                <button
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete("gameId");
                    setSearchParams(next);
                  }}
                  className="flex items-center justify-center min-w-[44px] min-h-[44px] -mr-3 rounded-full hover:bg-violet-500/30 transition-colors"
                  aria-label="Clear game filter"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </span>
            </div>
          )}

          {/* Game Time Filter */}
          {slotSet && (
            <div className="mb-6">
              <button
                onClick={() => setFilterGameTime((v) => !v)}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${filterGameTime
                  ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/40"
                  : "bg-surface text-muted border-edge hover:text-foreground hover:border-dim"
                  }`}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Inside Game Time
                {overlapSet && (
                  <span
                    className={`px-1.5 py-0.5 text-xs rounded-full ${filterGameTime ? "bg-cyan-500/30" : "bg-panel"
                      }`}
                  >
                    {overlapSet.size}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Events Grid — Desktop (≥md) */}
          <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <EventCardSkeleton key={i} />
              ))
            ) : (displayEvents ?? data?.data)?.length === 0 ? (
              filterGameTime ? (
                <div className="col-span-full text-center py-12">
                  <p className="text-muted">
                    No events match your game time schedule.
                  </p>
                  <button
                    onClick={() => setFilterGameTime(false)}
                    className="mt-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    Clear filter
                  </button>
                </div>
              ) : (
                <EventsEmptyState />
              )
            ) : (
              (displayEvents ?? data?.data)?.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  signupCount={event.signupCount}
                  matchesGameTime={overlapSet?.has(event.id)}
                  onClick={() => navigate(`/events/${event.id}`)}
                />
              ))
            )}
          </div>

          {/* Events List — Mobile (<md) */}
          <div className="md:hidden space-y-3">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <MobileEventCardSkeleton key={i} />
              ))
            ) : (displayEvents ?? data?.data)?.length === 0 ? (
              filterGameTime ? (
                <div className="text-center py-12">
                  <p className="text-muted">
                    No events match your game time schedule.
                  </p>
                  <button
                    onClick={() => setFilterGameTime(false)}
                    className="mt-2 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    Clear filter
                  </button>
                </div>
              ) : (
                <EventsEmptyState />
              )
            ) : (
              (displayEvents ?? data?.data)?.map((event) => (
                <MobileEventCard
                  key={event.id}
                  event={event}
                  signupCount={event.signupCount}
                  matchesGameTime={overlapSet?.has(event.id)}
                  onClick={() => navigate(`/events/${event.id}`)}
                />
              ))
            )}
          </div>

          {/* Pagination info */}
          {data?.meta && data.meta.totalPages > 1 && (
            <div className="mt-8 text-center text-dim">
              Page {data.meta.page} of {data.meta.totalPages} ({data.meta.total}{" "}
              events)
            </div>
          )}
        </div>
      </div>

      {isAuthenticated && (
        <FAB onClick={() => navigate('/events/new')} label="Create Event" />
      )}
    </div>
  );
}

