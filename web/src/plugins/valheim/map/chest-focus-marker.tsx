/**
 * ROK-1889 — the chest focus marker: a success-ringed chest disc at the
 * chest's position (ROK-1880 projection), counter-scaled like a pin, its
 * label always shown. Not interactive — the Materials row is the action.
 */
import type { JSX } from 'react';
import type { ValheimMapGrid } from '@raid-ledger/contract';
import { ArchiveBoxIcon } from '@heroicons/react/24/solid';
import { chestMarkerPoint } from './chest-focus';
import { chestFocusLabel, type ValheimChestFocus } from './use-chest-focus';

interface MarkerProps {
    grid: ValheimMapGrid;
    scale: number;
    chest: ValheimChestFocus;
}

/** Anchored on the disc centre, counter-scaled to a constant screen size. */
function markerStyle(x: number, y: number, scale: number) {
    return {
        left: x,
        top: y,
        transform: `translate(-50%, -18px) scale(${1 / scale})`,
        transformOrigin: '50% 18px',
    };
}

export function ChestFocusMarker({
    grid,
    scale,
    chest,
}: MarkerProps): JSX.Element {
    const { x, y } = chestMarkerPoint(grid, chest.x, chest.z);
    const label = chestFocusLabel(chest);
    return (
        <span
            role="img"
            aria-label={`Chest: ${label}`}
            data-testid="valheim-chest-marker"
            className="pointer-events-none absolute flex flex-col items-center"
            style={markerStyle(x, y, scale)}
        >
            <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-success bg-surface">
                <ArchiveBoxIcon
                    aria-hidden="true"
                    className="h-5 w-5 text-success"
                />
            </span>
            <span
                aria-hidden="true"
                className="mt-1 whitespace-nowrap rounded-md border border-edge bg-surface px-1.5 py-0.5 text-xs font-medium text-foreground"
            >
                {label}
            </span>
        </span>
    );
}
