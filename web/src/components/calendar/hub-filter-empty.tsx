/**
 * ROK-1893 — the filter-aware empty line shared by the grid views and the phone agenda.
 * While the Hubs filter hides something, an empty calendar says so and offers to show every hub.
 */
import type { ReactElement } from 'react';
import { useCalendarHubFilterStore } from '../../pages/calendar/use-calendar-hub-filter';

/** True while the Hubs filter hides at least one hub. */
export function useHubFilterActive(): boolean {
    return useCalendarHubFilterStore((st) => st.hidden.size > 0);
}

interface HubFilterEmptyProps {
    /** Classes for the message line — each view keeps its own empty-state type treatment. */
    messageClassName?: string;
}

/** "No events match your filters" + a "Show all hubs" button that clears the hub filter. */
export function HubFilterEmpty({ messageClassName }: HubFilterEmptyProps): ReactElement {
    const showAllHubs = useCalendarHubFilterStore((st) => st.showAll);
    return (
        <>
            <p className={messageClassName}>No events match your filters</p>
            <button type="button" onClick={showAllHubs} className="empty-cta">Show all hubs</button>
        </>
    );
}
