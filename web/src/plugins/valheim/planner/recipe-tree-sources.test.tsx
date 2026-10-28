/** ROK-1860 AC8 / D7 — an anyOneOf ingredient keeps its static stand-in chip even when the item has ≥2 sources. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ValheimPlanNode, ValheimRecipeSourceOption } from '@raid-ledger/contract';
import { RecipeTree } from './recipe-tree';
import type { SourceChooser } from './recipe-tree-row';
import type { PlannerNames } from './use-planner-names';

const nameOf = (p: string): string => p;
const names: PlannerNames = { nameOf, stationName: nameOf, ctxFor: () => ({ items: {}, atlas: null }) as never };
const option = (recipeId: string): ValheimRecipeSourceOption => ({
    ref: { type: 'recipe', recipeId }, station: null, stationLevel: 0, outputAmount: 1, upgradeOnly: false, resources: [], default: false,
});
const chooser: SourceChooser = { optionsOf: () => [option('Recipe_A'), option('Recipe_B')], choose: vi.fn() };

const node = (id: number, parentId: number | null, prefab: string, anyOneOf: boolean, alternatives: number): ValheimPlanNode => ({
    id, parentId, prefab, quantity: 1, alternatives, crafts: 1, have: null, short: null,
    via: { type: 'recipe', recipeId: `Recipe_${prefab}`, station: null, stationLevel: 0, quality: 1, upgradeOnly: false, formula: 'vanilla', anyOneOf, upgraderStation: false },
});

function renderTree(parentAnyOneOf: boolean): void {
    // The child's `alternatives` is the stand-in count under an anyOneOf parent (resolve.ts), the source count otherwise.
    render(<RecipeTree nodes={[node(1, null, 'Root', parentAnyOneOf, 0), node(2, 1, 'Meat', false, 3)]} truncated={false}
        names={names} label="Tree" rootKinds={['item']} onChooseSource={chooser} />);
}

describe('RecipeTree source chooser under an anyOneOf recipe', () => {
    it('a child of an anyOneOf recipe keeps the static "+N other ways" chip, not a picker button', () => {
        renderTree(true);
        expect(screen.queryByRole('button', { name: /Choose how to make Meat/ }), 'no picker under an anyOneOf parent').toBeNull();
        expect(screen.getByText('+3 other ways')).toBeInTheDocument();
    });

    it('the same child under a plain recipe gets the picker button', () => {
        renderTree(false);
        expect(screen.getByRole('button', { name: /Choose how to make Meat/ })).toBeInTheDocument();
    });
});
