/**
 * Contract tests for the absence-create input (TDB:388).
 *
 * `GameTimeAbsenceInputSchema` guards POST /users/me/game-time/absences. Both
 * dates must be strict ISO calendar dates (YYYY-MM-DD) and the range may not
 * end before it starts. Before this, both dates were bare strings and any
 * value (or an inverted range) reached the database.
 */
import { describe, it, expect } from 'vitest';
import { GameTimeAbsenceInputSchema } from '../game-time.schema.js';

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
