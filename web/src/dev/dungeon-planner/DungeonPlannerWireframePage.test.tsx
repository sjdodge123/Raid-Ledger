/**
 * ROK-2207 — the dungeon-planner wireframe mounts in DEMO_MODE, lists Forever
 * dungeons only, shows the OQ2 options, restores a plan from the URL and its
 * Create-event links carry the proposed pre-fill.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { DungeonPlannerWireframePage } from './DungeonPlannerWireframePage';

const mockUseSystemStatus = vi.fn();
vi.mock('../../hooks/use-system-status', () => ({
    useSystemStatus: () => mockUseSystemStatus(),
}));

describe('DungeonPlannerWireframePage', () => {
    beforeEach(() => {
        mockUseSystemStatus.mockReturnValue({ data: { demoMode: true }, isLoading: false });
    });

    it('shows the OQ2 options and no pruned variants', () => {
        renderWithProviders(<DungeonPlannerWireframePage />);
        expect(screen.getByRole('heading', { level: 1, name: /ROK-2207/ })).toBeInTheDocument();
        expect(screen.getByText('Option A (recommended) — one dungeon per plan')).toBeInTheDocument();
        expect(screen.getByText('Option B — several dungeons per plan')).toBeInTheDocument();
        expect(screen.queryByText('Option B — Overview widget')).not.toBeInTheDocument();
    });

    it('lists Forever dungeons only, Upper Blackrock Spire in, Scarlet Halls out', () => {
        renderWithProviders(<DungeonPlannerWireframePage />);
        const list = must(screen.getAllByRole('list', { name: 'Dungeons' })[0], 'dungeon list');
        expect(within(list).getByText(/Upper Blackrock Spire/)).toBeInTheDocument();
        expect(within(list).queryByText(/Scarlet Halls/)).not.toBeInTheDocument();
        expect(within(list).queryByText(/Classic/)).not.toBeInTheDocument();
    });

    it('links Create event to /events/new with the dungeon pre-filled and counts only claimed characters', () => {
        renderWithProviders(<DungeonPlannerWireframePage />);
        const link = must(screen.getAllByRole('link', { name: 'Create event ▸' })[0], 'create link');
        expect(link.getAttribute('href')).toContain('contentInstanceIds=90000004');
        expect(screen.getAllByRole('link', { name: 'Create event & invite these 4' }).length).toBeGreaterThan(0);
        expect(screen.getAllByText('Esk has no linked character — not invited.').length).toBeGreaterThan(0);
    });

    it('disables Create event and shows the empty state with no characters', () => {
        renderWithProviders(<DungeonPlannerWireframePage />);
        expect(screen.getByRole('button', { name: 'Create event ▸' })).toBeDisabled();
        expect(screen.getByText('No characters yet — add up to 5 from the roster.')).toBeInTheDocument();
    });

    it('restores the plan from ?c=…&d=…', () => {
        renderWithProviders(<DungeonPlannerWireframePage />, { initialEntries: ['/?c=Dorn&d=226'] });
        const link = must(screen.getAllByRole('link', { name: 'Create event ▸' })[0], 'create link');
        expect(link.getAttribute('href')).toContain('contentInstanceIds=226');
        expect(screen.getAllByText('No quest data for this dungeon yet.').length).toBeGreaterThan(0);
    });

    it('marks who can share a quest and whose prerequisites are unmet', () => {
        renderWithProviders(<DungeonPlannerWireframePage />);
        expect(screen.getAllByText('→ Aelin can share it').length).toBeGreaterThan(0);
        expect(screen.getAllByText('! Brann: prerequisites not met').length).toBeGreaterThan(0);
    });
});

function must<T>(x: T | undefined, label: string): T {
    if (x === undefined) throw new Error(`missing ${label}`);
    return x;
}
