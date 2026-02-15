import { MobilePageToolbar } from '../layout/mobile-page-toolbar';

interface GamesMobileToolbarProps {
    activeTab: 'discover' | 'library';
    onTabChange: (tab: 'discover' | 'library') => void;
    /** Whether to show the Library tab (admin-only feature) */
    showLibraryTab?: boolean;
}

/**
 * Mobile toolbar for Games page — Discover/Library segmented control (ROK-329).
 * When showLibraryTab is false, displays a non-interactive "Discover" label.
 */
export function GamesMobileToolbar({ activeTab, onTabChange, showLibraryTab = false }: GamesMobileToolbarProps) {
    const tabs = showLibraryTab
        ? (['discover', 'library'] as const)
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
