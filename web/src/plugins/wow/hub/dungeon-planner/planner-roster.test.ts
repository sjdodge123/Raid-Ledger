/** ROK-2216 — the planner's roster options and link-token resolution (spec L1/L2). */
import { describe, it, expect } from 'vitest';
import { resolvePicks, rosterPicks } from './planner-roster';
import { parseToken, type PlanToken } from './planner-url';
import { ROSTER, UUID_A, UUID_B } from './planner-roster.fixtures';

function tokens(...raw: string[]): PlanToken[] {
    return raw.flatMap((r) => parseToken(r) ?? []);
}

describe('rosterPicks', () => {
    it('keys claimed rows by character id and unclaimed rows by m<memberId>', () => {
        expect(rosterPicks(ROSTER).map((p) => [p.key, p.claimed, p.className])).toEqual([
            [UUID_A, true, 'Warrior'], ['m12', false, 'Warrior'], [UUID_B, true, 'Mage'],
        ]);
    });

    it('leaves out a row with neither a character id nor a member id', () => {
        expect(rosterPicks(ROSTER).some((p) => p.name === 'Ghost')).toBe(false);
    });

    it('is empty before the roster loads', () => {
        expect(rosterPicks(undefined)).toEqual([]);
    });
});

describe('resolvePicks', () => {
    it('keeps link order and drops tokens not on the roster', () => {
        const picks = resolvePicks(tokens('m12', '00000000-0000-4000-8000-000000000099', UUID_B, 'm77'), rosterPicks(ROSTER));
        expect(picks.map((p) => p.key)).toEqual(['m12', UUID_B]);
    });
});
