/**
 * Contract tests for the organiser "Rally" nudge (ROK-1618).
 *
 * Two things are pinned here:
 * 1. `RallyNonVotersResponseSchema` — the 200 body shape. The counts are
 *    non-negative integers and `cooldownUntil` is a real ISO instant, so a
 *    seconds/milliseconds slip or a `Date` that stringified oddly fails here
 *    rather than in a toast.
 * 2. `summariseRally` — the ONE success string table (AC3). It lives in the
 *    contract because both the API unit spec and the web toast read it; a
 *    web-side re-wording is the bug this file prevents.
 */
import { describe, it, expect } from 'vitest';
import {
    RallyNonVotersRequestSchema,
    RallyNonVotersResponseSchema,
    summariseRally,
    type RallyNonVotersResponseDto,
} from '../lineup-scheduling.schema.js';

/** Minimal valid rally response payload. */
function baseResponse(): RallyNonVotersResponseDto {
    return {
        pending: 3,
        nudged: 2,
        skipped: 1,
        cooldownUntil: '2026-09-19T20:45:55.710Z',
    };
}

describe('RallyNonVotersResponseSchema', () => {
    it('accepts a well-formed rally response', () => {
        const parsed = RallyNonVotersResponseSchema.parse(baseResponse());
        expect(parsed).toEqual(baseResponse());
    });

    it('accepts an all-zero response (nobody pending)', () => {
        const parsed = RallyNonVotersResponseSchema.parse({
            ...baseResponse(),
            pending: 0,
            nudged: 0,
            skipped: 0,
        });
        expect(parsed.pending).toBe(0);
    });

    it.each(['pending', 'nudged', 'skipped'] as const)(
        'rejects a negative %s count',
        (field) => {
            const result = RallyNonVotersResponseSchema.safeParse({
                ...baseResponse(),
                [field]: -1,
            });
            expect(result.success).toBe(false);
        },
    );

    it('rejects a fractional count', () => {
        const result = RallyNonVotersResponseSchema.safeParse({
            ...baseResponse(),
            nudged: 1.5,
        });
        expect(result.success).toBe(false);
    });

    it('rejects a cooldownUntil that is not an ISO datetime', () => {
        const result = RallyNonVotersResponseSchema.safeParse({
            ...baseResponse(),
            cooldownUntil: 'in 6 hours',
        });
        expect(result.success).toBe(false);
    });

    it('rejects a missing cooldownUntil', () => {
        const { cooldownUntil: _omitted, ...rest } = baseResponse();
        const result = RallyNonVotersResponseSchema.safeParse(rest);
        expect(result.success).toBe(false);
    });
});

describe('RallyNonVotersRequestSchema (ROK-1635)', () => {
    it('accepts an empty body — the legacy caller rallies the leader', () => {
        const parsed = RallyNonVotersRequestSchema.parse({});
        expect(parsed.slotId).toBeUndefined();
    });

    it('accepts an explicit slot id', () => {
        expect(RallyNonVotersRequestSchema.parse({ slotId: 42 })).toEqual({
            slotId: 42,
        });
    });

    it.each([0, -1, 1.5, '42', null])(
        'rejects %p as a slot id',
        (slotId) => {
            const result = RallyNonVotersRequestSchema.safeParse({ slotId });
            expect(result.success).toBe(false);
        },
    );
});

describe('summariseRally', () => {
    it('reports the empty audience before anything else, naming THIS time', () => {
        // Not "everyone has voted": the audience is the leading slot's
        // non-answerers, and a member who voted on another day is pending.
        expect(summariseRally(0, 0, 0)).toBe(
            'Everyone has answered this time — nobody to rally',
        );
    });

    it('uses the singular for exactly one nudged member', () => {
        expect(summariseRally(1, 1, 0)).toBe('Nudged 1 member');
    });

    it('uses the plural for more than one nudged member', () => {
        expect(summariseRally(4, 3, 1)).toBe('Nudged 3 members');
    });

    it("reports the rally's own dedup when everyone pending was skipped", () => {
        expect(summariseRally(2, 0, 2)).toBe(
            'Everyone left was already rallied recently',
        );
    });
});
