import { Link, useLocation } from 'react-router-dom';
import {
    CalendarIcon,
    ClipboardDocumentListIcon,
    UserGroupIcon,
    PuzzlePieceIcon,
} from '@heroicons/react/24/outline';
import { useScrollDirection } from '../../hooks/use-scroll-direction';
import { Z_INDEX } from '../../lib/z-index';
import { BottomHubsButton } from './hub-nav/bottom-hubs-button';

const LEFT_TABS = [
    { to: '/calendar', icon: CalendarIcon, label: 'Calendar' },
    { to: '/events', icon: ClipboardDocumentListIcon, label: 'Events' },
] as const;
const RIGHT_TABS = [
    { to: '/games', icon: PuzzlePieceIcon, label: 'Games' },
    { to: '/players', icon: UserGroupIcon, label: 'Players' },
] as const;
type Tab = (typeof LEFT_TABS)[number] | (typeof RIGHT_TABS)[number];

/**
 * Off-screen while scrolling down: the bar's own height plus the raised Hubs
 * circle's 24px lift (and a little shadow), so the circle never peeks above the edge.
 */
export const TAB_BAR_HIDDEN_CLASS = 'translate-y-[calc(100%+2rem)]';

/**
 * Mobile bottom tab bar — persistent navigation for the primary sections.
 *
 * Visible only below the `md` breakpoint (< 768px).
 * Strategy 2: direct tabs with hamburger for overflow (ROK-331). ROK-1875
 * (operator ruling 2026-10-21): five even grid columns — Calendar · Events ·
 * (raised Hubs circle) · Games · Players. Each slot fills its column (64px at
 * 320px wide), so no label truncates and nothing overflows.
 */
// Full-screen wizard routes where the tab bar must not render. Exact-match
// paths mirroring app-routes.tsx — update this when those routes move.
const MODAL_ROUTES = new Set(['/onboarding', '/admin/setup']);

function TabLink({ tab, isActive }: { tab: Tab; isActive: boolean }) {
    return (
        <Link to={tab.to}
            className={`relative flex flex-col items-center justify-center gap-0.5 w-full h-14 py-2 transition-all duration-75 active:scale-95 ${isActive ? 'text-emerald-400' : 'text-secondary hover:text-foreground'}`}>
            <tab.icon className="w-6 h-6" />
            <span className="text-[10px] font-medium">{tab.label}</span>
            {isActive && <div className="absolute -bottom-0.5 w-8 h-0.5 bg-emerald-400 rounded-full" />}
        </Link>
    );
}

/** The phone bottom bar (below 768px); hidden on full-screen wizard routes. */
export function BottomTabBar() {
    const location = useLocation();
    const scrollDirection = useScrollDirection();
    const isHidden = scrollDirection === 'down';

    if (MODAL_ROUTES.has(location.pathname)) return null;

    return (
        <nav data-testid="bottom-tab-bar" className={`fixed bottom-0 inset-x-0 md:hidden bg-surface/95 backdrop-blur-sm border-t border-edge-subtle will-change-transform md:will-change-auto ${isHidden ? TAB_BAR_HIDDEN_CLASS : 'translate-y-0'}`}
            style={{ zIndex: Z_INDEX.TAB_BAR, paddingBottom: 'env(safe-area-inset-bottom)', transition: 'transform 300ms ease-in-out' }}
            aria-label="Main navigation">
            <div data-testid="bottom-tab-grid" className="grid grid-cols-5 items-center h-14">
                {LEFT_TABS.map((tab) => <TabLink key={tab.to} tab={tab} isActive={location.pathname.startsWith(tab.to)} />)}
                <BottomHubsButton pathname={location.pathname} />
                {RIGHT_TABS.map((tab) => <TabLink key={tab.to} tab={tab} isActive={location.pathname.startsWith(tab.to)} />)}
            </div>
        </nav>
    );
}
