/**
 * ROK-1471 (T23): admin toggle for the LFG forum board, including the
 * missing-permission warning returned by a persisted-but-degraded PUT.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LfgBoardSection } from './lfg-board-section';

type Data = { enabled: boolean; composerEnabled?: boolean };
const state = {
    status: { data: { enabled: false } as Data | undefined },
    update: { mutate: vi.fn(), isPending: false },
    updateComposer: { mutate: vi.fn(), isPending: false },
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
        state.updateComposer.mutate = vi.fn();
        state.updateComposer.isPending = false;
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

describe('LfgBoardSection — pinned composer toggle (ROK-1612 AC6)', () => {
    const composer = () => screen.getByLabelText('Pin the LFG composer card');

    it('describes the card by its real title and the forum-board placement', () => {
        renderSection();
        expect(screen.getByText(/"Looking for a group\?" card/)).toBeInTheDocument();
        expect(screen.getByText(/pinned "How this board works" post/)).toBeInTheDocument();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        state.status.data = { enabled: true, composerEnabled: false };
        state.update.mutate = vi.fn();
        state.updateComposer.mutate = vi.fn();
        state.updateComposer.isPending = false;
    });

    it('renders off by default and on when the API says so', () => {
        const { unmount } = renderSection();
        expect(composer()).not.toBeChecked();
        unmount();
        state.status.data = { enabled: true, composerEnabled: true };
        renderSection();
        expect(composer()).toBeChecked();
    });

    it('switching it on PUTs the composer opt-in, not the board toggle', () => {
        state.updateComposer.mutate = vi.fn((_v, opts) => opts?.onSuccess?.({ enabled: true }));
        renderSection();

        fireEvent.click(composer());

        expect(state.updateComposer.mutate).toHaveBeenCalledWith({ enabled: true }, expect.any(Object));
        expect(state.update.mutate).not.toHaveBeenCalled();
        expect(toastSuccess).toHaveBeenCalledWith('Composer card pinned');
    });

    it('switching it off sends enabled=false', () => {
        state.status.data = { enabled: true, composerEnabled: true };
        renderSection();
        fireEvent.click(composer());
        expect(state.updateComposer.mutate).toHaveBeenCalledWith({ enabled: false }, expect.any(Object));
    });

    it('is disabled while a write is in flight, and reports a failed write', () => {
        state.updateComposer.isPending = true;
        const { unmount } = renderSection();
        expect(composer()).toBeDisabled();
        unmount();
        state.updateComposer.isPending = false;
        state.updateComposer.mutate = vi.fn((_v, opts) => opts?.onError?.(new Error('nope')));
        renderSection();
        fireEvent.click(composer());
        expect(toastError).toHaveBeenCalledWith('Failed to update the LFG composer setting');
    });
});
