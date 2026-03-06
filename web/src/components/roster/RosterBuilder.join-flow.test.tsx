import { screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RosterBuilder } from './RosterBuilder';
import { renderWithRouter, mockPool } from './RosterBuilder.test-helpers';

// Mock sonner toast
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ROK-353: Join? confirmation state tests
describe('RosterBuilder — Join? confirmation flow (ROK-353)', () => {
    const mockOnRosterChange = vi.fn();
    const mockSlotClick = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('AC-1: first click shows "Join?", second click triggers onSlotClick', () => {
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

        const joinLabels = screen.getAllByText('Join');
        const firstSlot = joinLabels[0].closest('div[class*="min-h-[60px]"]')!;
        fireEvent.click(firstSlot);

        expect(screen.getByText('Join?')).toBeInTheDocument();
        expect(mockSlotClick).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('Join?'));

        expect(mockSlotClick).toHaveBeenCalledTimes(1);
        expect(mockSlotClick).toHaveBeenCalledWith('tank', 1);
    });

    it('AC-4: pending state auto-resets after 3 seconds', () => {
        vi.useFakeTimers();
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

        const joinLabels = screen.getAllByText('Join');
        const firstSlot = joinLabels[0].closest('div[class*="min-h-[60px]"]')!;
        fireEvent.click(firstSlot);

        expect(screen.getByText('Join?')).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(screen.queryByText('Join?')).not.toBeInTheDocument();
        vi.useRealTimers();
    });

    it('AC-1: confirm works after 2+ seconds (within 3s window)', () => {
        vi.useFakeTimers();
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

        const joinLabels = screen.getAllByText('Join');
        const firstSlot = joinLabels[0].closest('div[class*="min-h-[60px]"]')!;
        fireEvent.click(firstSlot);

        expect(screen.getByText('Join?')).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(2000);
        });

        expect(screen.getByText('Join?')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Join?'));
        expect(mockSlotClick).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it('AC-3: pending state persists across prop changes (simulated refetch)', () => {
        const { rerender } = renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
                canJoin={true}
                signupSucceeded={false}
                onSlotClick={mockSlotClick}
            />
        );

        const joinLabels = screen.getAllByText('Join');
        const firstSlot = joinLabels[0].closest('div[class*="min-h-[60px]"]')!;
        fireEvent.click(firstSlot);

        expect(screen.getByText('Join?')).toBeInTheDocument();

        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        rerender(
            <QueryClientProvider client={qc}>
                <MemoryRouter>
                    <RosterBuilder
                        pool={[]}
                        assignments={[]}
                        onRosterChange={mockOnRosterChange}
                        canEdit={false}
                        canJoin={true}
                        signupSucceeded={false}
                        onSlotClick={mockSlotClick}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );

        expect(screen.getByText('Join?')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Join?'));
        expect(mockSlotClick).toHaveBeenCalledTimes(1);
    });

    it('AC-3: pending state persists when canJoin briefly becomes false', () => {
        const { rerender } = renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
                canJoin={true}
                signupSucceeded={false}
                onSlotClick={mockSlotClick}
            />
        );

        const joinLabels = screen.getAllByText('Join');
        const firstSlot = joinLabels[0].closest('div[class*="min-h-[60px]"]')!;
        fireEvent.click(firstSlot);

        expect(screen.getByText('Join?')).toBeInTheDocument();

        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        rerender(
            <QueryClientProvider client={qc}>
                <MemoryRouter>
                    <RosterBuilder
                        pool={[]}
                        assignments={[]}
                        onRosterChange={mockOnRosterChange}
                        canEdit={false}
                        canJoin={false}
                        signupSucceeded={false}
                        onSlotClick={mockSlotClick}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );

        expect(screen.getByText('Join?')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Join?'));
        expect(mockSlotClick).toHaveBeenCalledTimes(1);
    });

    it('pending state clears when signupSucceeded becomes true (ROK-467)', () => {
        const { rerender } = renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
                canJoin={true}
                signupSucceeded={false}
                onSlotClick={mockSlotClick}
            />
        );

        const joinLabels = screen.getAllByText('Join');
        const firstSlot = joinLabels[0].closest('div[class*="min-h-[60px]"]')!;
        fireEvent.click(firstSlot);
        expect(screen.getByText('Join?')).toBeInTheDocument();

        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        rerender(
            <QueryClientProvider client={qc}>
                <MemoryRouter>
                    <RosterBuilder
                        pool={[]}
                        assignments={[]}
                        onRosterChange={mockOnRosterChange}
                        canEdit={false}
                        canJoin={false}
                        signupSucceeded={true}
                        onSlotClick={mockSlotClick}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );

        expect(screen.queryByText('Join?')).not.toBeInTheDocument();
    });

    it('canJoin=false alone does NOT clear pending state (ROK-467)', () => {
        vi.useFakeTimers();

        const { rerender } = renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
                canJoin={true}
                signupSucceeded={false}
                onSlotClick={mockSlotClick}
            />
        );

        const joinLabels = screen.getAllByText('Join');
        const firstSlot = joinLabels[0].closest('div[class*="min-h-[60px]"]')!;
        fireEvent.click(firstSlot);
        expect(screen.getByText('Join?')).toBeInTheDocument();

        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        rerender(
            <QueryClientProvider client={qc}>
                <MemoryRouter>
                    <RosterBuilder
                        pool={[]}
                        assignments={[]}
                        onRosterChange={mockOnRosterChange}
                        canEdit={false}
                        canJoin={false}
                        signupSucceeded={false}
                        onSlotClick={mockSlotClick}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );

        act(() => {
            vi.advanceTimersByTime(200);
        });

        expect(screen.getByText('Join?')).toBeInTheDocument();

        vi.useRealTimers();
    });

    it('AC-5: admin assignment popup is unaffected by join confirmation', () => {
        renderWithRouter(
            <RosterBuilder
                pool={mockPool}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={true}
                canJoin={false}
                signupSucceeded={false}
            />
        );

        const assignLabels = screen.getAllByText('Assign');
        expect(assignLabels.length).toBeGreaterThan(0);
        expect(screen.queryByText('Join')).not.toBeInTheDocument();

        const firstSlot = assignLabels[0].closest('div[class*="min-h-[60px]"]')!;
        fireEvent.click(firstSlot);

        expect(screen.getByText(/Assign to/)).toBeInTheDocument();
        expect(screen.queryByText('Join?')).not.toBeInTheDocument();
    });

    it('only one slot can be in pending state at a time', () => {
        renderWithRouter(
            <RosterBuilder
                pool={[]}
                assignments={[]}
                onRosterChange={mockOnRosterChange}
                canEdit={false}
                canJoin={true}
                signupSucceeded={false}
                onSlotClick={mockSlotClick}
            />
        );

        const joinLabels = screen.getAllByText('Join');
        const firstSlot = joinLabels[0].closest('div[class*="min-h-[60px]"]')!;
        fireEvent.click(firstSlot);

        expect(screen.getByText('Join?')).toBeInTheDocument();

        const secondSlot = joinLabels[1].closest('div[class*="min-h-[60px]"]')!;
        fireEvent.click(secondSlot);

        const joinQuestions = screen.getAllByText('Join?');
        expect(joinQuestions.length).toBe(1);
    });
});
