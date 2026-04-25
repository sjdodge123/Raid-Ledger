import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, isOperatorOrAdmin } from '../hooks/use-auth';

type TabKey = 'community' | 'events';

interface TabDef {
    key: TabKey;
    label: string;
    to: string;
    adminOnly?: boolean;
}

const TABS: TabDef[] = [
    { key: 'community', label: 'Community', to: '/insights/community', adminOnly: true },
    { key: 'events', label: 'Events', to: '/insights/events' },
];

function activeTab(pathname: string): TabKey {
    if (pathname.startsWith('/insights/community')) return 'community';
    return 'events';
}

function TabLink({ tab, current }: { tab: TabDef; current: TabKey }) {
    const isActive = tab.key === current;
    const base = 'px-4 py-2 text-sm font-medium rounded-md transition-colors';
    return (
        <Link
            to={tab.to}
            className={`${base} ${isActive ? 'bg-emerald-600 text-white' : 'text-muted hover:text-foreground'}`}
        >
            {tab.label}
        </Link>
    );
}

/**
 * ROK-1099 Insights hub — tabbed container for Community (admin-gated)
 * and Events (all logged-in users). Renders child routes via <Outlet />.
 */
export function InsightsHubPage() {
    const { user, isLoading, isAuthenticated } = useAuth();
    const location = useLocation();

    if (isLoading) return <InsightsLoadingSkeleton />;
    if (!isAuthenticated || !user) return <Navigate to="/" replace />;

    const admin = isOperatorOrAdmin(user);
    const current = activeTab(location.pathname);

    if (!admin && current === 'community') {
        return <Navigate to="/insights/events" replace />;
    }

    const visibleTabs = TABS.filter((t) => !t.adminOnly || admin);

    return (
        <div className="py-8 px-4" data-testid="insights-hub">
            <div className="max-w-7xl mx-auto">
                <h1 className="text-3xl font-bold text-foreground mb-4">Insights</h1>
                <nav aria-label="Insights sections" className="flex gap-1 bg-panel rounded-lg p-1 mb-8 w-fit">
                    {visibleTabs.map((tab) => (
                        <TabLink key={tab.key} tab={tab} current={current} />
                    ))}
                </nav>
                <Outlet />
            </div>
        </div>
    );
}

function InsightsLoadingSkeleton() {
    return (
        <div className="py-8 px-4" data-testid="insights-hub">
            <div className="max-w-7xl mx-auto animate-pulse space-y-4">
                <div className="h-8 bg-overlay rounded w-48" />
                <div className="h-10 bg-overlay rounded w-80" />
                <div className="h-64 bg-overlay rounded" />
            </div>
        </div>
    );
}
