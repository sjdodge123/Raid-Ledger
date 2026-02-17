import { useNavigate } from 'react-router-dom';
import { useUserEventSignups } from '../../hooks/use-user-profile';
import { EventCard, EventCardSkeleton } from '../events/event-card';
import { MobileEventCard, MobileEventCardSkeleton } from '../events/mobile-event-card';

interface UserEventSignupsProps {
    userId: number;
}

/**
 * Upcoming events section for the public user profile page (ROK-299).
 * Shows event cards for events the user has signed up for.
 */
export function UserEventSignups({ userId }: UserEventSignupsProps) {
    const { data, isLoading } = useUserEventSignups(userId);
    const navigate = useNavigate();

    if (isLoading) {
        return (
            <div className="user-profile-section">
                <h2 className="user-profile-section-title">Upcoming Events</h2>
                <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <EventCardSkeleton key={i} />
                    ))}
                </div>
                <div className="md:hidden space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <MobileEventCardSkeleton key={i} />
                    ))}
                </div>
            </div>
        );
    }

    const events = data?.data ?? [];
    const total = data?.total ?? 0;

    if (events.length === 0) {
        return (
            <div className="user-profile-section">
                <h2 className="user-profile-section-title">Upcoming Events</h2>
                <div className="flex flex-col items-center justify-center py-8 text-muted">
                    <svg
                        className="w-10 h-10 mb-2 opacity-40"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                    </svg>
                    <p className="text-sm">No upcoming events</p>
                </div>
            </div>
        );
    }

    return (
        <div className="user-profile-section">
            <div className="flex items-center justify-between">
                <h2 className="user-profile-section-title">
                    Upcoming Events
                    <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        {total}
                    </span>
                </h2>
                {total > 6 && (
                    <button
                        onClick={() => navigate(`/events?signedUpAs=${userId}`)}
                        className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                        View all
                    </button>
                )}
            </div>
            {/* Desktop grid (≥md) */}
            <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
                {events.map((event) => (
                    <EventCard
                        key={event.id}
                        event={event}
                        signupCount={event.signupCount}
                        onClick={() => navigate(`/events/${event.id}`)}
                    />
                ))}
            </div>
            {/* Mobile list (<md) */}
            <div className="md:hidden space-y-3 mt-3">
                {events.map((event) => (
                    <MobileEventCard
                        key={event.id}
                        event={event}
                        signupCount={event.signupCount}
                        onClick={() => navigate(`/events/${event.id}`)}
                    />
                ))}
            </div>
        </div>
    );
}
