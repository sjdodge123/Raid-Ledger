import { describe, expect, it } from 'vitest';
import {
    MAX_RECENT_DINGS,
    WowRecentDingsSchema,
} from '../wow-recent-dings.schema.js';

const ding = {
    name: 'Thrall',
    characterId: '6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
    fromLevel: 38,
    toLevel: 41,
    at: '2026-10-28T12:00:00.000Z',
};

describe('WowRecentDingsSchema (ROK-1919)', () => {
    it('accepts a linked and an unlinked ding', () => {
        const parsed = WowRecentDingsSchema.parse({
            dings: [ding, { ...ding, characterId: null }],
        });
        expect(parsed.dings).toHaveLength(2);
    });

    it('accepts a name up to the guild-member cap (100) and rejects 101', () => {
        const ok = WowRecentDingsSchema.safeParse({
            dings: [{ ...ding, name: 'x'.repeat(100) }],
        });
        expect(ok.success).toBe(true);
        const tooLong = WowRecentDingsSchema.safeParse({
            dings: [{ ...ding, name: 'x'.repeat(101) }],
        });
        expect(tooLong.error?.issues[0]?.path).toEqual(['dings', 0, 'name']);
    });

    it('rejects an unknown key (strict)', () => {
        const result = WowRecentDingsSchema.safeParse({
            dings: [{ ...ding, guid: 'Player-1-x' }],
        });
        expect(result.success).toBe(false);
    });

    it(`rejects more than ${MAX_RECENT_DINGS} dings`, () => {
        const dings = Array.from({ length: MAX_RECENT_DINGS + 1 }, () => ding);
        expect(WowRecentDingsSchema.safeParse({ dings }).success).toBe(false);
    });

    it('rejects a non-datetime `at`', () => {
        const result = WowRecentDingsSchema.safeParse({
            dings: [{ ...ding, at: 'yesterday' }],
        });
        expect(result.error?.issues[0]?.path).toEqual(['dings', 0, 'at']);
    });
});
