/**
 * ROK-1659 — the Common Ground filters behind the shared funnel standard.
 *
 * Pins the approved rules: the badge counts ONLY the co-op filter (min owners
 * and the auto-seeded player count are defaults), a dormant co-op control
 * (no Co-Optimus data) never counts, "Clear all" clears exactly what the badge
 * counts, and the filter body carries no search box (search lives in the
 * page toolbar).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommonGroundParams } from '../../lib/api-client';
import { renderWithProviders } from '../../test/render-helpers';
import { CommonGroundFilterEntry, CommonGroundFilters } from './CommonGroundFilters';
import { commonGroundActiveFilterCount } from './common-ground-filter-count';

const originalMatchMedia = window.matchMedia;
afterEach(() => { window.matchMedia = originalMatchMedia; });

/** Evaluate `min-width` media queries against a fixed width. */
function mockViewportWidth(width: number): void {
    window.matchMedia = vi.fn().mockImplementation((query: string) => {
        const min = /min-width:\s*(\d+)px/.exec(query);
        return {
            matches: Boolean(min) && width >= Number(min![1]), media: query, onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
        };
    }) as unknown as typeof window.matchMedia;
}

// maxPlayers pre-set so the ROK-1255 auto-seed stays quiet.
const base: CommonGroundParams = { minOwners: 2, maxPlayers: 4 };

function renderEntry(filters: CommonGroundParams, coopDataAvailable = true) {
    const onChange = vi.fn();
    renderWithProviders(
        <CommonGroundFilterEntry
            filters={filters}
            onChange={onChange}
            participantCount={4}
            coopDataAvailable={coopDataAvailable}
            isOpen
            onOpenChange={vi.fn()}
        />,
    );
    return { onChange };
}

describe('commonGroundActiveFilterCount (ROK-1659)', () => {
    it('does not count min owners or the player count — they are defaults', () => {
        expect(commonGroundActiveFilterCount({ minOwners: 9, maxPlayers: 3 }, true)).toBe(0);
    });

    it('counts the co-op filter as one active filter', () => {
        expect(commonGroundActiveFilterCount({ ...base, minOnlineCoop: 4 }, true)).toBe(1);
    });

    it('never counts a dormant co-op filter (no Co-Optimus data)', () => {
        expect(commonGroundActiveFilterCount({ ...base, minOnlineCoop: 4 }, false)).toBe(0);
    });
});

describe('CommonGroundFilterEntry — badge (ROK-1659)', () => {
    it('phone: the Filters FAB badge reads 1 while co-op is on', () => {
        mockViewportWidth(390);
        renderEntry({ ...base, minOnlineCoop: 4 });
        const fab = screen.getByTestId('filter-fab');
        expect(within(fab).getByText('1')).toBeInTheDocument();
    });

    it('phone: no badge when only the defaults moved', () => {
        mockViewportWidth(390);
        renderEntry({ minOwners: 9, maxPlayers: 3 });
        const fab = screen.getByTestId('filter-fab');
        expect(fab).not.toHaveAttribute('aria-describedby');
        expect(within(fab).queryByText(/\d/)).not.toBeInTheDocument();
    });
});

describe('CommonGroundFilterEntry — Clear all (ROK-1659)', () => {
    it('desktop: clears the co-op filter and keeps min owners + players', async () => {
        mockViewportWidth(1280);
        const { onChange } = renderEntry({ minOwners: 5, maxPlayers: 3, minOnlineCoop: 4 });
        const panel = screen.getByTestId('filter-panel');
        await userEvent.click(within(panel).getByRole('button', { name: 'Clear all' }));
        expect(onChange).toHaveBeenCalledWith({ minOwners: 5, maxPlayers: 3, minOnlineCoop: undefined });
    });

    it('desktop: no Clear all while nothing counts', () => {
        mockViewportWidth(1280);
        renderEntry({ minOwners: 5, maxPlayers: 3 });
        expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
    });
});

describe('CommonGroundFilters — body (ROK-1659)', () => {
    it('carries no search box — search lives in the toolbar', () => {
        renderWithProviders(<CommonGroundFilters filters={base} onChange={vi.fn()} coopDataAvailable />);
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
        expect(screen.getByRole('slider', { name: /min owners/i })).toBeInTheDocument();
    });
});
