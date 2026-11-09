/**
 * ROK-2146: the Wowhead-style WoW: Forever talent tree — every talent at its cell,
 * spent vs unspent, per-rank tooltips (ROK-2150), phone tree tabs, "Other talents", the calc label and
 * the fallback to the old grid when the class has no table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

/** Renders and waits for the tree to draw (53 warrior talents), so later asserts fail on their own message. */
async function renderWarrior(nodes = ROK) {
    render(<TalentDisplay talents={dto(nodes)} isArmoryImported={false} characterClass="Warrior" gameVariant={null} />);
    await screen.findAllByTestId('forever-talent');
}

/** The talent button whose accessible name starts with `name` (any rank), so a wrong rank fails the name assert. */
function talent(name: string): HTMLElement {
    return screen.getByRole('button', { name: new RegExp(`^${name} \\d+ of \\d+$`) });
}

beforeEach(() => { loadTable.mockReset(); loadTable.mockResolvedValue(warrior()); });

describe('ForeverTalentTree', () => {
    it('draws every talent of all three trees with an accessible rank name', async () => {
        await renderWarrior();
        expect(screen.getAllByTestId('forever-talent')).toHaveLength(53);
        expect(talent('Shield Specialization'), 'joined by spellId 12298').toHaveAccessibleName('Shield Specialization 5 of 5');
        expect(talent('Mortal Strike')).toHaveAccessibleName('Mortal Strike 0 of 1');
    });

    it('marks spent talents and greys unspent ones, each with an x/y badge', async () => {
        await renderWarrior();
        const spent = talent('Last Stand');
        const unspent = talent('Iron Will');
        expect(spent, 'Last Stand joined by name in Protection').toHaveAccessibleName('Last Stand 1 of 1');
        expect(spent).toHaveAttribute('data-spent', 'true');
        expect(unspent).toHaveAttribute('data-spent', 'false');
        expect(within(spent).getByText('1/1')).toBeInTheDocument();
        expect(within(unspent).getByText('0/5')).toBeInTheDocument();
        expect(unspent.querySelector('img')?.className).toContain('grayscale');
    });

    // ROK-2150: Wowhead's Forever spell tooltip/page shows one rank's numbers for every rank, so icons no longer hook or link it.
    it('draws each talent as a button with the zamimg icon, not a Wowhead spell link', async () => {
        await renderWarrior();
        const icon = talent('Shield Specialization');
        expect(icon.tagName).toBe('BUTTON');
        expect(icon).not.toHaveAttribute('data-wowhead');
        expect(icon).not.toHaveAttribute('href');
        expect(icon.querySelector('img')).toHaveAttribute('src', 'https://wow.zamimg.com/images/wow/icons/medium/inv_shield_06.jpg');
    });

    it('draws prerequisite arrows, lit when the dependent talent is spent', async () => {
        await renderWarrior([{ nodeId: 1, rank: 1, spellId: 1310316 }]);
        expect(talent('Master of Defense')).toHaveAccessibleName('Master of Defense 1 of 2');
        const arrows = screen.getAllByTestId('forever-talent-arrow');
        expect(arrows).toHaveLength(8);
        expect(arrows.filter((a) => a.dataset.spent === 'true')).toHaveLength(1);
    });

    it('heads each tree with its name and points', async () => {
        await renderWarrior();
        expect(screen.getByTestId('forever-tree-spent-2')).toHaveTextContent('8');
        expect(screen.getByRole('heading', { name: 'Protection' })).toBeInTheDocument();
    });

});

/** ROK-2150: our own per-rank tooltip (Master of Defense 1/2 read "0% chance" on Wowhead's). */
describe('ForeverTalentTree — per-rank talent tooltip', () => {
    const MOD_RANK_1: ForeverTalentNodeDto[] = [{ nodeId: 1, rank: 1, spellId: 1310316 }];

    it('opens on hover with the name, rank, current and next rank text, and closes on leave', async () => {
        await renderWarrior(MOD_RANK_1);
        const icon = talent('Master of Defense');
        await userEvent.hover(icon);
        const tip = screen.getByRole('tooltip');
        expect(icon).toHaveAttribute('aria-describedby', tip.id);
        expect(within(tip).getByText('Master of Defense')).toBeInTheDocument();
        expect(within(tip).getByText('Rank 1/2')).toBeInTheDocument();
        expect(within(screen.getByTestId('forever-talent-tooltip-current')).getByText(/50% chance to generate 5 Rage/)).toBeInTheDocument();
        const next = screen.getByTestId('forever-talent-tooltip-next');
        expect(within(next).getByText('Next rank:')).toBeInTheDocument();
        expect(within(next).getByText(/100% chance to generate 5 Rage/)).toBeInTheDocument();
        await userEvent.unhover(icon);
        expect(screen.queryByRole('tooltip'), 'closes on mouse leave').toBeNull();
        expect(icon).not.toHaveAttribute('aria-describedby');
    });

    it('opens on keyboard focus and closes on Escape', async () => {
        await renderWarrior(MOD_RANK_1);
        const icon = talent('Master of Defense');
        act(() => icon.focus());
        expect(within(screen.getByRole('tooltip')).getByText('Rank 1/2')).toBeInTheDocument();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('tooltip'), 'Escape closes it').toBeNull();
    });

    it('shows only the next-rank (rank 1) text at rank 0', async () => {
        await renderWarrior(MOD_RANK_1);
        await userEvent.hover(talent('Mortal Strike'));
        expect(within(screen.getByRole('tooltip')).getByText('Rank 0/1')).toBeInTheDocument();
        expect(screen.queryByTestId('forever-talent-tooltip-current'), 'no current text at rank 0').toBeNull();
        expect(within(screen.getByTestId('forever-talent-tooltip-next')).getByText(/A vicious strike/)).toBeInTheDocument();
    });

    it('shows no "Next rank" at max rank', async () => {
        await renderWarrior();
        await userEvent.hover(talent('Shield Specialization'));
        const tip = screen.getByRole('tooltip');
        expect(within(tip).getByText('Rank 5/5')).toBeInTheDocument();
        expect(within(tip).getByText(/by 5% and grants you a 100% chance/)).toBeInTheDocument();
        expect(within(tip).queryByText('Next rank:'), 'no next rank at 5/5').toBeNull();
    });

    it('toggles on a touch tap instead of navigating', async () => {
        await renderWarrior(MOD_RANK_1);
        const icon = talent('Master of Defense');
        fireEvent.pointerDown(icon, { pointerType: 'touch' });
        fireEvent.click(icon);
        expect(within(screen.getByRole('tooltip')).getByText('Rank 1/2')).toBeInTheDocument();
        fireEvent.pointerDown(icon, { pointerType: 'touch' });
        fireEvent.click(icon);
        expect(screen.queryByRole('tooltip'), 'a second tap closes it').toBeNull();
    });
});

describe('ForeverTalentTree — tabs, other talents, label, fallback', () => {
    it('opens the phone tree tabs on the tree with the most points', async () => {
        await renderWarrior();
        const tabs = screen.getByRole('radiogroup', { name: 'Talent tree' });
        expect(within(tabs).getByRole('radio', { name: /Protection/ })).toBeChecked();
        expect(screen.getByTestId('forever-tree-0').className).toContain('hidden md:block');
        expect(screen.getByTestId('forever-tree-2').className).not.toContain('hidden');
        await userEvent.click(within(tabs).getByRole('radio', { name: /Arms/ }));
        expect(screen.getByTestId('forever-tree-0').className).not.toContain('hidden');
    });

    it('lists an unmatched ranked node under "Other talents"', async () => {
        await renderWarrior();
        const other = screen.getByTestId('forever-other-talents-none');
        expect(within(other).getByText('Mystery Talent 1')).toBeInTheDocument();
    });

    // ROK-2150 (operator 2026-11-09) replaces ROK-2146 D7's bare link: the calc opens on the character's build.
    it('labels the button "Open Wowhead calculator" and links the character\'s build (Protection 2/5/0/0/0/0/1)', async () => {
        await renderWarrior();
        const calc = screen.getByTestId('forever-talents-source').parentElement?.querySelector('a');
        expect(calc, 'calc link in the header').toHaveAccessibleName('Open Wowhead calculator');
        expect(calc).toHaveAttribute('href', 'https://www.wowhead.com/forever/talent-calc/warrior/vkndmh--2500001');
    });

    it('keeps the old grid/pills when the class has no table', async () => {
        loadTable.mockResolvedValue(null);
        render(<TalentDisplay talents={dto(ROK)} isArmoryImported={false} characterClass="Warrior" gameVariant={null} />);
        expect(await screen.findByText('Learned talents')).toBeInTheDocument();
        expect(screen.queryByTestId('forever-talent')).toBeNull();
        expect(screen.queryByTestId('forever-talents-loading'), 'no placeholder once the table is known missing').toBeNull();
    });

    it('shows a neutral placeholder, not the old grid/pills, while the table loads (review MINOR-2)', () => {
        loadTable.mockReturnValue(new Promise<ForeverClassTable | null>(() => {}));
        render(<TalentDisplay talents={dto(ROK)} isArmoryImported={false} characterClass="Warrior" gameVariant={null} />);
        expect(screen.queryAllByTestId('forever-talents-loading'), 'tree-height placeholder while loading').toHaveLength(1);
        expect(screen.queryByText('Learned talents'), 'no old pills flash before the tree').toBeNull();
        expect(screen.queryByTestId('forever-talent')).toBeNull();
    });
});

/** Review MAJOR-1: the shipped path is align → join → tree, so a Blizzard payload in Armory order must land on Protection. */
describe('ForeverTalentTree — Blizzard trees in Armory order', () => {
    const PROT_ONLY: ForeverTalentsDto = {
        format: 'forever', source: 'blizzard', syncedAt: '2026-11-08T09:00:00.000Z', layout: 'list',
        trees: [{ index: 0, spent: 13, name: 'Protection' }],
        nodes: [
            { nodeId: 50, rank: 5, maxRanks: 5, spellId: 12298, tree: 0 },
            { nodeId: 51, rank: 1, maxRanks: 1, name: 'Last Stand', tree: 0 },
        ],
    };

    it('puts the 13 points, the phone tab and a name-only talent on Protection', async () => {
        render(<TalentDisplay talents={PROT_ONLY} isArmoryImported characterClass="Warrior" gameVariant="wow_forever" />);
        await screen.findAllByTestId('forever-talent');
        expect(screen.getByTestId('forever-tree-spent-2'), 'Protection carries the Armory 13').toHaveTextContent(/^13$/);
        expect(screen.getByTestId('forever-tree-spent-0'), 'Arms must not carry Protection\'s 13').toHaveTextContent(/^0$/);
        expect(screen.getByTestId('forever-tree-spent-1')).toHaveTextContent(/^0$/);
        expect(within(screen.getByRole('radiogroup', { name: 'Talent tree' })).getByRole('radio', { name: /Protection/ }), 'phone opens on Protection').toBeChecked();
        expect(talent('Last Stand'), 'name-only node joined in Protection').toHaveAccessibleName('Last Stand 1 of 1');
        expect(screen.getByTestId('forever-tree-2')).toContainElement(talent('Last Stand'));
    });
});
