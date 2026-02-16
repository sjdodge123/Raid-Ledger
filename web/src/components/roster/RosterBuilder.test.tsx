import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RosterBuilder } from './RosterBuilder';
import { computeAutoFill } from './roster-auto-fill';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import type { ReactElement } from 'react';

/** Wrap component in MemoryRouter for Link context */
function renderWithRouter(ui: ReactElement) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// Mock sonner toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe('RosterBuilder', () => {
    const mockPool = [
        {
            id: 0,
            signupId: 1,
            userId: 101,
            discordId: '101101101',
            username: 'PlayerOne',
            avatar: null,
            slot: null,
            position: 0,
            isOverride: false,
            character: {
                id: 'char-1',
                name: 'Tanker',
                className: 'Warrior',
                role: 'tank',
                avatarUrl: null,
            },
        },
    ];

    const mockAssignments = [
        {
            id: 1,
            signupId: 2,
            userId: 102,
            discordId: '102102102',
            username: 'HealerOne',
            avatar: null,
            slot: 'healer' as RosterRole,
            position: 1,
            isOverride: false,
            character: {
                id: 'char-2',
                name: 'Healy',
                className: 'Priest',
                role: 'healer',
                avatarUrl: null,
            },
        },
    ];

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

        // Check if assigned item is rendered
        expect(screen.getByText('HealerOne')).toBeInTheDocument();
        expect(screen.getByText('Healer (1/4)')).toBeInTheDocument();
    });

    it('renders correct number of slots', () => {
        renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        // Check Tank slots (default 2)
        expect(screen.getByText('Tank (0/2)')).toBeInTheDocument();

        // Check Healer slots (default 4)
        expect(screen.getByText('Healer (0/4)')).toBeInTheDocument();

        // Check DPS slots (default 14)
        expect(screen.getByText('DPS (0/14)')).toBeInTheDocument();
    });

    it('renders UnassignedBar with pool count', () => {
        renderWithRouter(
            <RosterBuilder
                pool={mockPool}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        expect(screen.getByText('Unassigned')).toBeInTheDocument();
        // Count badge in the unassigned bar
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

        // All empty slots should show "+ Join" text
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

        // Empty slots without click handler show a muted "+" icon (ROK-210 AC-7)
        const emptySlots = screen.getAllByText('+');
        expect(emptySlots.length).toBeGreaterThan(0);
    });

    it('opens assignment popup when admin clicks slot', () => {
        renderWithRouter(
            <RosterBuilder
                pool={mockPool}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
            />
        );

        // Click first tank slot (admin sees "Assign" text, not "Join")
        const slotElements = screen.getAllByText('Assign');
        fireEvent.click(slotElements[0].closest('div[class*="min-h"]')!);

        // Assignment popup should appear
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

    // ROK-209: Auto-Fill & Clear All tests
    describe('Auto-Fill', () => {
        const makePlayer = (id: number, role: string | null, name: string): RosterAssignmentResponse => ({
            id: 0,
            signupId: id,
            userId: id + 100,
            discordId: `${id}${id}${id}`,
            username: name,
            avatar: null,
            slot: null,
            position: 0,
            isOverride: false,
            character: role ? { id: `char-${id}`, name, className: 'TestClass', role, avatarUrl: null } : null,
        });

        const mmoPool = [
            makePlayer(10, 'tank', 'TankA'),
            makePlayer(11, 'healer', 'HealerA'),
            makePlayer(12, 'healer', 'HealerB'),
            makePlayer(13, 'dps', 'DpsA'),
            makePlayer(14, 'dps', 'DpsB'),
            makePlayer(15, 'dps', 'DpsC'),
        ];

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

        it('disables Auto-Fill when all slots are filled', () => {
            // Fill all default MMO slots: 2 tank, 4 healer, 14 dps, 5 flex = 25 total
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

        it('shows confirmation modal with correct counts on Auto-Fill click', () => {
            renderWithRouter(
                <RosterBuilder pool={mmoPool} assignments={[]} onRosterChange={mockOnRosterChange} canEdit={true} />
            );

            fireEvent.click(screen.getByText('Auto-Fill'));

            // Modal should appear with summary
            expect(screen.getByText('Auto-Fill Roster')).toBeInTheDocument();
            expect(screen.getByText('Continue')).toBeInTheDocument();
            expect(screen.getByText('Cancel')).toBeInTheDocument();
        });

        it('shows info toast when no matching players', () => {
            // Pool with no characters → no role matches, but backfill still works for MMO...
            // Use a scenario where all slots are partially filled and the pool has no room
            const tinySlots = { tank: 0, healer: 0, dps: 0, flex: 0, player: 0 };
            renderWithRouter(
                <RosterBuilder pool={[makePlayer(1, null, 'NoRole')]} assignments={[]} slots={tinySlots} onRosterChange={mockOnRosterChange} canEdit={true} />
            );

            // All slots are 0, so allSlotsFilled is true — button should be disabled
            expect(screen.getByText('Auto-Fill')).toBeDisabled();
        });

        it('calls onRosterChange with filled assignments on confirm', () => {
            renderWithRouter(
                <RosterBuilder pool={mmoPool} assignments={[]} onRosterChange={mockOnRosterChange} canEdit={true} />
            );

            fireEvent.click(screen.getByText('Auto-Fill'));
            fireEvent.click(screen.getByText('Continue'));

            expect(mockOnRosterChange).toHaveBeenCalledTimes(1);
            const [newPool, newAssignments] = mockOnRosterChange.mock.calls[0];
            // All 6 players should be assigned (1 tank, 2 healer, 3 dps = 6 total, fits in available slots)
            expect(newAssignments.length).toBe(6);
            expect(newPool.length).toBe(0);
        });

        it('does not move already-assigned players', () => {
            const existingAssignment = { ...makePlayer(99, 'tank', 'ExistingTank'), slot: 'tank' as RosterRole, position: 1 };
            renderWithRouter(
                <RosterBuilder pool={mmoPool} assignments={[existingAssignment]} onRosterChange={mockOnRosterChange} canEdit={true} />
            );

            fireEvent.click(screen.getByText('Auto-Fill'));
            fireEvent.click(screen.getByText('Continue'));

            const [, newAssignments] = mockOnRosterChange.mock.calls[0];
            // Existing assignment should still be there
            expect(newAssignments.find((a: RosterAssignmentResponse) => a.signupId === 99)).toBeTruthy();
            // TankA from pool should go to tank position 2 (position 1 occupied)
            const tankA = newAssignments.find((a: RosterAssignmentResponse) => a.username === 'TankA');
            expect(tankA?.slot).toBe('tank');
            expect(tankA?.position).toBe(2);
        });
    });

    describe('computeAutoFill (unit)', () => {
        const makePlayer = (id: number, role: string | null, name: string): RosterAssignmentResponse => ({
            id: 0,
            signupId: id,
            userId: id + 100,
            discordId: `${id}${id}${id}`,
            username: name,
            avatar: null,
            slot: null,
            position: 0,
            isOverride: false,
            character: role ? { id: `char-${id}`, name, className: 'TestClass', role, avatarUrl: null } : null,
        });

        it('MMO: assigns by character role matching', () => {
            const pool = [
                makePlayer(1, 'tank', 'TankA'),
                makePlayer(2, 'healer', 'HealerA'),
                makePlayer(3, 'dps', 'DpsA'),
            ];
            const roleSlots = [
                { role: 'tank' as RosterRole, label: 'Tank' },
                { role: 'healer' as RosterRole, label: 'Healer' },
                { role: 'dps' as RosterRole, label: 'DPS' },
                { role: 'flex' as RosterRole, label: 'Flex' },
            ];
            const getSlotCount = (role: RosterRole) => (({ tank: 2, healer: 4, dps: 14, flex: 5 } as Record<string, number>)[role] ?? 0);

            const result = computeAutoFill(pool, [], roleSlots, getSlotCount, false);

            expect(result.totalFilled).toBe(3);
            expect(result.newAssignments.find(a => a.username === 'TankA')?.slot).toBe('tank');
            expect(result.newAssignments.find(a => a.username === 'HealerA')?.slot).toBe('healer');
            expect(result.newAssignments.find(a => a.username === 'DpsA')?.slot).toBe('dps');
        });

        it('MMO: overflows unmatched players to flex', () => {
            const pool = [
                makePlayer(1, null, 'NoRole'),
            ];
            const roleSlots = [
                { role: 'tank' as RosterRole, label: 'Tank' },
                { role: 'healer' as RosterRole, label: 'Healer' },
                { role: 'dps' as RosterRole, label: 'DPS' },
                { role: 'flex' as RosterRole, label: 'Flex' },
            ];
            const getSlotCount = (role: RosterRole) => (({ tank: 2, healer: 4, dps: 14, flex: 5 } as Record<string, number>)[role] ?? 0);

            const result = computeAutoFill(pool, [], roleSlots, getSlotCount, false);

            expect(result.totalFilled).toBe(1);
            const assigned = result.newAssignments.find(a => a.username === 'NoRole');
            expect(assigned?.slot).toBe('flex');
            expect(assigned?.isOverride).toBe(true);
        });

        it('MMO: backfills empty role slots when flex is full', () => {
            const pool = Array.from({ length: 8 }, (_, i) => makePlayer(i + 1, null, `P${i + 1}`));
            const roleSlots = [
                { role: 'tank' as RosterRole, label: 'Tank' },
                { role: 'healer' as RosterRole, label: 'Healer' },
                { role: 'dps' as RosterRole, label: 'DPS' },
                { role: 'flex' as RosterRole, label: 'Flex' },
            ];
            // Small slots to test backfill: 1 tank, 1 healer, 1 dps, 2 flex = 5 slots
            const getSlotCount = (role: RosterRole) => (({ tank: 1, healer: 1, dps: 1, flex: 2 } as Record<string, number>)[role] ?? 0);

            const result = computeAutoFill(pool, [], roleSlots, getSlotCount, false);

            // All 5 slots should be filled
            expect(result.totalFilled).toBe(5);
            expect(result.newPool.length).toBe(3); // 8 - 5 = 3 remaining
        });

        it('MMO: fills bench overflow', () => {
            const pool = Array.from({ length: 3 }, (_, i) => makePlayer(i + 1, null, `P${i + 1}`));
            const roleSlots = [
                { role: 'tank' as RosterRole, label: 'Tank' },
                { role: 'healer' as RosterRole, label: 'Healer' },
                { role: 'dps' as RosterRole, label: 'DPS' },
                { role: 'flex' as RosterRole, label: 'Flex' },
                { role: 'bench' as RosterRole, label: 'Bench' },
            ];
            // All MMO slots are 0, only bench available
            const getSlotCount = (role: RosterRole) => (({ tank: 0, healer: 0, dps: 0, flex: 0, bench: 3 } as Record<string, number>)[role] ?? 0);

            const result = computeAutoFill(pool, [], roleSlots, getSlotCount, false);

            expect(result.totalFilled).toBe(3);
            expect(result.newAssignments.every(a => a.slot === 'bench')).toBe(true);
        });

        it('Generic: fills player slots sequentially', () => {
            const pool = [
                makePlayer(1, null, 'Alpha'),
                makePlayer(2, null, 'Bravo'),
                makePlayer(3, null, 'Charlie'),
            ];
            const roleSlots = [{ role: 'player' as RosterRole, label: 'Player' }];
            const getSlotCount = (role: RosterRole) => role === 'player' ? 4 : 0;

            const result = computeAutoFill(pool, [], roleSlots, getSlotCount, true);

            expect(result.totalFilled).toBe(3);
            expect(result.newAssignments[0].username).toBe('Alpha');
            expect(result.newAssignments[0].position).toBe(1);
            expect(result.newAssignments[1].username).toBe('Bravo');
            expect(result.newAssignments[1].position).toBe(2);
            expect(result.newAssignments[2].username).toBe('Charlie');
            expect(result.newAssignments[2].position).toBe(3);
        });

        it('skips occupied positions', () => {
            const pool = [makePlayer(1, 'tank', 'NewTank')];
            const existing = [{ ...makePlayer(99, 'tank', 'OldTank'), slot: 'tank' as RosterRole, position: 1 }];
            const roleSlots = [
                { role: 'tank' as RosterRole, label: 'Tank' },
                { role: 'healer' as RosterRole, label: 'Healer' },
                { role: 'dps' as RosterRole, label: 'DPS' },
                { role: 'flex' as RosterRole, label: 'Flex' },
            ];
            const getSlotCount = (role: RosterRole) => (({ tank: 2, healer: 4, dps: 14, flex: 5 } as Record<string, number>)[role] ?? 0);

            const result = computeAutoFill(pool, existing, roleSlots, getSlotCount, false);

            expect(result.totalFilled).toBe(1);
            const newTank = result.newAssignments.find(a => a.username === 'NewTank');
            expect(newTank?.slot).toBe('tank');
            expect(newTank?.position).toBe(2); // Position 1 is occupied
        });
    });

    describe('Clear All', () => {
        const makePlayer = (id: number, role: string | null, name: string): RosterAssignmentResponse => ({
            id: 0,
            signupId: id,
            userId: id + 100,
            discordId: `${id}${id}${id}`,
            username: name,
            avatar: null,
            slot: null,
            position: 0,
            isOverride: false,
            character: role ? { id: `char-${id}`, name, className: 'TestClass', role, avatarUrl: null } : null,
        });

        const assigned = [
            { ...makePlayer(1, 'tank', 'TankA'), slot: 'tank' as RosterRole, position: 1 },
            { ...makePlayer(2, 'healer', 'HealerA'), slot: 'healer' as RosterRole, position: 1 },
        ];

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

        it('shows confirmation text on first click, clears on second click', () => {
            renderWithRouter(
                <RosterBuilder pool={[]} assignments={assigned} onRosterChange={mockOnRosterChange} canEdit={true} />
            );

            const clearBtn = screen.getByText('Clear All');
            fireEvent.click(clearBtn);

            // First click: shows confirmation text
            expect(screen.getByText('Click again to clear')).toBeInTheDocument();

            // Second click: executes clear
            fireEvent.click(screen.getByText('Click again to clear'));
            expect(mockOnRosterChange).toHaveBeenCalledTimes(1);
            const [newPool, newAssignments] = mockOnRosterChange.mock.calls[0];
            expect(newAssignments).toEqual([]);
            expect(newPool.length).toBe(2); // Both assigned players moved to pool
        });

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
    });
});
