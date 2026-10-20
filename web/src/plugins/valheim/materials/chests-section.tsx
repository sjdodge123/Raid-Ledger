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
} from '@raid-ledger/contract';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button } from '../../../components/ui/button';
import type { ItemIconContext } from '../character/use-item-icons';
import { ChestDetail } from './chest-detail';
import { ChestList } from './chest-list';

interface ChestsSectionProps {
    serverId: number;
    includeVehicles: boolean;
    chests: UseQueryResult<ValheimContainerListResponse>;
    /** The selected item's display name, or null for every chest. */
    holdingLabel: string | null;
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
    ctx,
    onOpen,
}: {
    chests: ChestsSectionProps['chests'];
    ctx: ItemIconContext;
    onOpen: (chest: ValheimContainerSummary) => void;
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
            containers={chests.data.containers}
            ctx={ctx}
            onOpen={onOpen}
        />
    );
}

export function ChestsSection({
    serverId,
    includeVehicles,
    chests,
    holdingLabel,
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
            <ChestsBody chests={chests} ctx={ctx} onOpen={setOpen} />
            <ChestDetail
                serverId={serverId}
                includeVehicles={includeVehicles}
                chest={open}
                ctx={ctx}
                onClose={() => setOpen(null)}
            />
        </section>
    );
}
