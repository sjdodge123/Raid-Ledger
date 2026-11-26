/**
 * LineupInviteesSection (ROK-1065, ROK-1440, ROK-2349) — the invite/remove
 * controls follow the manager flag, and an archived or aborted lineup hides
 * both while keeping the roster visible.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { LineupInviteesSection, isLineupReadOnly } from './LineupInviteesSection';

vi.mock('../../hooks/use-lineups', () => ({
    useRemoveLineupInvitee: () => ({ mutate: vi.fn(), isPending: false }),
    useAddLineupInvitees: () => ({ mutate: vi.fn(), isPending: false }),
}));

function wrap({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return createElement(QueryClientProvider, { client: qc }, children);
}

const invitees = [
    { id: 1, displayName: 'Alice', steamLinked: true },
    { id: 2, displayName: 'Bob', steamLinked: false },
];

function renderSection(props: { canManage: boolean; readOnly?: boolean }) {
    return render(
        <LineupInviteesSection
            lineupId={4}
            invitees={invitees}
            visibility="private"
            {...props}
        />,
        { wrapper: wrap },
    );
}

describe('LineupInviteesSection', () => {
    it('shows Invite more and a remove control per chip to a manager', () => {
        renderSection({ canManage: true });
        expect(screen.getByTestId('add-invitees-button')).toHaveTextContent('Invite more');
        expect(screen.getAllByRole('button', { name: /remove/i })).toHaveLength(2);
    });

    it('hides Invite more and every chip remove control when read-only (ROK-2349)', () => {
        renderSection({ canManage: true, readOnly: true });
        expect(screen.queryByTestId('add-invitees-button')).toBeNull();
        expect(screen.queryAllByRole('button', { name: /remove/i })).toHaveLength(0);
        // The roster itself stays visible.
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
    });

    it('hides the controls from a non-manager', () => {
        renderSection({ canManage: false });
        expect(screen.queryByTestId('add-invitees-button')).toBeNull();
        expect(screen.queryAllByRole('button', { name: /remove/i })).toHaveLength(0);
    });
});

describe('isLineupReadOnly (ROK-2349)', () => {
    it('is true for an archived lineup', () => {
        expect(isLineupReadOnly('archived', false)).toBe(true);
    });

    it('is true for an aborted lineup in any status', () => {
        expect(isLineupReadOnly('building', true)).toBe(true);
    });

    it('is false for a live lineup', () => {
        expect(isLineupReadOnly('building', false)).toBe(false);
        expect(isLineupReadOnly('voting', false)).toBe(false);
        expect(isLineupReadOnly('decided', false)).toBe(false);
    });
});
