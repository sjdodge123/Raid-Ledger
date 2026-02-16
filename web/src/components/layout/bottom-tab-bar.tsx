import { Link, useLocation } from 'react-router-dom';
import {
    CalendarIcon,
    ClipboardDocumentListIcon,
    UserGroupIcon,
    PuzzlePieceIcon,
} from '@heroicons/react/24/outline';
import { Z_INDEX } from '../../lib/z-index';

const tabs = [
    { to: '/calendar', icon: CalendarIcon, label: 'Calendar' },
    { to: '/events', icon: ClipboardDocumentListIcon, label: 'Events' },
    { to: '/games', icon: PuzzlePieceIcon, label: 'Games' },
    { to: '/players', icon: UserGroupIcon, label: 'Players' },
] as const;

/**
 * Mobile bottom tab bar — persistent navigation for the four primary sections.
 *
 * Visible only below the `md` breakpoint (< 768px).
 * Strategy 2: 4 direct tabs with hamburger for overflow (ROK-331).
 */
export function BottomTabBar() {
    const location = useLocation();

    const isActive = (path: string) => location.pathname.startsWith(path);

    return (
        <nav
            className="fixed bottom-0 inset-x-0 md:hidden bg-surface/95 backdrop-blur-sm border-t border-edge-subtle"
            style={{
                zIndex: Z_INDEX.TAB_BAR,
                paddingBottom: 'env(safe-area-inset-bottom)',
            }}
            aria-label="Main navigation"
        >
            <div className="flex items-center justify-around h-14">
                {tabs.map((tab) => (
                    <Link
                        key={tab.to}
                        to={tab.to}
                        className={`relative flex flex-col items-center justify-center gap-0.5 px-3 py-2 min-w-[60px] transition-all duration-75 active:scale-95 ${isActive(tab.to)
                            ? 'text-emerald-400'
                            : 'text-secondary hover:text-foreground'
                            }`}
                    >
                        <tab.icon className="w-6 h-6" />
                        <span className="text-[10px] font-medium">{tab.label}</span>
                        {isActive(tab.to) && (
                            <div className="absolute -bottom-0.5 w-8 h-0.5 bg-emerald-400 rounded-full" />
                        )}
                    </Link>
                ))}
            </div>
        </nav>
    );
}
