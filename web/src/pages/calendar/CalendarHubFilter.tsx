/**
 * ROK-1893 P4 (R24) — the "Hubs" group of the calendar Filters funnel, between
 * Games and Layers (wireframe `dev/hub-community-wireframes/calendar-bits.tsx`
 * `HubsSection`): one `Checkbox` per hub in the loaded events plus "No hub",
 * checked = shown. Session-only. Renders nothing until an event carries a hub.
 */
import type { JSX } from 'react';
import { Checkbox } from '../../components/ui/checkbox';
import { NO_HUB, type CalendarHubFilter } from './use-calendar-hub-filter';

export function CalendarHubFilterList({ hubs }: { hubs: CalendarHubFilter }): JSX.Element | null {
    if (hubs.known.length === 0) return null;
    return (
        <fieldset data-testid="calendar-hub-toggles" className="space-y-1">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Hubs</legend>
            {hubs.known.map((h) => (
                <Checkbox key={h.id} data-testid={`calendar-hub-toggle-${h.id}`} label={h.name}
                    checked={!hubs.hidden.has(h.id)} onChange={() => hubs.toggle(h.id)} />
            ))}
            <Checkbox data-testid={`calendar-hub-toggle-${NO_HUB}`} label="No hub"
                checked={!hubs.hidden.has(NO_HUB)} onChange={() => hubs.toggle(NO_HUB)} />
        </fieldset>
    );
}
