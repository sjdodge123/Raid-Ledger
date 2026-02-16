import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BottomSheet } from './bottom-sheet';

describe('BottomSheet', () => {
    beforeEach(() => {
        // Reset document.body.style.overflow before each test
        document.body.style.overflow = '';
    });

    afterEach(() => {
        // Clean up after each test
        document.body.style.overflow = '';
    });

    it('renders dialog off-screen when isOpen is false', () => {
        render(
            <BottomSheet isOpen={false} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        // Dialog is still in DOM but transformed off-screen
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveClass('translate-y-full');
    });

    it('renders dialog when isOpen is true', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeInTheDocument();
    });

    it('renders children content', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Test Content</p>
            </BottomSheet>
        );

        expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('renders title when provided', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }} title="Filter by Game">
                <p>Content</p>
            </BottomSheet>
        );

        expect(screen.getByText('Filter by Game')).toBeInTheDocument();
    });

    it('uses title in aria-label', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }} title="Filter by Game">
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog', { name: 'Filter by Game' });
        expect(dialog).toBeInTheDocument();
    });

    it('has default aria-label when title not provided', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog', { name: 'Bottom sheet' });
        expect(dialog).toBeInTheDocument();
    });

    it('renders close button when title is provided', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }} title="Filter by Game">
                <p>Content</p>
            </BottomSheet>
        );

        const closeButton = screen.getByRole('button', { name: 'Close' });
        expect(closeButton).toBeInTheDocument();
    });

    it('does not render close button when title is not provided', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
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
            <BottomSheet isOpen={false} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        expect(document.body.style.overflow).toBe('');

        rerender(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        expect(document.body.style.overflow).toBe('hidden');
    });

    it('restores body scroll when closed', () => {
        const { rerender } = render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        expect(document.body.style.overflow).toBe('hidden');

        rerender(
            <BottomSheet isOpen={false} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        expect(document.body.style.overflow).toBe('');
    });

    it('cleans up body scroll on unmount', () => {
        const { unmount } = render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        expect(document.body.style.overflow).toBe('hidden');

        unmount();

        expect(document.body.style.overflow).toBe('');
    });

    it('has max-height of 60vh', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveStyle({ maxHeight: '60vh' });
    });

    it('applies z-index 45 from Z_INDEX.BOTTOM_SHEET', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const container = dialog.parentElement;
        expect(container).toHaveStyle({ zIndex: 45 });
    });

    it('renders drag handle', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const dragHandle = dialog.querySelector('.w-10.h-1.bg-muted.rounded-full');
        expect(dragHandle).toBeInTheDocument();
    });

    it('drag handle has 40x4px dimensions (w-10 h-1)', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const dragHandle = dialog.querySelector('.w-10.h-1');
        expect(dragHandle).toHaveClass('w-10', 'h-1');
    });

    it('has translate-y-0 when open', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveClass('translate-y-0');
    });

    it('has translate-y-full when closed', () => {
        render(
            <BottomSheet isOpen={false} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        // Sheet is still in DOM but transformed off-screen
        const container = document.querySelector('[role="dialog"]')?.parentElement;
        if (container) {
            const dialog = container.querySelector('[role="dialog"]');
            expect(dialog).toHaveClass('translate-y-full');
        }
    });

    it('backdrop has opacity-100 when open', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const backdrop = screen.getByRole('dialog').parentElement?.querySelector('[aria-hidden="true"]');
        expect(backdrop).toHaveClass('opacity-100');
    });

    it('backdrop has opacity-0 when closed', () => {
        render(
            <BottomSheet isOpen={false} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const container = document.querySelector('[role="dialog"]')?.parentElement;
        if (container) {
            const backdrop = container.querySelector('[aria-hidden="true"]');
            expect(backdrop).toHaveClass('opacity-0');
        }
    });

    it('container has pointer-events-none when closed', () => {
        render(
            <BottomSheet isOpen={false} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const container = document.querySelector('[role="dialog"]')?.parentElement;
        expect(container).toHaveClass('pointer-events-none');
    });

    it('container does not have pointer-events-none when open', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const container = dialog.parentElement;
        expect(container).not.toHaveClass('pointer-events-none');
    });

    it('container has overflow-hidden to prevent layout stretching', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const container = dialog.parentElement;
        expect(container).toHaveClass('overflow-hidden');
    });

    it('has rounded-t-2xl top corners', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveClass('rounded-t-2xl');
    });

    it('is positioned at the bottom of the screen', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveClass('absolute', 'bottom-0', 'inset-x-0');
    });

    it('has aria-modal="true"', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('close button has 44x44px min tap target', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }} title="Filter">
                <p>Content</p>
            </BottomSheet>
        );

        const closeButton = screen.getByRole('button', { name: 'Close' });
        expect(closeButton).toHaveClass('min-w-[44px]', 'min-h-[44px]');
    });

    it('has transition-transform duration-300 ease-out', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveClass('transition-transform', 'duration-300', 'ease-out');
    });

    it('backdrop has transition-opacity duration-200', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const backdrop = screen.getByRole('dialog').parentElement?.querySelector('[aria-hidden="true"]');
        expect(backdrop).toHaveClass('transition-opacity', 'duration-200');
    });

    // Swipe gesture tests
    it('handles touch start', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const touchStartEvent = new TouchEvent('touchstart', {
            bubbles: true,
            touches: [{ clientX: 0, clientY: 100 } as Touch],
        });

        dialog.dispatchEvent(touchStartEvent);
        // No assertion needed - just verify it doesn't throw
    });

    it('handles touch move downward', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');

        // Simulate drag start
        const touchStartEvent = new TouchEvent('touchstart', {
            bubbles: true,
            touches: [{ clientX: 0, clientY: 100 } as Touch],
        });
        dialog.dispatchEvent(touchStartEvent);

        // Simulate drag move
        const touchMoveEvent = new TouchEvent('touchmove', {
            bubbles: true,
            touches: [{ clientX: 0, clientY: 150 } as Touch],
        });
        dialog.dispatchEvent(touchMoveEvent);

        // The transform should be applied (verified via transform style)
        expect(dialog.style.transform).toBe('translateY(50px)');
    });

    it('does not apply negative transform on upward swipe', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');

        // Simulate drag start
        const touchStartEvent = new TouchEvent('touchstart', {
            bubbles: true,
            touches: [{ clientX: 0, clientY: 100 } as Touch],
        });
        dialog.dispatchEvent(touchStartEvent);

        // Simulate upward drag (negative delta)
        const touchMoveEvent = new TouchEvent('touchmove', {
            bubbles: true,
            touches: [{ clientX: 0, clientY: 50 } as Touch],
        });
        dialog.dispatchEvent(touchMoveEvent);

        // Transform should not be applied for upward swipes
        expect(dialog.style.transform).toBe('');
    });

    it('calls onClose when dragged down >150px', async () => {
        const handleClose = vi.fn();

        render(
            <BottomSheet isOpen={true} onClose={handleClose}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');

        // Simulate drag gesture that exceeds 150px threshold
        const touchStartEvent = new TouchEvent('touchstart', {
            bubbles: true,
            touches: [{ clientX: 0, clientY: 100 } as Touch],
        });
        dialog.dispatchEvent(touchStartEvent);

        const touchMoveEvent = new TouchEvent('touchmove', {
            bubbles: true,
            touches: [{ clientX: 0, clientY: 260 } as Touch],
        });
        dialog.dispatchEvent(touchMoveEvent);

        const touchEndEvent = new TouchEvent('touchend', { bubbles: true });
        dialog.dispatchEvent(touchEndEvent);

        await waitFor(() => {
            expect(handleClose).toHaveBeenCalledTimes(1);
        });
    });

    it('does not call onClose when dragged down <150px and <40% of height', () => {
        const handleClose = vi.fn();

        render(
            <BottomSheet isOpen={true} onClose={handleClose}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');

        // Mock the offsetHeight to ensure we're below both thresholds
        Object.defineProperty(dialog, 'offsetHeight', {
            value: 400, // 40% would be 160px
            writable: true,
            configurable: true,
        });

        // Simulate drag gesture below both thresholds (100px < 150px and < 40% of 400px)
        const touchStartEvent = new TouchEvent('touchstart', {
            bubbles: true,
            touches: [{ clientX: 0, clientY: 100 } as Touch],
        });
        dialog.dispatchEvent(touchStartEvent);

        const touchMoveEvent = new TouchEvent('touchmove', {
            bubbles: true,
            touches: [{ clientX: 0, clientY: 200 } as Touch],
        });
        dialog.dispatchEvent(touchMoveEvent);

        const touchEndEvent = new TouchEvent('touchend', { bubbles: true });
        dialog.dispatchEvent(touchEndEvent);

        expect(handleClose).not.toHaveBeenCalled();
    });

    it('resets transform after drag end', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');

        // Simulate drag
        const touchStartEvent = new TouchEvent('touchstart', {
            bubbles: true,
            touches: [{ clientX: 0, clientY: 100 } as Touch],
        });
        dialog.dispatchEvent(touchStartEvent);

        const touchMoveEvent = new TouchEvent('touchmove', {
            bubbles: true,
            touches: [{ clientX: 0, clientY: 150 } as Touch],
        });
        dialog.dispatchEvent(touchMoveEvent);

        expect(dialog.style.transform).toBe('translateY(50px)');

        // End drag
        const touchEndEvent = new TouchEvent('touchend', { bubbles: true });
        dialog.dispatchEvent(touchEndEvent);

        // Transform should be reset
        expect(dialog.style.transform).toBe('');
    });

    it('content area has overflow-y-auto', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const contentArea = dialog.querySelector('.overflow-y-auto');
        expect(contentArea).toBeInTheDocument();
    });

    it('content area has max-height constraint', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const contentArea = dialog.querySelector('.overflow-y-auto');
        expect(contentArea).toHaveStyle({ maxHeight: 'calc(60vh - 80px)' });
    });

    it('content area has overflow-x-hidden to prevent horizontal overflow', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        const contentArea = dialog.querySelector('.overflow-y-auto');
        expect(contentArea).toHaveClass('overflow-x-hidden');
    });

    it('dialog panel has overflow-hidden to constrain content', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }}>
                <p>Content</p>
            </BottomSheet>
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveClass('overflow-hidden');
    });
});
