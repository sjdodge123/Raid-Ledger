import { MobilePageToolbar } from '../layout/mobile-page-toolbar';

interface GamesMobileToolbarProps {
    activeTab: 'discover' | 'manage';
    onTabChange: (tab: 'discover' | 'manage') => void;
    /** Whether to show the Manage tab (admin-only feature) */
    showManageTab?: boolean;
}

/**
 * Mobile toolbar for Games page — Discover/Manage segmented control (ROK-329).
 * When showManageTab is false, displays a non-interactive "Discover" label.
 */
export function GamesMobileToolbar({ activeTab, onTabChange, showManageTab = false }: GamesMobileToolbarProps) {
    const tabs = showManageTab
        ? (['discover', 'manage'] as const)
        : (['discover'] as const);

    // If only one tab, don't render a segmented control — just a label
    if (tabs.length === 1) {
        return null;
    }

    return (
        <MobilePageToolbar aria-label="Games navigation">
            <div className="flex rounded-lg bg-panel/50 border border-edge p-1 w-fit">
                {tabs.map((tab) => (
                    <button
                        key={tab}
                        type="button"
                        onClick={() => onTabChange(tab)}
                        className={`px-6 py-2.5 rounded-md text-sm font-medium transition-colors ${activeTab === tab
                            ? 'bg-overlay text-foreground'
                            : 'text-muted hover:text-foreground'
                            }`}
                    >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>
        </MobilePageToolbar>
    );
}
