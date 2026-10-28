/**
 * Contract tests for the claim-first poll lock-in (ROK-2032).
 *
 * `POST /scheduling-polls/:matchId/lock-in` takes the create-form event body
 * plus the winning slot and the organizer's bench pick, claims the poll, then
 * creates the event. The outer body is strict; `event` reuses
 * `CreateEventSchema` unchanged (its refines still run when nested).
 */
import { describe, it, expect } from 'vitest';
import {
    LockInSchedulingPollSchema,
    LockInSchedulingPollResponseSchema,
    SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE,
} from '../standalone-poll.schema.js';

const START = '2026-11-01T19:00:00.000Z';
const END = '2026-11-01T22:00:00.000Z';
const EVENT = { title: 'Raid night', gameId: 3, startTime: START, endTime: END };

function issuePaths(body: unknown): string[] {
    const parsed = LockInSchedulingPollSchema.safeParse(body);
    return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
}

describe('LockInSchedulingPollSchema (ROK-2032)', () => {
    it('accepts a minimal body (event only)', () => {
        const parsed = LockInSchedulingPollSchema.parse({ event: EVENT });
        expect(parsed.event.title).toBe('Raid night');
        expect(parsed.startTime).toBeUndefined();
    });

    it('accepts an event with its slot and a bench pick', () => {
        const parsed = LockInSchedulingPollSchema.parse({
            event: { ...EVENT, schedulingMatchId: 9 },
            startTime: START,
            benchUserIds: [11, 12],
        });
        expect(parsed.benchUserIds).toEqual([11, 12]);
        expect(parsed.event.schedulingMatchId).toBe(9);
    });

    it('rejects an unknown top-level key', () => {
        expect(issuePaths({ event: EVENT, eventId: 4 }).length).toBeGreaterThan(0);
    });

    it('rejects a body without an event', () => {
        expect(issuePaths({ startTime: START })).toContain('event');
    });

    it('runs CreateEventSchema refines inside event', () => {
        expect(issuePaths({ event: { ...EVENT, endTime: START } })).toContain('event.endTime');
    });

    it('rejects benchUserIds without startTime, on the benchUserIds path', () => {
        expect(issuePaths({ event: EVENT, benchUserIds: [11] })).toContain('benchUserIds');
    });

    it('rejects more than 200 bench ids', () => {
        const ids = Array.from({ length: 201 }, (_, i) => i + 1);
        expect(issuePaths({ event: EVENT, startTime: START, benchUserIds: ids })).toContain(
            'benchUserIds',
        );
    });

    it('rejects a startTime without an offset', () => {
        expect(issuePaths({ event: EVENT, startTime: '2026-11-01T19:00:00' })).toContain('startTime');
    });
});

describe('LockInSchedulingPollResponseSchema (ROK-2032)', () => {
    it('requires benchPickFallback', () => {
        const parsed = LockInSchedulingPollResponseSchema.safeParse({ event: {} });
        expect(parsed.success).toBe(false);
        const paths = parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('benchPickFallback');
    });
});

describe('SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE (ROK-2032)', () => {
    it('is the 409 message the losing lock-in receives', () => {
        expect(SCHEDULING_POLL_ALREADY_LOCKED_IN_MESSAGE).toBe('This poll has already been locked in');
    });
});
