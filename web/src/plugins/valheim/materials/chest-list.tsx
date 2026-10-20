/** ROK-1853 — "where is it": the visible chests, each opening its contents. */
import type { JSX } from 'react';
import type { ValheimContainerSummary } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';
import type { ItemIconContext } from '../character/use-item-icons';
import { chestLabel, formatCoords } from './materials.helpers';

interface ChestListProps {
    containers: readonly ValheimContainerSummary[];
    ctx: ItemIconContext;
    onOpen: (chest: ValheimContainerSummary) => void;
}

function ChestChips({ chest }: { chest: ValheimContainerSummary }): JSX.Element {
    return (
        <span className="flex flex-wrap gap-1">
            {chest.vehicle && <StatusChip tone="neutral" title="On a cart or ship">Vehicle</StatusChip>}
            {chest.privacy === 'personal' && <StatusChip tone="neutral" title="A personal chest">Personal</StatusChip>}
            {chest.unreadable && <StatusChip tone="warning" title="The server could not read this chest">Unreadable</StatusChip>}
        </span>
    );
}

export function ChestList({ containers, ctx, onOpen }: ChestListProps): JSX.Element {
    if (containers.length === 0) return <p className="py-4 text-center text-sm text-muted">No chests to show.</p>;
    return (
        <ul className="divide-y divide-edge" aria-label="Chests">
            {containers.map((c) => (
                <li key={c.key}>
                    <button type="button" onClick={() => onOpen(c)}
                        className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-overlay/30">
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-foreground">{chestLabel(c, ctx)}</span>
                            <span className="block text-xs text-muted tabular-nums">
                                {formatCoords(c.x, c.z)} · {c.usedSlots}/{c.slots} slots
                            </span>
                        </span>
                        <ChestChips chest={c} />
                    </button>
                </li>
            ))}
        </ul>
    );
}
