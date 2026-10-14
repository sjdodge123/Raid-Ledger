import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { clearRegistry, registerPlugin } from './plugin-registry';
import { usePluginStore } from '../stores/plugin-store';
import { useCalendarLayers } from './calendar-layer';
import type { CalendarLayer, CalendarLayerItem, CalendarLayerRange } from './calendar-layer';

const RANGE: CalendarLayerRange = { from: '2026-10-12T00:00:00-04:00', to: '2026-10-19T00:00:00-04:00' };
const BADGE = { icon: 'x', color: 'gray', label: 'X' };

function windowItem(id: string): CalendarLayerItem {
    return { kind: 'window', id, start: RANGE.from, end: RANGE.to, label: `Up · ${id}`, ariaLabel: id };
}

/** A fake layer whose `useItems` is a REAL hook (useState), so a hook-order change would throw. */
function fakeLayer(key: string, items: readonly CalendarLayerItem[]) {
    const spy = vi.fn<CalendarLayer['useItems']>();
    const layer: CalendarLayer = {
        key,
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

describe('useCalendarLayers — merge + gating (ROK-1774)', () => {
    let a: ReturnType<typeof fakeLayer>;
    let b: ReturnType<typeof fakeLayer>;

    beforeEach(() => {
        clearRegistry();
        usePluginStore.setState({ activeSlugs: new Set<string>(), initialized: false });
        a = fakeLayer('a:layer', [windowItem('a1')]);
        b = fakeLayer('b:layer', [windowItem('b1'), windowItem('b2')]);
        registerPlugin('a', BADGE).registerCalendarLayer(a.layer);
        registerPlugin('b', BADGE).registerCalendarLayer(b.layer);
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

    it('returns [] with no layers registered', () => {
        clearRegistry();
        setActive(['a']);
        const { result } = renderHook(() => useCalendarLayers(RANGE, undefined, true));
        expect(result.current).toEqual([]);
    });
});
