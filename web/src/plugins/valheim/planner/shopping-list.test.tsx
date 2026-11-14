/** ROK-1854 — the shopping list's "Copy list" control. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ValheimRecipePlanResponse } from '@raid-ledger/contract';
import { recipePlanFixture } from '../../../test/mocks/valheim-recipes-handlers';
import type { PlannerTarget } from './planner.helpers';
import type { PlannerNames } from './use-planner-names';
import { ShoppingList } from './shopping-list';

type Line = ValheimRecipePlanResponse['shoppingList'][number];

const TARGETS: PlannerTarget[] = [{ prefab: 'SwordBronze', kind: 'item', quality: 1, fromQuality: 0, amount: 1 }];
const names: PlannerNames = {
    nameOf: (prefab) => prefab,
    stationName: (prefab) => prefab,
    ctxFor: () => ({ serverId: 7, items: {}, atlas: null, atlasUrl: null }),
};

function renderList(lines: Line[]): void {
    const plan: ValheimRecipePlanResponse = { ...recipePlanFixture([]), shoppingList: lines, fuelEstimates: [] };
    render(<ShoppingList targets={TARGETS} plan={plan} names={names} onRemove={vi.fn()} isHidden={() => false} />);
}

describe('ShoppingList — Copy list', () => {
    it('offers "Copy list" when something is still short (control)', () => {
        renderList([{ prefab: 'Copper', need: 4, have: 1, short: 3 }]);
        expect(screen.getByText('Copy list')).toBeInTheDocument();
        expect(screen.getByTitle('Copy to clipboard')).toBeInTheDocument();
    });

    it('hides "Copy list" when nothing is short, so an empty list is never copied', () => {
        renderList([{ prefab: 'Copper', need: 4, have: 4, short: 0 }]);
        expect(screen.queryByText('Copy list')).toBeNull();
        expect(screen.queryByTitle('Copy to clipboard')).toBeNull();
    });
});
