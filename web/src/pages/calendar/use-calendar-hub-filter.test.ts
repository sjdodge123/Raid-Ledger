/** ROK-1893 P4 V6 — the session-only Hubs filter hides a hub's events, and "No hub" hides untagged ones. */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { EventResponseDto } from '@raid-ledger/contract';
import { createMockEvent } from '../../test/factories';
import { NO_HUB, useCalendarHubFilter, useCalendarHubFilterStore, useHubFilteredEvents } from './use-calendar-hub-filter';

const CREW = { id: 7, name: 'Seed Crew', kind: 'game_community' as const };
const SOLO = { id: 3, name: 'Alpha Solo', kind: 'game_community' as const };

const row = (id: number, hub: EventResponseDto['hub']): { id: number; resource: EventResponseDto } =>
    ({ id, resource: createMockEvent({ id, hub }) });

const EVENTS = [row(1, CREW), row(2, null), row(3, SOLO), row(4, CREW)];

function useBoth(events: typeof EVENTS) {
    return { visible: useHubFilteredEvents(events), hubs: useCalendarHubFilter() };
}

const idsOf = (rows: Array<{ id: number }>): number[] => rows.map((r) => r.id);

describe('useHubFilteredEvents + useCalendarHubFilter (ROK-1893 P4)', () => {
    beforeEach(() => {
        useCalendarHubFilterStore.setState({ known: [], hidden: new Set() });
    });

    it('lists each loaded hub once, by name, and shows every event by default', () => {
        const { result } = renderHook(() => useBoth(EVENTS));
        expect(result.current.hubs.known.map((h) => h.name)).toEqual(['Alpha Solo', 'Seed Crew']);
        expect(idsOf(result.current.visible)).toEqual([1, 2, 3, 4]);
        expect(result.current.hubs.hiddenCount).toBe(0);
    });

    it('unticking a hub hides only that hub\'s events and counts one hidden', () => {
        const { result } = renderHook(() => useBoth(EVENTS));
        act(() => { result.current.hubs.toggle(CREW.id); });
        expect(idsOf(result.current.visible)).toEqual([2, 3]);
        expect(result.current.hubs.hiddenCount).toBe(1);
        act(() => { result.current.hubs.toggle(CREW.id); });
        expect(idsOf(result.current.visible)).toEqual([1, 2, 3, 4]);
    });

    it('"No hub" hides untagged events; showAll restores everything', () => {
        const { result } = renderHook(() => useBoth(EVENTS));
        act(() => { result.current.hubs.toggle(NO_HUB); result.current.hubs.toggle(SOLO.id); });
        expect(idsOf(result.current.visible)).toEqual([1, 4]);
        expect(result.current.hubs.hiddenCount).toBe(2);
        act(() => { result.current.hubs.showAll(); });
        expect(idsOf(result.current.visible)).toEqual([1, 2, 3, 4]);
    });

    it('keeps a hub listed after its events leave the loaded range (still re-tickable)', () => {
        const { result, rerender } = renderHook(({ ev }) => useBoth(ev), { initialProps: { ev: EVENTS } });
        act(() => { result.current.hubs.toggle(SOLO.id); });
        rerender({ ev: [row(9, null)] });
        expect(result.current.hubs.known.map((h) => h.id)).toEqual([SOLO.id, CREW.id]);
        expect(result.current.hubs.hiddenCount).toBe(1);
    });
});

describe('useCalendarHubFilterStore.clearViewer (ROK-1893 P4)', () => {
    it('forgets the departing viewer\'s hubs and hidden set', () => {
        const store = useCalendarHubFilterStore.getState();
        store.addKnown([{ id: 7, name: 'BG3 Friends', kind: 'game_community' }]);
        store.toggle(7);
        store.toggle(NO_HUB);
        useCalendarHubFilterStore.getState().clearViewer();
        const after = useCalendarHubFilterStore.getState();
        expect({ known: after.known, hidden: [...after.hidden] }).toEqual({ known: [], hidden: [] });
    });
});
