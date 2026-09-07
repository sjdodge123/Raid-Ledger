/**
 * ROK-1517 — unit coverage for the lineup-scoped schedule-href helpers used by
 * decided-composite.smoke.spec.ts (AC2). Runs under the root vitest config:
 *   npx vitest run scripts/smoke/lineup-match-helpers.spec.ts
 */
import { describe, it, expect } from 'vitest';
import {
    collectLineupMatchIds,
    scheduleHrefPattern,
} from './lineup-match-helpers';

describe('scheduleHrefPattern (ROK-1517)', () => {
    it('accepts every match id owned by the seeded lineup, regardless of API order', () => {
        // Production failure shape: fixture pinned 43, page rendered 44 first.
        const p = scheduleHrefPattern(109, [43, 44]);
        expect('/community-lineup/109/schedule/43').toMatch(p);
        expect('/community-lineup/109/schedule/44').toMatch(p);
    });

    it('rejects a match id that is not in the lineup set', () => {
        expect('/community-lineup/109/schedule/45').not.toMatch(
            scheduleHrefPattern(109, [43, 44]),
        );
    });

    it('is anchored: rejects prefix-extended ids and foreign lineup ids', () => {
        const p = scheduleHrefPattern(109, [43, 44]);
        expect('/community-lineup/109/schedule/430').not.toMatch(p);
        expect('/community-lineup/1090/schedule/43').not.toMatch(p);
        expect('/community-lineup/108/schedule/43').not.toMatch(p);
    });

    it('throws instead of degrading to an any-href pattern when the set is empty', () => {
        expect(() => scheduleHrefPattern(109, [])).toThrow(/no match ids/i);
    });
});

describe('collectLineupMatchIds', () => {
    it('flattens scheduling → almostThere → rallyYourCrew in API order', () => {
        expect(
            collectLineupMatchIds({
                scheduling: [{ id: 43 }, { id: 44 }],
                almostThere: [{ id: 7 }],
                rallyYourCrew: [],
            }),
        ).toEqual([43, 44, 7]);
    });

    it('throws when the grouped response is null or has no matches', () => {
        expect(() => collectLineupMatchIds(null)).toThrow(/no matches/);
        expect(() =>
            collectLineupMatchIds({
                scheduling: [],
                almostThere: [],
                rallyYourCrew: [],
            }),
        ).toThrow(/no matches/);
    });
});
