import { screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { RosterBuilder } from './RosterBuilder';
import { renderWithRouter, makePlayer } from './RosterBuilder.test-helpers';
import { defined } from '../../test/defined';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function placed(id: number, role: RosterRole | null, name: string, position: number): RosterAssignmentResponse {
    return { ...makePlayer(id, role, name), slot: role, position };
}

type SaveArgs = [RosterAssignmentResponse[], RosterAssignmentResponse[]];

describe('RosterBuilder — rows the grid cannot place (ROK-2348)', () => {
    const onRosterChange = vi.fn<(...args: SaveArgs) => boolean>(() => true);

    beforeEach(() => { vi.clearAllMocks(); });

    it('renders a bench row left at a gapped position after promotions', () => {
        renderWithRouter(
            <RosterBuilder pool={[]} assignments={[placed(5, 'bench', 'BenchedLate', 3)]} slots={{ player: 4, bench: 0 }}
                onRosterChange={onRosterChange} canEdit={true} />,
        );

        expect(screen.getByText('BenchedLate')).toBeInTheDocument();
        expect(screen.getByText('All players assigned ✓')).toBeInTheDocument();
    });

    it('caps the role header at the rows the grid renders (no 5/4)', () => {
        const rows = [1, 2, 3, 4, 5].map((pos) => placed(pos, 'player', `P${pos}`, pos));
        renderWithRouter(
            <RosterBuilder pool={[]} assignments={rows} slots={{ player: 4, bench: 0 }}
                onRosterChange={onRosterChange} canEdit={true} />,
        );

        expect(screen.getByText('Players (4/4)')).toBeInTheDocument();
        expect(document.querySelector('.unassigned-bar__count')).toHaveTextContent('1');
    });

    it('lists an unplaced row in the bar popup, and assigning it replaces its old row', () => {
        const orphan = placed(7, 'dps', 'OrphanDps', 1);
        renderWithRouter(
            <RosterBuilder pool={[]} assignments={[orphan]} slots={{ player: 4, bench: 0 }}
                onRosterChange={onRosterChange} canEdit={true} />,
        );

        fireEvent.click(screen.getByRole('button', { name: /1 unassigned players\. Click to view\./ }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('OrphanDps')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Player 1/ }));

        expect(onRosterChange).toHaveBeenCalledTimes(1);
        const [savedPool, savedAssignments] = defined(onRosterChange.mock.calls[0], 'roster save call');
        expect(savedPool.map((p) => p.signupId)).not.toContain(7);
        expect(savedAssignments.filter((a) => a.signupId === 7)).toEqual([
            expect.objectContaining({ signupId: 7, slot: 'player', position: 1 }),
        ]);
    });

    it('enables Auto-Fill when the only unassigned players are unplaced rows', () => {
        renderWithRouter(
            <RosterBuilder pool={[]} assignments={[placed(8, null, 'NoRole', 0)]} slots={{ player: 4, bench: 0 }}
                onRosterChange={onRosterChange} canEdit={true} />,
        );

        expect(screen.getByText('Auto-Fill')).toBeEnabled();
    });
});
