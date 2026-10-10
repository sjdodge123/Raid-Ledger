import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ForeverPortraitFallback } from './forever-portrait';
import { getClassIconUrl } from '../lib/class-icons';

const existing = <span data-testid="existing-avatar">existing</span>;
const foreverHuman = { name: 'Ayla', avatarUrl: null, race: 'Human', class: 'Mage', gameVariant: null, ruleset: 'pvp', gameId: 1 };

describe('ForeverPortraitFallback (ROK-1761)', () => {
    it('renders the class icon + race tile for a Forever character with no render', () => {
        render(<ForeverPortraitFallback character={foreverHuman} size="md">{existing}</ForeverPortraitFallback>);
        // Labelled with the character name (like other avatars' alt), not the race/class text shown beside it.
        const tile = screen.getByRole('img', { name: 'Ayla' });
        expect(tile).toHaveAttribute('data-portrait', 'tile');
        expect(tile.querySelector('img')).toHaveAttribute('src', getClassIconUrl('Mage'));
        expect(screen.getByTestId('forever-portrait-race')).toHaveTextContent('H');
        expect(screen.getByTestId('forever-portrait-race').className).toContain('text-[0.6875rem]');
        expect(screen.queryByTestId('existing-avatar')).not.toBeInTheDocument();
    });

    it('degrades to the neutral glyph when the class icon fails to load', () => {
        render(<ForeverPortraitFallback character={foreverHuman} size="lg">{existing}</ForeverPortraitFallback>);
        fireEvent.error(screen.getByRole('img', { name: 'Ayla' }).querySelector('img')!);
        const tile = screen.getByTestId('forever-portrait');
        expect(tile).toHaveAttribute('data-portrait', 'neutral');
        expect(tile.querySelector('img')).toBeNull();
    });

    it('shows a race badge for a race outside any fixed list (Skyborne → "S")', () => {
        render(<ForeverPortraitFallback character={{ ...foreverHuman, race: 'Skyborne' }} size="sm">{existing}</ForeverPortraitFallback>);
        const badge = screen.getByTestId('forever-portrait-race');
        expect(badge).toHaveTextContent('S');
        expect(badge.className).toContain('text-[0.625rem]');
    });

    it('leaves a non-Forever character on its existing avatar', () => {
        render(
            <ForeverPortraitFallback character={{ ...foreverHuman, gameVariant: 'retail', ruleset: null }} size="md">
                {existing}
            </ForeverPortraitFallback>,
        );
        expect(screen.getByTestId('existing-avatar')).toBeInTheDocument();
        expect(screen.queryByTestId('forever-portrait')).not.toBeInTheDocument();
    });
});
