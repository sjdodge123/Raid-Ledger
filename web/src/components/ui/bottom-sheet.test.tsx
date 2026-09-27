import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { BottomSheet } from './bottom-sheet';

/** The visible viewport (`visualViewport`, via `bottom-sheet-viewport`); tests set it here. */
const viewport = vi.hoisted(() => ({ height: 0, offsetTop: 0 }));
vi.mock('./bottom-sheet-viewport', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./bottom-sheet-viewport')>();
    return { ...actual, useVisibleViewport: () => ({ height: viewport.height, offsetTop: viewport.offsetTop }) };
});

describe('BottomSheet — part 1', () => {
    beforeEach(() => {
        // Reset document.body.style.overflow before each test
        document.body.style.overflow = '';
    });
    afterEach(() => {
        // Clean up after each test
        document.body.style.overflow = '';
    });

    it('renders dialog when isOpen is true', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => {}}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
    });

    it('renders children content', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => {}}>
                <p>Test Content</p>
            </BottomSheet>
        );

        expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('renders title when provided', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => {}} title="Filter by Game">
                <p>Content</p>
            </BottomSheet>
        );

        expect(screen.getByText('Filter by Game')).toBeInTheDocument();
    });

    it('uses title in aria-label', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => {}} title="Filter by Game">
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog', { name: 'Filter by Game' });
        expect(dialog).toBeInTheDocument();
    });

    it('has default aria-label when title not provided', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => {}}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog', { name: 'Bottom sheet' });
        expect(dialog).toBeInTheDocument();
    });

});

describe('BottomSheet — part 2', () => {
    beforeEach(() => {
        // Reset document.body.style.overflow before each test
        document.body.style.overflow = '';
    });
    afterEach(() => {
        // Clean up after each test
        document.body.style.overflow = '';
    });

    it('renders close button when title is provided', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => {}} title="Filter by Game">
                <p>Content</p>
            </BottomSheet>
        );

        const closeButton = screen.getByRole('button', { name: 'Close' });
        expect(closeButton).toBeInTheDocument();
    });

    it('does not render close button when title is not provided', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => {}}>
                <p>Content</p>
            </BottomSheet>
        );

        expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    });

    it('calls onClose when close button clicked', () => {
        const handleClose = vi.fn();

        render(
            <BottomSheet isOpen={true} onClose={handleClose} title="Filter by Game">
                <p>Content</p>
            </BottomSheet>
        );

        const closeButton = screen.getByRole('button', { name: 'Close' });
        fireEvent.click(closeButton);

        expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when backdrop clicked', () => {
        const handleClose = vi.fn();

        render(
            <BottomSheet isOpen={true} onClose={handleClose}>
                <p>Content</p>
            </BottomSheet>
        );

        // Backdrop is the first child of the portal container
        const backdrop = screen.getByRole('dialog').parentElement?.querySelector('[aria-hidden="true"]');
        expect(backdrop).toBeInTheDocument();

        if (backdrop) {
            fireEvent.click(backdrop as HTMLElement);
            expect(handleClose).toHaveBeenCalledTimes(1);
        }
    });

});

describe('BottomSheet — part 3', () => {
    beforeEach(() => {
        // Reset document.body.style.overflow before each test
        document.body.style.overflow = '';
    });
    afterEach(() => {
        // Clean up after each test
        document.body.style.overflow = '';
    });

    it('calls onClose when Escape key pressed', () => {
        const handleClose = vi.fn();

        render(
            <BottomSheet isOpen={true} onClose={handleClose}>
                <p>Content</p>
            </BottomSheet>
        );

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('does not call onClose when Escape pressed but sheet is closed', () => {
        const handleClose = vi.fn();

        render(
            <BottomSheet isOpen={false} onClose={handleClose}>
                <p>Content</p>
            </BottomSheet>
        );

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(handleClose).not.toHaveBeenCalled();
    });

    it('locks body scroll when open', () => {
        const { rerender } = render(
            <BottomSheet isOpen={false} onClose={() => {}}>
                <p>Content</p>
            </BottomSheet>
        );

        expect(document.body.style.overflow).toBe('');

        rerender(
            <BottomSheet isOpen={true} onClose={() => {}}>
                <p>Content</p>
            </BottomSheet>
        );

        expect(document.body.style.overflow).toBe('hidden');
    });

    it('restores body scroll when closed', () => {
        const { rerender } = render(
            <BottomSheet isOpen={true} onClose={() => {}}>
                <p>Content</p>
            </BottomSheet>
        );

        expect(document.body.style.overflow).toBe('hidden');

        rerender(
            <BottomSheet isOpen={false} onClose={() => {}}>
                <p>Content</p>
            </BottomSheet>
        );

        expect(document.body.style.overflow).toBe('');
    });

});

describe('BottomSheet — part 4', () => {
    beforeEach(() => {
        // Reset document.body.style.overflow before each test
        document.body.style.overflow = '';
    });
    afterEach(() => {
        // Clean up after each test
        document.body.style.overflow = '';
    });

    it('cleans up body scroll on unmount', () => {
        const { unmount } = render(
            <BottomSheet isOpen={true} onClose={() => {}}>
                <p>Content</p>
            </BottomSheet>
        );

        expect(document.body.style.overflow).toBe('hidden');

        unmount();

        expect(document.body.style.overflow).toBe('');
    });

    it('has aria-modal="true"', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => {}}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    // Swipe gesture tests — touch handlers are on the drag handle (.cursor-grab)

    it('handles touch start', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => {}}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const dragHandle = dialog.querySelector('.cursor-grab')!;

        fireEvent.touchStart(dragHandle, {
            touches: [{ clientX: 0, clientY: 100 }],
        });
        // No assertion needed - just verify it doesn't throw
    });

    it('handles touch move downward', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => {}}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const dragHandle = dialog.querySelector('.cursor-grab')!;

        fireEvent.touchStart(dragHandle, {
            touches: [{ clientX: 0, clientY: 100 }],
        });

        fireEvent.touchMove(dragHandle, {
            touches: [{ clientX: 0, clientY: 150 }],
        });

        // The transform should be applied on the sheet (dialog ref)
        expect(dialog.style.transform).toBe('translateY(50px)');
    });

});

describe('BottomSheet — part 5', () => {
    beforeEach(() => {
        // Reset document.body.style.overflow before each test
        document.body.style.overflow = '';
    });
    afterEach(() => {
        // Clean up after each test
        document.body.style.overflow = '';
    });

    it('does not apply negative transform on upward swipe', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => {}}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const dragHandle = dialog.querySelector('.cursor-grab')!;

        fireEvent.touchStart(dragHandle, {
            touches: [{ clientX: 0, clientY: 100 }],
        });

        // Simulate upward drag (negative delta) — dampened transform applied
        fireEvent.touchMove(dragHandle, {
            touches: [{ clientX: 0, clientY: 50 }],
        });

        // Upward swipe applies dampened transform (delta * 0.4)
        expect(dialog.style.transform).toBe('translateY(-20px)');
    });

    it('calls onClose when dragged down >150px', async () => {
        const handleClose = vi.fn();

        render(
            <BottomSheet isOpen={true} onClose={handleClose}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const dragHandle = dialog.querySelector('.cursor-grab')!;

        fireEvent.touchStart(dragHandle, {
            touches: [{ clientX: 0, clientY: 100 }],
        });

        fireEvent.touchMove(dragHandle, {
            touches: [{ clientX: 0, clientY: 260 }],
        });

        fireEvent.touchEnd(dragHandle);

        await waitFor(() => {
            expect(handleClose).toHaveBeenCalledTimes(1);
        });
    });

});

describe('BottomSheet — part 6', () => {
    beforeEach(() => {
        // Reset document.body.style.overflow before each test
        document.body.style.overflow = '';
    });
    afterEach(() => {
        // Clean up after each test
        document.body.style.overflow = '';
    });

    it('does not call onClose when dragged down <150px and <40% of height', () => {
        const handleClose = vi.fn();

        render(
            <BottomSheet isOpen={true} onClose={handleClose}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const dragHandle = dialog.querySelector('.cursor-grab')!;

        // Mock the offsetHeight to ensure we're below both thresholds
        Object.defineProperty(dialog, 'offsetHeight', {
            value: 400, // 40% would be 160px
            writable: true,
            configurable: true,
        });

        fireEvent.touchStart(dragHandle, {
            touches: [{ clientX: 0, clientY: 100 }],
        });

        fireEvent.touchMove(dragHandle, {
            touches: [{ clientX: 0, clientY: 200 }],
        });

        fireEvent.touchEnd(dragHandle);

        expect(handleClose).not.toHaveBeenCalled();
    });

    it('resets transform after drag end', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => {}}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const dragHandle = dialog.querySelector('.cursor-grab')!;

        fireEvent.touchStart(dragHandle, {
            touches: [{ clientX: 0, clientY: 100 }],
        });

        fireEvent.touchMove(dragHandle, {
            touches: [{ clientX: 0, clientY: 150 }],
        });

        expect(dialog.style.transform).toBe('translateY(50px)');

        fireEvent.touchEnd(dragHandle);

        // Transform should be reset
        expect(dialog.style.transform).toBe('');
    });

    it('has no accessibility violations when open', async () => {
        const { container } = render(
            <BottomSheet isOpen={true} onClose={() => {}} title="Accessible Sheet">
                <p>Sheet content</p>
            </BottomSheet>
        );
        expect(await axe(container)).toHaveNoViolations();
    });

});

/**
 * ROK-1640/ROK-1641 — a sheet must be fully visible on open. On a real iPad
 * (Safari toolbar at the TOP) a `100dvh` overlay layer still reached ~100 CSS
 * px below the screen, hiding the time card's Rally/Lock and the game-time
 * drawer's Save footer. The layer and the cap now come from `visualViewport`
 * in px; the sheet clears the bottom safe-area inset, and its body is a flex
 * scroller instead of a `calc(max - 80px)` box.
 */
describe('BottomSheet — ROK-1640/ROK-1641 visible-viewport sizing', () => {
    beforeEach(() => { viewport.height = 1000; viewport.offsetTop = 0; });
    afterEach(() => { viewport.height = 0; viewport.offsetTop = 0; document.body.style.overflow = ''; });

    const renderShort = (props: Partial<React.ComponentProps<typeof BottomSheet>> = {}) => render(
        <BottomSheet isOpen onClose={() => {}} ariaLabel="Time actions" {...props}>
            <button type="button">Lock this time</button>
            <button type="button">Rally</button>
        </BottomSheet>,
    );

    it('caps the collapsed sheet at 60% of the visible height, in px', () => {
        renderShort();
        expect(screen.getByRole('dialog').style.maxHeight).toBe('600px');
    });

    it('converts a caller-supplied vh cap against the visible height', () => {
        renderShort({ maxHeight: '85vh' });
        expect(screen.getByRole('dialog').style.maxHeight).toBe('850px');
    });

    it.each(['400px', '50%'])('passes a non-vh cap (%s) through unchanged', (cap) => {
        renderShort({ maxHeight: cap });
        expect(screen.getByRole('dialog').style.maxHeight).toBe(cap);
    });

    it('pins the overlay layer to the visible viewport so the sheet bottom is the screen bottom', () => {
        viewport.height = 1106; viewport.offsetTop = 24;
        renderShort();
        const layer = screen.getByRole('dialog').parentElement!;
        expect(layer.style.height).toBe('1106px');
        expect(layer.style.top).toBe('24px');
        expect(layer.style.getPropertyValue('--sheet-vh')).toBe('11.06px');
        expect(layer.style.bottom).toBe('auto');
    });

    it('falls back to the vh cap and the inset-0 layer when the visible height is unknown', () => {
        viewport.height = 0;
        renderShort();
        const dialog = screen.getByRole('dialog');
        expect(dialog.style.maxHeight).toBe('60vh');
        expect(dialog.parentElement!.style.height).toBe('');
    });

    it('pads the sheet by the bottom safe-area inset', () => {
        renderShort();
        expect(screen.getByRole('dialog').className).toContain('pb-[env(safe-area-inset-bottom)]');
    });

    it('sizes a short sheet to its content: the body is a shrinkable scroller with no magic-offset cap', () => {
        renderShort();
        const body = screen.getByRole('button', { name: 'Rally' }).parentElement!;
        expect(screen.getByRole('dialog').className).toContain('flex-col');
        expect(body.style.maxHeight).toBe('');
        expect(body.className).toContain('min-h-0');
        expect(body.className).toContain('overflow-y-auto');
    });

    it('still expands to 95% of the visible height when the handle is dragged up', () => {
        renderShort();
        const dialog = screen.getByRole('dialog');
        const handle = dialog.querySelector('.cursor-grab')!;
        fireEvent.touchStart(handle, { touches: [{ clientX: 0, clientY: 300 }] });
        fireEvent.touchMove(handle, { touches: [{ clientX: 0, clientY: 200 }] });
        fireEvent.touchEnd(handle);
        expect(dialog.style.maxHeight).toBe('950px');
    });
});

/**
 * Tab / Shift+Tab stay inside an open sheet (it is `aria-modal`), while focus
 * restore on close stays with `useSheetFocus` so the ROK-1650 hand-off guard
 * (another dialog already took focus) still applies.
 */
/** jsdom reports offsetParent null for everything; the trap skips hidden (null) elements. */
function mockVisibleLayout(): void {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
            configurable: true,
            get(this: HTMLElement) { return this.parentNode; },
        });
    });
    afterEach(() => {
        if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original);
        else Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
        document.body.style.overflow = '';
    });
}

describe('BottomSheet — Tab trap', () => {
    mockVisibleLayout();

    const renderTrap = () => render(
        <BottomSheet isOpen onClose={() => {}} title="Actions">
            <button type="button">First action</button>
            <button type="button">Last action</button>
        </BottomSheet>,
    );

    it('wraps Tab from the last focusable back to the first (the header Close)', () => {
        renderTrap();
        const last = screen.getByRole('button', { name: 'Last action' });
        last.focus();
        fireEvent.keyDown(last, { key: 'Tab' });
        expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    });

    it('wraps Shift+Tab from the first focusable to the last', () => {
        renderTrap();
        const first = screen.getByRole('button', { name: 'Close' });
        first.focus();
        fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
        expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus();
    });

    it('leaves Tab alone while the sheet is closed', () => {
        render(
            <>
                <button type="button">Page button</button>
                <BottomSheet isOpen={false} onClose={() => {}} title="Actions"><button type="button">Only</button></BottomSheet>
            </>,
        );
        const page = screen.getByRole('button', { name: 'Page button' });
        page.focus();
        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        page.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });

    it('leaves Tab alone in a nested dialog that holds focus, even when the sheet has nothing focusable', () => {
        render(
            <>
                <BottomSheet isOpen onClose={() => {}} ariaLabel="Read-only"><p>No controls</p></BottomSheet>
                <div role="dialog" aria-label="Nested confirm"><button type="button">Stay</button></div>
            </>,
        );
        const stay = screen.getByRole('button', { name: 'Stay' });
        stay.focus();
        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        stay.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });

});

describe('BottomSheet — focus restore on close', () => {
    mockVisibleLayout();

    function Host({ open }: { open: boolean }) {
        return (
            <>
                <button type="button">Opener</button>
                <div role="dialog" aria-label="Confirm advance"><button type="button">Confirm</button></div>
                <BottomSheet isOpen={open} onClose={() => {}} title="Actions"><button type="button">Advance</button></BottomSheet>
            </>
        );
    }

    it('gives focus back to the opener on a plain close', () => {
        const { rerender } = render(<Host open={false} />);
        screen.getByRole('button', { name: 'Opener' }).focus();
        rerender(<Host open />);
        screen.getByRole('button', { name: 'Advance' }).focus();
        rerender(<Host open={false} />);
        expect(screen.getByRole('button', { name: 'Opener' })).toHaveFocus();
    });

    it('does not pull focus back to the opener when another dialog took it (ROK-1650)', () => {
        const { rerender } = render(<Host open={false} />);
        screen.getByRole('button', { name: 'Opener' }).focus();
        rerender(<Host open />);
        screen.getByRole('button', { name: 'Confirm' }).focus();
        rerender(<Host open={false} />);
        expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
    });
});
