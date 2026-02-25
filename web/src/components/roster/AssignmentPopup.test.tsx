import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AssignmentPopup } from './AssignmentPopup';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import type { ReactElement } from 'react';

// Mock useUserCharacters so character-selection step does not make real HTTP calls
vi.mock('../../hooks/use-characters', () => ({
    useMyCharacters: vi.fn(() => ({ data: [], isLoading: false })),
    useUserCharacters: vi.fn(() => ({ data: [], isLoading: false })),
}));

/** Wrap component in MemoryRouter + QueryClientProvider for hook context */
function renderWithRouter(ui: ReactElement) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>
    );
}

describe('AssignmentPopup', () => {
    const mockUnassigned: RosterAssignmentResponse[] = [
        {
            id: 0,
            signupId: 1,
            userId: 101,
            discordId: '101',
            username: 'TankPlayer',
            avatar: null,
            slot: null,
            position: 0,
            isOverride: false,
            character: {
                id: 'c1',
                name: 'Tankadin',
                className: 'Paladin',
                role: 'tank',
                avatarUrl: null,
            },
        },
        {
            id: 0,
            signupId: 2,
            userId: 102,
            discordId: '102',
            username: 'DPSPlayer',
            avatar: null,
            slot: null,
            position: 0,
            isOverride: false,
            character: {
                id: 'c2',
                name: 'Firemage',
                className: 'Mage',
                role: 'dps',
                avatarUrl: null,
            },
        },
        {
            id: 0,
            signupId: 3,
            userId: 103,
            discordId: '103',
            username: 'HealPlayer',
            avatar: null,
            slot: null,
            position: 0,
            isOverride: false,
            character: {
                id: 'c3',
                name: 'Healbot',
                className: 'Priest',
                role: 'healer',
                avatarUrl: null,
            },
        },
    ];

    const mockOnAssign = vi.fn();
    const mockOnClose = vi.fn();
    const mockOnRemove = vi.fn();

    it('renders role-sorted list with matching role first', () => {
        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                onAssign={mockOnAssign}
                eventId={1}
            />
        );

        // Title should show slot
        expect(screen.getByText('Assign to Tank 1')).toBeInTheDocument();

        // Matching role section should exist
        expect(screen.getByText(/Matching Role/)).toBeInTheDocument();

        // TankPlayer should be visible (matching role)
        expect(screen.getByText('TankPlayer')).toBeInTheDocument();
    });

    it('filters by search input', () => {
        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                onAssign={mockOnAssign}
                eventId={1}
            />
        );

        const searchInput = screen.getByPlaceholderText('Search by name...');
        fireEvent.change(searchInput, { target: { value: 'DPS' } });

        // Only DPSPlayer should remain
        expect(screen.getByText('DPSPlayer')).toBeInTheDocument();
        expect(screen.queryByText('TankPlayer')).not.toBeInTheDocument();
        expect(screen.queryByText('HealPlayer')).not.toBeInTheDocument();
    });

    it('shows "Remove to Unassigned" for filled slots', () => {
        const occupant: RosterAssignmentResponse = {
            id: 1,
            signupId: 10,
            userId: 110,
            discordId: '110',
            username: 'OccupantPlayer',
            avatar: null,
            slot: 'tank' as RosterRole,
            position: 1,
            isOverride: false,
            character: {
                id: 'c10',
                name: 'BigTank',
                className: 'Warrior',
                role: 'tank',
                avatarUrl: null,
            },
        };

        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                currentOccupant={occupant}
                onAssign={mockOnAssign}
                onRemove={mockOnRemove}
                eventId={1}
            />
        );

        expect(screen.getByText('Unassign')).toBeInTheDocument();
        expect(screen.getByText('OccupantPlayer')).toBeInTheDocument();
    });

    it('calls onAssign when clicking Assign button', () => {
        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                onAssign={mockOnAssign}
                eventId={1}
            />
        );

        const assignButtons = screen.getAllByText('Assign');
        fireEvent.click(assignButtons[0]);

        expect(mockOnAssign).toHaveBeenCalledWith(expect.any(Number));
    });

    it('shows empty state when no players', () => {
        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={[]}
                onAssign={mockOnAssign}
                eventId={1}
            />
        );

        expect(screen.getByText(/All players are assigned to slots/)).toBeInTheDocument();
    });

    it('does not render when closed', () => {
        renderWithRouter(
            <AssignmentPopup
                isOpen={false}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                onAssign={mockOnAssign}
                eventId={1}
            />
        );

        expect(screen.queryByText('Assign to Tank 1')).not.toBeInTheDocument();
    });

    // ========== ROK-390: Reassign tests ==========

    const occupant: RosterAssignmentResponse = {
        id: 1,
        signupId: 10,
        userId: 110,
        discordId: '110',
        username: 'OccupantPlayer',
        avatar: null,
        slot: 'tank' as RosterRole,
        position: 1,
        isOverride: false,
        character: {
            id: 'c10',
            name: 'BigTank',
            className: 'Warrior',
            role: 'tank',
            avatarUrl: null,
        },
    };

    const allSlots = [
        { role: 'tank' as RosterRole, position: 1, label: 'Tank', color: 'bg-blue-600', occupantName: 'OccupantPlayer' },
        { role: 'tank' as RosterRole, position: 2, label: 'Tank', color: 'bg-blue-600' },
        { role: 'healer' as RosterRole, position: 1, label: 'Healer', color: 'bg-green-600', occupantName: 'SomeHealer' },
        { role: 'dps' as RosterRole, position: 1, label: 'DPS', color: 'bg-red-600' },
    ];

    it('shows Reassign button when onReassignToSlot is provided and slot is occupied', () => {
        const mockReassign = vi.fn();

        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                currentOccupant={occupant}
                onAssign={mockOnAssign}
                onRemove={mockOnRemove}
                onReassignToSlot={mockReassign}
                availableSlots={allSlots}
                eventId={1}
            />
        );

        expect(screen.getByText('Reassign')).toBeInTheDocument();
    });

    it('does not show Reassign button when onReassignToSlot is not provided', () => {
        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                currentOccupant={occupant}
                onAssign={mockOnAssign}
                onRemove={mockOnRemove}
                eventId={1}
            />
        );

        expect(screen.queryByText('Reassign')).not.toBeInTheDocument();
    });

    it('clicking Reassign shows slot picker with current slot disabled', () => {
        const mockReassign = vi.fn();

        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                currentOccupant={occupant}
                onAssign={mockOnAssign}
                onRemove={mockOnRemove}
                onReassignToSlot={mockReassign}
                availableSlots={allSlots}
                eventId={1}
            />
        );

        fireEvent.click(screen.getByText('Reassign'));

        // Should show reassign title
        expect(screen.getByText('Reassign OccupantPlayer')).toBeInTheDocument();

        // Current slot should show "(current)"
        expect(screen.getByText('(current)')).toBeInTheDocument();

        // Occupied slot should show swap indicator
        expect(screen.getByText(/SomeHealer/)).toBeInTheDocument();
    });

    it('clicking Back returns from reassign mode to default view', () => {
        const mockReassign = vi.fn();

        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                currentOccupant={occupant}
                onAssign={mockOnAssign}
                onRemove={mockOnRemove}
                onReassignToSlot={mockReassign}
                availableSlots={allSlots}
                eventId={1}
            />
        );

        // Enter reassign mode
        fireEvent.click(screen.getByText('Reassign'));
        expect(screen.getByText('Reassign OccupantPlayer')).toBeInTheDocument();

        // Click back
        fireEvent.click(screen.getByText(/Back/));

        // Should be back to default view with search input
        expect(screen.getByPlaceholderText('Search by name...')).toBeInTheDocument();
    });

    it('clicking an empty slot in reassign mode calls onReassignToSlot', () => {
        const mockReassign = vi.fn();

        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                currentOccupant={occupant}
                onAssign={mockOnAssign}
                onRemove={mockOnRemove}
                onReassignToSlot={mockReassign}
                availableSlots={allSlots}
                eventId={1}
            />
        );

        fireEvent.click(screen.getByText('Reassign'));

        // Click DPS 1 (empty slot)
        const dpsSlot = screen.getByText('Dps 1').closest('button');
        expect(dpsSlot).not.toBeDisabled();
        fireEvent.click(dpsSlot!);

        expect(mockReassign).toHaveBeenCalledWith(10, 'dps', 1);
    });

    it('clicking an occupied slot in reassign mode calls onReassignToSlot (swap)', () => {
        const mockReassign = vi.fn();

        renderWithRouter(
            <AssignmentPopup
                isOpen={true}
                onClose={mockOnClose}
                slotRole={'tank' as RosterRole}
                slotPosition={1}
                unassigned={mockUnassigned}
                currentOccupant={occupant}
                onAssign={mockOnAssign}
                onRemove={mockOnRemove}
                onReassignToSlot={mockReassign}
                availableSlots={allSlots}
                eventId={1}
            />
        );

        fireEvent.click(screen.getByText('Reassign'));

        // Click Healer 1 (occupied by SomeHealer)
        const healerSlot = screen.getByText('Healer 1').closest('button');
        expect(healerSlot).not.toBeDisabled();
        fireEvent.click(healerSlot!);

        expect(mockReassign).toHaveBeenCalledWith(10, 'healer', 1);
    });
});

// ========== ROK-486: Generic roster — character modal skip ==========

describe('AssignmentPopup — ROK-486 generic roster modal skip', () => {
    const makePlayer = (overrides: Partial<RosterAssignmentResponse> = {}): RosterAssignmentResponse => ({
        id: 0,
        signupId: 1,
        userId: 101,
        discordId: '101',
        username: 'GenericPlayer',
        avatar: null,
        slot: null,
        position: 0,
        isOverride: false,
        character: null,
        ...overrides,
    });

    const baseProps = {
        isOpen: true,
        onClose: vi.fn(),
        eventId: 42,
        slotRole: 'player' as RosterRole,
        slotPosition: 1,
    };

    let mockOnAssign: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockOnAssign = vi.fn();
        vi.clearAllMocks();
    });

    // ----------------------------------------------------------------
    // 1. isMMO=false (generic) — targeted mode: assign directly, no modal
    // ----------------------------------------------------------------

    it('targeted mode: directly calls onAssign without character modal when isMMO is false', () => {
        const player = makePlayer();
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <AssignmentPopup
                        {...baseProps}
                        unassigned={[player]}
                        onAssign={mockOnAssign}
                        gameId={5}
                        isMMO={false}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );

        fireEvent.click(screen.getByText('Assign'));

        // Should call onAssign directly — no character selection step opened
        expect(mockOnAssign).toHaveBeenCalledWith(player.signupId);
        expect(screen.queryByText(/Select Character/i)).not.toBeInTheDocument();
    });

    // ----------------------------------------------------------------
    // 2. isMMO=true (MMO) with gameId — targeted mode: character modal appears
    // ----------------------------------------------------------------

    it('targeted mode: shows character selection step when isMMO is true and gameId is set', () => {
        const player = makePlayer({ userId: 101 });
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <AssignmentPopup
                        {...baseProps}
                        slotRole={'tank' as RosterRole}
                        unassigned={[player]}
                        onAssign={mockOnAssign}
                        gameId={5}
                        isMMO={true}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );

        fireEvent.click(screen.getByText('Assign'));

        // Character selection step should be visible — modal title changes to "Select Character for …"
        expect(screen.getByText(/Select Character for GenericPlayer/i)).toBeInTheDocument();
        expect(mockOnAssign).not.toHaveBeenCalled();
    });

    // ----------------------------------------------------------------
    // 3. Browse-all mode: generic roster skips character modal, opens slot picker
    // ----------------------------------------------------------------

    it('browse-all mode: skips character modal and opens slot picker when isMMO is false', () => {
        const player = makePlayer({ signupId: 7 });
        const availableSlots = [
            { role: 'player' as RosterRole, position: 1, label: 'Player', color: '' },
            { role: 'player' as RosterRole, position: 2, label: 'Player', color: '' },
        ];
        const mockOnAssignToSlot = vi.fn();
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <AssignmentPopup
                        isOpen={true}
                        onClose={vi.fn()}
                        eventId={42}
                        slotRole={null}
                        slotPosition={0}
                        unassigned={[player]}
                        onAssign={mockOnAssign}
                        onAssignToSlot={mockOnAssignToSlot}
                        availableSlots={availableSlots}
                        gameId={5}
                        isMMO={false}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );

        fireEvent.click(screen.getByText('Assign'));

        // No character selection modal should have appeared
        expect(screen.queryByText(/Select Character/i)).not.toBeInTheDocument();

        // Slot picker should now be visible (player was selected directly)
        expect(screen.getByText('Pick a slot for GenericPlayer')).toBeInTheDocument();
        expect(mockOnAssign).not.toHaveBeenCalled();
    });

    // ----------------------------------------------------------------
    // 4. Browse-all mode: MMO with gameId still shows character modal first
    // ----------------------------------------------------------------

    it('browse-all mode: shows character modal before slot picker when isMMO is true', () => {
        const player = makePlayer({ signupId: 8, userId: 201 });
        const availableSlots = [
            { role: 'tank' as RosterRole, position: 1, label: 'Tank', color: '' },
        ];
        const mockOnAssignToSlot = vi.fn();
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <AssignmentPopup
                        isOpen={true}
                        onClose={vi.fn()}
                        eventId={42}
                        slotRole={null}
                        slotPosition={0}
                        unassigned={[player]}
                        onAssign={mockOnAssign}
                        onAssignToSlot={mockOnAssignToSlot}
                        availableSlots={availableSlots}
                        gameId={5}
                        isMMO={true}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );

        fireEvent.click(screen.getByText('Assign'));

        // Character selection step should be visible first (MMO flow)
        expect(screen.getByText(/Select Character for GenericPlayer/i)).toBeInTheDocument();
        expect(mockOnAssign).not.toHaveBeenCalled();
    });

    // ----------------------------------------------------------------
    // 5. Edge case: isMMO undefined — treated the same as false → skip modal
    // ----------------------------------------------------------------

    it('targeted mode: skips character modal when isMMO is not passed (undefined)', () => {
        const player = makePlayer();
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <AssignmentPopup
                        {...baseProps}
                        unassigned={[player]}
                        onAssign={mockOnAssign}
                        gameId={5}
                        // isMMO intentionally omitted
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );

        fireEvent.click(screen.getByText('Assign'));

        expect(mockOnAssign).toHaveBeenCalledWith(player.signupId);
        expect(screen.queryByText(/Select Character/i)).not.toBeInTheDocument();
    });

    // ----------------------------------------------------------------
    // 6. Edge case: gameId null + isMMO true — no gameId means skip modal
    // ----------------------------------------------------------------

    it('targeted mode: skips character modal when gameId is absent even if isMMO is true', () => {
        const player = makePlayer();
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <AssignmentPopup
                        {...baseProps}
                        unassigned={[player]}
                        onAssign={mockOnAssign}
                        // gameId intentionally omitted
                        isMMO={true}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );

        fireEvent.click(screen.getByText('Assign'));

        expect(mockOnAssign).toHaveBeenCalledWith(player.signupId);
        expect(screen.queryByText(/Select Character/i)).not.toBeInTheDocument();
    });
});
