import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useResetOnboarding } from '../../hooks/use-onboarding-fte';
import { useSystemStatus } from '../../hooks/use-system-status';
import { SECTIONS } from './profile-nav-data';

interface ProfileSidebarProps {
    onNavigate?: () => void;
}

export function ProfileSidebar({ onNavigate }: ProfileSidebarProps) {
    const location = useLocation();
    const navigate = useNavigate();
    const resetOnboarding = useResetOnboarding();
    const { data: systemStatus } = useSystemStatus();

    // Hide Discord nav item when Discord OAuth is not configured
    const sections = useMemo(() => {
        if (systemStatus?.discordConfigured) return SECTIONS;
        return SECTIONS.map((section) => ({
            ...section,
            children: section.children.filter((child) => child.to !== '/profile/identity/discord'),
        }));
    }, [systemStatus?.discordConfigured]);

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
                {sections.map((section) => (
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
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${location.pathname === child.to
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
