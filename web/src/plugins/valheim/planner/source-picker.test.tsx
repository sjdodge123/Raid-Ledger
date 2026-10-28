/** ROK-1860 — the source picker (D8) and the row's "+N other ways" chip vs button (AC6 / AC8). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type JSX } from 'react';
import type { ValheimPlanNode, ValheimRecipeCatalogEntry, ValheimRecipeSourceOption, ValheimRecipeSourceRef } from '@raid-ledger/contract';
import { RecipeTreeRow, type SourceChooser } from './recipe-tree-row';
import { SourcePicker } from './source-picker';
import type { PlannerNames } from './use-planner-names';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));

const NAMES: Record<string, string> = { Bronze: 'Bronze', Copper: 'Copper', Tin: 'Tin', CopperOre: 'Copper ore', forge: 'Forge', smelter: 'Smelter' };
const names: PlannerNames = {
    nameOf: (p) => NAMES[p] ?? p,
    stationName: (p) => NAMES[p] ?? p,
    ctxFor: () => ({ serverId: 1, items: {}, atlas: null, atlasUrl: null }),
};

const FORGE: ValheimRecipeSourceOption = {
    ref: { type: 'recipe', recipeId: 'Recipe_Bronze' }, station: 'forge', stationLevel: 1, outputAmount: 1, upgradeOnly: false,
    resources: [{ prefab: 'Copper', amount: 2 }, { prefab: 'Tin', amount: 1 }], default: true,
};
const BULK: ValheimRecipeSourceOption = {
    ref: { type: 'recipe', recipeId: 'Recipe_Bronze5' }, station: 'forge', stationLevel: 2, outputAmount: 5, upgradeOnly: false,
    resources: [{ prefab: 'Copper', amount: 10 }, { prefab: 'Tin', amount: 5 }], default: false, discovered: false,
};
const ENTRY = { prefab: 'Bronze', kind: 'item', name: 'Bronze', sourceOptions: [FORGE, BULK] } as unknown as ValheimRecipeCatalogEntry;

beforeEach(() => {
    media.desktop = true;
});

describe('SourcePicker', () => {
    const renderPicker = (current: ValheimRecipeSourceRef | undefined) => {
        const onPick = vi.fn();
        const onClose = vi.fn();
        render(<SourcePicker entry={ENTRY} current={current} onPick={onPick} onClose={onClose} open names={names} />);
        return { onPick, onClose };
    };

    it('lists every source with its cost, "Best guess" on the default, and the stored pick selected', () => {
        renderPicker(BULK.ref);
        const dialog = screen.getByRole('dialog', { name: 'How to make Bronze' });
        const radios = within(dialog).getAllByRole('radio');
        expect(radios).toHaveLength(3);
        expect(within(dialog).getByRole('radio', { name: /Forge · lvl 1.*Best guess/ })).not.toBeChecked();
        expect(within(dialog).getByRole('radio', { name: /Forge · lvl 2/ })).toBeChecked();
        expect(within(dialog).getByRole('radio', { name: /Forge · lvl 2/ }).closest('label') ?? dialog).toHaveTextContent('Copper × 10');
        expect(within(dialog).getAllByText('Best guess')).toHaveLength(1);
        expect(within(dialog).getByTestId('valheim-undiscovered-chip')).toBeInTheDocument();
        expect(within(dialog).getByText('Makes 5')).toBeInTheDocument();
    });

    it('no stored pick selects "Use the default"', () => {
        renderPicker(undefined);
        expect(screen.getByRole('radio', { name: /Use the default/ })).toBeChecked();
    });

    it('picking a source calls onPick with its ref; "Use the default" with null', async () => {
        const user = userEvent.setup();
        const { onPick } = renderPicker(BULK.ref);
        await user.click(screen.getByRole('radio', { name: /Forge · lvl 1/ }));
        expect(onPick).toHaveBeenLastCalledWith({ type: 'recipe', recipeId: 'Recipe_Bronze' });
        await user.click(screen.getByRole('radio', { name: /Use the default/ }));
        expect(onPick).toHaveBeenLastCalledWith(null);
    });

    it('Esc closes it', async () => {
        const user = userEvent.setup();
        const { onClose } = renderPicker(BULK.ref);
        await user.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalled();
    });

    it('below 1024px it is a bottom sheet with the same options', () => {
        media.desktop = false;
        renderPicker(BULK.ref);
        expect(screen.getByRole('dialog', { name: 'How to make Bronze' })).toBeInTheDocument();
        expect(screen.getAllByRole('radio')).toHaveLength(3);
    });
});

const node = (over: Partial<ValheimPlanNode> = {}): ValheimPlanNode => ({
    id: 0, parentId: null, prefab: 'Bronze', quantity: 2, alternatives: 1, crafts: 2, have: 0, short: 2,
    via: { type: 'recipe', recipeId: 'Recipe_Bronze', station: 'forge', stationLevel: 1, quality: 1, upgradeOnly: false, formula: 'vanilla', anyOneOf: false, upgraderStation: false },
    ...over,
});

function chooser(options: readonly ValheimRecipeSourceOption[], choose: SourceChooser['choose'] = vi.fn()): SourceChooser {
    return { optionsOf: (p, kind) => (p === 'Bronze' && kind === 'item' ? options : undefined), choose };
}

const renderRow = (n: ValheimPlanNode, c: SourceChooser | undefined) =>
    render(<RecipeTreeRow node={n} kind="item" names={names} hasChildren={false} expanded onToggle={() => {}} onChooseSource={c} />);

describe('RecipeTreeRow "+N other ways"', () => {
    it('is a dialog button when the catalogue offers ≥2 sources (AC6)', async () => {
        const user = userEvent.setup();
        const choose = vi.fn();
        renderRow(node(), chooser([FORGE, BULK], choose));
        const button = screen.getByRole('button', { name: 'Choose how to make Bronze (1 other ways)' });
        expect(button).toHaveAttribute('aria-haspopup', 'dialog');
        await user.click(button);
        expect(choose).toHaveBeenCalledWith('Bronze');
        expect(screen.getAllByText('+1 other ways')).toHaveLength(1);
    });

    it('stays a static chip with fewer than 2 sources — an anyOneOf count (AC8)', () => {
        renderRow(node({ alternatives: 2 }), chooser([FORGE]));
        expect(screen.queryByRole('button', { name: /Choose how to make/ })).toBeNull();
        expect(screen.getByText('+2 other ways')).toBeInTheDocument();
    });

    it('stays a static chip without a chooser', () => {
        renderRow(node(), undefined);
        expect(screen.queryByRole('button', { name: /Choose how to make/ })).toBeNull();
        expect(screen.getByText('+1 other ways')).toBeInTheDocument();
    });

    it('a withheld row shows no chip and no button (AC8)', () => {
        renderRow(node({ via: { type: 'undiscovered' } }), chooser([FORGE, BULK]));
        expect(screen.queryByRole('button', { name: /Choose how to make/ })).toBeNull();
        expect(screen.queryByText(/other ways/)).toBeNull();
    });
});

/** Focus returns to the chip once the picker closes (AC9). */
function Harness(): JSX.Element {
    const [open, setOpen] = useState<string | null>(null);
    return (
        <>
            <RecipeTreeRow node={node()} kind="item" names={names} hasChildren={false} expanded onToggle={() => {}} onChooseSource={chooser([FORGE, BULK], setOpen)} />
            <SourcePicker entry={ENTRY} current={undefined} open={open !== null} names={names} onPick={() => setOpen(null)} onClose={() => setOpen(null)} />
        </>
    );
}

describe('picker focus', () => {
    it('Esc closes the picker and focus returns to the chip', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        const button = screen.getByRole('button', { name: /Choose how to make Bronze/ });
        await user.click(button);
        expect(await screen.findByRole('dialog', { name: 'How to make Bronze' })).toBeInTheDocument();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(button).toHaveFocus();
    });
});
