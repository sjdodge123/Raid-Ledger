/**
 * ROK-1853 — the "Chests" section: every visible chest, or (with an item
 * selected in the totals) only the chests holding it. Loading and failure
 * are their own states; "No chests to show" is a successful empty list
 * (Codex r2).
 */
import { useState, type JSX } from 'react';
import type {
    ValheimContainerListResponse,
    ValheimContainerSummary,
    ValheimMaterialsBase,
} from '@raid-ledger/contract';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button } from '../../../components/ui/button';
import type { ItemIconContext } from '../character/use-item-icons';
import { ChestDetail } from './chest-detail';
import { ChestList } from './chest-list';
import { chestsInBase } from './materials-bases.helpers';

interface ChestsSectionProps {
    serverId: number;
    includeVehicles: boolean;
    chests: UseQueryResult<ValheimContainerListResponse>;
    /** ROK-1859: every base (for chest names) and the selected one (null = all). */
    bases: readonly ValheimMaterialsBase[];
    base: ValheimMaterialsBase | null;
    /** The selected item's display name, or null for every chest. */
    holdingLabel: string | null;
    /** ROK-1889: the selected item's prefab, for the chest map links. */
    holding?: string | null;
    onClear: () => void;
    ctx: ItemIconContext;
}

function HoldingLine({
    label,
    onClear,
}: {
    label: string;
    onClear: () => void;
}): JSX.Element {
    return (
        <p
            className="flex items-center gap-2 text-sm text-secondary"
            data-testid="valheim-chests-holding"
        >
            <span>
                Chests holding{' '}
                <span className="font-medium text-foreground">{label}</span>
            </span>
            <span aria-hidden="true">·</span>
            <Button variant="ghost" size="sm" onClick={onClear}>
                Clear
            </Button>
        </p>
    );
}

function ChestsBody({
    chests,
    bases,
    base,
    ctx,
    onOpen,
    holding,
}: Pick<ChestsSectionProps, 'chests' | 'bases' | 'base' | 'ctx'> & {
    onOpen: (chest: ValheimContainerSummary) => void;
    holding: string | null;
}): JSX.Element {
    // Placeholder rows belong to the previous filter (another item, or the
    // vehicles toggle): never present them as the answer to this one.
    if (chests.isPending || chests.isPlaceholderData)
        return <p className="py-4 text-sm text-muted">Loading chests…</p>;
    if (chests.isError)
        return (
            <p
                role="alert"
                className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
            >
                Couldn’t load the chests. Try again in a moment.
            </p>
        );
    return (
        <ChestList
            containers={chestsInBase(chests.data.containers, base)}
            bases={bases}
            ctx={ctx}
            onOpen={onOpen}
            holding={holding}
        />
    );
}

export function ChestsSection({
    serverId,
    includeVehicles,
    chests,
    bases,
    base,
    holdingLabel,
    holding = null,
    onClear,
    ctx,
}: ChestsSectionProps): JSX.Element {
    const [open, setOpen] = useState<ValheimContainerSummary | null>(null);
    return (
        <section aria-labelledby="valheim-chests" className="space-y-2">
            <h2
                id="valheim-chests"
                className="text-base font-semibold text-foreground"
            >
                Chests
            </h2>
            {holdingLabel !== null && (
                <HoldingLine label={holdingLabel} onClear={onClear} />
            )}
            <ChestsBody
                chests={chests}
                bases={bases}
                base={base}
                ctx={ctx}
                onOpen={setOpen}
                holding={holding}
            />
            <ChestDetail
                serverId={serverId}
                includeVehicles={includeVehicles}
                chest={open}
                bases={bases}
                ctx={ctx}
                onClose={() => setOpen(null)}
            />
        </section>
    );
}
