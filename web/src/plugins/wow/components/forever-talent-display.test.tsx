/**
 * ROK-1744: WoW: Forever addon talents (`format: 'forever'`) — grid, pills,
 * summary-only, the plain Forever calc link (no iframe) and sub-tree headings.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ForeverTalentNodeDto, ForeverTalentsDto } from '@raid-ledger/contract';
import { TalentDisplay } from './talent-display';
import { foreverTreeNames } from '../lib/forever-talent-trees';

const SYNCED_AT = '2026-10-04T12:00:00.000Z';

function talents(layout: 'grid' | 'list', nodes: ForeverTalentNodeDto[]): ForeverTalentsDto {
    const trees = layout === 'grid'
        ? [0, 1, 2].map((index) => ({ index, spent: nodes.filter((n) => n.tree === index).reduce((s, n) => s + n.rank, 0) }))
        : [];
    return { format: 'forever', source: 'addon', syncedAt: SYNCED_AT, layout, trees, nodes };
}

const GRID_NODES: ForeverTalentNodeDto[] = [
    { nodeId: 1, rank: 1, maxRanks: 1, name: 'Mortal Strike', tree: 0, row: 6, col: 1 },
    { nodeId: 2, rank: 2, maxRanks: 5, name: 'Deflection', tree: 0, row: 0, col: 1 },
    { nodeId: 3, rank: 0, maxRanks: 5, name: 'Cruelty', tree: 1, row: 0, col: 2 },
    { nodeId: 4, rank: 3, maxRanks: 5, tree: 2, row: 1, col: 0 },
];

function renderForever(value: ForeverTalentsDto, characterClass: string | null = 'Warrior') {
    return render(<TalentDisplay talents={value} isArmoryImported={false} characterClass={characterClass} gameVariant={null} />);
}

function cell(text: string): HTMLElement {
    const el = screen.getByText(text).closest('[data-testid="forever-talent-cell"]');
    if (!(el instanceof HTMLElement)) throw new Error(`no cell for ${text}`);
    return el;
}

describe('ForeverTalentDisplay — header + calc link', () => {
    it('isTalentData accepts format forever (no "No talent data" fallback)', () => {
        renderForever(talents('grid', GRID_NODES));
        expect(screen.queryByText('No talent data')).toBeNull();
    });

    it('shows total points (Σ rank) and the "via addon · date" source line', () => {
        renderForever(talents('grid', GRID_NODES));
        expect(screen.getByText('6 points')).toBeInTheDocument();
        expect(screen.getByText('via addon · 4 Oct 2026')).toBeInTheDocument();
    });

    it('links to the Forever Wowhead calc even when gameVariant is null, with no iframe', () => {
        const { container } = renderForever(talents('grid', GRID_NODES));
        const href = screen.getByRole('link', { name: /view on wowhead/i }).getAttribute('href');
        expect(href).toMatch(/\/forever\/talent-calc\/warrior$/);
        expect(container.querySelector('iframe')).toBeNull();
    });

    it('omits the calc link for an unmappable class', () => {
        renderForever(talents('grid', GRID_NODES), null);
        expect(screen.queryByRole('link', { name: /view on wowhead/i })).toBeNull();
    });
});

describe('ForeverTalentGrid', () => {
    it('renders the three class sub-tree headings in tab order with spent points', () => {
        renderForever(talents('grid', GRID_NODES));
        const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
        expect(headings).toEqual(['Arms', 'Fury', 'Protection']);
        expect(screen.getByTestId('forever-tree-spent-0')).toHaveTextContent('3');
    });

    it('renders one cell per node, name or #nodeId, with rank/maxRanks', () => {
        renderForever(talents('grid', GRID_NODES));
        expect(screen.getAllByTestId('forever-talent-cell')).toHaveLength(4);
        expect(cell('Mortal Strike')).toHaveTextContent('Mortal Strike1/1');
        expect(cell('#4')).toHaveTextContent('3/5');
        expect(cell('Mortal Strike')).toHaveAttribute('title', 'Mortal Strike');
    });

    it('places a cell on its row/col', () => {
        renderForever(talents('grid', GRID_NODES));
        expect(cell('Mortal Strike').style.gridRow).toBe('7');
        expect(cell('Mortal Strike').style.gridColumn).toBe('2');
    });

    it('maxed, ranked and rank-0 cells use token-only emphasis classes', () => {
        renderForever(talents('grid', GRID_NODES));
        expect(cell('Mortal Strike').className).toEqual(expect.stringContaining('border-edge-strong'));
        expect(cell('Mortal Strike').className).toEqual(expect.stringContaining('font-medium'));
        expect(cell('Deflection').className).toEqual(expect.stringContaining('bg-overlay border border-edge text-foreground'));
        expect(cell('Deflection').className).not.toContain('border-edge-strong');
        expect(cell('Cruelty').className).toEqual(expect.stringContaining('bg-panel border border-edge-subtle text-dim'));
    });

    it('falls back to "Tree 1/2/3" headings for an unknown class', () => {
        renderForever(talents('grid', GRID_NODES), 'Monk');
        const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
        expect(headings).toEqual(['Tree 1', 'Tree 2', 'Tree 3']);
    });
});

describe('ForeverTalentDisplay — list layout', () => {
    const LIST = talents('list', [
        { nodeId: 10, rank: 2, maxRanks: 3, name: 'Improved Rend' },
        { nodeId: 11, rank: 0, maxRanks: 5, name: 'Iron Will' },
        { nodeId: 12, rank: 1 },
        { nodeId: 13, rank: 4 },
    ]);

    it('renders "<name> <rank>/<maxRanks>" pills for ranked named nodes only', () => {
        renderForever(LIST);
        expect(screen.getByText('Improved Rend 2/3')).toBeInTheDocument();
        expect(screen.queryByText(/Iron Will/)).toBeNull();
        expect(screen.queryAllByTestId('forever-talent-cell')).toHaveLength(0);
    });

    it('adds a muted "+N unnamed talents" line for ranked nodes without names', () => {
        renderForever(LIST);
        expect(screen.getByText('+2 unnamed talents')).toHaveClass('text-muted');
    });

    it('with no names at all renders the summary only', () => {
        renderForever(talents('list', [{ nodeId: 1, rank: 3 }, { nodeId: 2, rank: 2 }, { nodeId: 3, rank: 0 }]));
        expect(screen.getByText('5 points in 2 talents')).toBeInTheDocument();
        expect(screen.queryByText(/unnamed/)).toBeNull();
    });
});

describe('foreverTreeNames', () => {
    it.each([
        ['Druid', ['Balance', 'Feral', 'Restoration']],
        ['paladin', ['Holy', 'Protection', 'Retribution']],
        [null, ['Tree 1', 'Tree 2', 'Tree 3']],
    ])('%j → %j', (cls, names) => {
        expect(foreverTreeNames(cls)).toEqual(names);
    });
});
