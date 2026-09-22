/**
 * ROK-1471 (T23): admin toggle for the LFG forum board, including the
 * missing-permission warning returned by a persisted-but-degraded PUT.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LfgBoardSection } from './lfg-board-section';

const state = {
    status: { data: { enabled: false } as { enabled: boolean } | undefined },
    update: { mutate: vi.fn(), isPending: false },
};
// ROK-1619 — the indicator-emoji field's mutation.
const emojiSave = { mutate: vi.fn(), isPending: false };

vi.mock('../../hooks/admin/use-lfg-board-settings', () => ({
    useLfgBoardSettings: () => state,
    useLfgIndicatorEmoji: () => emojiSave,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('../../lib/toast', () => ({
    toast: {
        success: (...a: unknown[]) => toastSuccess(...a),
        error: (...a: unknown[]) => toastError(...a),
    },
}));

const renderSection = () =>
    render(
        <MemoryRouter>
            <LfgBoardSection />
        </MemoryRouter>,
    );

describe('LfgBoardSection (ROK-1471)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.status.data = { enabled: false };
        state.update.isPending = false;
        state.update.mutate = vi.fn();
    });

    it('renders unchecked when the board is disabled', () => {
        renderSection();
        expect(screen.getByLabelText('Enable LFG board')).not.toBeChecked();
    });

    it('renders checked when the board is already enabled', () => {
        state.status.data = { enabled: true };
        renderSection();
        expect(screen.getByLabelText('Enable LFG board')).toBeChecked();
    });

    // T23 — enabling persists { enabled: true } and confirms with a toast.
    it('persists enabled=true and toasts on success', () => {
        state.update.mutate = vi.fn((_vars, opts) => opts?.onSuccess?.({ enabled: true }));
        renderSection();

        fireEvent.click(screen.getByLabelText('Enable LFG board'));

        expect(state.update.mutate).toHaveBeenCalledWith(
            { enabled: true },
            expect.any(Object),
        );
        expect(toastSuccess).toHaveBeenCalled();
        expect(toastError).not.toHaveBeenCalled();
    });

    it('renders the missing permission names when the response carries a warning', () => {
        state.update.mutate = vi.fn((_vars, opts) =>
            opts?.onSuccess?.({
                enabled: true,
                warning: { missing: ['Manage Threads', 'Create Public Threads'] },
            }),
        );
        renderSection();

        fireEvent.click(screen.getByLabelText('Enable LFG board'));

        const warning = screen.getByTestId('lfg-board-warning');
        expect(warning).toHaveTextContent('Manage Threads');
        expect(warning).toHaveTextContent('Create Public Threads');
        expect(
            screen.getByRole('link', { name: /connection/i }),
        ).toHaveAttribute('href', '/admin/settings/discord/connection');
    });

    it('reports a failed write', () => {
        state.update.mutate = vi.fn((_vars, opts) => opts?.onError?.(new Error('nope')));
        renderSection();
        fireEvent.click(screen.getByLabelText('Enable LFG board'));
        expect(toastError).toHaveBeenCalled();
    });

    // ROK-1619 — the admin emoji field writes the raw value.
    it('saves the group-start emoji the admin typed', () => {
        render(<LfgBoardSection />);
        fireEvent.change(screen.getByTestId('lfg-indicator-emoji-input'), {
            target: { value: ':praise_sun:' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save group-start emoji' }));
        expect(emojiSave.mutate).toHaveBeenCalledWith(
            { emoji: ':praise_sun:' },
            expect.any(Object),
        );
    });
});
