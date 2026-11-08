import { describe, expect, it } from 'vitest';
import { guildAddonFlavorForSlug, pickFlavor } from './addon-flavor-default';

describe('guildAddonFlavorForSlug (ROK-2114)', () => {
    it.each([
        ['world-of-warcraft-forever', 'forever'],
        ['world-of-warcraft', 'retail'],
        ['world-of-warcraft-classic', 'classic'],
        ['world-of-warcraft-classic-season-of-discovery', 'classic'],
        ['world-of-warcraft-burning-crusade-classic-anniversary-edition', 'classic'],
        ['world-of-warcraft-cataclysm-classic', 'classic'],
    ] as const)('%s → %s', (slug, flavor) => {
        expect(guildAddonFlavorForSlug(slug)).toBe(flavor);
    });

    it.each([undefined, null, '', 'valheim', 'world-of-warcraft-wrath-of-the-lich-king', 'world-of-warcraft-some-future-expansion'])(
        'an unknown or ambiguous slug (%s) has no flavor, so the panel keeps All / Any flavor',
        (slug) => {
            expect(guildAddonFlavorForSlug(slug)).toBeNull();
        },
    );
});

describe('pickFlavor (ROK-2114)', () => {
    it('a manual choice always wins over the guild flavor', () => {
        expect(pickFlavor('retail', 'forever', 'any')).toBe('retail');
    });

    it('with no manual choice the guild flavor is used', () => {
        expect(pickFlavor(undefined, 'forever', 'any')).toBe('forever');
    });

    it('with neither, the fallback (today’s default) is used', () => {
        expect(pickFlavor(undefined, null, 'any')).toBe('any');
    });
});
