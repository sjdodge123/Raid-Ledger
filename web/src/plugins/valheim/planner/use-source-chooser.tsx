/**
 * ROK-1860 — the open-picker state shared by the two Planner trees (the
 * list's plan and the crafting window's breakdown). The tab provides the
 * viewer's picks through `PlannerSourcesContext`; without a provider the
 * trees keep their static "+N other ways" chips.
 */
import { createContext, useContext, useMemo, useState, type JSX } from 'react';
import type { ValheimRecipeCatalogEntry, ValheimRecipeCatalogResponse, ValheimRecipeSourceRef } from '@raid-ledger/contract';
import type { SourceOverrides } from './planner-sources';
import type { SourceChooser } from './recipe-tree-row';
import { SourcePicker } from './source-picker';
import type { PlannerNames } from './use-planner-names';

export interface PlannerSourcesValue {
    sources: SourceOverrides;
    setSource: (prefab: string, ref: ValheimRecipeSourceRef | null) => void;
}

export const PlannerSourcesContext = createContext<PlannerSourcesValue | null>(null);

export function usePlannerSourcesContext(): PlannerSourcesValue | null {
    return useContext(PlannerSourcesContext);
}

interface SourceChooserState {
    chooser: SourceChooser | undefined;
    picker: JSX.Element | null;
}

/** The tree's chooser and the one `SourcePicker` it opens; inert without a provider. */
export function useSourceChooser(catalog: Pick<ValheimRecipeCatalogResponse, 'entries'>, names: PlannerNames): SourceChooserState {
    const value = usePlannerSourcesContext();
    const [open, setOpen] = useState<string | null>(null);
    const items = useMemo(
        () => new Map<string, ValheimRecipeCatalogEntry>(catalog.entries.filter((e) => e.kind === 'item').map((e) => [e.prefab, e])),
        [catalog.entries],
    );
    if (value === null) return { chooser: undefined, picker: null };
    const chooser: SourceChooser = {
        optionsOf: (prefab, kind) => (kind === 'item' ? items.get(prefab)?.sourceOptions : undefined),
        choose: setOpen,
    };
    const onPick = (ref: ValheimRecipeSourceRef | null): void => {
        if (open !== null) value.setSource(open, ref);
        setOpen(null);
    };
    const entry = open === null ? null : (items.get(open) ?? null);
    const current = open === null ? undefined : value.sources.get(open);
    const picker = <SourcePicker entry={entry} open={open !== null} current={current} names={names} onPick={onPick} onClose={() => setOpen(null)} />;
    return { chooser, picker };
}
