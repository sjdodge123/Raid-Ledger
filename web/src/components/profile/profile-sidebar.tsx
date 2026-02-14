import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useResetOnboarding } from '../../hooks/use-onboarding-fte';

interface NavItem {
    to: string;
    label: string;
}

interface NavSection {
    id: string;
    label: string;
    icon: React.ReactNode;
    children: NavItem[];
}

const IdentityIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
);

const PreferencesIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
    </svg>
);

const GamingIcon = (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

const SECTIONS: NavSection[] = [
    {
        id: 'identity',
        label: 'Identity',
        icon: IdentityIcon,
        children: [
            { to: '/profile/identity', label: 'My Profile' },
            { to: '/profile/identity/discord', label: 'Discord' },
            { to: '/profile/identity/avatar', label: 'Avatar' },
        ],
    },
    {
        id: 'preferences',
        label: 'Preferences',
        icon: PreferencesIcon,
        children: [
            { to: '/profile/preferences/appearance', label: 'Appearance' },
            { to: '/profile/preferences/timezone', label: 'Timezone' },
            { to: '/profile/preferences/notifications', label: 'Notifications' },
        ],
    },
    {
        id: 'gaming',
        label: 'Gaming',
        icon: GamingIcon,
        children: [
            { to: '/profile/gaming/game-time', label: 'Game Time' },
            { to: '/profile/gaming/characters', label: 'Characters' },
        ],
    },
];

interface ProfileSidebarProps {
    onNavigate?: () => void;
}

export function ProfileSidebar({ onNavigate }: ProfileSidebarProps) {
    const location = useLocation();
    const navigate = useNavigate();
    const resetOnboarding = useResetOnboarding();

    const handleRerunWizard = () => {
        resetOnboarding.mutate(undefined, {
            onSuccess: () => {
                onNavigate?.();
                navigate('/onboarding?rerun=1');
            },
        });
    };

    return (
        <nav className="w-full h-full overflow-y-auto py-4 pr-2" aria-label="Profile navigation">
            <div className="space-y-4">
                {SECTIONS.map((section) => (
                    <div key={section.id}>
                        <div className="flex items-center gap-2.5 px-3 py-1.5 text-secondary">
                            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                                {section.icon}
                                {section.label}
                            </span>
                        </div>
                        <div className="mt-1 space-y-0.5">
                            {section.children.map((child) => (
                                <Link
                                    key={child.to}
                                    to={child.to}
                                    onClick={onNavigate}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                                        location.pathname === child.to
                                            ? 'text-emerald-400 bg-emerald-500/10 font-medium'
                                            : 'text-muted hover:text-foreground hover:bg-overlay/20'
                                    }`}
                                >
                                    <span className="truncate min-w-0 flex-1">{child.label}</span>
                                </Link>
                            ))}
                        </div>
                    </div>
                ))}

                {/* Setup Wizard re-run */}
                <div className="border-t border-edge/30 pt-4">
                    <button
                        onClick={handleRerunWizard}
                        disabled={resetOnboarding.isPending}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted hover:text-foreground hover:bg-overlay/20 transition-colors w-full"
                    >
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span className="truncate min-w-0 flex-1">
                            {resetOnboarding.isPending ? 'Resetting...' : 'Re-run Setup Wizard'}
                        </span>
                    </button>
                </div>
            </div>
        </nav>
    );
}
