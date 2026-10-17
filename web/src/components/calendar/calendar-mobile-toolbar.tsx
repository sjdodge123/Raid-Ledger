import { MobilePageToolbar } from '../layout/mobile-page-toolbar';

export type CalendarViewMode = 'schedule' | 'month' | 'day';

interface CalendarMobileToolbarProps {
    activeView: CalendarViewMode;
    onViewChange: (view: CalendarViewMode) => void;
}

const VIEWS: CalendarViewMode[] = ['schedule', 'month', 'day'];

/**
 * Mobile toolbar for Calendar page — segmented control for view switching (ROK-329).
 */
export function CalendarMobileToolbar({ activeView, onViewChange }: CalendarMobileToolbarProps) {
    return (
        <MobilePageToolbar aria-label="Calendar view switcher">
            {/* Segmented control — 44px min height */}
            <div className="flex rounded-lg bg-panel/50 border border-edge p-1">
                {VIEWS.map((view) => (
                    <button
                        key={view}
                        type="button"
                        onClick={() => onViewChange(view)}
                        className={`flex-1 px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${activeView === view
                            ? 'bg-overlay text-foreground'
                            : 'text-muted hover:text-foreground'
                            }`}
                    >
                        {view.charAt(0).toUpperCase() + view.slice(1)}
                    </button>
                ))}
            </div>
        </MobilePageToolbar>
    );
}
