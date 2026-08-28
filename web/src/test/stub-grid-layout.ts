/**
 * jsdom reports every box as zero, which used to be enough for GameTimeGrid: it
 * published those dimensions and rendered its overlays anyway. It no longer
 * does — a zero rowHeight makes the block editor silently inert in a real
 * browser, so degenerate measurements are now rejected (ROK-1426 follow-up).
 *
 * Tests that need the measured layers (blocks, event/preview overlays) therefore
 * have to give jsdom a plausible layout. Sizes are arbitrary but non-zero.
 */
const CELL_WIDTH = 40;
const CELL_HEIGHT = 24;

/** Give every element a non-zero box for the lifetime of the test file. */
export function stubGridLayout(): void {
    for (const [prop, value] of [
        ['offsetWidth', CELL_WIDTH],
        ['offsetHeight', CELL_HEIGHT],
    ] as const) {
        Object.defineProperty(HTMLElement.prototype, prop, {
            configurable: true,
            get() { return value; },
        });
    }
}
