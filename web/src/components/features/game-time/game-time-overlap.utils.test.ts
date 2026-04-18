import { describe, it, expect } from 'vitest';
import { checkGameTimeOverlap, walkEventHours } from './game-time-overlap.utils';

/**
 * ROK-1039 — `checkGameTimeOverlap` must use Sunday-first dayOfWeek convention
 * (0=Sun..6=Sat), matching what the server returns and what the grid UI expects.
 *
 * The pre-fix code applied an off-by-one: `gameDay = jsDay === 0 ? 6 : jsDay - 1`,
 * which mapped JS Sunday (0) → 6 and JS Monday (1) → 0. That causes Sunday events
 * to miss Sunday slots and Monday events to falsely match Sunday slots.
 *
 * Tests build dates with the local-timezone Date constructor (y, m, d, h, min)
 * so that `.getDay()` / `.getHours()` observed inside the util match the
 * day/hour values used to define the slots — regardless of CI timezone.
 */

type Slot = { dayOfWeek: number; hour: number; status?: string };

/**
 * Build an ISO string for a specific local weekday + hour.
 * Anchors on 2026-04-12 which is a known Sunday (dayOfWeek=0 in Sunday-first).
 * dayOffset=0→Sun, 1→Mon, 2→Tue, 3→Wed, 4→Thu, 5→Fri, 6→Sat.
 */
function localISO(dayOffset: number, hour: number, minute = 0): string {
    // 2026-04-12 is a Sunday. Month is 0-indexed in Date constructor.
    const d = new Date(2026, 3, 12 + dayOffset, hour, minute, 0, 0);
    return d.toISOString();
}

describe('checkGameTimeOverlap — AC1 overlap returns true', () => {
    it('returns true when event falls entirely within an available slot (full overlap)', () => {
        const slots: Slot[] = [{ dayOfWeek: 1, hour: 19, status: 'available' }];
        const startTime = localISO(1, 19); // Monday 19:00
        const endTime = localISO(1, 20);   // Monday 20:00

        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(true);
    });

    it('returns true when event partially overlaps an available slot', () => {
        const slots: Slot[] = [{ dayOfWeek: 1, hour: 19, status: 'available' }];
        const startTime = localISO(1, 18, 30); // Monday 18:30
        const endTime = localISO(1, 19, 30);   // Monday 19:30

        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(true);
    });
});

describe('checkGameTimeOverlap — AC2 no overlap returns false', () => {
    it('returns false when event time does not match any slot hour on same day', () => {
        const slots: Slot[] = [{ dayOfWeek: 1, hour: 19, status: 'available' }];
        const startTime = localISO(1, 14); // Monday 14:00
        const endTime = localISO(1, 15);   // Monday 15:00

        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(false);
    });

    it('returns false when event is on a different weekday than the slot', () => {
        const slots: Slot[] = [{ dayOfWeek: 1, hour: 19, status: 'available' }]; // Monday 19
        const startTime = localISO(3, 19); // Wednesday 19:00
        const endTime = localISO(3, 20);   // Wednesday 20:00

        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(false);
    });
});

describe('checkGameTimeOverlap — Sunday-first day convention (regression for ROK-1039)', () => {
    it('Sunday event matches Sunday slot (dayOfWeek=0)', () => {
        const slots: Slot[] = [{ dayOfWeek: 0, hour: 12, status: 'available' }];
        const startTime = localISO(0, 12); // Sunday 12:00
        const endTime = localISO(0, 13);   // Sunday 13:00

        // Pre-fix bug: getDay()=0 → gameDay=6 → looks up "6:12" → miss → false
        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(true);
    });

    it('Monday event does NOT match Sunday slot (off-by-one regression)', () => {
        const slots: Slot[] = [{ dayOfWeek: 0, hour: 12, status: 'available' }]; // Sunday only
        const startTime = localISO(1, 12); // Monday 12:00
        const endTime = localISO(1, 13);   // Monday 13:00

        // Pre-fix bug: getDay()=1 → gameDay=0 → looks up "0:12" → HIT → true (wrong)
        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(false);
    });

    it.each([
        { dayOffset: 0, dayName: 'Sunday', slotDow: 0 },
        { dayOffset: 1, dayName: 'Monday', slotDow: 1 },
        { dayOffset: 2, dayName: 'Tuesday', slotDow: 2 },
        { dayOffset: 3, dayName: 'Wednesday', slotDow: 3 },
        { dayOffset: 4, dayName: 'Thursday', slotDow: 4 },
        { dayOffset: 5, dayName: 'Friday', slotDow: 5 },
        { dayOffset: 6, dayName: 'Saturday', slotDow: 6 },
    ])('$dayName event (dayOfWeek=$slotDow) matches same-day slot', ({ dayOffset, slotDow }) => {
        const slots: Slot[] = [{ dayOfWeek: slotDow, hour: 20, status: 'available' }];
        const startTime = localISO(dayOffset, 20);
        const endTime = localISO(dayOffset, 21);

        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(true);
    });
});

describe('checkGameTimeOverlap — midnight-spanning events', () => {
    it('returns true when Friday evening slot matches Friday portion of Fri→Sat event', () => {
        const slots: Slot[] = [{ dayOfWeek: 5, hour: 23, status: 'available' }]; // Fri 23
        const startTime = localISO(5, 23);   // Friday 23:00
        const endTime = localISO(6, 2);      // Saturday 02:00 (spans midnight)

        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(true);
    });

    it('returns true when Saturday slot matches Saturday portion of Fri→Sat event', () => {
        const slots: Slot[] = [{ dayOfWeek: 6, hour: 1, status: 'available' }]; // Sat 01
        const startTime = localISO(5, 23);   // Friday 23:00
        const endTime = localISO(6, 2);      // Saturday 02:00 (spans midnight)

        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(true);
    });
});

describe('checkGameTimeOverlap — slot status filtering', () => {
    it('ignores blocked slots (only available/unset count)', () => {
        const slots: Slot[] = [
            { dayOfWeek: 1, hour: 19, status: 'blocked' },   // blocked at event time
            { dayOfWeek: 3, hour: 10, status: 'available' }, // unrelated available
        ];
        const startTime = localISO(1, 19); // Monday 19:00 — only overlaps the blocked slot
        const endTime = localISO(1, 20);

        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(false);
    });

    it('counts explicit status="available" as overlap', () => {
        const slots: Slot[] = [{ dayOfWeek: 1, hour: 19, status: 'available' }];
        const startTime = localISO(1, 19);
        const endTime = localISO(1, 20);

        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(true);
    });

    it('treats slot with no status field as available', () => {
        const slots: Slot[] = [{ dayOfWeek: 2, hour: 15 }]; // no status
        const startTime = localISO(2, 15); // Tuesday 15:00
        const endTime = localISO(2, 16);   // Tuesday 16:00

        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(true);
    });
});

describe('checkGameTimeOverlap — edge cases', () => {
    it('returns false for empty slots array', () => {
        const startTime = localISO(1, 19);
        const endTime = localISO(1, 20);

        expect(checkGameTimeOverlap([], startTime, endTime)).toBe(false);
    });

    it('advances cursor past sub-hour start when event begins mid-hour', () => {
        // Slot is ONLY at 20:00 (not 19:00). Event runs 19:30–20:15.
        // Cursor should floor to 19:00, detect < start (19:30), advance to 20:00,
        // and find the match at the slot at hour=20.
        const slots: Slot[] = [{ dayOfWeek: 1, hour: 20, status: 'available' }];
        const startTime = localISO(1, 19, 30); // Monday 19:30
        const endTime = localISO(1, 20, 15);   // Monday 20:15

        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(true);
    });

    it('keeps cursor on event start hour when start is exactly on the hour', () => {
        const slots: Slot[] = [{ dayOfWeek: 1, hour: 19, status: 'available' }];
        const startTime = localISO(1, 19);     // Monday 19:00 exactly
        const endTime = localISO(1, 19, 45);   // Monday 19:45

        expect(checkGameTimeOverlap(slots, startTime, endTime)).toBe(true);
    });
});

/**
 * ROK-1056 — walkEventHours is the shared cursor iterator used by both
 * checkGameTimeOverlap and GameTimeWidget.collectDayHours. These tests lock
 * the iterator's contract so either caller can rely on identical behavior.
 */
function collectVisits(startTime: string, endTime: string): Array<[number, number]> {
    const visits: Array<[number, number]> = [];
    walkEventHours(startTime, endTime, (dayOfWeek, hour) => {
        visits.push([dayOfWeek, hour]);
    });
    return visits;
}

describe('walkEventHours — iterator contract', () => {
    it('visits every whole hour between start and end', () => {
        const visits = collectVisits(localISO(1, 19), localISO(1, 22));
        expect(visits).toEqual([[1, 19], [1, 20], [1, 21]]);
    });

    it('floors sub-hour start to the next whole hour', () => {
        // 19:30 → first whole hour inside [start, end) is 20:00
        const visits = collectVisits(localISO(1, 19, 30), localISO(1, 21));
        expect(visits).toEqual([[1, 20]]);
    });

    it('visits the start hour when start is exactly on the hour', () => {
        const visits = collectVisits(localISO(1, 19), localISO(1, 19, 45));
        expect(visits).toEqual([[1, 19]]);
    });

    it('does not visit the end hour when end is exactly on the hour', () => {
        const visits = collectVisits(localISO(1, 19), localISO(1, 20));
        expect(visits).toEqual([[1, 19]]);
    });

    it('crosses midnight and updates dayOfWeek', () => {
        const visits = collectVisits(localISO(5, 23), localISO(6, 2));
        expect(visits).toEqual([[5, 23], [6, 0], [6, 1]]);
    });

    it('yields nothing when end <= start', () => {
        expect(collectVisits(localISO(1, 19), localISO(1, 19))).toEqual([]);
        expect(collectVisits(localISO(1, 20), localISO(1, 19))).toEqual([]);
    });

    it('yields nothing when the range is entirely inside a single sub-hour window', () => {
        // 19:15 → 19:45 has no whole-hour boundary inside [start, end)
        expect(collectVisits(localISO(1, 19, 15), localISO(1, 19, 45))).toEqual([]);
    });
});

/**
 * ROK-1056 — DST boundary sanity. We don't pin the test timezone, so instead
 * of asserting exact hour numbers (which depend on host TZ), we assert that
 * checkGameTimeOverlap agrees with walkEventHours across the boundary: for
 * every hour the walker visits, a slot marked available at that (day, hour)
 * must produce an overlap, and the absence of matching slots must not.
 *
 * 2026-03-08 is US spring-forward, 2026-11-01 is US fall-back. JS's
 * setHours(getHours()+1) is DST-aware, so on spring-forward the skipped
 * wall-clock hour is never visited, and on fall-back the repeated wall-clock
 * hour is visited once per occurrence.
 */
describe('checkGameTimeOverlap — DST boundary consistency (ROK-1056)', () => {
    it('spring-forward Sunday 2026-03-08: overlap answer matches walker visits', () => {
        // 2026-03-08 is a Sunday (dayOffset 0 from 2026-03-08). Anchor directly.
        const start = new Date(2026, 2, 8, 1, 0, 0, 0).toISOString();   // Sun 01:00 local
        const end = new Date(2026, 2, 8, 4, 0, 0, 0).toISOString();     // Sun 04:00 local
        const visits = collectVisits(start, end);

        expect(visits.length).toBeGreaterThan(0);
        // Every visited (day, hour) with a matching available slot produces overlap.
        for (const [dayOfWeek, hour] of visits) {
            const slots: Slot[] = [{ dayOfWeek, hour, status: 'available' }];
            expect(checkGameTimeOverlap(slots, start, end)).toBe(true);
        }
        // A slot at an hour the walker did not visit must not produce overlap.
        const visitedKeys = new Set(visits.map(([d, h]) => `${d}:${h}`));
        const unvisitedHour = [0, 1, 2, 3, 4, 5].find((h) => !visitedKeys.has(`${visits[0][0]}:${h}`));
        if (unvisitedHour !== undefined) {
            const slots: Slot[] = [{ dayOfWeek: visits[0][0], hour: unvisitedHour, status: 'available' }];
            expect(checkGameTimeOverlap(slots, start, end)).toBe(false);
        }
    });

    it('fall-back Sunday 2026-11-01: overlap answer matches walker visits', () => {
        const start = new Date(2026, 10, 1, 1, 0, 0, 0).toISOString();  // Sun 01:00 local
        const end = new Date(2026, 10, 1, 3, 0, 0, 0).toISOString();    // Sun 03:00 local
        const visits = collectVisits(start, end);

        expect(visits.length).toBeGreaterThan(0);
        for (const [dayOfWeek, hour] of visits) {
            const slots: Slot[] = [{ dayOfWeek, hour, status: 'available' }];
            expect(checkGameTimeOverlap(slots, start, end)).toBe(true);
        }
    });
});
