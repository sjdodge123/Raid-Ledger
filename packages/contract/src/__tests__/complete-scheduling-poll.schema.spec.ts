/**
 * Contract tests for the organizer's bench pick on a scheduling lock (ROK-2025).
 *
 * `benchUserIds` is additive and optional: absent means the server benches the
 * latest yes-voters. It only makes sense with an `eventId` to sign voters up
 * to, so a pick without one is refused. Duplicates and membership are checked
 * by the API, not here.
 */
import { describe, it, expect } from 'vitest';
import { CompleteSchedulingPollSchema } from '../standalone-poll.schema.js';

const START = '2026-11-01T19:00:00.000Z';

function issuePaths(body: unknown): string[] {
    const parsed = CompleteSchedulingPollSchema.safeParse(body);
    return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
}

describe('CompleteSchedulingPollSchema benchUserIds (ROK-2025)', () => {
    it('accepts a pick alongside eventId and startTime', () => {
        const parsed = CompleteSchedulingPollSchema.parse({
            eventId: 7,
            startTime: START,
            benchUserIds: [11, 12],
        });
        expect(parsed.benchUserIds).toEqual([11, 12]);
    });

    it('accepts an empty pick (nobody needs to go to the bench)', () => {
        expect(issuePaths({ eventId: 7, startTime: START, benchUserIds: [] })).toEqual([]);
    });

    it('still accepts a body without a pick (old clients, reschedule lock)', () => {
        const parsed = CompleteSchedulingPollSchema.parse({ eventId: 7, startTime: START });
        expect(parsed.benchUserIds).toBeUndefined();
    });

    it('refuses a pick without an eventId, on the benchUserIds path', () => {
        const parsed = CompleteSchedulingPollSchema.safeParse({ benchUserIds: [11] });
        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues).toEqual([
            expect.objectContaining({
                path: ['benchUserIds'],
                message: 'benchUserIds needs eventId',
            }),
        ]);
    });

    it.each([
        ['a zero id', [0]],
        ['a negative id', [-3]],
        ['a fractional id', [1.5]],
        ['a string id', ['11']],
        ['more than 200 ids', Array.from({ length: 201 }, (_, i) => i + 1)],
    ])('refuses %s', (_label, benchUserIds) => {
        expect(issuePaths({ eventId: 7, startTime: START, benchUserIds })).not.toEqual([]);
    });
});
