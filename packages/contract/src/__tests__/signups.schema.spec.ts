/**
 * Failing-first contract tests for ROK-1379 ("Running Late").
 *
 * Validates additive optional fields on `SignupResponseSchema`:
 *   - `runningLate` (boolean)
 *   - `runningLateAt` (nullable datetime)
 *   - `lateMinutes` (nullable positive int — column exists, unset in v1)
 *
 * The contract package has no test runner of its own; this spec mirrors the
 * convention in `lineup.schema.spec.ts`.
 */
import { describe, it, expect } from 'vitest';
import { SignupResponseSchema } from '../signups.schema.js';

const base = {
    id: 1,
    eventId: 2,
    user: { id: 3, discordId: '123', username: 'late-guy', avatar: null },
    note: null,
    signedUpAt: '2026-06-28T20:00:00.000Z',
    characterId: null,
    character: null,
    confirmationStatus: 'pending' as const,
    status: 'signed_up' as const,
};

describe('SignupResponseSchema — running-late fields (ROK-1379)', () => {
    it('accepts a running-late signup with timestamp', () => {
        const parsed = SignupResponseSchema.parse({
            ...base,
            runningLate: true,
            runningLateAt: '2026-06-28T20:05:00.000Z',
            lateMinutes: null,
        });
        expect(parsed.runningLate).toBe(true);
        expect(parsed.runningLateAt).toBe('2026-06-28T20:05:00.000Z');
    });

    it('treats the new fields as optional (backwards compatible)', () => {
        const parsed = SignupResponseSchema.parse(base);
        expect(parsed.runningLate).toBeUndefined();
        expect(parsed.runningLateAt).toBeUndefined();
    });

    it('rejects a non-positive lateMinutes value', () => {
        expect(() =>
            SignupResponseSchema.parse({ ...base, lateMinutes: 0 }),
        ).toThrow();
    });
});
