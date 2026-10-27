/** ROK-2014 — the shared trend chip helpers under the Materials format (whole items, "days"). */
import { describe, expect, it } from 'vitest';
import {
    formatDelta,
    roundTo,
    trendDetail,
    trendDots,
    trendFor,
    trendLabel,
    trendSentence,
    trendTone,
    type TrendFormat,
} from './trend.helpers';

const DAYS: TrendFormat = { decimals: 0, noun: 'day' };
const TREND = {
    days: [
        { date: '2026-10-17', gains: { Wood: 20, Stone: -10, Coins: 1240 } },
        { date: '2026-10-16', gains: { Wood: 15 } },
        { date: '2026-10-14', gains: { Wood: 10, Resin: 0.4 } },
    ],
};

function must<T>(v: T | null | undefined, label: string): T {
    if (v === null || v === undefined) throw new Error(`missing ${label}`);
    return v;
}

describe('trend.helpers (shared Valheim trend chip)', () => {
    it('sums the rounded days and keeps every play day, newest first', () => {
        expect(trendFor('Wood', TREND, 0)).toEqual({
            total: 45,
            days: [
                { date: '2026-10-17', gain: 20 },
                { date: '2026-10-16', gain: 15 },
                { date: '2026-10-14', gain: 10 },
            ],
        });
    });

    it('no history, an id that never moved, or a total that rounds to 0 → null (no chip)', () => {
        expect(trendFor('Wood', undefined, 0)).toBeNull();
        expect(trendFor('Wood', { days: [] }, 0)).toBeNull();
        expect(trendFor('SwordIron', TREND, 0)).toBeNull();
        expect(trendFor('Resin', TREND, 0)).toBeNull();
        expect(trendFor('Resin', TREND, 1)?.total).toBe(0.4);
    });

    it('a prefab named like an Object.prototype member reads its own gains only (Codex P2)', () => {
        for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
            expect(trendFor(id, TREND, 0)).toBeNull();
        }
        const own = { days: [{ date: '2026-10-17', gains: JSON.parse('{"__proto__":3,"constructor":2}') }] };
        expect(trendFor('__proto__', own, 0)?.total).toBe(3);
        expect(trendFor('constructor', own, 0)?.total).toBe(2);
    });

    it('formats whole items with a thousands separator and the U+2212 minus', () => {
        expect(formatDelta(1240, 0)).toBe('+1,240');
        expect(formatDelta(-10, 0)).toBe('−10');
        expect(formatDelta(0, 0)).toBe('0');
        expect(formatDelta(2, 1)).toBe('+2.0');
        expect(roundTo(-0.04, 1)).toBe(0);
    });

    it('labels in days, singular for one', () => {
        const wood = must(trendFor('Wood', TREND, 0), 'wood');
        expect(trendLabel(wood, DAYS)).toBe('+45 over 3 days');
        const one = must(trendFor('Wood', { days: TREND.days.slice(0, 1) }, 0), 'one');
        expect(trendLabel(one, DAYS)).toBe('+20 over 1 day');
        const stone = must(trendFor('Stone', TREND, 0), 'stone');
        expect(trendLabel(stone, DAYS)).toBe('−10 over 3 days');
        expect(trendTone(stone.total)).toBe('danger');
        expect(trendTone(wood.total)).toBe('success');
    });

    it('detail + sentence name each day; dots run oldest → newest, losses hollow', () => {
        const stone = must(trendFor('Stone', TREND, 0), 'stone');
        expect(trendDetail(stone, DAYS)).toBe('Oct 17 −10 · Oct 16 no change · Oct 14 no change');
        expect(trendSentence(stone, DAYS)).toBe(
            '−10 over 3 days: −10 on Oct 17, no change on Oct 16, no change on Oct 14',
        );
        const wood = must(trendFor('Wood', TREND, 0), 'wood');
        expect(trendDots(wood).map((d) => [d.date, d.px, d.filled])).toEqual([
            ['2026-10-14', 6, true],
            ['2026-10-16', 7, true],
            ['2026-10-17', 8, true],
        ]);
        expect(trendDots(stone).every((d) => !d.filled && d.px === 4)).toBe(true);
    });
});
