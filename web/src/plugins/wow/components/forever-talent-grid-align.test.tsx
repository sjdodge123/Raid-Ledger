/**
 * ROK-2113 T1 (delta review MAJOR): a Blizzard payload that already arrives in
 * grid layout is aligned to class columns too — headers, cells and spent
 * counts all read the SAME aligned trees, so a Protection-only Warrior shows
 * Arms 0 | Fury 0 | Protection 13 with its cells under Protection.
 */
import { describe, it, expect, vi } from 'vitest';

// ROK-2146: these specs pin the pre-table grid/pills, so the static Forever table is absent here
// (forever-talent-tree.test.tsx covers the tree). Without this the lazy table would race the asserts.
vi.mock('../lib/forever-talent-table', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/forever-talent-table')>()),
    loadForeverClassTable: () => Promise.resolve(null),
    peekForeverClassTable: () => null,
}));
import { render, screen, within } from '@testing-library/react';
import type { ForeverTalentsDto } from '@raid-ledger/contract';
import { TalentDisplay } from './talent-display';

const PROT_GRID: ForeverTalentsDto = {
    format: 'forever', source: 'blizzard', syncedAt: '2026-11-08T09:00:00.000Z', layout: 'grid',
    trees: [{ index: 0, spent: 13, name: 'Protection' }],
    nodes: [
        { nodeId: 50, rank: 5, name: 'Shield Specialization', tree: 0, row: 1, col: 1 },
        { nodeId: 51, rank: 5, name: 'Toughness', tree: 0, row: 2, col: 2 },
        { nodeId: 52, rank: 3, name: 'Improved Shield Block', tree: 0, row: 2, col: 1 },
    ],
};

function column(index: number): HTMLElement {
    const spent = screen.getByTestId(`forever-tree-spent-${index}`);
    const col = spent.closest<HTMLElement>('.space-y-2');
    if (!col) throw new Error(`column ${index} not found`);
    return col;
}

describe('ForeverTalentGrid — grid-layout Armory trees by name', () => {
    it('renders a lone Protection tree in column 3 with its cells and spent', () => {
        render(<TalentDisplay talents={PROT_GRID} isArmoryImported characterClass="Warrior" gameVariant="wow_forever" />);
        const prot = column(2);
        expect(within(prot).getByRole('heading').textContent).toBe('Protection');
        expect(within(prot).getByTestId('forever-tree-spent-2').textContent).toBe('13');
        expect(within(prot).getAllByTestId('forever-talent-cell')).toHaveLength(3);
        const arms = column(0);
        expect(within(arms).getByRole('heading').textContent).toBe('Arms');
        expect(within(arms).getByTestId('forever-tree-spent-0').textContent, 'Arms must not carry Protection\'s 13').toBe('0');
        expect(within(arms).queryAllByTestId('forever-talent-cell')).toHaveLength(0);
    });
});
