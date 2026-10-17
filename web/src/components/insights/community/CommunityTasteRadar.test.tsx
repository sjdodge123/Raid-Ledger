import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommunityTasteRadar } from './CommunityTasteRadar';

describe('CommunityTasteRadar', () => {
    it('renders empty state when no axes are provided', () => {
        render(<CommunityTasteRadar axes={[]} />);
        expect(screen.getByText(/not enough play history/i)).toBeInTheDocument();
    });

    it('renders a labeled radar for populated axes', () => {
        render(
            <CommunityTasteRadar
                axes={[
                    { axis: 'rpg', meanScore: 80 },
                    { axis: 'shooter', meanScore: 60 },
                    { axis: 'mmo', meanScore: 50 },
                ]}
            />,
        );
        expect(screen.getByRole('img', { name: /community taste radar/i })).toBeInTheDocument();
    });
});
