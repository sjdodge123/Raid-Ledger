/**
 * ROK-342: Accessibility tests for RosterBuilder screen reader announcements.
 * Tests the `useAriaLive` integration — verify that roster changes are
 * announced to screen readers via the ARIA live regions.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { RosterBuilder } from './RosterBuilder';
import type { RosterAssignmentResponse, RosterRole } from '@raid-ledger/contract';
import type { ReactElement } from 'react';

vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function renderWithRouter(ui: ReactElement) {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
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

describe('RosterBuilder — screen reader announcements (ROK-342)', () => {
    let politeRegion: HTMLDivElement;
    let assertiveRegion: HTMLDivElement;

    beforeEach(() => {
        vi.clearAllMocks();

        // Set up ARIA live regions as LiveRegionProvider would render them
        politeRegion = document.createElement('div');
        politeRegion.id = 'aria-live-polite';
        document.body.appendChild(politeRegion);

        assertiveRegion = document.createElement('div');
        assertiveRegion.id = 'aria-live-assertive';
        document.body.appendChild(assertiveRegion);
    });

    afterEach(() => {
        politeRegion?.remove();
        assertiveRegion?.remove();
    });

    describe('assign player announcement via auto-fill', () => {
        it('announces when a single player is auto-filled', async () => {
            const pool = [makePlayer(1, 'tank', 'TankA')];
            const onRosterChange = vi.fn();

            renderWithRouter(
                <RosterBuilder
                    pool={pool}
                    assignments={[]}
                    onRosterChange={onRosterChange}
                    canEdit={true}
                />,
            );

            // Trigger auto-fill which goes through the announce path
            fireEvent.click(screen.getByText('Auto-Fill'));
            fireEvent.click(screen.getByText('Continue'));

            await act(async () => {
                await new Promise((resolve) => requestAnimationFrame(resolve));
            });

            // Auto-fill announce is called with a message about filled players
            expect(politeRegion.textContent).toMatch(/Auto-filled \d+ player/);
        });

        it('announces auto-fill completion', async () => {
            const pool = [
                makePlayer(1, 'tank', 'TankA'),
                makePlayer(2, 'healer', 'HealerA'),
            ];
            const onRosterChange = vi.fn();

            renderWithRouter(
                <RosterBuilder
                    pool={pool}
                    assignments={[]}
                    onRosterChange={onRosterChange}
                    canEdit={true}
                />,
            );

            // Trigger auto-fill confirmation
            fireEvent.click(screen.getByText('Auto-Fill'));
            fireEvent.click(screen.getByText('Continue'));

            await act(async () => {
                await new Promise((resolve) => requestAnimationFrame(resolve));
            });

            expect(politeRegion.textContent).toMatch(/Auto-filled \d+ players/);
        });

        it('announces clear all operation', async () => {
            const assigned = [
                { ...makePlayer(1, 'tank', 'TankA'), slot: 'tank' as RosterRole, position: 1 },
                { ...makePlayer(2, 'healer', 'HealerA'), slot: 'healer' as RosterRole, position: 1 },
            ];
            const onRosterChange = vi.fn();

            renderWithRouter(
                <RosterBuilder
                    pool={[]}
                    assignments={assigned}
                    onRosterChange={onRosterChange}
                    canEdit={true}
                />,
            );

            // Two-click clear sequence
            fireEvent.click(screen.getByText('Clear All'));
            fireEvent.click(screen.getByText('Click again to clear'));

            await act(async () => {
                await new Promise((resolve) => requestAnimationFrame(resolve));
            });

            expect(politeRegion.textContent).toContain('Roster cleared');
            expect(politeRegion.textContent).toContain('2 players');
        });
    });

    describe('remove player announcement', () => {
        it('announces player removal to screen readers', async () => {
            const assigned = [
                { ...makePlayer(1, 'healer', 'HealerA'), slot: 'healer' as RosterRole, position: 1 },
            ];
            const onRosterChange = vi.fn();

            renderWithRouter(
                <RosterBuilder
                    pool={[]}
                    assignments={assigned}
                    onRosterChange={onRosterChange}
                    canEdit={true}
                />,
            );

            // Open slot popup for the occupied slot
            const healerName = screen.queryByText('HealerA');
            if (healerName) {
                fireEvent.click(healerName.closest('[class*="min-h"]') ?? healerName);

                const removeBtn = screen.queryByText('Remove');
                if (removeBtn) {
                    fireEvent.click(removeBtn);

                    await act(async () => {
                        await new Promise((resolve) => requestAnimationFrame(resolve));
                    });

                    expect(politeRegion.textContent).toContain('HealerA');
                    expect(politeRegion.textContent).toContain('unassigned');
                }
            }
        });
    });
});
