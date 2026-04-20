/**
 * Tests for AddInviteesButton (ROK-1065) — creator/admin-only trigger that
 * opens a modal with the InviteeMultiSelect and submits user IDs to the
 * add-invitees endpoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { AddInviteesButton } from './AddInviteesButton';

const mockAdd = vi.fn();

vi.mock('../../hooks/use-lineups', () => ({
    useAddLineupInvitees: () => ({
        mutateAsync: mockAdd,
        isPending: false,
    }),
}));

function wrap({ children }: { children: ReactNode }) {
    const qc = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return createElement(QueryClientProvider, { client: qc }, children);
}

describe('AddInviteesButton (ROK-1065)', () => {
    beforeEach(() => {
        mockAdd.mockReset();
        mockAdd.mockResolvedValue({});
    });

    it('renders an "Invite more" button', () => {
        render(<AddInviteesButton lineupId={1} />, { wrapper: wrap });
        expect(
            screen.getByRole('button', { name: /invite more/i }),
        ).toBeInTheDocument();
    });

    it('opens the modal when clicked', async () => {
        const user = userEvent.setup();
        render(<AddInviteesButton lineupId={1} />, { wrapper: wrap });
        await user.click(screen.getByRole('button', { name: /invite more/i }));
        expect(
            screen.getByTestId('invitee-user-ids'),
        ).toBeInTheDocument();
    });

    it('disables submit until at least one invitee id is entered', async () => {
        const user = userEvent.setup();
        render(<AddInviteesButton lineupId={1} />, { wrapper: wrap });
        await user.click(screen.getByRole('button', { name: /invite more/i }));
        const submit = screen.getByRole('button', { name: /^add invitees$/i });
        expect(submit).toBeDisabled();
    });

    it('submits typed user ids to useAddLineupInvitees', async () => {
        const user = userEvent.setup();
        render(<AddInviteesButton lineupId={42} />, { wrapper: wrap });
        await user.click(screen.getByRole('button', { name: /invite more/i }));
        const input = screen.getByTestId('invitee-user-ids');
        await user.type(input, '5, 7');
        const submit = screen.getByRole('button', { name: /^add invitees$/i });
        await user.click(submit);
        expect(mockAdd).toHaveBeenCalledWith({
            lineupId: 42,
            userIds: [5, 7],
        });
    });
});
