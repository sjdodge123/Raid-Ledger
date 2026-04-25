import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArchetypeDistribution } from './ArchetypeDistribution';

describe('ArchetypeDistribution', () => {
    it('renders empty state when no archetypes are provided', () => {
        render(<ArchetypeDistribution archetypes={[]} />);
        expect(screen.getByText(/no archetype distribution/i)).toBeInTheDocument();
    });

    it('renders chart container for populated archetypes', () => {
        render(
            <ArchetypeDistribution
                archetypes={[
                    { intensityTier: 'Hardcore', vectorTitle: 'Raider', count: 4 },
                    { intensityTier: 'Casual', vectorTitle: null, count: 2 },
                ]}
            />,
        );
        expect(screen.getByTestId('archetype-distribution')).toBeInTheDocument();
    });
});
