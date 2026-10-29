/**
 * ROK-2030 — `useAnchoredPopup` keeps a `fixed` popup on screen: below the
 * anchor when it fits, flipped above when it does not, clamped when neither
 * side fits (the hub Manage menu's "Remove" used to land below the viewport).
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { placeTop, useAnchoredPopup } from './use-anchored-popup';

const realInnerHeight = window.innerHeight;

afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: realInnerHeight, configurable: true });
});

function withRect(rect: Partial<DOMRect>): HTMLElement {
    const el = document.createElement('div');
    const full = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, ...rect };
    el.getBoundingClientRect = () => ({ ...full, toJSON: () => full });
    return el;
}

describe('placeTop', () => {
    it('opens below the anchor (4px gap) when the popup fits', () => {
        expect(placeTop({ top: 64, bottom: 100 }, 120, 600)).toBe(104);
    });

    it('flips above the anchor when the popup would cross the viewport bottom', () => {
        expect(placeTop({ top: 500, bottom: 536 }, 120, 600)).toBe(376);
    });

    it('clamps into the viewport when the popup fits neither side', () => {
        expect(placeTop({ top: 50, bottom: 86 }, 160, 200)).toBe(32);
    });

    it('pins the top edge when the popup is taller than the viewport', () => {
        expect(placeTop({ top: 50, bottom: 86 }, 400, 200)).toBe(8);
    });
});

describe('useAnchoredPopup', () => {
    function positionFor(anchor: Partial<DOMRect>, popupHeight: number, viewportHeight: number) {
        Object.defineProperty(window, 'innerHeight', { value: viewportHeight, configurable: true });
        const anchorRef = { current: withRect(anchor) };
        const popupRef = { current: withRect({ width: 176, height: popupHeight }) };
        const { result } = renderHook(() => useAnchoredPopup(anchorRef, popupRef, true, () => undefined, 'end'));
        return result.current;
    }

    it("flips a menu measured from its rendered height above a trigger near the viewport's bottom", () => {
        const pos = positionFor({ top: 700, bottom: 736, left: 900, right: 936, width: 36 }, 168, 768);
        expect(pos).toEqual({ top: 528, left: 760, width: 36 });
    });

    it('keeps a menu with room below under its trigger', () => {
        const pos = positionFor({ top: 200, bottom: 236, left: 900, right: 936, width: 36 }, 168, 768);
        expect(pos).toEqual({ top: 240, left: 760, width: 36 });
    });
});
