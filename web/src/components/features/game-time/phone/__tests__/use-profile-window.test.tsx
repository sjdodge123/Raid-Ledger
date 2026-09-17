/**
 * `useProfileWindow` measuring a HIDDEN day slot (ROK-1585 risk 2).
 *
 * The phone drawer's away view keeps the week editor mounted under `hidden`
 * (display:none) so draft edits survive the swap. A display:none slot reports
 * `clientHeight === 0`; recording that collapsed the window to the minimum rows
 * until the next resize. A zero reading must keep the last real height.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { JSX } from 'react';
import { act, render, screen } from '@testing-library/react';
import { useProfileWindow } from '../use-profile-window';
import { PROFILE_HOURS } from '../phone-week-check.helpers';

let slotHeight = 0;
let observed: (() => void) | null = null;

class FakeResizeObserver {
    constructor(cb: () => void) { observed = cb; }
    observe(): void {}
    disconnect(): void {}
}

function Probe(): JSX.Element {
    const { slotRef, hours } = useProfileWindow(PROFILE_HOURS, []);
    return <div ref={slotRef} data-testid="probe" data-rows={hours.length} />;
}

const rows = (): number => Number(screen.getByTestId('probe').dataset.rows);

beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => slotHeight });
});

afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

describe('useProfileWindow — a hidden slot keeps its last height', () => {
    it('fits ten 44px rows into a 460px slot and keeps them while the slot is display:none', () => {
        slotHeight = 460;
        render(<Probe />);
        expect(rows()).toBe(10);

        slotHeight = 0; // the away view hid the editor
        act(() => observed?.());
        expect(rows()).toBe(10);
    });

    it('still follows a real resize', () => {
        slotHeight = 460;
        render(<Probe />);
        slotHeight = 660; // fifteen rows
        act(() => observed?.());
        expect(rows()).toBe(15);
    });
});
