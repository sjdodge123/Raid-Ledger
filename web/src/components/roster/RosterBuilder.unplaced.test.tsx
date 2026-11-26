import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import { RosterBuilder } from './RosterBuilder';
import { renderWithRouter, makePlayer } from './RosterBuilder.test-helpers';
import { defined } from '../../test/defined';
import { toast } from 'sonner';

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

describe('RosterBuilder — flex rows, bench cap and save toast (ROK-2348)', () => {
    const onRosterChange = vi.fn<(...args: SaveArgs) => boolean>(() => true);
    const mmoFlexSlots = { tank: 2, healer: 4, dps: 14, flex: 2, bench: 0 };

    beforeEach(() => { vi.clearAllMocks(); });

    it('renders a Flex group for flex rows when the event has flex slots', () => {
        renderWithRouter(
            <RosterBuilder pool={[]} assignments={[placed(9, 'flex', 'FlexPlayer', 1)]} slots={mmoFlexSlots}
                onRosterChange={onRosterChange} canEdit={true} />,
        );

        expect(screen.getByText('Flex (1/2)')).toBeInTheDocument();
        expect(screen.getByText('FlexPlayer')).toBeInTheDocument();
        expect(screen.getByText('All players assigned ✓')).toBeInTheDocument();
    });

    it('keeps flex rows in the save when an unrelated slot changes', () => {
        const flexRow = placed(9, 'flex', 'FlexPlayer', 1);
        renderWithRouter(
            <RosterBuilder pool={[]} assignments={[placed(10, 'tank', 'TankA', 1), flexRow]} slots={mmoFlexSlots}
                onRosterChange={onRosterChange} canEdit={true} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Remove TankA from slot' }));

        expect(onRosterChange).toHaveBeenCalledTimes(1);
        const [savedPool, savedAssignments] = defined(onRosterChange.mock.calls[0], 'roster save call');
        expect(savedPool.map((p) => p.signupId)).toEqual([10]);
        expect(savedAssignments).toEqual([flexRow]);
    });

    it('sends a bench row past the cap to the bar instead of rendering its position', () => {
        renderWithRouter(
            <RosterBuilder pool={[]} assignments={[placed(11, 'bench', 'StrayBench', 100000)]} slots={{ player: 4, bench: 0 }}
                onRosterChange={onRosterChange} canEdit={true} />,
        );

        expect(document.querySelector('.unassigned-bar__count')).toHaveTextContent('1');
        expect(screen.getByText('Bench (0)')).toBeInTheDocument();
        // 4 player seats + 1 open bench seat; the stray position renders no cells.
        expect(screen.getAllByText('Assign')).toHaveLength(5);
    });

    it('says in the save toast how many unplaced players the save moved to Unassigned', async () => {
        renderWithRouter(
            <RosterBuilder pool={[]} assignments={[placed(12, 'player', 'Kept', 1), placed(13, 'dps', 'OrphanDps', 1)]}
                slots={{ player: 4, bench: 0 }} onRosterChange={onRosterChange} canEdit={true} />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Remove Kept from slot' }));

        await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
            'Kept moved to unassigned. 1 player moved to Unassigned.'));
    });
});
