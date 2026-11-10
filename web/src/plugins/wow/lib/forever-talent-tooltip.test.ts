/**
 * ROK-2150: Forever tooltips show per-rank text from the static table, not Wowhead's
 * spell tooltip (one spell id for every rank showed "0% chance" for Master of Defense).
 */
import { describe, it, expect } from 'vitest';
import fixture from './__fixtures__/forever-warrior-trees.json';
import { isForeverTalentTable, type ForeverTableTalent } from './forever-talent-table';
import { foreverTalentTooltipText } from './forever-talent-tooltip';

function warriorTalent(name: string): ForeverTableTalent {
    if (!isForeverTalentTable(fixture) || !fixture.warrior) throw new Error('bad fixture');
    const talent = fixture.warrior.trees.flatMap((t) => t.talents).find((t) => t.name === name);
    if (!talent) throw new Error(`no warrior talent ${name}`);
    return talent;
}

describe('foreverTalentTooltipText', () => {
    const mod = warriorTalent('Master of Defense'); // 2 ranks

    it('Master of Defense 1/2: current is the 50% rank, next the 100% rank', () => {
        const text = foreverTalentTooltipText({ ...mod, rank: 1 });
        expect(text.shownRank).toBe(1);
        expect(text.current).toContain('50% chance');
        expect(text.next).toContain('100% chance');
    });

    it('rank 0: no current, next is rank 1', () => {
        expect(foreverTalentTooltipText({ ...mod, rank: 0 })).toEqual({
            current: null,
            next: mod.descriptions[0],
            shownRank: 0,
        });
    });

    it('max rank: current is the last rank, no next', () => {
        const text = foreverTalentTooltipText({ ...mod, rank: 2 });
        expect(text).toEqual({ current: mod.descriptions[1], next: null, shownRank: 2 });
        expect(text.current).toContain('100% chance');
    });

    it('clamps a rank past max (a bad sync) to max', () => {
        expect(foreverTalentTooltipText({ ...mod, rank: 9 }).shownRank).toBe(2);
    });

    it('a 1-rank talent: rank 0 previews it, rank 1 has no next', () => {
        const lastStand = warriorTalent('Last Stand');
        expect(foreverTalentTooltipText({ ...lastStand, rank: 0 }).next).toBe(lastStand.descriptions[0]);
        expect(foreverTalentTooltipText({ ...lastStand, rank: 1 }).next).toBeNull();
    });
});
