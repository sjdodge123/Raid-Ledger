/** ROK-2110 AC8: the unconverted-classic fallback mirrors the api converter's rank rules. */
import { describe, it, expect } from 'vitest';
import { classicToForeverList } from './forever-classic-fallback';

describe('classicToForeverList', () => {
    it('treats an omitted rank as 0 (not learned), like the api converter (F8)', () => {
        const out = classicToForeverList({
            trees: [{ name: 'Arms', spentPoints: 3, talents: [{ name: 'Deflection', id: 7 }, { name: 'Tactical Mastery', id: 8, rank: 3 }] }],
        });
        expect(out.nodes.map((n) => [n.nodeId, n.rank])).toEqual([[7, 0], [8, 3]]);
        expect(out.trees).toEqual([{ index: 0, spent: 3, name: 'Arms' }]);
    });
});
