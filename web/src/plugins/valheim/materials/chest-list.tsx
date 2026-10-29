/** ROK-1853 — "where is it": the visible chests, each opening its contents. */
import type { JSX } from 'react';
import type {
    ValheimContainerSummary,
    ValheimMaterialsBase,
} from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { buttonClass } from '../../../components/ui/button-classes';
import { StatusChip } from '../../../components/ui/status-chip';
import type { ItemIconContext } from '../character/use-item-icons';
import { MapPinIcon } from '@heroicons/react/24/outline';
import { chestFocusHash } from '../map/chest-focus';
import { chestDisplayName } from './materials-bases.helpers';
import { formatCoords } from './materials.helpers';

interface ChestListProps {
    containers: readonly ValheimContainerSummary[];
    /** ROK-1859: names each chest "Wood chest 2 · Base near x…, z…". */
    bases: readonly ValheimMaterialsBase[];
    ctx: ItemIconContext;
    onOpen: (chest: ValheimContainerSummary) => void;
    /** ROK-1889: the filtered item's prefab — carried into the map link. */
    holding?: string | null;
}

/** A real `<a>` that looks like the row's ghost button (design-system §3, `buttonClass`). */
const MAP_LINK_CLASS = buttonClass({
    variant: 'ghost',
    className: 'shrink-0 gap-1',
});

/** ROK-1889: a plain hash link (TabRow rule) to the Map tab centred on the chest. */
function MapLink({
    chest,
    holding,
    name,
}: {
    chest: ValheimContainerSummary;
    holding: string | null;
    name: string;
}): JSX.Element {
    const { prefab, x, y, z } = chest;
    return (
        <a
            href={chestFocusHash({ prefab, x, y, z, item: holding })}
            aria-label={`Show ${name} at ${formatCoords(x, z)} on the map`}
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

function ChestRowText({
    chest,
    name,
}: {
    chest: ValheimContainerSummary;
    name: string;
}): JSX.Element {
    return (
        <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-foreground">
                {name}
            </span>
            <span className="block text-xs text-muted tabular-nums">
                {formatCoords(chest.x, chest.z)} · {chest.usedSlots}/
                {chest.slots} slots
            </span>
        </span>
    );
}

function ChestRow({
    chest,
    name,
    onOpen,
    holding,
}: {
    chest: ValheimContainerSummary;
    name: string;
    onOpen: (chest: ValheimContainerSummary) => void;
    holding: string | null;
}): JSX.Element {
    return (
        <li className="flex items-center gap-1">
            <Button
                variant="ghost"
                fullWidth
                onClick={() => onOpen(chest)}
                className="min-w-0 flex-1 justify-start text-left"
            >
                <ChestRowText chest={chest} name={name} />
                <ChestChips chest={chest} />
            </Button>
            <MapLink chest={chest} holding={holding} name={name} />
        </li>
    );
}

export function ChestList({
    containers,
    bases,
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
                <ChestRow
                    key={c.key}
                    chest={c}
                    name={chestDisplayName(c, bases, ctx)}
                    onOpen={onOpen}
                    holding={holding}
                />
            ))}
        </ul>
    );
}
