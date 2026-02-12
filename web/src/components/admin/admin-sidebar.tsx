import { useState, useCallback, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';

interface NavSection { id: string; label: string; icon: React.ReactNode; children: { to: string; label: string }[]; }

const GeneralIcon = (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>);
const IntegrationsIcon = (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>);
const PluginsIcon = (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" /></svg>);
const AppearanceIcon = (<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>);

const NAV_SECTIONS: NavSection[] = [
    { id: 'general', label: 'General', icon: GeneralIcon, children: [
        { to: '/admin/settings/general', label: 'Site Settings' },
        { to: '/admin/settings/general/roles', label: 'Role Management' },
        { to: '/admin/settings/general/data', label: 'Demo Data' },
    ]},
    { id: 'integrations', label: 'Integrations', icon: IntegrationsIcon, children: [
        { to: '/admin/settings/integrations', label: 'Discord OAuth' },
        { to: '/admin/settings/integrations/igdb', label: 'IGDB / Twitch' },
        { to: '/admin/settings/integrations/relay', label: 'Relay Hub' },
    ]},
    { id: 'plugins', label: 'Plugins', icon: PluginsIcon, children: [
        { to: '/admin/settings/plugins', label: 'Manage Plugins' },
    ]},
    { id: 'appearance', label: 'Appearance', icon: AppearanceIcon, children: [
        { to: '/admin/settings/appearance', label: 'Branding' },
        { to: '/admin/settings/appearance/theme', label: 'Theme' },
    ]},
];

function findActiveSectionId(pathname: string): string | undefined {
    return NAV_SECTIONS.find((s) => s.children.some((c) => pathname === c.to))?.id;
}

interface AdminSidebarProps { isOpen?: boolean; onNavigate?: () => void; }

export function AdminSidebar({ isOpen = true, onNavigate }: AdminSidebarProps) {
    const location = useLocation();
    const activeSectionId = findActiveSectionId(location.pathname);
    const [userToggles, setUserToggles] = useState<Record<string, boolean>>({});

    const expandedMap = useMemo(() => {
        const result: Record<string, boolean> = {};
        for (const section of NAV_SECTIONS) {
            result[section.id] = section.id in userToggles ? userToggles[section.id] : section.id === activeSectionId;
        }
        return result;
    }, [activeSectionId, userToggles]);

    const handleToggle = useCallback((sectionId: string) => {
        setUserToggles((prev) => {
            const currentlyExpanded = sectionId in prev ? prev[sectionId] : sectionId === activeSectionId;
            return { ...prev, [sectionId]: !currentlyExpanded };
        });
    }, [activeSectionId]);

    if (!isOpen) return null;

    return (
        <nav className="w-full h-full overflow-y-auto py-4 pr-2" aria-label="Admin settings navigation">
            <div className="space-y-1">
                {NAV_SECTIONS.map((section) => {
                    const isExpanded = expandedMap[section.id] ?? false;
                    const isActive = section.id === activeSectionId;
                    return (
                        <div key={section.id}>
                            <button type="button" onClick={() => handleToggle(section.id)}
                                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors ${isActive ? 'text-foreground bg-overlay/40' : 'text-secondary hover:text-foreground hover:bg-overlay/20'}`}
                                aria-expanded={isExpanded}>
                                <span className="flex items-center gap-3 font-semibold text-sm">{section.icon}{section.label}</span>
                                <svg className={`w-4 h-4 text-dim transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                            <div className={`overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                                <div className="ml-5 pl-3 border-l border-edge/50 mt-1 mb-2 space-y-0.5">
                                    {section.children.map((child) => (
                                        <Link key={child.to} to={child.to} onClick={onNavigate}
                                            className={`block px-3 py-2 rounded-lg text-sm transition-colors ${location.pathname === child.to ? 'text-emerald-400 bg-emerald-500/10 font-medium' : 'text-muted hover:text-foreground hover:bg-overlay/20'}`}>
                                            {child.label}
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </nav>
    );
}
