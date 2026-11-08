/**
 * ROK-2146: the Wowhead-style WoW: Forever talent tree — every talent at its cell,
 * spent vs unspent, tooltips, phone tree tabs, "Other talents", the calc label and
 * the fallback to the old grid when the class has no table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ForeverTalentNodeDto, ForeverTalentsDto } from '@raid-ledger/contract';
import fixture from '../lib/__fixtures__/forever-warrior-trees.json';
import { isForeverTalentTable, type ForeverClassTable } from '../lib/forever-talent-table';
import { TalentDisplay } from './talent-display';

const loadTable = vi.hoisted(() => vi.fn<(cls: string | null | undefined) => Promise<ForeverClassTable | null>>());
vi.mock('../lib/forever-talent-table', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/forever-talent-table')>()),
    loadForeverClassTable: loadTable,
}));

function warrior(): ForeverClassTable {
    if (!isForeverTalentTable(fixture) || !fixture.warrior) throw new Error('bad fixture');
    return fixture.warrior;
}

/** Rok Androl's Armory build: 13 points, all Protection (12298 by spellId, Last Stand by name). */
const ROK: ForeverTalentNodeDto[] = [
    { nodeId: 1, rank: 5, maxRanks: 5, spellId: 12298, tree: 2 },
    { nodeId: 2, rank: 1, maxRanks: 1, name: 'Last Stand', spellId: 99999, tree: 2 },
    { nodeId: 3, rank: 2, maxRanks: 2, spellId: 12301, tree: 2 },
    { nodeId: 4, rank: 1, name: 'Mystery Talent', tree: 1 },
];

function dto(nodes: ForeverTalentNodeDto[]): ForeverTalentsDto {
    return { format: 'forever', source: 'addon', syncedAt: '2026-11-08T12:00:00.000Z', layout: 'list', trees: [], nodes };
}

function renderWarrior(nodes = ROK) {
    return render(<TalentDisplay talents={dto(nodes)} isArmoryImported={false} characterClass="Warrior" gameVariant={null} />);
}

beforeEach(() => { loadTable.mockReset(); loadTable.mockResolvedValue(warrior()); });

describe('ForeverTalentTree', () => {
    it('draws every talent of all three trees with an accessible rank name', async () => {
        renderWarrior();
        expect(await screen.findByRole('link', { name: 'Shield Specialization 5 of 5' })).toBeInTheDocument();
        expect(screen.getAllByTestId('forever-talent')).toHaveLength(53);
        expect(screen.getByRole('link', { name: 'Mortal Strike 0 of 1' })).toBeInTheDocument();
    });

    it('marks spent talents and greys unspent ones, each with an x/y badge', async () => {
        renderWarrior();
        const spent = await screen.findByRole('link', { name: 'Last Stand 1 of 1' });
        const unspent = screen.getByRole('link', { name: 'Iron Will 0 of 5' });
        expect(spent).toHaveAttribute('data-spent', 'true');
        expect(unspent).toHaveAttribute('data-spent', 'false');
        expect(within(spent).getByText('1/1')).toBeInTheDocument();
        expect(within(unspent).getByText('0/5')).toBeInTheDocument();
        expect(unspent.querySelector('img')?.className).toContain('grayscale');
    });

    it('hooks each talent to the Forever Wowhead tooltip and the zamimg icon', async () => {
        renderWarrior();
        const link = await screen.findByRole('link', { name: 'Shield Specialization 5 of 5' });
        expect(link).toHaveAttribute('data-wowhead', 'spell=12298&domain=forever');
        expect(link.querySelector('img')).toHaveAttribute('src', 'https://wow.zamimg.com/images/wow/icons/medium/inv_shield_06.jpg');
    });

    it('draws prerequisite arrows, lit when the dependent talent is spent', async () => {
        renderWarrior([{ nodeId: 1, rank: 1, spellId: 1310316 }]);
        await screen.findByRole('link', { name: 'Master of Defense 1 of 2' });
        const arrows = screen.getAllByTestId('forever-talent-arrow');
        expect(arrows).toHaveLength(8);
        expect(arrows.filter((a) => a.dataset.spent === 'true')).toHaveLength(1);
    });

    it('heads each tree with its name and points', async () => {
        renderWarrior();
        await screen.findByRole('link', { name: 'Last Stand 1 of 1' });
        expect(screen.getByTestId('forever-tree-spent-2')).toHaveTextContent('8');
        expect(screen.getByRole('heading', { name: 'Protection' })).toBeInTheDocument();
    });

});

describe('ForeverTalentTree — tabs, other talents, label, fallback', () => {
    it('opens the phone tree tabs on the tree with the most points', async () => {
        renderWarrior();
        const tabs = await screen.findByRole('radiogroup', { name: 'Talent tree' });
        expect(within(tabs).getByRole('radio', { name: /Protection/ })).toBeChecked();
        expect(screen.getByTestId('forever-tree-0').className).toContain('hidden md:block');
        expect(screen.getByTestId('forever-tree-2').className).not.toContain('hidden');
        await userEvent.click(within(tabs).getByRole('radio', { name: /Arms/ }));
        expect(screen.getByTestId('forever-tree-0').className).not.toContain('hidden');
    });

    it('lists an unmatched ranked node under "Other talents"', async () => {
        renderWarrior();
        const other = await screen.findByTestId('forever-other-talents-none');
        expect(within(other).getByText('Mystery Talent 1')).toBeInTheDocument();
    });

    it('labels the button "Open Wowhead calculator" with the bare Forever calc URL', async () => {
        renderWarrior();
        expect(await screen.findByRole('link', { name: 'Open Wowhead calculator' })).toHaveAttribute('href', 'https://www.wowhead.com/forever/talent-calc/warrior');
    });

    it('keeps the old grid/pills when the class has no table', async () => {
        loadTable.mockResolvedValue(null);
        renderWarrior();
        expect(await screen.findByText('Learned talents')).toBeInTheDocument();
        expect(screen.queryByTestId('forever-talent')).toBeNull();
    });
});
