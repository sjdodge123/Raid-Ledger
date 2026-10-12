/**
 * Contract tests for the absence-create input (TDB:388).
 *
 * `GameTimeAbsenceInputSchema` guards POST /users/me/game-time/absences. Both
 * dates must be strict ISO calendar dates (YYYY-MM-DD) and the range may not
 * end before it starts. Before this, both dates were bare strings and any
 * value (or an inverted range) reached the database.
 */
import { describe, it, expect } from 'vitest';
import {
    GameTimeAbsenceInputSchema,
    GameTimeAbsenceSchema,
    GameTimeEventBlockSchema,
    GameTimeResponseSchema,
} from '../game-time.schema.js';

/** Issue paths + messages, or [] when the input parsed. */
function issuesOf(input: Record<string, unknown>) {
    const result = GameTimeAbsenceInputSchema.safeParse(input);
    if (result.success) return [];
    return result.error.issues.map(({ path, message }) => ({ path, message }));
}

function pathsOf(input: Record<string, unknown>) {
    return issuesOf(input).map(({ path }) => path);
}

describe('GameTimeAbsenceInputSchema — valid ranges', () => {
    it('accepts a same-day range', () => {
        const input = { startDate: '2026-10-05', endDate: '2026-10-05' };
        expect(issuesOf(input)).toEqual([]);
        expect(GameTimeAbsenceInputSchema.parse(input)).toEqual(input);
    });

    it('accepts an end date after the start date without a reason', () => {
        const input = { startDate: '2026-10-05', endDate: '2026-10-12' };
        expect(GameTimeAbsenceInputSchema.parse(input)).toEqual(input);
    });

    it('accepts an end date after the start date with a reason', () => {
        const input = {
            startDate: '2026-12-30',
            endDate: '2027-01-02',
            reason: 'Holiday travel',
        };
        expect(GameTimeAbsenceInputSchema.parse(input)).toEqual(input);
    });

    it('accepts a leap day', () => {
        const input = { startDate: '2028-02-29', endDate: '2028-03-01' };
        expect(issuesOf(input)).toEqual([]);
    });
});

describe('GameTimeAbsenceInputSchema — range order', () => {
    it('rejects an end date before the start date, on the endDate path', () => {
        const input = { startDate: '2026-10-12', endDate: '2026-10-05' };
        expect(issuesOf(input)).toEqual([
            {
                path: ['endDate'],
                message: 'endDate must be on or after startDate',
            },
        ]);
    });
});

const MALFORMED_DATES = [
    '2026-9-1',
    '2026-09-01T00:00:00Z',
    'tomorrow',
    '2026-02-30',
];

describe('GameTimeAbsenceInputSchema — date format', () => {
    it.each(MALFORMED_DATES)('rejects startDate %j on its own path', (bad) => {
        const input = { startDate: bad, endDate: '2099-12-31' };
        expect(pathsOf(input)).toEqual([['startDate']]);
    });

    it.each(MALFORMED_DATES)('rejects endDate %j on its own path', (bad) => {
        const input = { startDate: '2000-01-01', endDate: bad };
        expect(pathsOf(input)).toEqual([['endDate']]);
    });
});

describe('GameTimeAbsenceInputSchema — reason', () => {
    const dates = { startDate: '2026-10-05', endDate: '2026-10-06' };

    it('accepts a reason of exactly 255 characters', () => {
        expect(pathsOf({ ...dates, reason: 'x'.repeat(255) })).toEqual([]);
    });

    it('rejects a reason longer than 255 characters', () => {
        expect(pathsOf({ ...dates, reason: 'x'.repeat(256) })).toEqual([
            ['reason'],
        ]);
    });
});

/**
 * Parse outcome for any input, with a throw captured as data so a crash shows
 * up in the assertion diff instead of aborting the test.
 */
function outcomeOf(input: unknown) {
    try {
        const result = GameTimeAbsenceInputSchema.safeParse(input);
        if (result.success) return { success: true, issues: [] };
        const issues = result.error.issues.map(({ path, code }) => ({
            path,
            code,
        }));
        return { success: false, issues };
    } catch (err) {
        return { threw: String(err) };
    }
}

describe('GameTimeAbsenceInputSchema — non-object input', () => {
    // A POST with no JSON body reaches the controller as `undefined`.
    it.each([
        { label: 'undefined', input: undefined },
        { label: 'null', input: null },
        { label: 'an array', input: [] },
        { label: 'a string', input: 'x' },
        { label: 'a number', input: 42 },
    ])(
        'reports only the root invalid_type issue for $label',
        ({ input }) => {
            expect(outcomeOf(input)).toEqual({
                success: false,
                issues: [{ path: [], code: 'invalid_type' }],
            });
        },
    );
});

describe('GameTimeResponseSchema.calendarBusy (ROK-1593 §3.6)', () => {
    const legacy = {
        slots: [{ dayOfWeek: 1, hour: 20, status: 'available' }],
        gameTimeStale: false,
    };
    const busy = { dayOfWeek: 2, startHour: 18, endHour: 21, provider: 'google' };

    function busyIssues(block: Record<string, unknown>) {
        const result = GameTimeResponseSchema.safeParse({ ...legacy, calendarBusy: [block] });
        if (result.success) return [];
        return result.error.issues.map(({ code, path }) => ({ code, path }));
    }

    it('still parses a pre-1593 payload without calendarBusy', () => {
        expect(GameTimeResponseSchema.parse(legacy)).toEqual(legacy);
    });

    it('parses busy blocks', () => {
        const input = { ...legacy, calendarBusy: [busy, { ...busy, endHour: 24 }] };
        expect(GameTimeResponseSchema.parse(input)).toEqual(input);
    });

    it('rejects a stray key on a busy block (no event detail leaks)', () => {
        expect(busyIssues({ ...busy, title: 'Dentist' })).toEqual([
            { code: 'unrecognized_keys', path: ['calendarBusy', 0] },
        ]);
    });

    it('rejects an unknown provider', () => {
        expect(busyIssues({ ...busy, provider: 'outlook' })).toEqual([
            { code: 'invalid_value', path: ['calendarBusy', 0, 'provider'] },
        ]);
    });

    it('rejects an hour outside the grid', () => {
        expect(busyIssues({ ...busy, endHour: 25 })).toEqual([
            { code: 'too_big', path: ['calendarBusy', 0, 'endHour'] },
        ]);
    });
});

describe('GameTimeAbsenceSchema.source/provider (ROK-1593 PR-B)', () => {
    const legacy = { id: 7, startDate: '2026-10-01', endDate: '2026-10-03', reason: 'Trip' };

    function absenceIssues(input: Record<string, unknown>) {
        const result = GameTimeAbsenceSchema.safeParse(input);
        if (result.success) return [];
        return result.error.issues.map(({ code, path }) => ({ code, path }));
    }

    it('still parses a pre-1593 absence without source or provider', () => {
        expect(GameTimeAbsenceSchema.parse(legacy)).toEqual(legacy);
    });

    it('parses a calendar absence with its provider', () => {
        const input = { ...legacy, reason: null, source: 'calendar', provider: 'google' };
        expect(GameTimeAbsenceSchema.parse(input)).toEqual(input);
    });

    it('parses a manual absence', () => {
        const input = { ...legacy, source: 'manual' };
        expect(GameTimeAbsenceSchema.parse(input)).toEqual(input);
    });

    it('rejects an unknown source', () => {
        expect(absenceIssues({ ...legacy, source: 'import' })).toEqual([
            { code: 'invalid_value', path: ['source'] },
        ]);
    });

    it('rejects an unknown provider', () => {
        expect(absenceIssues({ ...legacy, source: 'calendar', provider: 'outlook' })).toEqual([
            { code: 'invalid_value', path: ['provider'] },
        ]);
    });
});

describe('GameTimeEventBlockSchema.calendarCopy (ROK-1595 G-1)', () => {
    const legacy = {
        eventId: 12,
        title: 'Karazhan',
        gameSlug: null,
        gameName: null,
        coverUrl: null,
        signupId: 34,
        confirmationStatus: 'confirmed',
        dayOfWeek: 4,
        startHour: 20,
        endHour: 23,
    };

    it('still parses a pre-1595 event block without calendarCopy', () => {
        const parsed = GameTimeEventBlockSchema.parse(legacy);
        expect(parsed).toEqual(legacy);
        expect(parsed).not.toHaveProperty('calendarCopy');
    });

    it('parses a block that names the calendar holding our copy', () => {
        const input = { ...legacy, calendarCopy: 'google' };
        expect(GameTimeEventBlockSchema.parse(input)).toEqual(input);
    });

    it('rejects an unknown provider', () => {
        const result = GameTimeEventBlockSchema.safeParse({ ...legacy, calendarCopy: 'outlook' });
        expect(result.success ? [] : result.error.issues.map(({ code, path }) => ({ code, path }))).toEqual([
            { code: 'invalid_value', path: ['calendarCopy'] },
        ]);
    });
});
