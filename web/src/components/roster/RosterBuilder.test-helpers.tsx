import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RosterAssignmentResponse } from '@raid-ledger/contract';
import type { ReactElement } from 'react';

/** Wrap component in MemoryRouter + QueryClientProvider for hook context */
export function renderWithRouter(ui: ReactElement) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>
    );
}

/** Build a mock player for roster test fixtures */
export function makePlayer(
    id: number,
    role: string | null,
    name: string,
): RosterAssignmentResponse {
    return {
        id: 0,
        signupId: id,
        userId: id + 100,
        discordId: `${id}${id}${id}`,
        username: name,
        avatar: null,
        slot: null,
        position: 0,
        isOverride: false,
        character: role
            ? { id: `char-${id}`, name, className: 'TestClass', role, avatarUrl: null }
            : null,
    };
}

/** Standard mock pool with a single tank player */
export const mockPool = [
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

/** Standard mock assignments with a single healer */
export const mockAssignments: RosterAssignmentResponse[] = [
    {
        id: 1,
        signupId: 2,
        userId: 102,
        discordId: '102102102',
        username: 'HealerOne',
        avatar: null,
        slot: 'healer',
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

/** Create a fresh onRosterChange mock */
export function createMockOnRosterChange() {
    return vi.fn();
}
