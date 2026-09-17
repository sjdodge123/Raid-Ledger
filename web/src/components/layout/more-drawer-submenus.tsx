import { Link, useNavigate } from 'react-router-dom';
import { getSections, type NavItem, type NavSection } from '../profile/profile-nav-data';
import { useAuth } from '../../hooks/use-auth';
import { useGameTime } from '../../hooks/use-game-time';
import { gameTimeSummary } from '../features/game-time/phone/phone-week-summary';
import { useResetOnboarding } from '../../hooks/use-onboarding-fte';
import { usePluginAdmin } from '../../hooks/use-plugin-admin';
import { useAdminSettings } from '../../hooks/use-admin-settings';
import { useItadSettings } from '../../hooks/admin/use-itad-settings';
import { useCooptimusSettings } from '../../hooks/admin/use-cooptimus-settings';
import {
    buildCoreIntegrationItems,
    buildPluginIntegrationItems,
    buildDiscordNavItems,
    buildNavSections,
} from '../admin/admin-nav-data';
import { SidebarNavItem } from '../admin/admin-sidebar';
import { usePluginStore } from '../../stores/plugin-store';

/** The profile child whose row opens a drawer instead of a page (ROK-1584 §3). */
const GAME_TIME_PATH = '/profile/gaming/game-time';

/** Shared row recipe, so the Game Time button matches its sibling links exactly. */
function rowClass(active: boolean): string {
    return `flex items-center gap-2 px-3 py-3 min-h-[44px] w-full rounded-lg text-sm text-left transition-colors ${active
        ? 'text-emerald-400 bg-emerald-500/10 font-medium'
        : 'text-muted hover:text-foreground hover:bg-overlay/20'
        }`;
}

/**
 * Game Time opens the editor IN PLACE (ROK-1584 §3): the More drawer closes and
 * its host mounts the same "My game time" drawer the profile route does, so the
 * viewer never loses the page they were on.
 */
function GameTimeRow({ child, active, subtitle, onOpen }: {
    child: NavItem; active: boolean; subtitle: string; onOpen: () => void;
}) {
    return (
        <button type="button" data-testid="more-drawer-game-time" onClick={onOpen} className={rowClass(active)}>
            <span className="min-w-0 flex-1">
                <span className="block truncate">{child.label}</span>
                <span className="block truncate text-xs text-muted">{subtitle}</span>
            </span>
        </button>
    );
}

function ProfileNavSection({ section, pathname, onClose, gameTime }: {
    section: NavSection; pathname: string; onClose: () => void; gameTime: GameTimeRowData;
}) {
    return (
        <div key={section.id}>
            <div className="flex items-center gap-2 px-3 py-1.5 text-secondary">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                    {section.icon}
                    {section.label}
                </span>
            </div>
            <div className="mt-1 space-y-0.5">
                {section.children.map((child) => (
                    child.to === GAME_TIME_PATH && gameTime.onOpen
                        ? <GameTimeRow key={child.to} child={child} active={pathname === child.to}
                            subtitle={gameTime.subtitle} onOpen={gameTime.onOpen} />
                        : <Link key={child.to} to={child.to} onClick={onClose} className={rowClass(pathname === child.to)}>
                            <span className="truncate min-w-0 flex-1">{child.label}</span>
                        </Link>
                ))}
            </div>
        </div>
    );
}

/** What the Game Time row needs: its summary line and the host's opener. */
interface GameTimeRowData {
    subtitle: string;
    /** Absent when the host cannot mount the drawer — the row stays a link. */
    onOpen?: () => void;
}

function RerunWizardButton({ onRerun, isPending }: { onRerun: () => void; isPending: boolean }) {
    return (
        <div className="border-t border-edge/30 pt-3">
            <button onClick={onRerun} disabled={isPending}
                className="flex items-center gap-2 px-3 py-3 min-h-[44px] rounded-lg text-sm text-muted hover:text-foreground hover:bg-overlay/20 transition-colors w-full">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="truncate min-w-0 flex-1">
                    {isPending ? 'Resetting...' : 'Re-run Setup Wizard'}
                </span>
            </button>
        </div>
    );
}

/** Profile submenu -- renders profile nav sections inline in the MoreDrawer */
export function ProfileSubmenuContent({ pathname, onClose, onOpenGameTime }: {
    pathname: string; onClose: () => void; onOpenGameTime?: () => void;
}) {
    const navigate = useNavigate();
    const { user } = useAuth();
    const resetOnboarding = useResetOnboarding();
    const sections = getSections(user?.id ?? 0);
    // The drawer is `md:hidden`, so this summary is phone-only by construction.
    const { data: week } = useGameTime();
    const gameTime: GameTimeRowData = {
        subtitle: gameTimeSummary(week?.slots ?? [], week?.gameTimeAgeDays),
        onOpen: onOpenGameTime,
    };

    const handleRerunWizard = () => {
        resetOnboarding.mutate(undefined, { onSuccess: () => { onClose(); navigate('/onboarding?rerun=1'); } });
    };

    return (
        <div className="px-4 pb-3 space-y-3" data-testid="profile-submenu">
            {sections.map((section) => (
                <ProfileNavSection key={section.id} section={section} pathname={pathname}
                    onClose={onClose} gameTime={gameTime} />
            ))}
            <RerunWizardButton onRerun={handleRerunWizard} isPending={resetOnboarding.isPending} />
        </div>
    );
}

function useAdminNavSections() {
    const { plugins } = usePluginAdmin();
    const { igdbStatus, steamStatus, oauthStatus, discordBotStatus } = useAdminSettings();
    const { itadStatus } = useItadSettings();
    const { cooptimusStatus } = useCooptimusSettings();
    const isDiscordActive = usePluginStore((s) => s.isPluginActive('discord'));
    const coreIntegrations = buildCoreIntegrationItems({
        igdb: { configured: igdbStatus.data?.configured ?? false, loading: igdbStatus.isLoading },
        steam: { configured: steamStatus.data?.configured ?? false, loading: steamStatus.isLoading },
        itad: { configured: itadStatus.data?.configured ?? false, loading: itadStatus.isLoading },
        cooptimus: { configured: cooptimusStatus.data?.configured ?? false, loading: cooptimusStatus.isLoading },
    });
    const pluginIntegrations = buildPluginIntegrationItems(plugins.data ?? []);
    const discordItems = isDiscordActive
        ? buildDiscordNavItems(
            { connected: discordBotStatus.data?.connected ?? false, connecting: discordBotStatus.data?.connecting ?? false },
            { configured: oauthStatus.data?.configured ?? false, loading: oauthStatus.isLoading },
        )
        : null;
    return buildNavSections(coreIntegrations, pluginIntegrations, discordItems);
}

function AdminNavSection({ section, pathname, onClose }: {
    section: ReturnType<typeof buildNavSections>[number]; pathname: string; onClose: () => void;
}) {
    return (
        <div key={section.id}>
            <div className="flex items-center gap-2.5 px-3 py-1.5 text-secondary">
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                    {section.icon}
                    {section.label}
                </span>
            </div>
            <div className="mt-1 space-y-0.5">
                {section.children.map((child) => (
                    <SidebarNavItem key={child.to} item={child} isActive={pathname === child.to} onNavigate={onClose} />
                ))}
            </div>
        </div>
    );
}

/**
 * Admin submenu -- conditionally rendered so hooks only fire when expanded.
 * Uses the same builder functions and SidebarNavItem from admin-sidebar.
 */
export function AdminSubmenuContent({ pathname, onClose }: { pathname: string; onClose: () => void }) {
    const sections = useAdminNavSections();

    return (
        <div className="px-4 pb-3 space-y-3" data-testid="admin-submenu">
            {sections.map((section) => (
                <AdminNavSection key={section.id} section={section} pathname={pathname} onClose={onClose} />
            ))}
        </div>
    );
}
