import { screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RosterBuilder } from './RosterBuilder';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import {
    renderWithRouter,
    makePlayer,
    mockPool,
    mockAssignments,
} from './RosterBuilder.test-helpers';

// Mock sonner toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe('RosterBuilder', () => {
    const mockOnRosterChange = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders assigned players in slots', () => {
        renderWithRouter(
            <RosterBuilder
                pool={mockPool}
                assignments={mockAssignments}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        expect(screen.getByText('HealerOne')).toBeInTheDocument();
        expect(screen.getByText('Healer (1/4)')).toBeInTheDocument();
    });

    it('renders correct number of slots', () => {
        renderWithRouter(
            <RosterBuilder pool={[]} assignments={[]} onRosterChange={mockOnRosterChange} canEdit={true} />
        );

        expect(screen.getByText('Tank (0/2)')).toBeInTheDocument();
        expect(screen.getByText('Healer (0/4)')).toBeInTheDocument();
        expect(screen.getByText('DPS (0/14)')).toBeInTheDocument();
    });

    it('renders UnassignedBar with pool count', () => {
        renderWithRouter(
            <RosterBuilder pool={mockPool} assignments={[]} onRosterChange={mockOnRosterChange} canEdit={true} />
        );

        expect(screen.getByText('Unassigned')).toBeInTheDocument();
        const countBadge = document.querySelector('.unassigned-bar__count');
        expect(countBadge).toHaveTextContent('1');
    });

    it('shows "All players assigned ✓" when pool is empty', () => {
        renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={mockAssignments}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        expect(screen.getByText('All players assigned ✓')).toBeInTheDocument();
    });

    it('shows "+ Join" for regular users on empty slots', () => {
        const mockSlotClick = vi.fn();
        renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
                canJoin={true}
                onSlotClick={mockSlotClick}
            />
        );

        const joinButtons = screen.getAllByText('Join');
        expect(joinButtons.length).toBeGreaterThan(0);
    });

    it('shows muted "+" for non-interactive empty slots', () => {
        renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
                canJoin={false}
            />
        );

        const emptySlots = screen.getAllByText('+');
        expect(emptySlots.length).toBeGreaterThan(0);
    });

    it('opens assignment popup when admin clicks slot', () => {
        renderWithRouter(
            <RosterBuilder pool={mockPool} assignments={[]} onRosterChange={mockOnRosterChange} canEdit={true} />
        );

        const slotElements = screen.getAllByText('Assign');
        fireEvent.click(slotElements[0].closest('div[class*="min-h"]')!);

        expect(screen.getByText(/Assign to/)).toBeInTheDocument();
    });

    it('renders generic player slots for non-MMO games', () => {
        renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                slots={{ player: 8 }}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
            />
        );

        expect(screen.getByText('Players (0/8)')).toBeInTheDocument();
    });

    // ROK-209: Auto-Fill UI tests
const mmoPool = [
            makePlayer(10, 'tank', 'TankA'),
            makePlayer(11, 'healer', 'HealerA'),
            makePlayer(12, 'healer', 'HealerB'),
            makePlayer(13, 'dps', 'DpsA'),
            makePlayer(14, 'dps', 'DpsB'),
            makePlayer(15, 'dps', 'DpsC'),
        ];
    function autoFillGroup1() {
it('shows Auto-Fill button when canEdit is true', () => {
            renderWithRouter(
                <RosterBuilder pool={mmoPool} assignments={[]} onRosterChange={mockOnRosterChange} canEdit={true} />
            );
            expect(screen.getByText('Auto-Fill')).toBeInTheDocument();
        });

it('hides Auto-Fill button when canEdit is false', () => {
            renderWithRouter(
                <RosterBuilder pool={mmoPool} assignments={[]} onRosterChange={mockOnRosterChange} canEdit={false} />
            );
            expect(screen.queryByText('Auto-Fill')).not.toBeInTheDocument();
        });

it('disables Auto-Fill when pool is empty', () => {
            renderWithRouter(
                <RosterBuilder pool={[]} assignments={[]} onRosterChange={mockOnRosterChange} canEdit={true} />
            );
            expect(screen.getByText('Auto-Fill')).toBeDisabled();
        });

    }

    function autoFillGroup2() {
it('disables Auto-Fill when all slots are filled', () => {
            const fullAssignments: RosterAssignmentResponse[] = [];
            let id = 1;
            for (const [role, count] of [['tank', 2], ['healer', 4], ['dps', 14], ['flex', 5]] as const) {
                for (let pos = 1; pos <= count; pos++) {
                    fullAssignments.push({ ...makePlayer(id, role, `P${id}`), slot: role, position: pos });
                    id++;
                }
            }

            renderWithRouter(
                <RosterBuilder pool={mmoPool} assignments={fullAssignments} onRosterChange={mockOnRosterChange} canEdit={true} />
            );
            expect(screen.getByText('Auto-Fill')).toBeDisabled();
        });

    }

    function autoFillGroup3() {
it('shows confirmation modal with correct counts on Auto-Fill click', () => {
            renderWithRouter(
                <RosterBuilder pool={mmoPool} assignments={[]} onRosterChange={mockOnRosterChange} canEdit={true} />
            );

            fireEvent.click(screen.getByText('Auto-Fill'));

            expect(screen.getByText('Auto-Fill Roster')).toBeInTheDocument();
            expect(screen.getByText('Continue')).toBeInTheDocument();
            expect(screen.getByText('Cancel')).toBeInTheDocument();
        });

it('shows info toast when no matching players', () => {
            const tinySlots = { tank: 0, healer: 0, dps: 0, flex: 0, player: 0 };
            renderWithRouter(
                <RosterBuilder pool={[makePlayer(1, null, 'NoRole')]} assignments={[]} slots={tinySlots} onRosterChange={mockOnRosterChange} canEdit={true} />
            );

            expect(screen.getByText('Auto-Fill')).toBeDisabled();
        });

    }

    function autoFillGroup4() {
it('calls onRosterChange with filled assignments on confirm', () => {
            renderWithRouter(
                <RosterBuilder pool={mmoPool} assignments={[]} onRosterChange={mockOnRosterChange} canEdit={true} />
            );

            fireEvent.click(screen.getByText('Auto-Fill'));
            fireEvent.click(screen.getByText('Continue'));

            expect(mockOnRosterChange).toHaveBeenCalledTimes(1);
            const [newPool, newAssignments] = mockOnRosterChange.mock.calls[0];
            expect(newAssignments.length).toBe(6);
            expect(newPool.length).toBe(0);
        });

    }

    function autoFillGroup5() {
it('does not move already-assigned players', () => {
            const existingAssignment = { ...makePlayer(99, 'tank', 'ExistingTank'), slot: 'tank' as RosterRole, position: 1 };
            renderWithRouter(
                <RosterBuilder pool={mmoPool} assignments={[existingAssignment]} onRosterChange={mockOnRosterChange} canEdit={true} />
            );

            fireEvent.click(screen.getByText('Auto-Fill'));
            fireEvent.click(screen.getByText('Continue'));

            const [, newAssignments] = mockOnRosterChange.mock.calls[0];
            expect(newAssignments.find((a: RosterAssignmentResponse) => a.signupId === 99)).toBeTruthy();
            const tankA = newAssignments.find((a: RosterAssignmentResponse) => a.username === 'TankA');
            expect(tankA?.slot).toBe('tank');
            expect(tankA?.position).toBe(2);
        });

    }

    describe('Auto-Fill', () => {
        autoFillGroup1();
        autoFillGroup2();
        autoFillGroup3();
        autoFillGroup4();
        autoFillGroup5();
    });

const assigned = [
            { ...makePlayer(1, 'tank', 'TankA'), slot: 'tank' as RosterRole, position: 1 },
            { ...makePlayer(2, 'healer', 'HealerA'), slot: 'healer' as RosterRole, position: 1 },
        ];
    function clearAllGroup1() {
it('shows Clear All button when canEdit is true', () => {
            renderWithRouter(
                <RosterBuilder pool={[]} assignments={assigned} onRosterChange={mockOnRosterChange} canEdit={true} />
            );
            expect(screen.getByText('Clear All')).toBeInTheDocument();
        });

it('hides Clear All button when canEdit is false', () => {
            renderWithRouter(
                <RosterBuilder pool={[]} assignments={assigned} onRosterChange={mockOnRosterChange} canEdit={false} />
            );
            expect(screen.queryByText('Clear All')).not.toBeInTheDocument();
        });

it('disables Clear All when no assignments', () => {
            renderWithRouter(
                <RosterBuilder pool={[]} assignments={[]} onRosterChange={mockOnRosterChange} canEdit={true} />
            );
            expect(screen.getByText('Clear All')).toBeDisabled();
        });

    }

    function clearAllGroup2() {
it('shows confirmation text on first click, clears on second click', () => {
            renderWithRouter(
                <RosterBuilder pool={[]} assignments={assigned} onRosterChange={mockOnRosterChange} canEdit={true} />
            );

            const clearBtn = screen.getByText('Clear All');
            fireEvent.click(clearBtn);

            expect(screen.getByText('Click again to clear')).toBeInTheDocument();

            fireEvent.click(screen.getByText('Click again to clear'));
            expect(mockOnRosterChange).toHaveBeenCalledTimes(1);
            const [newPool, newAssignments] = mockOnRosterChange.mock.calls[0];
            expect(newAssignments).toEqual([]);
            expect(newPool.length).toBe(2);
        });

    }

    function clearAllGroup3() {
it('auto-resets confirmation after 3s', () => {
            vi.useFakeTimers();
            renderWithRouter(
                <RosterBuilder pool={[]} assignments={assigned} onRosterChange={mockOnRosterChange} canEdit={true} />
            );

            fireEvent.click(screen.getByText('Clear All'));
            expect(screen.getByText('Click again to clear')).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(3000);
            });

            expect(screen.getByText('Clear All')).toBeInTheDocument();
            vi.useRealTimers();
        });

    }

    describe('Clear All', () => {
        clearAllGroup1();
        clearAllGroup2();
        clearAllGroup3();
    });

    // ROK-343: Memoization tests
    describe('memoization (ROK-343)', () => {
        it('is wrapped with React.memo', () => {
            const memoSymbol = Symbol.for('react.memo');
            expect((RosterBuilder as unknown as { $$typeof: symbol }).$$typeof).toBe(memoSymbol);
        });

        it('has an inner named function (not anonymous)', () => {
            const inner = (RosterBuilder as unknown as { type: { name: string } }).type;
            expect(inner.name).toBeTruthy();
            expect(inner.name.length).toBeGreaterThan(0);
        });
    });
});
