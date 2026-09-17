import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useResetOnboarding } from '../../hooks/use-onboarding-fte';
import { useAuth } from '../../hooks/use-auth';
import { useGameTime } from '../../hooks/use-game-time';
import { getSections, type NavItem, type NavSection } from './profile-nav-data';
import { gameTimeSummary } from '../features/game-time/phone/phone-week-summary';

interface ProfileSidebarProps {
    onNavigate?: () => void;
}

const GAME_TIME_PATH = '/profile/gaming/game-time';

/** What the Game Time link shows beside its label: the dot and the summary line. */
interface GameTimeStatus {
    /** Whether a template week is saved (green dot) or not (red dot). */
    isSet: boolean;
    /** The second line — saved week + freshness, or "No game time yet" (ROK-1585 AC4b). */
    summary: string;
}

/** One sidebar link; the Game Time link carries its status dot and summary line. */
function SidebarLink({ child, active, onNavigate, gameTime }: {
    child: NavItem; active: boolean; onNavigate?: () => void; gameTime: GameTimeStatus;
}) {
    const isGameTime = child.to === GAME_TIME_PATH;
    return (
        <Link to={child.to} onClick={onNavigate}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                active ? 'text-emerald-400 bg-emerald-500/10 font-medium' : 'text-muted hover:text-foreground hover:bg-overlay/20'}`}>
            {isGameTime && <span className={`w-2 h-2 rounded-full shrink-0 ${gameTime.isSet ? 'bg-emerald-400' : 'bg-red-400'}`} />}
            <span className="min-w-0 flex-1">
                <span className="block truncate">{child.label}</span>
                {isGameTime && (
                    <span data-testid="profile-sidebar-game-time-summary" className="block truncate text-xs font-normal text-dim">
                        {gameTime.summary}
                    </span>
                )}
            </span>
        </Link>
    );
}

/** Renders a single sidebar section with its children links. */
function SidebarSection({ section, onNavigate, gameTime }: {
    section: NavSection; onNavigate?: () => void; gameTime: GameTimeStatus;
}) {
    const location = useLocation();
    return (
        <div>
            <div className="flex items-center gap-2.5 px-3 py-1.5 text-secondary">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">{section.icon}{section.label}</span>
            </div>
            <div className="mt-1 space-y-0.5">
                {section.children.map((child) => (
                    <SidebarLink key={child.to} child={child} active={location.pathname === child.to}
                        onNavigate={onNavigate} gameTime={gameTime} />
                ))}
            </div>
        </div>
    );
}

/** Re-run setup wizard button at the bottom of the sidebar. */
function RerunWizardButton({ onNavigate }: { onNavigate?: () => void }) {
    const navigate = useNavigate();
    const resetOnboarding = useResetOnboarding();
    return (
        <div className="border-t border-edge/30 pt-4">
            <button onClick={() => resetOnboarding.mutate(undefined, { onSuccess: () => { onNavigate?.(); navigate('/onboarding?rerun=1'); } })}
                disabled={resetOnboarding.isPending}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted hover:text-foreground hover:bg-overlay/20 transition-colors w-full">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="truncate min-w-0 flex-1">{resetOnboarding.isPending ? 'Resetting...' : 'Re-run Setup Wizard'}</span>
            </button>
        </div>
    );
}

/** Profile sidebar navigation with user-specific links (ROK-548). */
export function ProfileSidebar({ onNavigate }: ProfileSidebarProps) {
    const { isAuthenticated, user } = useAuth();
    const { data: gameTimeData } = useGameTime({ enabled: isAuthenticated });
    const gameTime: GameTimeStatus = {
        isSet: gameTimeData?.slots?.some(s => s.fromTemplate) ?? false,
        summary: gameTimeSummary(gameTimeData?.slots ?? [], gameTimeData?.gameTimeAgeDays, 'No game time yet'),
    };
    const sections = getSections(user?.id ?? 0);

    return (
        <nav className="w-full h-full overflow-y-auto py-4 px-2" aria-label="Profile navigation">
            <div className="space-y-4">
                {sections.map((section) => (
                    <SidebarSection key={section.id} section={section} onNavigate={onNavigate} gameTime={gameTime} />
                ))}
                <RerunWizardButton onNavigate={onNavigate} />
            </div>
        </nav>
    );
}
