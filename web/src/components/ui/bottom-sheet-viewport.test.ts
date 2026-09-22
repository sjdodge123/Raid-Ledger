/** ROK-1640/ROK-1641: the sheet is sized from the VISIBLE viewport (visualViewport). */
import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { toVisiblePx, useVisibleViewport } from './bottom-sheet-viewport';

class FakeVisualViewport extends EventTarget {
    height = 1000;
    offsetTop = 0;
}

const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');

function installVisualViewport(vv: FakeVisualViewport | undefined) {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
}

describe('useVisibleViewport', () => {
    afterEach(() => {
        if (original) Object.defineProperty(window, 'visualViewport', original);
        else installVisualViewport(undefined);
    });

    it('reads visualViewport and follows its resize and scroll events', () => {
        const vv = new FakeVisualViewport();
        installVisualViewport(vv);
        const { result } = renderHook(() => useVisibleViewport());
        expect(result.current).toEqual({ height: 1000, offsetTop: 0 });

        act(() => { vv.height = 880; vv.dispatchEvent(new Event('resize')); });
        expect(result.current.height).toBe(880);

        act(() => { vv.offsetTop = 40; vv.dispatchEvent(new Event('scroll')); });
        expect(result.current.offsetTop).toBe(40);
    });

    it('falls back to window.innerHeight when visualViewport is missing', () => {
        installVisualViewport(undefined);
        const { result } = renderHook(() => useVisibleViewport());
        expect(result.current).toEqual({ height: window.innerHeight, offsetTop: 0 });
    });
});

describe('toVisiblePx', () => {
    it('turns a vh or dvh cap into px of the visible height', () => {
        expect(toVisiblePx('60vh', 1000)).toBe('600px');
        expect(toVisiblePx('95dvh', 1106)).toBe('1050px');
    });

    it('passes other units, and an unknown height, through unchanged', () => {
        expect(toVisiblePx('420px', 1000)).toBe('420px');
        expect(toVisiblePx('50%', 1000)).toBe('50%');
        expect(toVisiblePx('60vh', 0)).toBe('60vh');
    });
});
