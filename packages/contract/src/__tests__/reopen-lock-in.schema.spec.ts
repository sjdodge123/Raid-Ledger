/**
 * Contract tests for the admin lock-in recovery (ROK-2033).
 *
 * `ReopenLockInResponseSchema` is the new admin route's body; the poll page's
 * `lockInRecoverable` is additive and optional (absent for non-admins).
 */
import { describe, it, expect } from 'vitest';
import {
    ReopenLockInResponseSchema,
    SchedulePollPageResponseSchema,
} from '../lineup-scheduling.schema.js';

describe('ReopenLockInResponseSchema (ROK-2033)', () => {
    it('accepts the reopened match with its discarded event ids', () => {
        const body = { matchId: 4, status: 'scheduling', discardedEventIds: [9, 10] };
        expect(ReopenLockInResponseSchema.parse(body)).toEqual(body);
    });

    it('accepts an empty discarded list (crash before the create)', () => {
        const body = { matchId: 4, status: 'scheduling', discardedEventIds: [] };
        expect(ReopenLockInResponseSchema.parse(body)).toEqual(body);
    });

    it('refuses any status other than scheduling', () => {
        const parsed = ReopenLockInResponseSchema.safeParse({
            matchId: 4,
            status: 'scheduled',
            discardedEventIds: [],
        });
        expect(parsed.success).toBe(false);
    });
});

describe('SchedulePollPageResponseSchema.lockInRecoverable (ROK-2033)', () => {
    it('is optional and boolean', () => {
        const shape = SchedulePollPageResponseSchema.shape.lockInRecoverable;
        expect(shape.safeParse(undefined).success).toBe(true);
        expect(shape.safeParse(true).success).toBe(true);
        expect(shape.safeParse('yes').success).toBe(false);
    });
});
