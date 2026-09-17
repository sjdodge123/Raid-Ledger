/**
 * ROK-1585 — `useMenuOpenState`, extracted from LineupOperatorMenu and shared
 * with the desktop "Manage poll ⋯" dropdown. Adds focus return to the trigger
 * and ignores mousedowns inside a portalled `[role="dialog"]`.
 */
import { describe, it, expect } from 'vitest';
import { useRef, type JSX } from 'react';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { useMenuOpenState } from './use-menu-open-state';

function Harness({ outside = true }: { outside?: boolean }): JSX.Element {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const { isOpen, open, close, containerRef } = useMenuOpenState(outside, triggerRef);
    return (
        <>
            <div ref={containerRef}>
                <button ref={triggerRef} type="button" onClick={open}>
                    trigger
                </button>
                {isOpen && (
                    <button type="button" onClick={() => close({ restoreFocus: true })}>
                        item
                    </button>
                )}
            </div>
            <p data-testid="plain-outside">outside text</p>
            <button type="button" data-testid="focusable-outside">
                other
            </button>
            <div role="dialog" data-testid="dialog">
                <p data-testid="dialog-body">modal body</p>
            </div>
        </>
    );
}

const openMenu = (): void => {
    fireEvent.click(screen.getByText('trigger'));
    expect(screen.getByText('item')).toBeInTheDocument();
};

describe('useMenuOpenState (ROK-1585)', () => {
    it('Escape closes and returns focus to the trigger', () => {
        render(<Harness />);
        openMenu();
        act(() => screen.getByText('item').focus());
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByText('item')).toBeNull();
        expect(document.activeElement).toBe(screen.getByText('trigger'));
    });

    it('outside mousedown on a non-focusable target closes and restores focus', () => {
        render(<Harness />);
        openMenu();
        fireEvent.mouseDown(screen.getByTestId('plain-outside'));
        expect(screen.queryByText('item')).toBeNull();
        expect(document.activeElement).toBe(screen.getByText('trigger'));
    });

    it('outside mousedown on a focusable target closes without stealing focus', () => {
        render(<Harness />);
        openMenu();
        act(() => screen.getByTestId('focusable-outside').focus());
        fireEvent.mouseDown(screen.getByTestId('focusable-outside'));
        expect(screen.queryByText('item')).toBeNull();
        expect(document.activeElement).toBe(screen.getByTestId('focusable-outside'));
    });

    it('ignores mousedown inside a role="dialog"', () => {
        render(<Harness />);
        openMenu();
        fireEvent.mouseDown(screen.getByTestId('dialog-body'));
        expect(screen.getByText('item')).toBeInTheDocument();
    });

    it('close({ restoreFocus }) from an item focuses the trigger', () => {
        render(<Harness />);
        openMenu();
        fireEvent.click(screen.getByText('item'));
        expect(screen.queryByText('item')).toBeNull();
        expect(document.activeElement).toBe(screen.getByText('trigger'));
    });

    it('attaches no document listeners when outside clicks do not close', () => {
        render(<Harness outside={false} />);
        openMenu();
        fireEvent.mouseDown(screen.getByTestId('plain-outside'));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.getByText('item')).toBeInTheDocument();
    });
});
