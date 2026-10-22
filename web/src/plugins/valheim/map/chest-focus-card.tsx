/**
 * ROK-1889 — the line above the map naming the focused chest, or saying it
 * is not there. A hidden personal chest reads exactly like a missing one.
 */
import type { JSX } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ArchiveBoxIcon } from '@heroicons/react/24/outline';
import { formatCoords } from '../materials/materials.helpers';
import type { ChestFocusTarget } from './chest-focus';
import type { ValheimChestFocus } from '@raid-ledger/contract';
import { chestFocusLabel } from './use-chest-focus';

const CARD =
    'flex items-center gap-2 rounded-lg border border-edge bg-panel p-3 text-sm';

interface ChestFocusCardProps {
    target: ChestFocusTarget | null;
    query: UseQueryResult<ValheimChestFocus | null>;
}

function Missing({ failed }: { failed: boolean }): JSX.Element {
    return (
        <p
            role="status"
            data-testid="valheim-chest-focus"
            className={`${CARD} text-muted`}
        >
            {failed
                ? 'The chest could not be loaded. Try again later.'
                : 'That chest is not on the map — it may have moved or been removed.'}
        </p>
    );
}

function Found({ chest }: { chest: ValheimChestFocus }): JSX.Element {
    return (
        <p
            role="status"
            data-testid="valheim-chest-focus"
            className={`${CARD} text-foreground`}
        >
            <ArchiveBoxIcon
                aria-hidden="true"
                className="h-5 w-5 shrink-0 text-success"
            />
            <span className="min-w-0">
                {chestFocusLabel(chest)}
                <span className="text-muted tabular-nums">
                    {' '}
                    · {formatCoords(chest.x, chest.z)}
                </span>
            </span>
        </p>
    );
}

/** Hidden personal chest = missing chest: the same line, never a hint. */
export function ChestFocusCard({
    target,
    query,
}: ChestFocusCardProps): JSX.Element | null {
    if (target === null || query.isPending) return null;
    if (query.isError || query.data === null)
        return <Missing failed={query.isError} />;
    return <Found chest={query.data} />;
}
