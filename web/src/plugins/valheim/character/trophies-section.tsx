/** ROK-1836 — collected trophies as item tiles (count first); none → a §4.5 sentence. */
import type { JSX } from 'react';
import type { ValheimCharacterSectionProps } from './character-section-slots';
import { ItemTile } from './item-tile';
import { useItemIcons } from './use-item-icons';

const trophyStack = (prefab: string) => ({ prefab, stack: 1, quality: 1, variant: 0, durability: null, maxDurability: null });

export function TrophiesSection({ character }: ValheimCharacterSectionProps): JSX.Element {
    const ctx = useItemIcons(character);
    const count = character.trophies.length;
    if (count === 0) return <p className="text-sm text-muted">No trophies collected yet.</p>;
    return (
        <>
            <p className="mb-3 text-sm text-muted">{count} {count === 1 ? 'trophy' : 'trophies'} collected</p>
            <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Trophies">
                {character.trophies.map((prefab) => <li key={prefab}><ItemTile item={trophyStack(prefab)} ctx={ctx} /></li>)}
            </ul>
        </>
    );
}
