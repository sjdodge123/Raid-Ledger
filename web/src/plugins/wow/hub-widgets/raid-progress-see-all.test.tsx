/** ROK-1789 Part B (B-4) — the Raid progress card's "See all" jumps to the Progression tab. */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RaidProgressSeeAll } from './raid-progress-see-all';
import { raidProgressWidget } from './raid-progress.register';

describe('RaidProgressSeeAll', () => {
    it('links to the Progression tab with a 44px target', () => {
        render(<RaidProgressSeeAll />);
        const link = screen.getByRole('link', { name: 'See all' });
        expect(link).toHaveAttribute('href', '#progression');
        expect(link).toHaveAttribute('data-testid', 'forever-see-all-progression');
        expect(link).toHaveClass('min-h-11');
    });

    it('is the Raid progress widget header action', () => {
        expect(raidProgressWidget.action).toBe(RaidProgressSeeAll);
    });
});
