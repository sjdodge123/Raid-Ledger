import { describe, it, expect } from 'vitest';
import { liveLockouts, type RosterLockout } from './whos-saved.helpers';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const LIVE = '2026-11-07T12:00:00Z';
const SOON = '2026-11-06T18:00:00Z';
const PAST = '2026-11-06T06:00:00Z';

function member(name: string, resetAt: string): RosterLockout['members'][number] {
    return { characterId: `00000000-0000-4000-8000-${name.padStart(12, '0').slice(-12)}`, name, killed: 1, resetAt };
}

function group(name: string, resets: string[]): RosterLockout {
    return {
        instanceId: name.length, difficultyId: 0, name, difficulty: null, total: 10, resetAt: LIVE,
        members: resets.map((r, i) => member(`m${name}${i}`, r)),
    };
}

/** TDB 3762/3763 — client-side expiry filtering, group reset, and re-sort. */
describe('liveLockouts', () => {
    it('drops expired members and groups left with nobody', () => {
        const out = liveLockouts([group('Molten Core', [PAST, LIVE]), group('Onyxia', [PAST])], NOW);
        expect(out.map((g) => g.name)).toEqual(['Molten Core']);
        expect(out[0]?.members).toHaveLength(1);
    });

    it("sets each group's resetAt to its soonest live member reset", () => {
        const out = liveLockouts([group('Molten Core', [PAST, LIVE, SOON])], NOW);
        expect(out[0]?.resetAt).toBe(SOON);
    });

    it('re-sorts by live member count desc, then name, after expiry', () => {
        const server = [
            group('Zul Gurub', [PAST, PAST, LIVE]),
            group('Onyxia', [LIVE, LIVE]),
            group('Blackwing Lair', [LIVE, LIVE]),
        ];
        expect(liveLockouts(server, NOW).map((g) => g.name)).toEqual(['Blackwing Lair', 'Onyxia', 'Zul Gurub']);
    });
});
