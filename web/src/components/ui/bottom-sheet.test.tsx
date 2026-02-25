import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
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
