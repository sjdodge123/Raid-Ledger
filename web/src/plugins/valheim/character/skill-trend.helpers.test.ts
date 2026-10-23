/** ROK-1882 — the trend chip's pure helpers: slice, rounding, sign, tone, dates, dots, sentence (AC 8–10). */
import { describe, expect, it } from 'vitest';
import type { ValheimSkillTrend } from '@raid-ledger/contract';
import { valheimSkillTrend } from '../../../test/mocks/valheim-armory-handlers';
import {
    dotSizePx,
    formatGain,
    formatTrendDate,
    roundGain,
    skillTrendFor,
    trendDetail,
    trendDots,
    trendLabel,
    trendSentence,
    trendTone,
} from './skill-trend.helpers';

function must<T>(v: T | null | undefined, label: string): T {
    if (v === null || v === undefined) throw new Error(`missing ${label}`);
    return v;
}

describe('skillTrendFor', () => {
    it('returns null with no skillTrend, empty days, or a skill that never moved', () => {
        expect(skillTrendFor('Swords', undefined)).toBeNull();
        expect(skillTrendFor('Swords', { days: [] })).toBeNull();
        expect(skillTrendFor('Bows', valheimSkillTrend)).toBeNull();
    });

    it('keeps the same three dates on every row, newest first, null for an idle day', () => {
        const run = must(skillTrendFor('Run', valheimSkillTrend), 'Run');
        expect(run.days).toEqual([
            { date: '2026-10-20', gain: 0.8 },
            { date: '2026-10-18', gain: null },
            { date: '2026-10-15', gain: 0.3 },
        ]);
        expect(run.total).toBe(1.1);
    });

    it('sums the ROUNDED days so the chip matches the detail line', () => {
        const trend: ValheimSkillTrend = {
            days: [1, 2, 3].map((d) => ({ date: `2026-10-0${d}`, gains: { Axes: 1.04 } })),
        };
        expect(must(skillTrendFor('Axes', trend), 'Axes').total).toBe(3);
    });

    it('drops a row whose rounded total is zero (a gain cancelled by a loss)', () => {
        const trend: ValheimSkillTrend = {
            days: [
                { date: '2026-10-02', gains: { Axes: 1.0 } },
                { date: '2026-10-01', gains: { Axes: -1.0 } },
            ],
        };
        expect(skillTrendFor('Axes', trend)).toBeNull();
    });
});

describe('formatting', () => {
    it('signs gains with + and U+2212, one decimal', () => {
        expect(formatGain(2)).toBe('+2.0');
        expect(formatGain(-1.2)).toBe('−1.2');
        expect(formatGain(0)).toBe('0.0');
        expect(roundGain(-0.04)).toBe(0);
        expect(Object.is(roundGain(-0.04), -0)).toBe(false);
    });

    it('formats the bucket date from its parts, never through Date (AC 9)', () => {
        expect(formatTrendDate('2026-10-20')).toBe('Oct 20');
        expect(formatTrendDate('2026-01-01')).toBe('Jan 1');
        expect(formatTrendDate('2026-12-31')).toBe('Dec 31');
        expect(formatTrendDate('garbage')).toBe('garbage');
    });

    it('labels, details and describes a 3-day gain (AC 8)', () => {
        const t = must(skillTrendFor('Swords', valheimSkillTrend), 'Swords');
        expect(trendLabel(t)).toBe('+4.1 over 3 sessions');
        expect(trendDetail(t)).toBe('Oct 20 +2.0 · Oct 18 +1.6 · Oct 15 +0.5');
        expect(trendSentence(t)).toBe('+4.1 over 3 sessions: +2.0 on Oct 20, +1.6 on Oct 18, +0.5 on Oct 15');
        expect(trendTone(t.total)).toBe('success');
    });

    it('singular "session" for one day; a net loss is danger-toned', () => {
        const one = must(skillTrendFor('Swords', { days: [{ date: '2026-10-20', gains: { Swords: 2 } }] }), 'one');
        expect(trendLabel(one)).toBe('+2.0 over 1 session');
        const loss = must(skillTrendFor('-1287461328', valheimSkillTrend), 'modded');
        expect(trendLabel(loss)).toBe('−1.2 over 3 sessions');
        expect(trendTone(loss.total)).toBe('danger');
        expect(trendDetail(loss)).toBe('Oct 20 −1.5 · Oct 18 +0.3 · Oct 15 no change');
    });
});

describe('dots', () => {
    it('sizes 4–8px by gain over the best day; no gain or a loss is a 4px hollow dot', () => {
        expect(dotSizePx(2, 2)).toBe(8);
        expect(dotSizePx(1, 2)).toBe(6);
        expect(dotSizePx(null, 2)).toBe(4);
        expect(dotSizePx(-1, 2)).toBe(4);
    });

    it('orders oldest → newest and marks only positive days filled', () => {
        const loss = must(skillTrendFor('-1287461328', valheimSkillTrend), 'modded');
        expect(trendDots(loss)).toEqual([
            { date: '2026-10-15', px: 4, filled: false },
            { date: '2026-10-18', px: 8, filled: true },
            { date: '2026-10-20', px: 4, filled: false },
        ]);
    });
});
