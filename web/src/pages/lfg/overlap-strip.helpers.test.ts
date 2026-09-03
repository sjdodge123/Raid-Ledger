/**
 * ROK-1464 — day-bucketing for the "When everyone's free" strip.
 *
 * Every fixture instant is built from LOCAL date components and then
 * serialised, so the assertions hold in any timezone the suite runs under —
 * the helper's contract is "the viewer's local time", not UTC.
 */
import { describe, it, expect } from 'vitest';
import type { LfgOverlapWindowDto } from '@raid-ledger/contract';
import {
    buildDayStrip,
    formatWindowLabel,
    pickBestWindows,
} from './overlap-strip.helpers';

/** An instant expressed by the viewer's LOCAL wall clock. */
function localIso(day: number, hour: number, minute = 0): string {
    return new Date(2026, 8, day, hour, minute, 0, 0).toISOString();
}

function makeWindow(
    over: Partial<LfgOverlapWindowDto> = {},
): LfgOverlapWindowDto {
    return {
        start: localIso(2, 19),
        end: localIso(2, 22),
        availableCount: 3,
        totalCount: 3,
        members: [1, 2, 3],
        ...over,
    };
}

// 2026-09-02 is a Wednesday; 2026-09-03 a Thursday.
const WED = 2;
const THU = 3;

describe('buildDayStrip', () => {
    it('returns seven Mon–Sun columns', () => {
        const strip = buildDayStrip([], 2);

        expect(strip.map((d) => d.label)).toEqual([
            'Mon',
            'Tue',
            'Wed',
            'Thu',
            'Fri',
            'Sat',
            'Sun',
        ]);
        expect(strip.every((d) => d.status === 'none')).toBe(true);
    });

    it('marks a full-roster window as a hit on its local weekday', () => {
        const strip = buildDayStrip(
            [makeWindow({ availableCount: 3, totalCount: 3 })],
            3,
        );

        expect(strip[2]).toMatchObject({ label: 'Wed', status: 'hit' });
        expect(strip[3].status).toBe('none');
    });

    it('marks a partial window as part, never as a hit', () => {
        const strip = buildDayStrip(
            [makeWindow({ availableCount: 2, totalCount: 3, members: [1, 2] })],
            3,
        );

        expect(strip[2].status).toBe('part');
    });

    it('buckets a window that crosses local midnight into both days', () => {
        const strip = buildDayStrip(
            [makeWindow({ start: localIso(WED, 23), end: localIso(THU, 1) })],
            3,
        );

        expect(strip[2].status).toBe('hit');
        expect(strip[3].status).toBe('hit');
    });

    it('keeps the stronger status when two windows share a day', () => {
        const strip = buildDayStrip(
            [
                makeWindow({ availableCount: 2, totalCount: 3 }),
                makeWindow({ start: localIso(WED, 9), end: localIso(WED, 11) }),
            ],
            3,
        );

        expect(strip[2].status).toBe('hit');
    });

    it('never reports a hit when the roster size is zero', () => {
        const strip = buildDayStrip(
            [makeWindow({ availableCount: 0, totalCount: 0, members: [] })],
            0,
        );

        expect(strip[2].status).toBe('part');
    });
});

describe('pickBestWindows', () => {
    it('keeps the server ranking and caps at two rows', () => {
        const first = makeWindow({ start: localIso(WED, 19) });
        const second = makeWindow({ start: localIso(THU, 19) });
        const third = makeWindow({ start: localIso(4, 19) });

        expect(pickBestWindows([first, second, third])).toEqual([
            first,
            second,
        ]);
    });
});

describe('formatWindowLabel', () => {
    it('collapses a shared meridiem into one suffix', () => {
        const label = formatWindowLabel(
            makeWindow({ start: localIso(WED, 19), end: localIso(WED, 22) }),
        );

        expect(label).toBe('Wed 7–10 PM · 3 of 3 free');
    });

    it('prints both meridiems when the window straddles noon', () => {
        const label = formatWindowLabel(
            makeWindow({
                start: localIso(WED, 11, 30),
                end: localIso(WED, 14),
                availableCount: 2,
                totalCount: 3,
            }),
        );

        expect(label).toBe('Wed 11:30 AM–2 PM · 2 of 3 free');
    });
});
