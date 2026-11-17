/** ROK-2229 — web mirror of the api's `resolveEventCapacity`. */
import { describe, it, expect } from 'vitest';
import { resolveEventCapacity } from './event-capacity';

describe('resolveEventCapacity', () => {
    it("prefers a generic roster's player count over maxAttendees", () => {
        expect(
            resolveEventCapacity({
                slotConfig: { type: 'generic', player: 5 },
                maxAttendees: 40,
            }),
        ).toBe(5);
    });

    it('sums an MMO roster, filling missing roles with the api defaults (2/4/14/5)', () => {
        expect(
            resolveEventCapacity({
                slotConfig: { type: 'mmo' },
                maxAttendees: null,
            }),
        ).toBe(25);
        expect(
            resolveEventCapacity({
                slotConfig: {
                    type: 'mmo',
                    tank: 1,
                    healer: 2,
                    dps: 3,
                    flex: 0,
                },
            }),
        ).toBe(6);
    });

    it('treats a generic roster without player as uncapped, like the api', () => {
        expect(
            resolveEventCapacity({
                slotConfig: { type: 'generic' },
                maxAttendees: 40,
            }),
        ).toBeNull();
    });

    it('falls back to maxAttendees, null when neither is set', () => {
        expect(
            resolveEventCapacity({ slotConfig: null, maxAttendees: 40 }),
        ).toBe(40);
        expect(resolveEventCapacity({})).toBeNull();
    });

    it('keeps a zero capacity as 0 (always full), not uncapped', () => {
        expect(
            resolveEventCapacity({
                slotConfig: { type: 'generic', player: 0 },
                maxAttendees: 40,
            }),
        ).toBe(0);
        expect(
            resolveEventCapacity({ slotConfig: null, maxAttendees: 0 }),
        ).toBe(0);
    });
});
