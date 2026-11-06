/**
 * ROK-2030 — `useAnchoredPopup` keeps a `fixed` popup on screen: below the
 * anchor when it fits, flipped above when it does not, clamped when neither
 * side fits (the hub Manage menu's "Remove" used to land below the viewport).
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { maxHeightWithin, placeTop, placeWithin, useAnchoredPopup } from './use-anchored-popup';

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

// Bug (TECH-DEBT 2026-11-05): a Combobox inside a short Modal portals into the
// `overflow-hidden` dialog, so placement must use the dialog's rect, not the viewport's.
describe('placeWithin (container bounds)', () => {
    const dialog = { top: 100, bottom: 400 };

    it('flips up when there is no room below inside the container, though the viewport has room', () => {
        expect(placeTop({ top: 300, bottom: 336 }, 120, 800)).toBe(340);
        expect(placeWithin({ top: 300, bottom: 336 }, 120, dialog)).toBe(176);
    });

    it('opens below when the popup fits inside the container', () => {
        expect(placeWithin({ top: 150, bottom: 186 }, 120, dialog)).toBe(190);
    });

    it('matches placeTop when the bounds are the viewport', () => {
        expect(placeWithin({ top: 50, bottom: 86 }, 160, { top: 0, bottom: 200 })).toBe(32);
    });
});

describe('maxHeightWithin', () => {
    it('caps the popup to the roomier side of the anchor inside the container', () => {
        // below: 400 - 8 - (186 + 4) = 202; above: 150 - 4 - (100 + 8) = 38
        expect(maxHeightWithin({ top: 150, bottom: 186 }, { top: 100, bottom: 400 })).toBe(202);
        // below: 392 - 340 = 52; above: 296 - 108 = 188
        expect(maxHeightWithin({ top: 300, bottom: 336 }, { top: 100, bottom: 400 })).toBe(188);
    });

    it('never goes negative', () => {
        expect(maxHeightWithin({ top: 100, bottom: 136 }, { top: 100, bottom: 140 })).toBe(0);
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

    it('places and caps a popup portalled into a dialog against the dialog rect, not the viewport', () => {
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
        const dialog = withRect({ top: 100, bottom: 400, left: 0, right: 600, width: 600, height: 300 });
        const popup = withRect({ width: 200, height: 120 });
        dialog.appendChild(popup);
        document.body.appendChild(dialog);
        const anchorRef = { current: withRect({ top: 300, bottom: 336, left: 10, right: 210, width: 200 }) };
        const { result } = renderHook(() => useAnchoredPopup(anchorRef, { current: popup }, true, () => undefined));
        expect(result.current).toEqual({ top: 176, left: 10, width: 200, maxHeight: 188 });
        dialog.remove();
    });

    it('leaves a <body>-portalled popup uncapped (viewport placement unchanged)', () => {
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
        const popup = withRect({ width: 200, height: 120 });
        document.body.appendChild(popup);
        const anchorRef = { current: withRect({ top: 300, bottom: 336, left: 10, right: 210, width: 200 }) };
        const { result } = renderHook(() => useAnchoredPopup(anchorRef, { current: popup }, true, () => undefined));
        expect(result.current).toStrictEqual({ top: 340, left: 10, width: 200 });
        popup.remove();
    });
});
