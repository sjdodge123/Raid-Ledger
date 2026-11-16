/** ROK-2216 — the planner's Copy link reset and the Create-event "not invited" lines. */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CopyLinkButton, CreateEventButtons, COPIED_RESET_MS } from './planner-controls';

describe('CopyLinkButton', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    });
    afterEach(() => { vi.useRealTimers(); });

    async function copy(): Promise<void> {
        fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
        await act(async () => { await Promise.resolve(); });
    }

    it('says "Copied" and goes back to "Copy link" after a short time', async () => {
        render(<CopyLinkButton url="https://x/hubs/7" />);
        await copy();
        expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(COPIED_RESET_MS); });
        expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    });

    it('clears its reset timer on unmount', async () => {
        const { unmount } = render(<CopyLinkButton url="https://x/hubs/7" />);
        await copy();
        expect(vi.getTimerCount()).toBe(1);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('CreateEventButtons', () => {
    it('lists unlinked and off-roster picks on separate lines', () => {
        render(
            <MemoryRouter>
                <CreateEventButtons links={{ plain: '/events/new', invite: '/events/new?i=1', inviteCount: 1, unlinked: ['Alt', 'Ghost'], dropped: ['Blinky'] }} />
            </MemoryRouter>,
        );
        expect(screen.getByText('Alt, Ghost have no linked character — not invited.')).toBeInTheDocument();
        expect(screen.getByText('Blinky is no longer on the roster — not invited.')).toBeInTheDocument();
    });
});
