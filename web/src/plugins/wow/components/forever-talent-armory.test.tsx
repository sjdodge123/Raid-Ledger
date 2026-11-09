/**
 * ROK-2110 AC6–AC8: Blizzard-sourced WoW: Forever talents render through the
 * Forever display with a "via Armory · date" source line, placed on the known
 * trees when possible, and never through the Classic renderer.
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
import type { ForeverTalentNodeDto, ForeverTalentsDto } from '@raid-ledger/contract';
import { TalentDisplay } from './talent-display';

const NODES: ForeverTalentNodeDto[] = [
    { nodeId: 10, rank: 3, name: 'Improved Heroic Strike', tree: 0 },
    { nodeId: 12, rank: 5, name: 'Cruelty', tree: 1 },
];

function dto(source: 'addon' | 'blizzard', nodes: ForeverTalentNodeDto[], syncedAt = '2026-11-06T09:00:00.000Z', names?: string[]): ForeverTalentsDto {
    const trees = [0, 1, 2].map((index) => {
        const name = names?.[index];
        return { index, spent: nodes.filter((n) => n.tree === index).reduce((s, n) => s + n.rank, 0), ...(name !== undefined ? { name } : {}) };
    });
    return { format: 'forever', source, syncedAt, layout: 'list', trees, nodes };
}

function renderTalents(value: ForeverTalentsDto, gameVariant: string | null = 'wow_forever') {
    return render(<TalentDisplay talents={value} isArmoryImported characterClass="Warrior" gameVariant={gameVariant} />);
}

describe('ForeverTalentDisplay — source line (AC6)', () => {
    it('Blizzard source reads "via Armory · 6 Nov 2026"', () => {
        renderTalents(dto('blizzard', NODES));
        expect(screen.getByTestId('forever-talents-source')).toHaveTextContent(/^via Armory · 6 Nov 2026$/);
    });

    it('addon source keeps "via addon · date"', () => {
        renderTalents(dto('addon', NODES, '2026-10-04T12:00:00.000Z'));
        expect(screen.getByTestId('forever-talents-source')).toHaveTextContent(/^via addon · 4 Oct 2026$/);
    });

    it('Blizzard source with an unparseable date reads just "via Armory"', () => {
        renderTalents(dto('blizzard', NODES, 'not-a-date'));
        expect(screen.getByTestId('forever-talents-source')).toHaveTextContent(/^via Armory$/);
    });
});

describe('ForeverTalentDisplay — Armory placement (AC7)', () => {
    it('renders a Blizzard list payload as the grid when every talent is on a known tree', () => {
        renderTalents(dto('blizzard', NODES));
        expect(screen.getAllByTestId('forever-talent-cell')).toHaveLength(2);
        expect(screen.queryByText('Learned talents')).toBeNull();
    });

    it('heads the grid in class order when Blizzard sends its trees out of order (ROK-2113 T1)', () => {
        renderTalents(dto('blizzard', [{ nodeId: 12, rank: 5, name: 'Cruelty', tree: 0 }], undefined, ['Fury', 'Arms', 'Protection']));
        expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Arms', 'Fury', 'Protection']);
        expect(screen.getByTestId('forever-tree-spent-1')).toHaveTextContent('5');
    });

    it('never places an addon list payload', () => {
        renderTalents(dto('addon', NODES));
        expect(screen.queryAllByTestId('forever-talent-cell')).toHaveLength(0);
        expect(screen.getByText('Learned talents')).toBeInTheDocument();
    });
});

const UNKNOWN: ForeverTalentNodeDto = { nodeId: 30, rank: 2, name: 'Master of Defense', tree: 2 };

describe('ForeverTalentDisplay — per-talent fallback (ROK-2113)', () => {
    it('mixed known/unknown: grid for the known, "Other talents" under the unknown one\'s tree', () => {
        renderTalents(dto('blizzard', [...NODES, UNKNOWN]));
        expect(screen.getAllByTestId('forever-talent-cell').map((c) => c.getAttribute('title'))).toEqual(['Improved Heroic Strike', 'Cruelty']);
        const other = screen.getByTestId('forever-other-talents-2');
        expect(other).toHaveTextContent(/^Other talentsMaster of Defense 2$/);
        expect(screen.queryByTestId('forever-other-talents-0')).toBeNull();
        expect(screen.queryByText('Learned talents')).toBeNull();
    });

    it('keeps ranks and points: header total, per-tree spent, cell ranks', () => {
        renderTalents(dto('blizzard', [...NODES, UNKNOWN]));
        expect(screen.getByText('10 points')).toBeInTheDocument();
        expect(screen.getByTestId('forever-tree-spent-2')).toHaveTextContent('2');
        expect(screen.getByTestId('forever-tree-spent-1')).toHaveTextContent('5');
        expect(screen.getAllByTestId('forever-talent-cell')[0]).toHaveTextContent('Improved Heroic Strike3');
    });

    it('all known: grid only, no empty "Other talents" header', () => {
        renderTalents(dto('blizzard', NODES));
        expect(screen.getAllByTestId('forever-talent-cell')).toHaveLength(2);
        expect(screen.queryByText('Other talents')).toBeNull();
    });

    it('none known: the list view as today', () => {
        renderTalents(dto('blizzard', [UNKNOWN, { nodeId: 31, rank: 1, name: 'Forever Only Talent', tree: 0 }]));
        expect(screen.queryAllByTestId('forever-talent-cell')).toHaveLength(0);
        expect(screen.queryByText('Other talents')).toBeNull();
        expect(screen.getByText('Learned talents')).toBeInTheDocument();
        expect(screen.getByText('Master of Defense 2')).toBeInTheDocument();
    });

    it('counts an unnamed unplaced talent instead of naming it', () => {
        renderTalents(dto('blizzard', [...NODES, { nodeId: 32, rank: 1, tree: 0 }]));
        expect(screen.getByTestId('forever-other-talents-0')).toHaveTextContent('+1 unnamed talent');
    });

    it('a talent with no tree is listed after every grid, not under a tree', () => {
        renderTalents(dto('blizzard', [...NODES, { nodeId: 40, rank: 1, name: 'Treeless Talent' }]));
        const none = screen.getByTestId('forever-other-talents-none');
        expect(none).toHaveTextContent(/^Other talentsTreeless Talent 1$/);
        expect(screen.getAllByRole('heading', { name: 'Other talents' })).toHaveLength(1);
        for (const i of [0, 1, 2]) expect(screen.queryByTestId(`forever-other-talents-${i}`)).toBeNull();
        const lastCell = screen.getAllByTestId('forever-talent-cell').at(-1);
        expect(lastCell?.compareDocumentPosition(none)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });
});

describe('TalentDisplay — Forever never hits the Classic renderer (AC8)', () => {
    it('a Blizzard Forever payload shows the Forever header and no Classic embed', () => {
        const { container } = renderTalents(dto('blizzard', NODES));
        expect(screen.getByText('8 points')).toBeInTheDocument();
        expect(container.querySelector('iframe')).toBeNull();
        expect(screen.queryByText('No talent data')).toBeNull();
    });
});

describe('ForeverTalentDisplay — points come from the tree totals', () => {
    it('header shows the tree total when the converter dropped an id-less node', () => {
        const value = dto('blizzard', [{ nodeId: 99, rank: 2, name: 'Forever Only Talent', tree: 0 }]);
        const trees = value.trees.map((t) => (t.index === 0 ? { ...t, spent: 6 } : t));
        renderTalents({ ...value, trees });
        expect(screen.getByText('6 points')).toBeInTheDocument();
        expect(screen.queryByText('2 points')).toBeNull();
    });

    it('list summary uses the tree total when every node was dropped', () => {
        const value = dto('blizzard', []);
        const trees = value.trees.map((t) => (t.index === 1 ? { ...t, spent: 5 } : t));
        renderTalents({ ...value, trees });
        expect(screen.getAllByText('5 points').length).toBeGreaterThan(0);
        expect(screen.getByText('5 points in 0 talents')).toBeInTheDocument();
    });
});

/** Rok Androl's real Armory import (fleet T1): Blizzard returned only the Protection tree. */
const PROT: ForeverTalentNodeDto[] = [
    { nodeId: 50, rank: 5, name: 'Shield Specialization', tree: 0 },
    { nodeId: 51, rank: 2, name: 'Anticipation', tree: 0 },
    { nodeId: 52, rank: 3, name: 'Toughness', tree: 0 },
    { nodeId: 53, rank: 1, name: 'Improved Bloodrage', tree: 0 },
    { nodeId: 54, rank: 1, name: 'Forever Only A', tree: 0 },
    { nodeId: 55, rank: 1, name: 'Forever Only B', tree: 0 },
];

function treeHeadings(): (string | null)[] {
    return screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent).filter((t) => t !== 'Other talents');
}

/** The sub-tree column holding `forever-tree-spent-<index>`. */
function column(index: number): HTMLElement {
    const col = screen.getByTestId(`forever-tree-spent-${index}`).parentElement?.parentElement;
    if (!col) throw new Error(`column ${index} not rendered`);
    return col;
}

function expectProtectionInThirdColumn(): void {
    expect(treeHeadings(), 'one Protection tree must head column 3, Arms/Fury the first two, no duplicate').toEqual(['Arms', 'Fury', 'Protection']);
    expect([0, 1, 2].map((i) => screen.getByTestId(`forever-tree-spent-${i}`).textContent)).toEqual(['0', '0', '13']);
    expect(within(column(2)).getAllByTestId('forever-talent-cell')).toHaveLength(4);
    expect(within(column(0)).queryAllByTestId('forever-talent-cell')).toHaveLength(0);
    expect(screen.getByTestId('forever-other-talents-2')).toHaveTextContent(/Forever Only A 1.*Forever Only B 1/);
}

describe('ForeverTalentDisplay — Armory trees map to class columns by name (ROK-2113 T1)', () => {
    it('a converted payload with only "Protection" renders Arms 0 | Fury 0 | Protection 13', () => {
        renderTalents({ format: 'forever', source: 'blizzard', syncedAt: '2026-11-08T09:00:00.000Z', layout: 'list', trees: [{ index: 0, spent: 13, name: 'Protection' }], nodes: PROT });
        expectProtectionInThirdColumn();
    });

    it('an unconverted classic payload with only "Protection" renders the same columns', () => {
        const talents = PROT.map(({ nodeId, rank, name }) => ({ id: nodeId, rank, name: name ?? '' }));
        render(<TalentDisplay talents={{ format: 'classic', trees: [{ name: 'Protection', spentPoints: 13, talents }] }} isArmoryImported characterClass="Warrior" gameVariant="wow_forever" />);
        expectProtectionInThirdColumn();
    });
});
