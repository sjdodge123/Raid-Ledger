/**
 * Unit tests for RecurrenceSchema and CreateEventSchema (ROK-426)
 *
 * Verifies that the `recurrence.until` field accepts both UTC ("Z") and
 * offset ("-05:00", "+09:00") datetime formats, that all recurrence
 * frequencies are accepted, and that non-repeating event creation remains
 * unaffected.
 */
import {
    RecurrenceSchema,
    CreateEventSchema,
} from '@raid-ledger/contract';

// ─── RecurrenceSchema ─────────────────────────────────────────────────────────

describe('RecurrenceSchema', () => {
    describe('until field — valid datetime formats', () => {
        it('accepts a UTC datetime (Z suffix)', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'weekly',
                until: '2026-05-30T23:59:59.000Z',
            });
            expect(result.success).toBe(true);
        });

        it('accepts a negative UTC offset (-05:00)', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'weekly',
                until: '2026-05-30T23:59:59.000-05:00',
            });
            expect(result.success).toBe(true);
        });

        it('accepts a positive UTC offset (+09:00)', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'weekly',
                until: '2026-05-30T23:59:59.000+09:00',
            });
            expect(result.success).toBe(true);
        });

        it('accepts a positive fractional offset (+05:30 — India)', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'weekly',
                until: '2026-05-30T23:59:59.000+05:30',
            });
            expect(result.success).toBe(true);
        });

        it('accepts a zero offset (+00:00)', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'weekly',
                until: '2026-05-30T23:59:59.000+00:00',
            });
            expect(result.success).toBe(true);
        });

        it('accepts a datetime without milliseconds but with offset', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'weekly',
                until: '2026-05-30T23:59:59-05:00',
            });
            expect(result.success).toBe(true);
        });
    });

    describe('until field — invalid formats are rejected', () => {
        it('rejects a plain date string (no time component)', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'weekly',
                until: '2026-05-30',
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                const paths = result.error.errors.map((e) => e.path.join('.'));
                expect(paths).toContain('until');
            }
        });

        it('rejects a non-ISO string', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'weekly',
                until: 'not-a-date',
            });
            expect(result.success).toBe(false);
        });

        it('rejects an empty string', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'weekly',
                until: '',
            });
            expect(result.success).toBe(false);
        });

        it('rejects null', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'weekly',
                until: null,
            });
            expect(result.success).toBe(false);
        });

        it('rejects undefined (field is required)', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'weekly',
            });
            expect(result.success).toBe(false);
        });

        it('rejects a numeric timestamp', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'weekly',
                until: 1748649599000,
            });
            expect(result.success).toBe(false);
        });
    });

    describe('frequency field', () => {
        const validUntil = '2026-05-30T23:59:59.000-05:00';

        it('accepts "weekly" frequency', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'weekly',
                until: validUntil,
            });
            expect(result.success).toBe(true);
        });

        it('accepts "biweekly" frequency', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'biweekly',
                until: validUntil,
            });
            expect(result.success).toBe(true);
        });

        it('accepts "monthly" frequency', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'monthly',
                until: validUntil,
            });
            expect(result.success).toBe(true);
        });

        it('rejects an unknown frequency value', () => {
            const result = RecurrenceSchema.safeParse({
                frequency: 'daily',
                until: validUntil,
            });
            expect(result.success).toBe(false);
        });

        it('rejects a missing frequency', () => {
            const result = RecurrenceSchema.safeParse({
                until: validUntil,
            });
            expect(result.success).toBe(false);
        });
    });
});

// ─── CreateEventSchema with recurrence ───────────────────────────────────────

describe('CreateEventSchema — recurrence integration', () => {
    const baseEvent = {
        title: 'Weekly Raid',
        startTime: '2026-03-01T19:00:00.000-05:00',
        endTime: '2026-03-01T22:00:00.000-05:00',
    };

    it('creates a repeating event with offset until (the bug scenario)', () => {
        const result = CreateEventSchema.safeParse({
            ...baseEvent,
            recurrence: {
                frequency: 'weekly',
                until: '2026-05-30T23:59:59.000-05:00', // TZDate.toISOString() format
            },
        });
        expect(result.success).toBe(true);
    });

    it('creates a repeating event with UTC until', () => {
        const result = CreateEventSchema.safeParse({
            ...baseEvent,
            recurrence: {
                frequency: 'weekly',
                until: '2026-05-30T23:59:59.000Z',
            },
        });
        expect(result.success).toBe(true);
    });

    it('creates a repeating biweekly event', () => {
        const result = CreateEventSchema.safeParse({
            ...baseEvent,
            recurrence: {
                frequency: 'biweekly',
                until: '2026-05-30T23:59:59.000-05:00',
            },
        });
        expect(result.success).toBe(true);
    });

    it('creates a repeating monthly event', () => {
        const result = CreateEventSchema.safeParse({
            ...baseEvent,
            recurrence: {
                frequency: 'monthly',
                until: '2026-05-30T23:59:59.000+09:00',
            },
        });
        expect(result.success).toBe(true);
    });

    it('rejects a repeating event when until is a bare date (old bug)', () => {
        const result = CreateEventSchema.safeParse({
            ...baseEvent,
            recurrence: {
                frequency: 'weekly',
                until: '2026-05-30', // would have passed before; still invalid
            },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            const allPaths = result.error.errors.map((e) => e.path.join('.'));
            expect(allPaths.some((p) => p.includes('until'))).toBe(true);
        }
    });

    it('creates a non-repeating event when recurrence is omitted', () => {
        const result = CreateEventSchema.safeParse(baseEvent);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.recurrence).toBeUndefined();
        }
    });

    it('rejects a non-repeating event when start time is after end time', () => {
        const result = CreateEventSchema.safeParse({
            title: 'Bad Event',
            startTime: '2026-03-01T22:00:00.000-05:00',
            endTime: '2026-03-01T19:00:00.000-05:00', // end before start
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            const paths = result.error.errors.map((e) => e.path.join('.'));
            expect(paths).toContain('endTime');
        }
    });

    it('creates a non-repeating event with all optional fields omitted', () => {
        const result = CreateEventSchema.safeParse({
            title: 'Minimal Event',
            startTime: '2026-03-01T19:00:00.000Z',
            endTime: '2026-03-01T22:00:00.000Z',
        });
        expect(result.success).toBe(true);
    });
});
