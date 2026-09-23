/**
 * ROK-1435 — `channelId` on the weekly-digest settings body must be a Discord
 * snowflake (17–20 digits) or null. The contract package has no test runner
 * of its own; this spec mirrors the convention in `lineup.schema.spec.ts`.
 */
import { describe, it, expect } from 'vitest';
import { WeeklyDigestSettingsSchema } from '../weekly-digest-settings.schema.js';

const base = { enabled: true, day: 1, hour: 9 };

describe('WeeklyDigestSettingsSchema.channelId', () => {
    it.each(['12345678901234567', '123456789012345678', '12345678901234567890'])(
        'accepts a snowflake (%s)',
        (channelId) => {
            expect(WeeklyDigestSettingsSchema.safeParse({ ...base, channelId }).success).toBe(true);
        },
    );

    it('accepts null (no dedicated channel — fall back to the default)', () => {
        expect(WeeklyDigestSettingsSchema.safeParse({ ...base, channelId: null }).success).toBe(true);
    });

    it.each(['general', 'c1', '1234567890123456', '123456789012345678901', '12345678901234567a', ''])(
        'rejects a non-snowflake (%s)',
        (channelId) => {
            expect(WeeklyDigestSettingsSchema.safeParse({ ...base, channelId }).success).toBe(false);
        },
    );
});
