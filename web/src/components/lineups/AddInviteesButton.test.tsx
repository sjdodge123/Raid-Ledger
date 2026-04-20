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

vi.mock('../../lib/api-client', () => ({
    getPlayers: vi.fn(),
}));

import { getPlayers } from '../../lib/api-client';

const playerListResponse = (
    members: Array<{ id: number; username: string; discordId: string | null }>,
) => ({
    data: members.map((m) => ({
        id: m.id,
        username: m.username,
        avatar: null,
        discordId: m.discordId,
    })),
    meta: { total: members.length, page: 1, pageSize: 20, hasMore: false },
});

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
        vi.mocked(getPlayers).mockReset();
        vi.mocked(getPlayers).mockResolvedValue(
            playerListResponse([
                { id: 5, username: 'alice', discordId: 'd-5' },
                { id: 7, username: 'bob', discordId: 'd-7' },
            ]),
        );
    });

    it('renders an "Invite more" button', () => {
        render(<AddInviteesButton lineupId={1} />, { wrapper: wrap });
        expect(
            screen.getByRole('button', { name: /invite more/i }),
        ).toBeInTheDocument();
    });

    it('opens the modal when clicked and renders the invitee picker', async () => {
        const user = userEvent.setup();
        render(<AddInviteesButton lineupId={1} />, { wrapper: wrap });
        await user.click(screen.getByRole('button', { name: /invite more/i }));
        expect(
            await screen.findByTestId('invitee-multi-select'),
        ).toBeInTheDocument();
    });

    it('disables submit until at least one invitee is selected', async () => {
        const user = userEvent.setup();
        render(<AddInviteesButton lineupId={1} />, { wrapper: wrap });
        await user.click(screen.getByRole('button', { name: /invite more/i }));
        const submit = screen.getByRole('button', { name: /^add invitees$/i });
        expect(submit).toBeDisabled();
    });

    it('submits checked user ids to useAddLineupInvitees', async () => {
        const user = userEvent.setup();
        render(<AddInviteesButton lineupId={42} />, { wrapper: wrap });
        await user.click(screen.getByRole('button', { name: /invite more/i }));

        const alice = await screen.findByTestId('invitee-option-5');
        const bob = screen.getByTestId('invitee-option-7');
        await user.click(alice.querySelector('input[type="checkbox"]')!);
        await user.click(bob.querySelector('input[type="checkbox"]')!);

        const submit = screen.getByRole('button', { name: /^add invitees$/i });
        await user.click(submit);
        expect(mockAdd).toHaveBeenCalledWith({
            lineupId: 42,
            userIds: [5, 7],
        });
    });
});
