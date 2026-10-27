/** ROK-1861 D8 — the detail pane's star slot names an upgrade station. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ValheimRecipeUpgrade } from '@raid-ledger/contract';
import { IngredientSlots } from './ingredient-slots';
import type { PlannerNames } from './use-planner-names';

const names: PlannerNames = { nameOf: (p) => p, stationName: (p) => p, ctxFor: () => ({ items: {}, atlas: null }) as never };
const upgrade = (upgraderStation: boolean): ValheimRecipeUpgrade => ({
    station: 'upgrader_test',
    stationLevel: 2,
    anyOneOf: false,
    resources: [],
    quality: 2,
    upgraderStation,
});
const renderSlots = (upgraderStation: boolean) =>
    render(<IngredientSlots cost={upgrade(upgraderStation)} totals={null} stockState="none" names={names} stationLabel="Armor upgrader" />);

describe('IngredientSlots star slot', () => {
    it('shows "Upgrade station" and says so in its accessible name for an upgrade-station step', () => {
        renderSlots(true);
        const star = screen.getByTestId('valheim-craft-star-slot');
        expect(star).toHaveAccessibleName('Armor upgrader, upgrade station, level 2');
        expect(star).toHaveTextContent('Upgrade station');
    });
    it('keeps the plain station slot otherwise', () => {
        renderSlots(false);
        const star = screen.getByTestId('valheim-craft-star-slot');
        expect(star).toHaveAccessibleName('Armor upgrader, level 2');
        expect(star).not.toHaveTextContent('Upgrade station');
    });
});
