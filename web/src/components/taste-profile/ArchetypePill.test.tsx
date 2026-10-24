import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArchetypePill } from './ArchetypePill';

describe('ArchetypePill', () => {
    it('renders a Newcomer with no titles as "Newcomer Player" on the newcomer tier class (ROK-1935)', () => {
        render(
            <ArchetypePill
                archetype={{
                    intensityTier: 'Newcomer',
                    vectorTitles: [],
                    descriptions: { tier: 'New here — no play sessions seen yet', titles: [] },
                }}
            />,
        );
        const pill = screen.getByText('Newcomer Player');
        expect(pill).toHaveClass('archetype-pill--tier-newcomer');
        expect(pill).toHaveAttribute('data-tier', 'Newcomer');
    });
});
