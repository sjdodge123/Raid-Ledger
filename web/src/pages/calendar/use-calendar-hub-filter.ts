/**
 * ROK-1893 P4 (R24) — the calendar's Hubs filter: session-only (a plain,
 * unpersisted store), client-side. `CalendarView` registers the hubs of the
 * events it loaded and drops hidden ones; the Filters funnel lists them.
 */
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { EventHubRef, EventResponseDto } from '@raid-ledger/contract';

export const NO_HUB = 'none';
/** A hub id, or `NO_HUB` for untagged events. */
export type HubKey = number | typeof NO_HUB;

interface HubFilterState {
    /** Every hub seen in loaded events this session, by name. */
    known: EventHubRef[];
    hidden: ReadonlySet<HubKey>;
    addKnown: (hubs: EventHubRef[]) => void;
    toggle: (key: HubKey) => void;
    showAll: () => void;
    /** The viewer changed (logout, login, impersonation): forget the hubs and hidden set. */
    clearViewer: () => void;
}

export const useCalendarHubFilterStore = create<HubFilterState>((set) => ({
    known: [],
    hidden: new Set<HubKey>(),
    addKnown: (hubs) => set((s) => {
        // Dedupe within the batch too: several loaded events share a hub.
        const byId = new Map(s.known.map((k) => [k.id, k]));
        for (const h of hubs) if (!byId.has(h.id)) byId.set(h.id, h);
        return byId.size === s.known.length ? s : { known: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)) };
    }),
    toggle: (key) => set((s) => {
        const hidden = new Set(s.hidden);
        if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
        return { hidden };
    }),
    showAll: () => set({ hidden: new Set<HubKey>() }),
    clearViewer: () => set({ known: [], hidden: new Set<HubKey>() }),
}));

export const hubKeyOf = (e: Pick<EventResponseDto, 'hub'>): HubKey => e.hub?.id ?? NO_HUB;

/** `CalendarView`: remember the loaded events' hubs, return the events whose hub is shown. */
export function useHubFilteredEvents<T extends { resource: EventResponseDto }>(events: T[]): T[] {
    const addKnown = useCalendarHubFilterStore((s) => s.addKnown);
    const hidden = useCalendarHubFilterStore((s) => s.hidden);
    useEffect(() => {
        addKnown(events.flatMap((e) => (e.resource.hub ? [e.resource.hub] : [])));
    }, [events, addKnown]);
    return useMemo(() => (hidden.size === 0 ? events : events.filter((e) => !hidden.has(hubKeyOf(e.resource)))), [events, hidden]);
}

export interface CalendarHubFilter extends Omit<HubFilterState, 'addKnown' | 'clearViewer'> {
    /** Hidden options (known hubs + "No hub") — the Filters badge. */
    hiddenCount: number;
}

/** The funnel's view of the Hubs filter. */
export function useCalendarHubFilter(): CalendarHubFilter {
    const { known, hidden, toggle, showAll } = useCalendarHubFilterStore();
    const options: HubKey[] = [NO_HUB, ...known.map((h) => h.id)];
    const hiddenCount = options.filter((k) => hidden.has(k)).length;
    return { known, hidden, toggle, showAll, hiddenCount };
}
