import { useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useEvents } from '../hooks/use-events';
import { useAuth } from '../hooks/use-auth';
import { useGameTime } from '../hooks/use-game-time';
import { EventCard, EventCardSkeleton } from '../components/events/event-card';
import { EventsEmptyState } from '../components/events/events-empty-state';
import type { EventResponseDto, GameTimeSlot } from '@raid-ledger/contract';

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
    const { data, isLoading, error } = useEvents({ upcoming: true });
    const { isAuthenticated } = useAuth();
    const { data: gameTime } = useGameTime({ enabled: isAuthenticated });

    const gameTimeSlots = gameTime?.slots;
    const events = data?.data;

    // Build a Set of "dow-hour" keys for O(1) lookup
    const slotSet = useMemo(() => {
        if (!gameTimeSlots?.length) return null;
        const set = new Set<string>();
        for (const slot of gameTimeSlots as GameTimeSlot[]) {
            set.add(`${slot.dayOfWeek}-${slot.hour}`);
        }
        return set;
    }, [gameTimeSlots]);

    // Sort events: game-time overlaps first, then by original order
    const sortedEvents = useMemo(() => {
        if (!events || !slotSet) return events;
        return [...events].sort((a, b) => {
            const aOverlaps = eventOverlapsGameTime(a, slotSet) ? 0 : 1;
            const bOverlaps = eventOverlapsGameTime(b, slotSet) ? 0 : 1;
            return aOverlaps - bOverlaps;
        });
    }, [events, slotSet]);

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
        <div className="py-8 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Page Header */}
                <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-foreground mb-2">Upcoming Events</h1>
                        <p className="text-muted">
                            Discover and sign up for gaming sessions
                        </p>
                    </div>
                    {isAuthenticated && (
                        <Link
                            to="/events/new"
                            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-foreground font-semibold rounded-lg transition-colors shadow-lg shadow-emerald-600/25"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Create Event
                        </Link>
                    )}
                </div>

                {/* Events Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {isLoading ? (
                        // Show skeletons while loading
                        Array.from({ length: 8 }).map((_, i) => (
                            <EventCardSkeleton key={i} />
                        ))
                    ) : (sortedEvents ?? data?.data)?.length === 0 ? (
                        // Empty state with illustration and CTA
                        <EventsEmptyState />
                    ) : (
                        // Event cards — sorted by game time overlap when authenticated
                        (sortedEvents ?? data?.data)?.map((event) => (
                            <EventCard
                                key={event.id}
                                event={event}
                                signupCount={event.signupCount}
                                onClick={() => navigate(`/events/${event.id}`)}
                            />
                        ))
                    )}
                </div>

                {/* Pagination info */}
                {data?.meta && data.meta.totalPages > 1 && (
                    <div className="mt-8 text-center text-dim">
                        Page {data.meta.page} of {data.meta.totalPages} ({data.meta.total} events)
                    </div>
                )}
            </div>
        </div>
    );
}
