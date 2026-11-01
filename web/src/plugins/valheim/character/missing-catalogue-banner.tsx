/**
 * ROK-1836 D7 — §4.7 neutral banner when the server has sent no item
 * catalogue at all. ROK-2058 — a quieter status line when the names come
 * from another game version's catalogue (a patch the server hasn't re-sent
 * the item list for yet); nothing when this version's catalogue is in.
 */
import type { JSX } from 'react';
import type { ValheimCharacterDetail } from '@raid-ledger/contract';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { catalogueState } from './item-icon.helpers';

export function MissingCatalogueBanner({
    character,
}: {
    character: ValheimCharacterDetail;
}): JSX.Element | null {
    const state = catalogueState(character);
    if (state === 'fallback')
        return <FallbackCatalogueNote character={character} />;
    if (state !== 'missing') return null;
    return (
        <div
            role="status"
            data-testid="valheim-missing-catalogue"
            className="mb-4 flex gap-2 rounded-lg border border-edge bg-panel p-3 text-sm text-muted"
        >
            <InformationCircleIcon
                className="h-5 w-5 shrink-0"
                aria-hidden="true"
            />
            <span>
                Item names aren&apos;t available for game version{' '}
                {character.gameVersion} yet, so items show their game ids. They
                update after the server sends its item list.
            </span>
        </div>
    );
}

/** The status-line idiom (no panel): names are present, just possibly stale. */
function FallbackCatalogueNote({
    character,
}: {
    character: ValheimCharacterDetail;
}): JSX.Element {
    return (
        <p
            role="status"
            data-testid="valheim-catalogue-fallback"
            className="mb-3 flex items-start gap-1.5 text-xs text-muted"
        >
            <InformationCircleIcon
                className="mt-px h-4 w-4 shrink-0"
                aria-hidden="true"
            />
            <span>
                Item names are from game version{' '}
                {character.catalogueGameVersion} — the server hasn&apos;t sent
                the {character.gameVersion} item list yet. New items show their
                game ids.
            </span>
        </p>
    );
}
