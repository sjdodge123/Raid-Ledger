/**
 * ROK-1726: talent empty-state copy and the Forever calc link (AC5, AC7).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TalentDisplay } from './talent-display';
import { FOREVER_ADDON_HINT_TALENTS } from '../lib/wow-variant-config';

const ARMORY_HINT = 'Talent data is only available for characters imported from the Blizzard Armory.';
const REFRESH_HINT = 'Talent data may not be available for this character. Try refreshing.';
/** Mage with no spent points still builds the talent string '0', so a Classic variant gets an embed. */
const CLASSIC_MAGE = { format: 'classic', trees: [], summary: '0/0/0' };

function hint(gameVariant: string | null, isArmoryImported = false) {
    render(<TalentDisplay talents={null} isArmoryImported={isArmoryImported} gameVariant={gameVariant} />);
    return screen.getByText('No talent data').nextElementSibling?.textContent;
}

function renderMage(gameVariant: string) {
    const { container } = render(
        <TalentDisplay talents={CLASSIC_MAGE} isArmoryImported characterClass="Mage" gameVariant={gameVariant} />,
    );
    return {
        href: screen.getByRole('link', { name: /view on wowhead/i }).getAttribute('href'),
        embedSrc: container.querySelector('iframe')?.getAttribute('src') ?? null,
    };
}

describe('TalentDisplay — empty-state copy', () => {
    it('WoW: Forever without talents shows the addon hint, not the Armory copy', () => {
        expect(hint('wow_forever')).toBe(FOREVER_ADDON_HINT_TALENTS);
    });

    it.each(['classic_era', 'classic', 'classic_anniversary', 'retail', null])(
        '%j keeps the Armory copy verbatim', (variant) => {
            expect(hint(variant)).toBe(ARMORY_HINT);
        },
    );

    it.each(['wow_forever', 'classic_era'])('%s Armory-imported keeps the refresh copy', (variant) => {
        expect(hint(variant, true)).toBe(REFRESH_HINT);
    });
});

describe('TalentDisplay — Wowhead calculator (AC7, D5)', () => {
    it('WoW: Forever Mage: plain /forever calc link, no embed, no build string', () => {
        expect(renderMage('wow_forever')).toEqual({
            href: 'https://www.wowhead.com/forever/talent-calc/mage',
            embedSrc: null,
        });
    });

    it('Classic Era Mage is unchanged: build-string link + embed', () => {
        expect(renderMage('classic_era')).toEqual({
            href: 'https://www.wowhead.com/classic/talent-calc/mage/0',
            embedSrc: 'https://www.wowhead.com/classic/talent-calc/embed/mage/0',
        });
    });
});
