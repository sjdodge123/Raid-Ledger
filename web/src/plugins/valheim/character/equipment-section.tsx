/** ROK-1836 — the nine named equip slots; an empty slot is a dashed tile + its label. */
import type { JSX } from 'react';
import type { ValheimEquipSlot, ValheimItemStack } from '@raid-ledger/contract';
import type { ValheimCharacterSectionProps } from './character-section-slots';
import { EmptyItemTile, ItemTile } from './item-tile';
import { MissingCatalogueBanner } from './missing-catalogue-banner';
import { useItemIcons, type ItemIconContext } from './use-item-icons';

const EQUIP_SLOTS: readonly (readonly [ValheimEquipSlot, string])[] = [
    ['head', 'Head'],
    ['shoulder', 'Shoulder'],
    ['chest', 'Chest'],
    ['legs', 'Legs'],
    ['rightHand', 'Right hand'],
    ['leftHand', 'Left hand'],
    ['utility', 'Utility'],
    ['trinket', 'Trinket'],
    ['ammo', 'Ammo'],
];

function EquipSlot({
    slot,
    label,
    item,
    ctx,
}: {
    slot: ValheimEquipSlot;
    label: string;
    item: ValheimItemStack | undefined;
    ctx: ItemIconContext;
}): JSX.Element {
    return (
        <li
            data-slot={slot}
            className="flex min-w-0 flex-col items-center gap-1"
        >
            {item === undefined ? (
                <EmptyItemTile />
            ) : (
                <ItemTile item={item} ctx={ctx} equipped />
            )}
            <span className="text-center text-xs text-dim">
                {label}
                {item === undefined ? ' (empty)' : ''}
            </span>
        </li>
    );
}

export function EquipmentSection({
    character,
}: ValheimCharacterSectionProps): JSX.Element {
    const ctx = useItemIcons(character);
    const bySlot = new Map(
        character.equipment.map((e) => [e.slot, e.item] as const),
    );
    return (
        <>
            <MissingCatalogueBanner character={character} />
            <ul
                className="grid list-none grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-x-2 gap-y-3 p-0"
                aria-label="Equipment slots"
            >
                {EQUIP_SLOTS.map(([slot, label]) => (
                    <EquipSlot
                        key={slot}
                        slot={slot}
                        label={label}
                        item={bySlot.get(slot)}
                        ctx={ctx}
                    />
                ))}
            </ul>
        </>
    );
}
