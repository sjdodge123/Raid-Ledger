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
import { AttendanceTrendsChart } from '../components/analytics/attendance-trends-chart';
import { ReliabilityLeaderboard } from '../components/analytics/reliability-leaderboard';
import { GameBreakdownChart } from '../components/analytics/game-breakdown-chart';
import { NoShowPatterns } from '../components/analytics/no-show-patterns';

type Tab = 'dashboard' | 'analytics';

export function MyEventsPage() {
    const { user } = useAuth();
    const dashboard = useMyDashboard();
    const isAdmin = isOperatorOrAdmin(user);

    const [activeTab, setActiveTab] = useState<Tab>('dashboard');
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

    // Empty state (dashboard tab only)
    if (
        activeTab === 'dashboard' &&
        !dashboard.isLoading &&
        (!dashboard.data || dashboard.data.events.length === 0)
    ) {
        return (
            <div className="py-8 px-4">
                <div className="max-w-7xl mx-auto">
                    <h1 className="text-3xl font-bold text-foreground mb-4">
                        Event Metrics
                    </h1>

                    {/* Tab switcher (still show if admin) */}
                    {isAdmin && (
                        <TabSwitcher
                            activeTab={activeTab}
                            onTabChange={setActiveTab}
                        />
                    )}

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
                <h1 className="text-3xl font-bold text-foreground mb-4">
                    Event Metrics
                </h1>

                {/* Tab switcher (only visible to operator/admin) */}
                {isAdmin && (
                    <TabSwitcher
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                    />
                )}

                {activeTab === 'dashboard' ? (
                    <DashboardTab
                        dashboard={dashboard}
                        highlightGaps={highlightGaps}
                        eventsGridRef={eventsGridRef}
                        handleNeedsAttentionClick={handleNeedsAttentionClick}
                        isAdmin={isAdmin}
                    />
                ) : (
                    <AnalyticsTab />
                )}
            </div>
        </div>
    );
}

// ─── Tab Switcher ──────────────────────────────────────────

function TabSwitcher({
    activeTab,
    onTabChange,
}: {
    activeTab: Tab;
    onTabChange: (tab: Tab) => void;
}) {
    return (
        <div className="flex gap-1 bg-panel rounded-lg p-1 mb-8 w-fit">
            {[
                { key: 'dashboard' as Tab, label: 'Dashboard' },
                { key: 'analytics' as Tab, label: 'Analytics' },
            ].map(({ key, label }) => (
                <button
                    key={key}
                    onClick={() => onTabChange(key)}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                        activeTab === key
                            ? 'bg-emerald-600 text-white'
                            : 'text-muted hover:text-foreground'
                    }`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

// ─── Dashboard Tab (existing content) ──────────────────────

function DashboardTab({
    dashboard,
    highlightGaps,
    eventsGridRef,
    handleNeedsAttentionClick,
    isAdmin,
}: {
    dashboard: ReturnType<typeof useMyDashboard>;
    highlightGaps: boolean;
    eventsGridRef: React.RefObject<HTMLDivElement | null>;
    handleNeedsAttentionClick: () => void;
    isAdmin: boolean;
}) {
    return (
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
                    {isAdmin ? 'All Upcoming Events' : 'Your Events'}
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
                                  highlighted={
                                      highlightGaps &&
                                      event.missingRoles.length > 0
                                  }
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
    );
}

// ─── Analytics Tab (new — ROK-491) ─────────────────────────

function AnalyticsTab() {
    return (
        <div className="space-y-6">
            {/* Attendance Trends */}
            <AttendanceTrendsChart />

            {/* Two-column layout for leaderboard + game breakdown on larger screens */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ReliabilityLeaderboard />
                <GameBreakdownChart />
            </div>

            {/* No-Show Patterns */}
            <NoShowPatterns />
        </div>
    );
}
