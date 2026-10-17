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

/** The first <img> inside `el`; throws (fails the test loudly) when there is none. */
function firstImg(el: HTMLElement): HTMLImageElement {
    const img = el.querySelector('img');
    if (!img) throw new Error('expected an <img> inside the portrait');
    return img;
}

describe('ForeverPortraitFallback race portrait (ROK-1747)', () => {
    const RACE_ICON = 'https://wow.zamimg.com/images/wow/icons/large/race_human_female.jpg';
    const foreverHumanFemale = { ...foreverHuman, gender: 'female' };

    it('fills the disc with the race icon and badges the class icon', () => {
        render(<ForeverPortraitFallback character={foreverHumanFemale} size="md">{existing}</ForeverPortraitFallback>);
        const tile = screen.getByRole('img', { name: 'Ayla' });
        expect(tile).toHaveAttribute('data-portrait', 'race');
        expect(tile.querySelector('img')).toHaveAttribute('src', RACE_ICON);
        expect(screen.getByTestId('forever-portrait-class').querySelector('img')).toHaveAttribute('src', getClassIconUrl('Mage'));
        expect(screen.queryByTestId('forever-portrait-race')).not.toBeInTheDocument();
    });

    it('degrades to the class tile when the race icon fails to load', () => {
        render(<ForeverPortraitFallback character={foreverHumanFemale} size="lg">{existing}</ForeverPortraitFallback>);
        fireEvent.error(firstImg(screen.getByRole('img', { name: 'Ayla' })));
        const tile = screen.getByTestId('forever-portrait');
        expect(tile).toHaveAttribute('data-portrait', 'tile');
        expect(tile.querySelector('img')).toHaveAttribute('src', getClassIconUrl('Mage'));
        expect(screen.getByTestId('forever-portrait-race')).toHaveTextContent('H');
    });

    it('hides the class badge when the class icon fails to load', () => {
        render(<ForeverPortraitFallback character={foreverHumanFemale} size="sm">{existing}</ForeverPortraitFallback>);
        fireEvent.error(firstImg(screen.getByTestId('forever-portrait-class')));
        expect(screen.queryByTestId('forever-portrait-class')).not.toBeInTheDocument();
        expect(screen.getByTestId('forever-portrait')).toHaveAttribute('data-portrait', 'race');
    });

    it('keeps the class tile when the gender is unknown', () => {
        render(<ForeverPortraitFallback character={{ ...foreverHuman, gender: null }} size="md">{existing}</ForeverPortraitFallback>);
        expect(screen.getByTestId('forever-portrait')).toHaveAttribute('data-portrait', 'tile');
        expect(screen.getByTestId('forever-portrait').querySelector('img')).toHaveAttribute('src', getClassIconUrl('Mage'));
    });
});
