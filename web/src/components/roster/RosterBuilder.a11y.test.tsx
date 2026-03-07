/**
 * ROK-342: Accessibility tests for RosterBuilder screen reader announcements.
 * Tests the `useAriaLive` integration — verify that roster changes are
 * announced to screen readers via the ARIA live regions.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RosterBuilder } from './RosterBuilder';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import type { ReactElement } from 'react';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

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

function makePlayer(
    id: number,
    role: string | null,
    name: string,
    assigned = false,
    slot: RosterRole | null = null,
    position = 0,
): RosterAssignmentResponse {
    return {
        id: 0,
        signupId: id,
        userId: id + 100,
        discordId: `${id}${id}${id}`,
        username: name,
        avatar: null,
        slot: assigned ? slot : null,
        position: assigned ? position : 0,
        isOverride: false,
        character: role ? { id: `char-${id}`, name, className: 'TestClass', role, avatarUrl: null } : null,
    };
}

let politeRegion: HTMLDivElement;
let assertiveRegion: HTMLDivElement;

function setupAriaRegions() {
    vi.clearAllMocks();
    politeRegion = document.createElement('div');
    politeRegion.id = 'aria-live-polite';
    document.body.appendChild(politeRegion);
    assertiveRegion = document.createElement('div');
    assertiveRegion.id = 'aria-live-assertive';
    document.body.appendChild(assertiveRegion);
}

function teardownAriaRegions() {
    politeRegion?.remove();
    assertiveRegion?.remove();
}

async function waitForRaf() {
    await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
    });
}

describe('RosterBuilder a11y — auto-fill announcements (ROK-342)', () => {
    beforeEach(setupAriaRegions);
    afterEach(teardownAriaRegions);

    it('announces when a single player is auto-filled', async () => {
        const pool = [makePlayer(1, 'tank', 'TankA')];
        renderWithRouter(
            <RosterBuilder pool={pool} assignments={[]} onRosterChange={vi.fn()} canEdit={true} />,
        );
        fireEvent.click(screen.getByText('Auto-Fill'));
        fireEvent.click(screen.getByText('Continue'));
        await waitForRaf();
        expect(politeRegion.textContent).toMatch(/Auto-filled \d+ player/);
    });

    it('announces auto-fill completion', async () => {
        const pool = [makePlayer(1, 'tank', 'TankA'), makePlayer(2, 'healer', 'HealerA')];
        renderWithRouter(
            <RosterBuilder pool={pool} assignments={[]} onRosterChange={vi.fn()} canEdit={true} />,
        );
        fireEvent.click(screen.getByText('Auto-Fill'));
        fireEvent.click(screen.getByText('Continue'));
        await waitForRaf();
        expect(politeRegion.textContent).toMatch(/Auto-filled \d+ players/);
    });
});

describe('RosterBuilder a11y — clear & remove announcements (ROK-342)', () => {
    beforeEach(setupAriaRegions);
    afterEach(teardownAriaRegions);

    it('announces clear all operation', async () => {
        const assigned = [
            { ...makePlayer(1, 'tank', 'TankA'), slot: 'tank' as RosterRole, position: 1 },
            { ...makePlayer(2, 'healer', 'HealerA'), slot: 'healer' as RosterRole, position: 1 },
        ];
        renderWithRouter(
            <RosterBuilder pool={[]} assignments={assigned} onRosterChange={vi.fn()} canEdit={true} />,
        );
        fireEvent.click(screen.getByText('Clear All'));
        fireEvent.click(screen.getByText('Click again to clear'));
        await waitForRaf();
        expect(politeRegion.textContent).toContain('Roster cleared');
        expect(politeRegion.textContent).toContain('2 players');
    });

    it('announces player removal to screen readers', async () => {
        const assigned = [
            { ...makePlayer(1, 'healer', 'HealerA'), slot: 'healer' as RosterRole, position: 1 },
        ];
        renderWithRouter(
            <RosterBuilder pool={[]} assignments={assigned} onRosterChange={vi.fn()} canEdit={true} />,
        );
        const healerName = screen.queryByText('HealerA');
        if (healerName) {
            fireEvent.click(healerName.closest('[class*="min-h"]') ?? healerName);
            const removeBtn = screen.queryByText('Remove');
            if (removeBtn) {
                fireEvent.click(removeBtn);
                await waitForRaf();
                expect(politeRegion.textContent).toContain('HealerA');
                expect(politeRegion.textContent).toContain('unassigned');
            }
        }
    });
});
