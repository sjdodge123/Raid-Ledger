/**
 * Tests for InviteeList — the read-only roster panel that shows every
 * invitee on a private lineup, with a trash icon available to the
 * creator/admin/operator for quick removal (ROK-1065).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { InviteeList } from './InviteeList';

const mockRemove = vi.fn();

vi.mock('../../hooks/use-lineups', () => ({
    useRemoveLineupInvitee: () => ({
        mutate: mockRemove,
        isPending: false,
    }),
}));

function wrap({ children }: { children: ReactNode }) {
    const qc = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return createElement(QueryClientProvider, { client: qc }, children);
}

const invitees = [
    { id: 1, displayName: 'Alice', steamLinked: true },
    { id: 2, displayName: 'Bob', steamLinked: false },
];

describe('InviteeList (ROK-1065)', () => {
    beforeEach(() => {
        mockRemove.mockReset();
    });

    it('renders one row per invitee with display names', () => {
        render(
            <InviteeList
                lineupId={1}
                invitees={invitees}
                canManage={false}
            />,
            { wrapper: wrap },
        );
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
    });

    it('hides remove buttons when canManage is false', () => {
        render(
            <InviteeList
                lineupId={1}
                invitees={invitees}
                canManage={false}
            />,
            { wrapper: wrap },
        );
        expect(
            screen.queryAllByRole('button', { name: /remove/i }),
        ).toHaveLength(0);
    });

    it('shows a remove button per invitee when canManage is true', () => {
        render(
            <InviteeList
                lineupId={1}
                invitees={invitees}
                canManage={true}
            />,
            { wrapper: wrap },
        );
        expect(
            screen.getAllByRole('button', { name: /remove/i }),
        ).toHaveLength(2);
    });

    it('calls the remove mutation with the lineup+user id on click', async () => {
        const user = userEvent.setup();
        render(
            <InviteeList
                lineupId={7}
                invitees={invitees}
                canManage={true}
            />,
            { wrapper: wrap },
        );
        const [firstBtn] = screen.getAllByRole('button', { name: /remove/i });
        await user.click(firstBtn);
        expect(mockRemove).toHaveBeenCalledWith(
            { lineupId: 7, userId: 1 },
            expect.any(Object),
        );
    });

    it('renders an empty state when there are no invitees', () => {
        render(
            <InviteeList lineupId={1} invitees={[]} canManage={false} />,
            { wrapper: wrap },
        );
        expect(screen.getByText(/no invitees/i)).toBeInTheDocument();
    });
});
