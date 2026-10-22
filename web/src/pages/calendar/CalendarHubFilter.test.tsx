/**
 * ROK-1893 P4 V6/V7 — the Hubs section of the calendar Filters funnel: a
 * checkbox per known hub + "No hub", between Games and Layers, counted by the
 * Filters badge; "Clear all" shows every hub again.
 */
import type { JSX } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { CalendarFilterEntry, CalendarFilterTrigger } from './CalendarFilterEntry';
import { useCalendarHubFilterStore } from './use-calendar-hub-filter';
import type { CalendarGameFilter } from './use-calendar-game-filter';
import type { CalendarLayerToggles } from './use-calendar-layer-toggles';

vi.mock('../../hooks/use-auth', async (orig) => ({
    ...(await orig<typeof import('../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => null),
}));

const NO_GAMES: CalendarGameFilter = {
    allKnownGames: [], selectedGames: new Set(), toggleGame: vi.fn(), selectAllGames: vi.fn(),
    deselectAllGames: vi.fn(), likedSlugs: new Set(), hiddenCount: 0,
};
const NO_LAYERS: CalendarLayerToggles = { toggles: [], toggleLayer: vi.fn(), showAllLayers: vi.fn(), hiddenCount: 0 };

function Harness(): JSX.Element {
    return (
        <>
            <CalendarFilterTrigger filter={NO_GAMES} layers={NO_LAYERS} isOpen onOpenChange={vi.fn()} />
            <CalendarFilterEntry filter={NO_GAMES} layers={NO_LAYERS} isOpen onOpenChange={vi.fn()} />
        </>
    );
}

function box(testId: string): HTMLInputElement {
    const el = screen.getByTestId(testId);
    const input = el instanceof HTMLInputElement ? el : el.querySelector('input');
    if (!input) throw new Error(`${testId} has no checkbox input`);
    return input;
}

const badges = (): Array<string | null> => screen.queryAllByTestId('filter-count-badge').map((b) => b.textContent);

describe('CalendarFilterEntry — Hubs section (ROK-1893 P4)', () => {
    beforeEach(() => {
        useCalendarHubFilterStore.setState({ known: [], hidden: new Set() });
    });

    it('renders no entry while no loaded event carries a hub', () => {
        renderWithProviders(<Harness />);
        expect(screen.queryByTestId('calendar-hub-toggles')).toBeNull();
        expect(screen.queryByTestId('filter-panel')).toBeNull();
    });

    it('lists each hub plus "No hub", all ticked, with no badge', () => {
        useCalendarHubFilterStore.setState({ known: [{ id: 7, name: 'Seed Crew', kind: 'game_community' }] });
        renderWithProviders(<Harness />);
        expect(screen.getByText('Hubs')).toBeInTheDocument();
        expect(box('calendar-hub-toggle-7').checked).toBe(true);
        expect(box('calendar-hub-toggle-none').checked).toBe(true);
        expect(screen.getByText('No hub')).toBeInTheDocument();
        expect(badges()).toEqual([]);
    });

    it('unticking a hub and "No hub" counts 2 in the badge; Clear all re-ticks both', () => {
        useCalendarHubFilterStore.setState({ known: [{ id: 7, name: 'Seed Crew', kind: 'game_community' }] });
        renderWithProviders(<Harness />);
        act(() => { fireEvent.click(box('calendar-hub-toggle-7')); fireEvent.click(box('calendar-hub-toggle-none')); });
        expect(box('calendar-hub-toggle-7').checked).toBe(false);
        expect(badges()).toContain('2');
        const [clearAll] = screen.getAllByRole('button', { name: /clear all/i });
        if (!clearAll) throw new Error('no Clear all button');
        act(() => { fireEvent.click(clearAll); });
        expect(box('calendar-hub-toggle-7').checked).toBe(true);
        expect(badges()).toEqual([]);
    });
});
