/**
 * ROK-2349: the archived and aborted lineup bodies render their nominations
 * read-only, so the nominator's own card offers no Remove link.
 * `NominationGrid.test.tsx` proves the `readOnly` prop itself; this pins the
 * wiring that passes it.
 */
import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockEntry, createMockLineupDetail } from '../../test/lineup-factories';
import { LineupDetailBody } from './LineupDetailBody';
import { AbortedReadOnlySnapshot } from './AbortedReadOnlySnapshot';

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({ user: { id: 99, role: 'member' } })),
    isOperatorOrAdmin: vi.fn(() => false),
}));

vi.mock('../../hooks/use-lineups', () => ({
    useRemoveNomination: vi.fn(() => ({ mutate: vi.fn() })),
}));

const ownEntry = () => [
    createMockEntry({ id: 1, gameId: 1, gameName: 'Mine', nominatedBy: { id: 99, displayName: 'Me' } }),
];

function renderBody(status: 'archived', isAborted: boolean) {
    const lineup = createMockLineupDetail({ status, entries: ownEntry() });
    renderWithProviders(
        <LineupDetailBody lineup={lineup} tiebreaker={null} isAborted={isAborted} canParticipate={true}
            leaderboardRef={createRef<HTMLElement>()} bracketRef={createRef<HTMLElement>()} />,
    );
}

describe('LineupDetailBody — read-only nominations (ROK-2349)', () => {
    it('shows an archived lineup\'s own nomination without a Remove link', () => {
        renderBody('archived', false);
        expect(screen.getByText('Mine')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    });

    it('shows an aborted lineup\'s own nomination without a Remove link', () => {
        renderBody('archived', true);
        expect(screen.getByTestId('lineup-aborted-snapshot')).toBeInTheDocument();
        expect(screen.getByText('Mine')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    });
});

describe('AbortedReadOnlySnapshot (ROK-2349)', () => {
    it('renders its nominations without a Remove link', () => {
        renderWithProviders(<AbortedReadOnlySnapshot lineup={createMockLineupDetail({ entries: ownEntry() })} />);
        expect(screen.getByText('Mine')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    });
});
