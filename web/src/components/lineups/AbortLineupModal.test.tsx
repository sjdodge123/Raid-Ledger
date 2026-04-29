/**
 * AbortLineupModal tests (ROK-1062).
 * Covers UI states from the spec: open, loading, success, error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { AbortLineupModal } from './AbortLineupModal';

vi.mock('../../hooks/use-lineups', () => ({
    useAbortLineup: vi.fn(),
}));

vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

import { useAbortLineup } from '../../hooks/use-lineups';
import { toast } from '../../lib/toast';

type MutationLike = {
    mutateAsync: ReturnType<typeof vi.fn>;
    isPending: boolean;
};

function mockMutation(overrides: Partial<MutationLike> = {}): MutationLike {
    const m: MutationLike = {
        mutateAsync: vi.fn().mockResolvedValue({ id: 1, status: 'archived' }),
        isPending: false,
        ...overrides,
    };
    vi.mocked(useAbortLineup).mockReturnValue(
        m as unknown as ReturnType<typeof useAbortLineup>,
    );
    return m;
}

describe('AbortLineupModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders title, warning, textarea, cancel + confirm buttons', () => {
        mockMutation();
        renderWithProviders(
            <AbortLineupModal lineupId={42} onClose={vi.fn()} />,
        );

        expect(
            screen.getByRole('heading', { name: /Abort lineup\?/i }),
        ).toBeInTheDocument();
        expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /^Cancel$/ }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /Abort Lineup/i }),
        ).toBeInTheDocument();
    });

    it('character counter updates as the user types', async () => {
        const user = userEvent.setup();
        mockMutation();
        renderWithProviders(
            <AbortLineupModal lineupId={1} onClose={vi.fn()} />,
        );

        expect(screen.getByText('0 / 500')).toBeInTheDocument();

        await user.type(screen.getByRole('textbox'), 'wrong scope');
        expect(screen.getByText('11 / 500')).toBeInTheDocument();
    });

    it('confirm submits trimmed reason', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const mutation = mockMutation();
        renderWithProviders(
            <AbortLineupModal lineupId={7} onClose={onClose} />,
        );

        await user.type(screen.getByRole('textbox'), '   wrong scope   ');
        await user.click(screen.getByRole('button', { name: /Abort Lineup/i }));

        await waitFor(() =>
            expect(mutation.mutateAsync).toHaveBeenCalledWith({
                lineupId: 7,
                body: { reason: 'wrong scope' },
            }),
        );
    });

    it('whitespace-only reason is sent as null', async () => {
        const user = userEvent.setup();
        const mutation = mockMutation();
        renderWithProviders(
            <AbortLineupModal lineupId={3} onClose={vi.fn()} />,
        );

        await user.type(screen.getByRole('textbox'), '    ');
        await user.click(screen.getByRole('button', { name: /Abort Lineup/i }));

        await waitFor(() =>
            expect(mutation.mutateAsync).toHaveBeenCalledWith({
                lineupId: 3,
                body: { reason: null },
            }),
        );
    });

    it('empty reason is sent as null', async () => {
        const user = userEvent.setup();
        const mutation = mockMutation();
        renderWithProviders(
            <AbortLineupModal lineupId={9} onClose={vi.fn()} />,
        );

        await user.click(screen.getByRole('button', { name: /Abort Lineup/i }));

        await waitFor(() =>
            expect(mutation.mutateAsync).toHaveBeenCalledWith({
                lineupId: 9,
                body: { reason: null },
            }),
        );
    });

    it('disables confirm while mutation is pending', () => {
        mockMutation({ isPending: true });
        renderWithProviders(
            <AbortLineupModal lineupId={1} onClose={vi.fn()} />,
        );

        const confirm = screen.getByRole('button', { name: /Aborting/i });
        expect(confirm).toBeDisabled();
    });

    it('on success: shows toast, closes modal, mutation resolved', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        mockMutation();
        renderWithProviders(
            <AbortLineupModal lineupId={1} onClose={onClose} />,
        );

        await user.click(screen.getByRole('button', { name: /Abort Lineup/i }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(toast.success).toHaveBeenCalledWith('Lineup aborted.');
    });

    it('on error: shows toast with server message, modal stays open, reason preserved', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        mockMutation({
            mutateAsync: vi
                .fn()
                .mockRejectedValue(new Error('Already archived')),
        });
        renderWithProviders(
            <AbortLineupModal lineupId={1} onClose={onClose} />,
        );

        const textbox = screen.getByRole('textbox') as HTMLTextAreaElement;
        await user.type(textbox, 'preserved reason');
        await user.click(screen.getByRole('button', { name: /Abort Lineup/i }));

        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith('Already archived'),
        );
        expect(onClose).not.toHaveBeenCalled();
        expect(textbox.value).toBe('preserved reason');
    });

    it('cancel button calls onClose without firing mutation', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const mutation = mockMutation();
        renderWithProviders(
            <AbortLineupModal lineupId={1} onClose={onClose} />,
        );

        await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mutation.mutateAsync).not.toHaveBeenCalled();
    });
});
