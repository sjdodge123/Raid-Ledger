import { useNavigate, Link } from 'react-router-dom';
import { useEvents } from '../hooks/use-events';
import { useAuth } from '../hooks/use-auth';
import { EventCard, EventCardSkeleton } from '../components/events/event-card';

/**
 * Events List Page - displays upcoming events in a responsive grid
 */
export function EventsPage() {
    const navigate = useNavigate();
    const { data, isLoading, error } = useEvents({ upcoming: true });
    const { isAuthenticated } = useAuth();

    if (error) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-xl font-semibold text-red-400 mb-2">
                        Failed to load events
                    </h2>
                    <p className="text-slate-400">{error.message}</p>
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
                        <h1 className="text-3xl font-bold text-white mb-2">Upcoming Events</h1>
                        <p className="text-slate-400">
                            Discover and sign up for gaming sessions
                        </p>
                    </div>
                    {isAuthenticated && (
                        <Link
                            to="/events/new"
                            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg transition-colors shadow-lg shadow-emerald-600/25"
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
                    ) : data?.data.length === 0 ? (
                        // Empty state
                        <div className="col-span-full text-center py-16">
                            <p className="text-xl text-slate-400">No upcoming events</p>
                            <p className="text-slate-500 mt-2">
                                Check back later or create a new event
                            </p>
                        </div>
                    ) : (
                        // Event cards - now using signupCount from event response
                        data?.data.map((event) => (
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
                    <div className="mt-8 text-center text-slate-500">
                        Page {data.meta.page} of {data.meta.totalPages} ({data.meta.total} events)
                    </div>
                )}
            </div>
        </div>
    );
}
