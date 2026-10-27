/** ROK-1861 — the per-step breakdown under a multi-step recipe row, and the optional station build. */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ValheimPlanNode, ValheimPlanStep } from '@raid-ledger/contract';
import { RecipeSteps } from './recipe-steps';
import { RecipeTree } from './recipe-tree';
import type { PlannerNames } from './use-planner-names';

const NAMES: Record<string, string> = {
    Bronze: 'Bronze',
    DeerHide: 'Deer hide',
    Upgrader1Armor: 'Upgrade item',
    Stone: 'Stone',
    forge: 'Forge',
    upgrader_test: 'Armor upgrader',
};
const nameOf = (p: string): string => NAMES[p] ?? p;
const names: PlannerNames = { nameOf, stationName: nameOf, ctxFor: () => ({ items: {}, atlas: null }) as never };

const step = (quality: number, station: string, upgraderStation: boolean, resources: [string, number][]): ValheimPlanStep => ({
    quality,
    station,
    stationLevel: quality,
    anyOneOf: false,
    upgraderStation,
    resources: resources.map(([prefab, amount]) => ({ prefab, amount })),
});

const UPGRADER = [
    step(1, 'upgrader_test', true, [['Bronze', 5], ['DeerHide', 2]]),
    step(2, 'upgrader_test', true, [['Bronze', 3], ['Upgrader1Armor', 1]]),
    step(3, 'upgrader_test', true, [['Bronze', 3], ['Upgrader1Armor', 1]]),
];
const BUILDS = { upgrader_test: [{ prefab: 'Stone', amount: 10 }, { prefab: 'Bronze', amount: 2 }] };

const disclosure = () => screen.getByRole('button', { name: /3 steps/ });

describe('RecipeSteps', () => {
    it('opens by default when a step is at an upgrade station, with each step labelled', () => {
        render(<RecipeSteps steps={UPGRADER} builds={BUILDS} names={names} />);
        expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
        const items = screen.getAllByTestId('valheim-planner-step');
        expect(items.map((li) => li.getAttribute('data-quality'))).toEqual(['1', '2', '3']);
        const q2 = items[1];
        if (q2 === undefined) throw new Error('no q2 step');
        expect(within(q2).getByText('Quality 2 · Armor upgrader')).toBeInTheDocument();
        expect(within(q2).getByText('Upgrade station · lvl 2')).toHaveAttribute('title', 'Upgraded at Armor upgrader, level 2');
        expect(within(q2).getByText('Bronze 3 · Upgrade item 1')).toBeInTheDocument();
    });

    it('stays collapsed when no step is at an upgrade station, and the disclosure toggles', async () => {
        const plain = [step(1, 'forge', false, [['Bronze', 8]]), step(2, 'forge', false, [['Bronze', 4]]), step(3, 'forge', false, [['Bronze', 4]])];
        render(<RecipeSteps steps={plain} builds={undefined} names={names} />);
        expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('valheim-planner-step')).not.toBeInTheDocument();
        await userEvent.click(disclosure());
        expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getAllByTestId('valheim-planner-step')).toHaveLength(3);
        expect(screen.getByText('Quality 2 · Forge · lvl 2')).toBeInTheDocument();
        expect(screen.queryByText(/Upgrade station · lvl/)).not.toBeInTheDocument();
    });

    it('offers the upgrade station build once, collapsed, listing its pieces and the not-added note', async () => {
        render(<RecipeSteps steps={UPGRADER} builds={BUILDS} names={names} />);
        const builds = screen.getAllByRole('button', { name: 'Build Armor upgrader (optional)' });
        expect(builds).toHaveLength(1);
        const build = builds[0];
        if (build === undefined) throw new Error('no build disclosure');
        expect(build).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(build);
        expect(build).toHaveAttribute('aria-expanded', 'true');
        const cost = screen.getByTestId('valheim-planner-station-build');
        expect(within(cost).getByText('Stone 10 · Bronze 2')).toBeInTheDocument();
        expect(within(cost).getByText('Not added to your list.')).toBeInTheDocument();
    });

    it('labels an any-one-of step as alternatives, not an additive cost', async () => {
        const either: ValheimPlanStep = { ...step(2, 'forge', false, [['Bronze', 3], ['DeerHide', 2]]), anyOneOf: true };
        const steps = [step(1, 'forge', false, [['Bronze', 5]]), either, step(3, 'forge', false, [['Bronze', 3], ['Stone', 1]])];
        render(<RecipeSteps steps={steps} builds={undefined} names={names} />);
        await userEvent.click(disclosure());
        expect(screen.getByText('Any one of: Bronze 3 · Deer hide 2')).toBeInTheDocument();
        expect(screen.getByText('Bronze 3 · Stone 1')).toBeInTheDocument();
    });

    it('shows no build disclosure when the response has no build for the station', () => {
        render(<RecipeSteps steps={UPGRADER} builds={undefined} names={names} />);
        expect(screen.queryByRole('button', { name: /^Build / })).not.toBeInTheDocument();
    });
});

// ROK-1861 F4: StatusChip is `whitespace-nowrap`, and Tailwind 4 emits that rule AFTER `.whitespace-normal`,
// so only the important modifier lets "Armor upgrader · Upgrade station · lvl 3" wrap at 375px.
describe('upgrade-station chips wrap on a phone', () => {
    const treeNames: PlannerNames = { ...names, ctxFor: () => ({ serverId: 7, items: {}, atlas: null, atlasUrl: null }) };
    const node: ValheimPlanNode = {
        id: 1, parentId: null, prefab: 'ArmorBronzeChest', quantity: 1, alternatives: 0, crafts: 1, have: null, short: null,
        via: {
            type: 'recipe', recipeId: 'r', station: 'upgrader_test', stationLevel: 3, quality: 3, upgradeOnly: false,
            formula: 'custom', anyOneOf: false, upgraderStation: true, steps: UPGRADER,
        },
    };

    it('the plan-row via-chip and the step chip both carry the wrap override', () => {
        render(<RecipeTree nodes={[node]} truncated={false} names={treeNames} label="What your list needs" rootKinds={['item']} />);
        expect(screen.getByText('Armor upgrader · Upgrade station · lvl 3')).toHaveClass('whitespace-normal!');
        expect(screen.getByText('Upgrade station · lvl 3')).toHaveClass('whitespace-normal!');
    });
});
