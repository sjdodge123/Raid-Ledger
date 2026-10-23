/** ROK-1899 — the crafting window's list half: station switcher, mode switch, recipe rows. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BY_HAND_KEY, sortRows, stationGroups } from './crafting.helpers';
import { CRAFT_ENTRIES, CRAFT_STATIONS, CRAFT_TOTALS } from './crafting.test-fixture';
import { CraftModeSwitch } from './craft-mode-switch';
import { RecipeList } from './recipe-list';
import { StationSwitcher } from './station-switcher';
import type { PlannerNames } from './use-planner-names';

const byPrefab = new Map(CRAFT_ENTRIES.map((e) => [e.prefab, e.name]));
const names: PlannerNames = {
    nameOf: (p) => byPrefab.get(p) ?? p,
    stationName: (p) => CRAFT_STATIONS.find((s) => s.prefab === p)?.name ?? p,
    ctxFor: () => ({ serverId: 7, items: {}, atlas: null, atlasUrl: null }),
};
const groups = stationGroups(CRAFT_ENTRIES, CRAFT_STATIONS, 'craft', { kind: 'item', category: null });
const rowsOf = (key: string) => sortRows(groups.find((g) => g.key === key)?.rows ?? [], CRAFT_TOTALS);
const rowNamed = (name: RegExp) => screen.getByRole('button', { name });

describe('StationSwitcher', () => {
    it('lists every station with rows, marks the chosen one and shows its max level', async () => {
        const onChange = vi.fn();
        render(<StationSwitcher groups={groups} value="forge" onChange={onChange} names={names} />);
        const group = screen.getByRole('radiogroup', { name: 'Crafting station' });
        expect(within(group).getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual(['forge', 'piece_workbench', BY_HAND_KEY]);
        expect(screen.getByRole('radio', { name: 'Forge' })).toBeChecked();
        expect(screen.getByText('max 7')).toBeInTheDocument();
        await userEvent.setup().click(screen.getByRole('radio', { name: 'Workbench' }));
        expect(onChange).toHaveBeenCalledWith('piece_workbench');
    });

    it('while searching nothing is selected and the star badge hides', () => {
        render(<StationSwitcher groups={groups} value={null} onChange={vi.fn()} names={names} />);
        expect(screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)).toEqual([]);
        expect(screen.queryByText(/^max /)).not.toBeInTheDocument();
    });
});

describe('CraftModeSwitch', () => {
    it('switches CRAFT / UPGRADE and shows the upgrade count', async () => {
        const onChange = vi.fn();
        render(<CraftModeSwitch value="craft" onChange={onChange} upgradeCount={11} />);
        expect(screen.getByRole('radio', { name: 'CRAFT' })).toBeChecked();
        await userEvent.setup().click(screen.getByRole('radio', { name: /UPGRADE.*11/ }));
        expect(onChange).toHaveBeenCalledWith('upgrade');
    });
});

describe('RecipeList', () => {
    const renderList = (key = 'forge', selectedKey: string | null = null, showStation = false) => {
        const onSelect = vi.fn();
        render(<RecipeList label="Forge recipes" rows={rowsOf(key)} selectedKey={selectedKey} onSelect={onSelect} names={names} showStation={showStation} />);
        return onSelect;
    };

    it('greys a short row with the ⊘ glyph and an aria-description of every shortfall', () => {
        renderList();
        const bronze = rowNamed(/^Bronze$/);
        expect(bronze).toHaveAttribute('aria-description', "Can't craft yet: need 1 more Tin");
        expect(within(bronze).getByText('⊘')).toHaveAttribute('aria-hidden', 'true');
        expect(bronze).toHaveAttribute('data-afford', 'short');
    });

    it('an affordable row has no glyph and no description', () => {
        renderList(BY_HAND_KEY);
        const club = rowNamed(/^Club$/);
        expect(club).not.toHaveAttribute('aria-description');
        expect(within(club).queryByText('⊘')).not.toBeInTheDocument();
    });

    it('shows ×amount, ★level above 1 and, while searching, the station suffix', () => {
        renderList('piece_workbench', null, true);
        expect(within(rowNamed(/Wood arrow/)).getByText('×20')).toBeInTheDocument();
        expect(within(rowNamed(/Bronze buckler/)).getByText('★2')).toBeInTheDocument();
        expect(within(rowNamed(/Wood arrow/)).queryByText(/★/)).not.toBeInTheDocument();
        expect(within(rowNamed(/Bronze buckler/)).getByText('Workbench')).toBeInTheDocument();
    });

    it('marks the selected row pressed; a greyed row stays selectable', async () => {
        const onSelect = renderList('forge', 'item:AxeBronze');
        expect(rowNamed(/Bronze axe/)).toHaveAttribute('aria-pressed', 'true');
        expect(rowNamed(/^Bronze$/)).toHaveAttribute('aria-pressed', 'false');
        await userEvent.setup().click(rowNamed(/^Bronze$/));
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ entry: expect.objectContaining({ prefab: 'Bronze' }) }));
    });

    it('is one tab stop on the selected row; arrows move focus, Enter selects', async () => {
        const user = userEvent.setup();
        const onSelect = renderList('forge', 'item:AxeBronze');
        await user.tab();
        expect(rowNamed(/Bronze axe/)).toHaveFocus();
        await user.keyboard('{ArrowDown}');
        expect(rowNamed(/Bronze nails/)).toHaveFocus();
        await user.keyboard('{Home}{Enter}');
        expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ entry: expect.objectContaining({ prefab: 'Bronze' }) }));
    });

    it('marks the list busy while stock loads and renders the empty slot with no rows', () => {
        render(<RecipeList label="Forge recipes" rows={[]} selectedKey={null} onSelect={vi.fn()} names={names} showStation={false} busy empty={<p>No recipes match.</p>} />);
        expect(screen.getByText('No recipes match.')).toBeInTheDocument();
        render(<RecipeList label="Busy recipes" rows={rowsOf('forge')} selectedKey={null} onSelect={vi.fn()} names={names} showStation={false} busy />);
        expect(screen.getByRole('list', { name: 'Busy recipes' })).toHaveAttribute('aria-busy', 'true');
    });
});
