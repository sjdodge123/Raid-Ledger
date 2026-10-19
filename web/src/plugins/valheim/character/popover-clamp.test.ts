/** ROK-1836 — the desktop item popover stays inside the viewport (Codex P2). */
import { describe, it, expect } from 'vitest';
import { clampPopover } from './popover-clamp';

const viewport = { width: 1280, height: 800 };
const size = { width: 288, height: 200 };

describe('clampPopover', () => {
    it('opens below the anchor at its left edge when it fits', () => {
        const anchor = { left: 100, top: 100, bottom: 144 };
        expect(clampPopover({ anchor, size, viewport })).toEqual({
            left: 100,
            top: 148,
        });
    });
    it('shifts left so a rightmost-column popover stays on screen', () => {
        const anchor = { left: 1250, top: 100, bottom: 144 };
        expect(clampPopover({ anchor, size, viewport }).left).toBe(984);
    });
    it('flips above the anchor when there is no room below', () => {
        const anchor = { left: 100, top: 700, bottom: 744 };
        expect(clampPopover({ anchor, size, viewport }).top).toBe(496);
    });
    it('never goes past the top margin when neither side fits', () => {
        const anchor = { left: 100, top: 50, bottom: 94 };
        const tall = { width: 288, height: 790 };
        expect(clampPopover({ anchor, size: tall, viewport }).top).toBe(8);
    });
});
