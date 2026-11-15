/**
 * ROK-2207 — the dungeon-planner wireframe mounts in DEMO_MODE, shows every
 * decision's options, and its Create-event links carry the proposed pre-fill.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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

    it('shows each open question with a recommended Option A and an Option B', () => {
        renderWithProviders(<DungeonPlannerWireframePage />);
        expect(screen.getByRole('heading', { level: 1, name: /ROK-2207/ })).toBeInTheDocument();
        expect(screen.getByText('Option A (recommended) — hub tab')).toBeInTheDocument();
        expect(screen.getByText('Option B — Overview widget')).toBeInTheDocument();
        expect(screen.getByText('Option B — also invite the group')).toBeInTheDocument();
    });

    it('links Create event to /events/new with the dungeon pre-filled', () => {
        renderWithProviders(<DungeonPlannerWireframePage />);
        const link = screen.getAllByRole('link', { name: 'Create event ▸' })[0];
        expect(link?.getAttribute('href')).toContain('contentInstanceIds=90000004');
    });

    it('marks who can share a quest and whose prerequisites are unmet', () => {
        renderWithProviders(<DungeonPlannerWireframePage />);
        expect(screen.getAllByText('→ Aelin can share it').length).toBeGreaterThan(0);
        expect(screen.getAllByText('! Brann: prerequisites not met').length).toBeGreaterThan(0);
    });
});
