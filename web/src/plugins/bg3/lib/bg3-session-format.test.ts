import { describe, expect, it } from 'vitest';
import type { Bg3Session } from '@raid-ledger/contract';
import {
    formatLevelChange,
    formatSaveCount,
    formatSessionDate,
    formatSessionDuration,
    formatSessionRange,
    sessionAreaChips,
} from './bg3-session-format';

const TZ = 'UTC';

function session(over: Partial<Bg3Session> = {}): Bg3Session {
    return {
        startedAt: '2026-10-27T19:40:00Z',
        endedAt: '2026-10-27T23:05:00Z',
        saveCount: 14,
        partyLevelFrom: 6,
        partyLevelTo: 7,
        areas: ['WLD_Main_A'],
        lastSaveId: 1,
        thumbnailUrl: null,
        ...over,
    };
}

describe('bg3-session-format (D-9)', () => {
    it('formats the date in the viewer time zone', () => {
        expect(formatSessionDate('2026-10-27T19:40:00Z', TZ)).toBe('Tue 27 Oct');
    });

    it('shows the clock range and a 3 h 25 m duration', () => {
        expect(formatSessionRange(session(), TZ)).toBe('19:40–23:05 · 3 h 25 m');
    });

    it('drops the range for a one-save session', () => {
        expect(formatSessionRange(session({ saveCount: 1 }), TZ)).toBeNull();
        expect(formatSaveCount(1)).toBe('1 save');
        expect(formatSaveCount(14)).toBe('14 saves');
    });

    it('formats durations without zero parts', () => {
        expect(formatSessionDuration(45 * 60_000)).toBe('45 m');
        expect(formatSessionDuration(2 * 3_600_000)).toBe('2 h');
    });

    it('shows a level change only when the level moved', () => {
        expect(formatLevelChange(session())).toBe('Level 6 → 7');
        expect(formatLevelChange(session({ partyLevelTo: 6 }))).toBeNull();
    });

    it('caps area chips at three plus an overflow count', () => {
        const chips = sessionAreaChips(['WLD_Main_A', 'CRE_Main_A', 'SCL_Main_A', 'SYS_Menuscreen_Camp_A', 'X_Unknown']);
        expect(chips).toEqual({ labels: ['Wilderness', 'Rosymorn Monastery', 'Shadow-Cursed Lands'], more: 2 });
        expect(sessionAreaChips(['Odd_Level'])).toEqual({ labels: ['Odd_Level'], more: 0 });
    });

    it('renders no chips when areas are hidden', () => {
        expect(sessionAreaChips(null)).toBeNull();
    });
});
