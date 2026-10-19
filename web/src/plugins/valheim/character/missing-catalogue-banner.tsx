/** ROK-1836 D7 — §4.7 neutral banner when the server has sent no item catalogue for this game version. */
import type { JSX } from 'react';
import type { ValheimCharacterDetail } from '@raid-ledger/contract';
import { InformationCircleIcon } from '@heroicons/react/24/outline';

/** True when the sheet references items but no catalogue entry came with it. */
export function isCatalogueMissing(character: ValheimCharacterDetail): boolean {
    const hasItems = character.equipment.length > 0 || character.inventory.items.length > 0 || character.trophies.length > 0;
    return hasItems && Object.keys(character.items ?? {}).length === 0;
}

export function MissingCatalogueBanner({ character }: { character: ValheimCharacterDetail }): JSX.Element | null {
    if (!isCatalogueMissing(character)) return null;
    return (
        <div role="status" data-testid="valheim-missing-catalogue"
            className="mb-4 flex gap-2 rounded-lg border border-edge bg-panel p-3 text-sm text-muted">
            <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span>
                Item names aren&apos;t available for game version {character.gameVersion} yet, so items show their game ids.
                They update after the server sends its item list.
            </span>
        </div>
    );
}
