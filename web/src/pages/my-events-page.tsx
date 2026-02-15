import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, isOperatorOrAdmin } from '../hooks/use-auth';
import { useMyDashboard } from '../hooks/use-my-events';
import {
    DashboardStatsRow,
    DashboardStatsRowSkeleton,
} from '../components/dashboard/dashboard-stats-row';
import {
    DashboardEventCard,
    DashboardEventCardSkeleton,
} from '../components/dashboard/dashboard-event-card';
import { ActivityFeed } from '../components/dashboard/activity-feed';

export function MyEventsPage() {
    const { user } = useAuth();
    const dashboard = useMyDashboard();

    const [highlightGaps, setHighlightGaps] = useState(false);
    const eventsGridRef = useRef<HTMLDivElement>(null);

    const handleNeedsAttentionClick = useCallback(() => {
        setHighlightGaps(true);
        eventsGridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(() => setHighlightGaps(false), 3000);
    }, []);

    if (dashboard.error) {
        return (
            <div className="min-h-[50vh] flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-xl font-semibold text-red-400 mb-2">
                        Failed to load dashboard
                    </h2>
                    <p className="text-muted">
                        {dashboard.error.message}
                    </p>
                </div>
            </div>
        );
    }

    // Empty state
    if (!dashboard.isLoading && (!dashboard.data || dashboard.data.events.length === 0)) {
        return (
            <div className="py-8 px-4">
                <div className="max-w-7xl mx-auto">
                    <h1 className="text-3xl font-bold text-foreground mb-8">
                        Event Metrics
                    </h1>
                    <div className="text-center py-16">
                        <p className="text-lg text-muted mb-4">
                            You don't have any event metrics yet.
                        </p>
                        <div className="flex items-center justify-center gap-4">
                            <Link
                                to="/events"
                                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-foreground font-semibold rounded-lg transition-colors"
                            >
                                Browse Events
                            </Link>
                            <Link
                                to="/events/new"
                                className="px-6 py-3 bg-panel hover:bg-overlay text-foreground font-semibold rounded-lg transition-colors border border-edge"
                            >
                                Create Event
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="py-8 px-4">
            <div className="max-w-7xl mx-auto">
                <h1 className="text-3xl font-bold text-foreground mb-8">
                    Event Metrics
                </h1>

                <div className="space-y-8">
                    {/* Stats Row */}
                    {dashboard.isLoading ? (
                        <DashboardStatsRowSkeleton />
                    ) : dashboard.data ? (
                        <DashboardStatsRow
                            stats={dashboard.data.stats}
                            onNeedsAttentionClick={handleNeedsAttentionClick}
                        />
                    ) : null}

                    {/* Event Cards Grid */}
                    <div ref={eventsGridRef}>
                        <h2 className="text-xl font-semibold text-foreground mb-4">
                            {isOperatorOrAdmin(user) ? 'All Upcoming Events' : 'Your Events'}
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {dashboard.isLoading
                                ? Array.from({ length: 3 }).map((_, i) => (
                                    <DashboardEventCardSkeleton key={i} />
                                ))
                                : dashboard.data?.events.map((event) => (
                                    <DashboardEventCard
                                        key={event.id}
                                        event={event}
                                        highlighted={highlightGaps && event.missingRoles.length > 0}
                                    />
                                ))}
                        </div>
                    </div>

                    {/* Activity Feed */}
                    <div>
                        <h2 className="text-xl font-semibold text-foreground mb-4">
                            Recent Activity
                        </h2>
                        <div className="bg-surface rounded-lg border border-edge p-4">
                            <ActivityFeed />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
