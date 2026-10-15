import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { clearRegistry, registerPlugin } from './plugin-registry';
import { usePluginStore } from '../stores/plugin-store';
import { useCalendarLayerFilterStore } from '../stores/calendar-layer-filter-store';
import { useCalendarLayers } from './calendar-layer';
import type { CalendarLayer, CalendarLayerItem, CalendarLayerRange } from './calendar-layer';

/** Signed-out (null) by default, as before ROK-1775's hydration gate. */
const session = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('../hooks/use-auth', () => ({ getAuthToken: () => session.token }));

const RANGE: CalendarLayerRange = { from: '2026-10-12T00:00:00-04:00', to: '2026-10-19T00:00:00-04:00' };
const BADGE = { icon: 'x', color: 'gray', label: 'X' };

function windowItem(id: string): CalendarLayerItem {
    return { kind: 'window', id, start: RANGE.from, end: RANGE.to, label: `Up · ${id}`, ariaLabel: id };
}

/** A fake layer whose `useItems` is a REAL hook (useState), so a hook-order change would throw. */
function fakeLayer(key: string, items: readonly CalendarLayerItem[], filterLabel?: string) {
    const spy = vi.fn<CalendarLayer['useItems']>();
    const layer: CalendarLayer = {
        key,
        ...(filterLabel !== undefined ? { filterLabel } : {}),
        useItems(range, selectedGames, enabled) {
            const [stable] = useState(items);
            spy(range, selectedGames, enabled);
            return enabled ? stable : [];
        },
    };
    return { layer, spy };
}

function setActive(slugs: string[]) {
    act(() => usePluginStore.getState().setActiveSlugs(slugs));
}

/** Fresh registry with plugin `a` (one item) and plugin `b` (two items), none active. */
function setupTwoLayers() {
    clearRegistry();
    usePluginStore.setState({ activeSlugs: new Set<string>(), initialized: false });
    const a = fakeLayer('a:layer', [windowItem('a1')]);
    const b = fakeLayer('b:layer', [windowItem('b1'), windowItem('b2')]);
    registerPlugin('a', BADGE).registerCalendarLayer(a.layer);
    registerPlugin('b', BADGE).registerCalendarLayer(b.layer);
    return { a, b };
}

describe('useCalendarLayers — merge + gating (ROK-1774)', () => {
    let a: ReturnType<typeof fakeLayer>;
    let b: ReturnType<typeof fakeLayer>;

    beforeEach(() => {
        ({ a, b } = setupTwoLayers());
    });

    it('returns only the active plugin\'s items and calls the inactive layer with enabled=false', () => {
        setActive(['a']);
        const { result } = renderHook(() => useCalendarLayers(RANGE, undefined, true));
        expect(result.current.map((i) => i.id)).toEqual(['a1']);
        expect(a.spy).toHaveBeenLastCalledWith(RANGE, undefined, true);
        expect(b.spy).toHaveBeenLastCalledWith(RANGE, undefined, false);
    });

    it('swaps items when activeSlugs flips, with no hook-order error', () => {
        setActive(['a']);
        const { result } = renderHook(() => useCalendarLayers(RANGE, undefined, true));
        expect(result.current.map((i) => i.id)).toEqual(['a1']);
        setActive(['b']);
        expect(result.current.map((i) => i.id)).toEqual(['b1', 'b2']);
        expect(a.spy).toHaveBeenLastCalledWith(RANGE, undefined, false);
        expect(b.spy).toHaveBeenLastCalledWith(RANGE, undefined, true);
    });

    it('merges every active layer in registration order', () => {
        setActive(['b', 'a']);
        const { result } = renderHook(() => useCalendarLayers(RANGE, undefined, true));
        expect(result.current.map((i) => i.id)).toEqual(['a1', 'b1', 'b2']);
    });

    it('viewEnabled=false returns [] and calls every layer with enabled=false', () => {
        setActive(['a', 'b']);
        const { result } = renderHook(() => useCalendarLayers(RANGE, undefined, false));
        expect(result.current).toEqual([]);
        expect(a.spy).toHaveBeenLastCalledWith(RANGE, undefined, false);
        expect(b.spy).toHaveBeenLastCalledWith(RANGE, undefined, false);
    });

    it('passes selectedGames through to each layer unchanged', () => {
        setActive(['a']);
        const games = new Set(['valheim']);
        renderHook(() => useCalendarLayers(RANGE, games, true));
        expect(a.spy).toHaveBeenLastCalledWith(RANGE, games, true);
    });

});

describe('useCalendarLayers — result shape (ROK-1774)', () => {
    beforeEach(() => {
        setupTwoLayers();
    });

    it('drops items a layer returns while disabled', () => {
        const leaky: CalendarLayer = { key: 'c:layer', useItems: () => [windowItem('c1')] };
        registerPlugin('c', BADGE).registerCalendarLayer(leaky);
        const { result } = renderHook(() => useCalendarLayers(RANGE, undefined, true));
        expect(result.current).toEqual([]);
    });

    it('keeps one empty-result identity across renders', () => {
        const { result, rerender } = renderHook(() => useCalendarLayers(RANGE, undefined, true));
        const first = result.current;
        rerender();
        expect(result.current).toBe(first);
    });

    it('keeps the merged array identity across rerenders while layer results are unchanged', () => {
        setActive(['a', 'b']);
        const { result, rerender } = renderHook(() => useCalendarLayers(RANGE, undefined, true));
        const first = result.current;
        expect(first.map((i) => i.id)).toEqual(['a1', 'b1', 'b2']);
        rerender();
        expect(result.current).toBe(first);
    });

    it('returns a new merged array when a layer result changes', () => {
        setActive(['a']);
        const { result } = renderHook(() => useCalendarLayers(RANGE, undefined, true));
        const first = result.current;
        setActive(['a', 'b']);
        expect(result.current).not.toBe(first);
        expect(result.current.map((i) => i.id)).toEqual(['a1', 'b1', 'b2']);
    });

    it('returns [] with no layers registered', () => {
        clearRegistry();
        setActive(['a']);
        const { result } = renderHook(() => useCalendarLayers(RANGE, undefined, true));
        expect(result.current).toEqual([]);
    });
});

describe('useCalendarLayers — registration freeze (ROK-1774)', () => {
    beforeEach(() => {
        setupTwoLayers();
    });

    it('throws in dev when a NEW layer key registers after the first render', () => {
        renderHook(() => useCalendarLayers(RANGE, undefined, true));
        const late = fakeLayer('late:layer', [windowItem('late1')]);
        expect(() => registerPlugin('late', BADGE).registerCalendarLayer(late.layer))
            .toThrow('Calendar layer "late:layer" was registered after the calendar first rendered');
    });

    it('still lets an already-registered key be replaced after the first render (HMR)', () => {
        renderHook(() => useCalendarLayers(RANGE, undefined, true));
        const again = fakeLayer('a:layer', [windowItem('a2')]);
        expect(() => registerPlugin('a', BADGE).registerCalendarLayer(again.layer)).not.toThrow();
    });

    it('ignores a late NEW layer key in prod', () => {
        vi.stubEnv('DEV', false);
        try {
            setActive(['a', 'late']);
            const { result, rerender } = renderHook(() => useCalendarLayers(RANGE, undefined, true));
            registerPlugin('late', BADGE).registerCalendarLayer(fakeLayer('late:layer', [windowItem('late1')]).layer);
            rerender();
            expect(result.current.map((i) => i.id)).toEqual(['a1']);
        } finally {
            vi.unstubAllEnvs();
        }
    });
});

describe('useCalendarLayers — viewer-hidden layers (ROK-1775)', () => {
    it('calls a layer the viewer hid with enabled=false and drops its items', () => {
        const { a, b } = setupTwoLayers();
        setActive(['a', 'b']);
        act(() => useCalendarLayerFilterStore.getState().loadHiddenLayers(['b:layer']));
        const { result } = renderHook(() => useCalendarLayers(RANGE, undefined, true));
        expect(result.current.map((i) => i.id)).toEqual(['a1']);
        expect(a.spy).toHaveBeenLastCalledWith(RANGE, undefined, true);
        expect(b.spy).toHaveBeenLastCalledWith(RANGE, undefined, false);
        act(() => useCalendarLayerFilterStore.getState()._reset());
        expect(b.spy).toHaveBeenLastCalledWith(RANGE, undefined, true);
        expect(result.current.map((i) => i.id)).toEqual(['a1', 'b1', 'b2']);
    });
});

describe('useCalendarLayers — cold-load hydration gate (ROK-1775)', () => {
    /** `a` is a checkbox layer (has a filterLabel); `b` has none. */
    function setupGated() {
        clearRegistry();
        usePluginStore.setState({ activeSlugs: new Set<string>(), initialized: false });
        const a = fakeLayer('a:layer', [windowItem('a1')], 'Server schedules');
        const b = fakeLayer('b:layer', [windowItem('b1')]);
        registerPlugin('a', BADGE).registerCalendarLayer(a.layer);
        registerPlugin('b', BADGE).registerCalendarLayer(b.layer);
        return { a, b };
    }

    beforeEach(() => {
        session.token = null;
        useCalendarLayerFilterStore.getState()._reset();
    });

    it('a signed-in viewer\'s checkbox layer makes no request before hydration', () => {
        session.token = 'token';
        const { a, b } = setupGated();
        setActive(['a', 'b']);
        const { result } = renderHook(() => useCalendarLayers(RANGE, undefined, true));
        expect(a.spy).not.toHaveBeenCalledWith(RANGE, undefined, true);
        expect(b.spy).toHaveBeenLastCalledWith(RANGE, undefined, true); // no checkbox → not held
        expect(result.current.map((i) => i.id)).toEqual(['b1']);
    });

    it('after hydration a hidden layer still makes no request and a visible one fetches', () => {
        session.token = 'token';
        const { a } = setupGated();
        const c = fakeLayer('c:layer', [windowItem('c1')], 'Other');
        registerPlugin('c', BADGE).registerCalendarLayer(c.layer);
        setActive(['a', 'c']);
        const { result } = renderHook(() => useCalendarLayers(RANGE, undefined, true));
        act(() => useCalendarLayerFilterStore.getState().loadHiddenLayers(['c:layer']));
        expect(a.spy).toHaveBeenLastCalledWith(RANGE, undefined, true);
        expect(c.spy).not.toHaveBeenCalledWith(RANGE, undefined, true);
        expect(result.current.map((i) => i.id)).toEqual(['a1']);
    });

    it('a signed-out viewer is not held: checkbox layers fetch without hydration', () => {
        const { a } = setupGated();
        setActive(['a']);
        renderHook(() => useCalendarLayers(RANGE, undefined, true));
        expect(a.spy).toHaveBeenLastCalledWith(RANGE, undefined, true);
    });
});
