/** ROK-1859 — base names, the active base, per-base personal totals, chest display names. */
import { describe, it, expect } from 'vitest';
import {
    BASE_A,
    BASE_C,
    basesFixture,
    materialsCatalogue,
    materialsFixture,
    personalWithBases,
} from '../../../test/mocks/valheim-materials-handlers';
import {
    activeBase,
    baseOptionLabel,
    chestDisplayName,
    chestsInBase,
    personalFor,
    sharedTotalsFor,
} from './materials-bases.helpers';

const ctx = { items: materialsCatalogue, atlas: null };
const [baseA, baseC] = basesFixture;
const must = <T>(v: T | undefined, label: string): T => {
    if (v === undefined) throw new Error(`missing ${label}`);
    return v;
};
const A = must(baseA, 'base A');
const C = must(baseC, 'base C');

describe('materials-bases.helpers', () => {
    it('labels a base option with the locale minus sign and a singular count', () => {
        expect(baseOptionLabel(C)).toBe('Base near x 610, z −420 · 1 chest');
        expect(baseOptionLabel(A)).toBe('Base near x 3, z 53 · 5 chests');
    });

    it('chestDisplayName: index + base, away from bases, unknown base, absent fields', () => {
        const wood = { prefab: 'piece_chest_wood' };
        expect(chestDisplayName({ ...wood, base: BASE_C, index: 2 }, basesFixture, ctx)).toBe(
            'Wood chest 2 · Base near x 610, z −420',
        );
        expect(chestDisplayName({ prefab: 'Cart', base: null, index: 1 }, basesFixture, ctx)).toBe(
            'Cart 1 · Away from bases',
        );
        expect(chestDisplayName({ ...wood, base: 'Q'.repeat(22), index: 3 }, basesFixture, ctx)).toBe(
            'Wood chest 3',
        );
        expect(chestDisplayName(wood, basesFixture, ctx)).toBe('Wood chest');
    });

    it('activeBase: a known key, a stale key, no bases', () => {
        const data = materialsFixture({ bases: basesFixture });
        expect(activeBase(data, BASE_C)).toBe(C);
        expect(activeBase(data, 'Z'.repeat(22))).toBeNull();
        expect(activeBase(materialsFixture(), BASE_C)).toBeNull();
        expect(activeBase(data, null)).toBeNull();
    });

    it('sharedTotalsFor: the base totals, or every shared total for All bases', () => {
        const data = materialsFixture({ bases: basesFixture });
        expect(sharedTotalsFor(data, C)).toBe(C.totals);
        expect(sharedTotalsFor(data, null)).toBe(data.shared.totals);
    });

    it('personalFor: the base group, an empty group, or unfiltered without byBase', () => {
        expect(personalFor(personalWithBases, A)).toMatchObject({
            chestCount: 1,
            totals: [{ prefab: 'Coins', total: 99 }],
        });
        expect(personalFor(personalWithBases, C)).toMatchObject({
            chestCount: 0,
            totals: [],
        });
        const noByBase = {
            totals: personalWithBases.totals,
            chestCount: personalWithBases.chestCount,
            omittedPrivate: null,
        };
        expect(personalFor(noByBase, C)).toBe(noByBase);
    });

    it('chestsInBase keeps only the base members (unbased chests drop out)', () => {
        const rows = [{ base: BASE_A }, { base: null }, { base: BASE_C }];
        expect(chestsInBase(rows, A)).toEqual([{ base: BASE_A }]);
        expect(chestsInBase(rows, null)).toBe(rows);
    });
});
