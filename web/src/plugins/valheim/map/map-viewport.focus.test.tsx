import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MapViewport } from './map-viewport';
import { revealShift, FOCUS_PAN_MARGIN } from './use-map-viewport';

const VIEW = { width: 400, height: 300 };

function rect(left: number, top: number, w: number, h: number): DOMRect {
    return DOMRect.fromRect({ x: left, y: top, width: w, height: h });
}

/** jsdom's scrollLeft/Top are inert; back them so a native scroll is observable. */
function scrollable(el: HTMLElement): void {
    for (const key of ['scrollLeft', 'scrollTop'] as const) {
        let value = 0;
        Object.defineProperty(el, key, {
            configurable: true,
            get: () => value,
            set: (v: number) => {
                value = v;
            },
        });
    }
}

function renderWithPin() {
    render(
        <MapViewport contentSize={256} label="Valheim map">
            {() => <button type="button">Far pin</button>}
        </MapViewport>,
    );
    const app = screen.getByRole('application', { name: 'Valheim map' });
    const pin = screen.getByRole('button', { name: 'Far pin' });
    const layer = screen.getByTestId('map-texture-layer');
    return { app, pin, layer };
}

describe('MapViewport focus never scrolls the surface (Codex r5 P2)', () => {
    beforeEach(() => {
        const proto = HTMLElement.prototype;
        vi.spyOn(proto, 'clientWidth', 'get').mockReturnValue(VIEW.width);
        vi.spyOn(proto, 'clientHeight', 'get').mockReturnValue(VIEW.height);
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('focusing an offscreen pin resets the native scroll and pans the transform instead', () => {
        const { app, pin, layer } = renderWithPin();
        fireEvent.keyDown(app, { key: '+' });
        fireEvent.keyDown(app, { key: '+' });
        fireEvent.keyDown(app, { key: '+' });
        scrollable(app);
        vi.spyOn(app, 'getBoundingClientRect').mockReturnValue(
            rect(0, 0, VIEW.width, VIEW.height),
        );
        vi.spyOn(pin, 'getBoundingClientRect').mockReturnValue(
            rect(500, 350, 20, 20),
        );
        const before = layer.style.transform;
        // What the browser does when Tab reaches a pin past the right/bottom edge.
        app.scrollLeft = 120;
        app.scrollTop = 70;
        fireEvent.scroll(app);
        fireEvent.focus(pin);
        expect({ left: app.scrollLeft, top: app.scrollTop }).toEqual({
            left: 0,
            top: 0,
        });
        expect(layer.style.transform).not.toBe(before);
    });

    it('focusing a visible pin leaves the transform alone', () => {
        const { app, pin, layer } = renderWithPin();
        fireEvent.keyDown(app, { key: '+' });
        vi.spyOn(app, 'getBoundingClientRect').mockReturnValue(
            rect(0, 0, VIEW.width, VIEW.height),
        );
        vi.spyOn(pin, 'getBoundingClientRect').mockReturnValue(
            rect(100, 100, 20, 20),
        );
        const before = layer.style.transform;
        fireEvent.focus(pin);
        expect(layer.style.transform).toBe(before);
    });

    it('revealShift moves an edge-crossing box just inside the margin', () => {
        expect(revealShift(100, 120, 400)).toBe(0);
        expect(revealShift(500, 520, 400)).toBe(400 - FOCUS_PAN_MARGIN - 520);
        expect(revealShift(-30, -10, 400)).toBe(FOCUS_PAN_MARGIN + 30);
    });
});
