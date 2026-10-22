/** ROK-1853 — "where is it": the visible chests, each opening its contents. */
import type { JSX } from 'react';
import type { ValheimContainerSummary } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { StatusChip } from '../../../components/ui/status-chip';
import type { ItemIconContext } from '../character/use-item-icons';
import { MapPinIcon } from '@heroicons/react/24/outline';
import { chestFocusHash } from '../map/chest-focus';
import { chestLabel, formatCoords } from './materials.helpers';

interface ChestListProps {
    containers: readonly ValheimContainerSummary[];
    ctx: ItemIconContext;
    onOpen: (chest: ValheimContainerSummary) => void;
    /** ROK-1889: the filtered item's prefab — carried into the map link. */
    holding?: string | null;
}

const MAP_LINK_CLASS =
    'flex min-h-[44px] shrink-0 items-center gap-1 rounded-lg px-3 text-sm text-success underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success';

/** ROK-1889: a plain hash link (TabRow rule) to the Map tab centred on the chest. */
function MapLink({
    chest,
    holding,
    ctx,
}: {
    chest: ValheimContainerSummary;
    holding: string | null;
    ctx: ItemIconContext;
}): JSX.Element {
    const { prefab, x, z } = chest;
    return (
        <a
            href={chestFocusHash({ prefab, x, z, item: holding })}
            aria-label={`Show ${chestLabel(chest, ctx)} at ${formatCoords(x, z)} on the map`}
            data-testid="valheim-chest-map-link"
            className={MAP_LINK_CLASS}
        >
            <MapPinIcon aria-hidden="true" className="h-4 w-4" />
            Map
        </a>
    );
}

function ChestChips({
    chest,
}: {
    chest: ValheimContainerSummary;
}): JSX.Element {
    return (
        <span className="flex flex-wrap gap-1">
            {chest.vehicle && (
                <StatusChip tone="neutral" title="On a cart or ship">
                    Vehicle
                </StatusChip>
            )}
            {chest.privacy === 'personal' && (
                <StatusChip tone="neutral" title="A personal chest">
                    Personal
                </StatusChip>
            )}
            {chest.unreadable && (
                <StatusChip
                    tone="warning"
                    title="The server could not read this chest"
                >
                    Unreadable
                </StatusChip>
            )}
        </span>
    );
}

export function ChestList({
    containers,
    ctx,
    onOpen,
    holding = null,
}: ChestListProps): JSX.Element {
    if (containers.length === 0)
        return (
            <p className="py-4 text-center text-sm text-muted">
                No chests to show.
            </p>
        );
    return (
        <ul className="divide-y divide-edge" aria-label="Chests">
            {containers.map((c) => (
                <li key={c.key} className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        fullWidth
                        onClick={() => onOpen(c)}
                        className="min-w-0 flex-1 justify-start text-left"
                    >
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-foreground">
                                {chestLabel(c, ctx)}
                            </span>
                            <span className="block text-xs text-muted tabular-nums">
                                {formatCoords(c.x, c.z)} · {c.usedSlots}/
                                {c.slots} slots
                            </span>
                        </span>
                        <ChestChips chest={c} />
                    </Button>
                    <MapLink chest={c} holding={holding} ctx={ctx} />
                </li>
            ))}
        </ul>
    );
}
