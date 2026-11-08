/**
 * ROK-1726: talent empty-state copy and the Forever calc link (AC5, AC7).
 */
import { describe, it, expect, vi } from 'vitest';

// ROK-2146: these specs pin the pre-table grid/pills, so the static Forever table is absent here
// (forever-talent-tree.test.tsx covers the tree). Without this the lazy table would race the asserts.
vi.mock('../lib/forever-talent-table', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/forever-talent-table')>()),
    loadForeverClassTable: () => Promise.resolve(null),
    peekForeverClassTable: () => null,
}));
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
        href: screen.getByRole('link', { name: /view on wowhead|open wowhead calculator/i }).getAttribute('href'),
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

describe('TalentDisplay — Forever never reaches the Classic trees (ROK-2110 AC8)', () => {
    const UNCONVERTED = {
        format: 'classic',
        summary: '3/0/0',
        trees: [{ name: 'Arms', spentPoints: 3, talents: [{ name: 'Improved Heroic Strike', id: 124, rank: 3 }] }],
    };

    it('an unconverted classic payload on a Forever character renders through the Forever display with a bare Armory line', () => {
        render(<TalentDisplay talents={UNCONVERTED} isArmoryImported characterClass="Warrior" gameVariant="wow_forever" />);
        expect(screen.getByTestId('forever-talents-source').textContent).toBe('via Armory');
        expect(screen.queryByText('3/0/0')).toBeNull();
    });

    it('the same payload on Classic Era still renders the Classic trees', () => {
        render(<TalentDisplay talents={UNCONVERTED} isArmoryImported characterClass="Warrior" gameVariant="classic_era" />);
        expect(screen.queryByTestId('forever-talents-source')).toBeNull();
        expect(screen.getByText('3/0/0')).toBeTruthy();
    });
});
