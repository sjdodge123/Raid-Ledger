/** ROK-2014 — Materials trend helpers: per-item slice, per-row map, the Base filter's trend pick. */
import { describe, expect, it } from 'vitest';
import {
    basesFixture,
    materialsFixture,
    personalWithBases,
} from '../../../test/mocks/valheim-materials-handlers';
import { personalFor } from './materials-bases.helpers';
import { itemTrendFor, rowTrends, sharedTrendFor } from './materials-trend.helpers';

const ALL = { days: [{ date: '2026-10-17', gains: { Wood: 45, Stone: -10 } }] };
const AT_A = { days: [{ date: '2026-10-17', gains: { Wood: 5 } }] };
const COINS = { days: [{ date: '2026-10-16', gains: { Coins: 100 } }] };

function must<T>(v: T | undefined, label: string): T {
    if (v === undefined) throw new Error(`missing ${label}`);
    return v;
}
const baseA = must(basesFixture[0], 'base A');

describe('materials-trend.helpers', () => {
    it('itemTrendFor: whole items; no trend → null', () => {
        expect(itemTrendFor('Wood', ALL)?.total).toBe(45);
        expect(itemTrendFor('Wood', undefined)).toBeNull();
        expect(itemTrendFor('SwordIron', ALL)).toBeNull();
    });

    it('rowTrends keeps only rows with a chip', () => {
        const map = rowTrends([{ prefab: 'Wood' }, { prefab: 'SwordIron' }, { prefab: 'Stone' }], ALL);
        expect([...map.keys()]).toEqual(['Wood', 'Stone']);
        expect(rowTrends([{ prefab: 'Wood' }], undefined).size).toBe(0);
    });

    it('sharedTrendFor: every shared chest for All bases, the base’s own under the filter', () => {
        const data = materialsFixture({
            shared: { ...materialsFixture().shared, trend: ALL },
            bases: [{ ...baseA, trend: AT_A }, ...basesFixture.slice(1)],
        });
        expect(sharedTrendFor(data, null)).toBe(ALL);
        expect(sharedTrendFor(data, { ...baseA, trend: AT_A })).toBe(AT_A);
        expect(sharedTrendFor(data, baseA)).toBeUndefined();
    });

    it('personalFor swaps in the base group’s trend and drops the all-bases one', () => {
        const groups = personalWithBases.byBase ?? [];
        const personal = {
            ...personalWithBases,
            trend: ALL,
            byBase: groups.map((g) => (g.base === baseA.key ? { ...g, trend: COINS } : g)),
        };
        expect(personalFor(personal, baseA).trend).toBe(COINS);
        const atC = personalFor(personal, must(basesFixture[1], 'base C'));
        expect('trend' in atC).toBe(false);
        expect(personalFor(personal, null).trend).toBe(ALL);
    });
});
