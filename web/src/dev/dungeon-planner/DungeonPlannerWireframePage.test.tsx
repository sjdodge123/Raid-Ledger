/**
 * ROK-2207 — the dungeon-planner wireframe mounts in DEMO_MODE, lists Forever
 * dungeons only, shows only the decided design (one dungeon per plan), filters
 * quests to the guild's faction, restores a plan from the URL and its
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

    it('shows only the decided design — one ruled frame, two planners, one Create-event set each', () => {
        renderWithProviders(<DungeonPlannerWireframePage />);
        expect(screen.getByRole('heading', { level: 1, name: /ROK-2207/ })).toBeInTheDocument();
        // One decision frame with two planners (group of 5 + empty group) and one Create-event set each.
        expect(screen.getAllByRole('heading', { level: 2, name: /^Ruled/ })).toHaveLength(1);
        expect(screen.getAllByRole('heading', { level: 2, name: 'Dungeon planner' })).toHaveLength(2);
        expect(screen.getAllByRole('link', { name: 'Create event ▸' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Create event ▸' })).toHaveLength(1);
    });

    it('shows only the Alliance guild’s quests: the Horde ones are hidden and counted', () => {
        renderWithProviders(<DungeonPlannerWireframePage />);
        expect(screen.getAllByText('Alliance guild').length).toBeGreaterThan(0);
        expect(screen.queryByRole('link', { name: /Sunreaver Orders/ })).not.toBeInTheDocument();
        expect(screen.getAllByRole('link', { name: 'Silver Covenant Dispatch ↗' }).length).toBeGreaterThan(0);
        const errands = screen.getAllByRole('link', { name: "The Archmage's Errand ↗" });
        expect(errands.map((a) => a.getAttribute('href') ?? '').every((h) => h.includes('9100004'))).toBe(true);
        expect(errands.some((a) => (a.getAttribute('href') ?? '').includes('9100104'))).toBe(false);
        expect(screen.getAllByText('2 Horde quests hidden — this is an Alliance guild.').length).toBeGreaterThan(0);
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
        // c=Dorn replaces the frame's default five: the restored group is Dorn alone.
        expect(screen.getByText('Group (1/5)')).toBeInTheDocument();
        const levels = must(screen.getAllByRole('region', { name: 'Levels' })[0], 'levels section');
        expect(within(levels).getByText('Dorn')).toBeInTheDocument();
        expect(within(levels).queryByText('Aelin')).not.toBeInTheDocument();
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
