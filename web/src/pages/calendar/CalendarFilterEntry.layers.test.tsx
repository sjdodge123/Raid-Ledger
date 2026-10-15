/**
 * ROK-1775 — the "Server schedules" (generic calendar layer) checkbox in the
 * calendar Filters panel: shown only for an active plugin's labelled layer,
 * default ON, persisted, and counted by the Filters badge.
 */
import type { JSX } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import { updatePreference } from '../../lib/api-client';
import { clearRegistry, registerPlugin } from '../../plugins/plugin-registry';
import { usePluginStore } from '../../stores/plugin-store';
import { useCalendarLayerFilterStore } from '../../stores/calendar-layer-filter-store';
import { renderWithProviders } from '../../test/render-helpers';
import { CalendarFilterEntry, CalendarFilterTrigger } from './CalendarFilterEntry';
import { useCalendarLayerToggles } from './use-calendar-layer-toggles';
import type { CalendarGameFilter } from './use-calendar-game-filter';

vi.mock('../../lib/api-client', async (orig) => ({
    ...(await orig<typeof import('../../lib/api-client')>()),
    updatePreference: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../hooks/use-auth', async (orig) => ({
    ...(await orig<typeof import('../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'token'),
}));

const KEY = 'srv:schedule';
const TOGGLE = `calendar-layer-toggle-${KEY}`;

/** No known games — the layer alone must be enough to show the entry. */
const NO_GAMES: CalendarGameFilter = {
    allKnownGames: [], selectedGames: new Set(), toggleGame: vi.fn(), selectAllGames: vi.fn(),
    deselectAllGames: vi.fn(), likedSlugs: new Set(), hiddenCount: 0,
};

function Harness(): JSX.Element {
    const layers = useCalendarLayerToggles();
    return (
        <>
            <CalendarFilterTrigger filter={NO_GAMES} layers={layers} isOpen onOpenChange={vi.fn()} />
            <CalendarFilterEntry filter={NO_GAMES} layers={layers} isOpen onOpenChange={vi.fn()} />
        </>
    );
}

function register(filterLabel: string | undefined): void {
    registerPlugin('srv', { icon: 'x', color: 'gray', label: 'Srv' }).registerCalendarLayer({
        key: KEY, ...(filterLabel ? { filterLabel } : {}), useItems: () => [],
    });
}

function checkbox(): HTMLInputElement {
    const el = screen.getByTestId(TOGGLE);
    const input = el instanceof HTMLInputElement ? el : el.querySelector('input');
    if (!input) throw new Error(`${TOGGLE} has no checkbox input`);
    return input;
}

describe('CalendarFilterEntry — calendar layer toggle (ROK-1775)', () => {
    beforeEach(() => {
        clearRegistry();
        useCalendarLayerFilterStore.getState()._reset();
        usePluginStore.setState({ activeSlugs: new Set<string>(), initialized: true });
        vi.mocked(updatePreference).mockClear();
    });

    it('renders nothing while the layer\'s plugin is inactive', () => {
        register('Server schedules');
        renderWithProviders(<Harness />);
        expect(screen.queryByTestId(TOGGLE)).toBeNull();
        expect(screen.queryByTestId('filter-panel')).toBeNull();
    });

    it('omits a layer that supplies no filterLabel', () => {
        register(undefined);
        usePluginStore.setState({ activeSlugs: new Set(['srv']) });
        renderWithProviders(<Harness />);
        expect(screen.queryByTestId(TOGGLE)).toBeNull();
    });

    it('shows the labelled checkbox, ON by default, with no badge', () => {
        register('Server schedules');
        usePluginStore.setState({ activeSlugs: new Set(['srv']) });
        renderWithProviders(<Harness />);
        expect(screen.getByText('Server schedules')).toBeInTheDocument();
        expect(checkbox().checked).toBe(true);
        expect(screen.queryByTestId('filter-count-badge')).toBeNull();
    });

    it('toggling off persists, survives a remount, and counts in the badge', () => {
        register('Server schedules');
        usePluginStore.setState({ activeSlugs: new Set(['srv']) });
        const first = renderWithProviders(<Harness />);
        act(() => { fireEvent.click(checkbox()); });
        expect(updatePreference).toHaveBeenCalledWith('calendarHiddenLayers', [KEY]);
        first.unmount();
        renderWithProviders(<Harness />);
        expect(checkbox().checked).toBe(false);
        const badges = screen.getAllByTestId('filter-count-badge');
        expect(badges.map((b) => b.textContent)).toContain('1');
    });
});
