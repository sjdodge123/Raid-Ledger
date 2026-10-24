/**
 * ROK-1943 D7/D8 — the Map pin filter's type chips. Raw pin types mean nothing
 * to players (`Icon3` → "Mine", ROK-1880), so the filter works on groups; the
 * open type set (modded, numeric) lands in "Other". Q2 = (a): all 11 chips,
 * always, in this fixed order.
 *
 * ROK-1946 seam: a new layer (scanned portals) adds one entry with its own
 * `source` after Portal; nothing else here changes.
 */
import type { ComponentType, SVGProps } from 'react';
import { MapPinIcon } from '@heroicons/react/24/solid';
import { pinStyleFor } from './pin-types';

export const PIN_TYPE_GROUP_IDS = [
    'death', 'bed', 'portal', 'boss', 'home', 'fire',
    'workshop', 'mine', 'shout', 'hildir', 'other',
] as const;
export type PinTypeGroupId = (typeof PIN_TYPE_GROUP_IDS)[number];

/** Where a chip's pins come from — only the map's own pins today (D8). */
export type PinSource = 'map';

export interface PinTypeGroup {
    id: PinTypeGroupId;
    label: string;
    Icon: ComponentType<SVGProps<SVGSVGElement>>;
    /** Text-colour token utility, same as the pin's own icon. */
    toneClass: string;
    /** The raw `ValheimMapPin.type`s in this group; empty for the open "Other". */
    rawTypes: readonly string[];
    match: (type: string) => boolean;
    source: PinSource;
}

const RAW_TYPES: Readonly<Record<Exclude<PinTypeGroupId, 'other'>, readonly string[]>> = {
    death: ['Death'], bed: ['Bed'], portal: ['Icon4'], boss: ['Boss'], home: ['Icon1'],
    fire: ['Icon0'], workshop: ['Icon2'], mine: ['Icon3'], shout: ['Shout'],
    hildir: ['Hildir1', 'Hildir2', 'Hildir3'],
};

const KNOWN_TYPES = new Set(Object.values(RAW_TYPES).flat());

function knownGroup(id: Exclude<PinTypeGroupId, 'other'>): PinTypeGroup {
    const rawTypes = RAW_TYPES[id];
    const style = pinStyleFor(rawTypes[0] ?? '');
    return {
        id, label: style.typeLabel, Icon: style.Icon, toneClass: style.toneClass,
        rawTypes, match: (type) => rawTypes.includes(type), source: 'map',
    };
}

const OTHER: PinTypeGroup = {
    id: 'other', label: 'Other', Icon: MapPinIcon, toneClass: 'text-foreground',
    rawTypes: [], match: (type) => !KNOWN_TYPES.has(type), source: 'map',
};

/** The chips, in the ruled order (Q2). */
export const PIN_TYPE_GROUPS: readonly PinTypeGroup[] = PIN_TYPE_GROUP_IDS.map((id) =>
    id === 'other' ? OTHER : knownGroup(id),
);

/** True for one of the 11 chip ids (URL tokens are untrusted). */
export function isPinTypeGroupId(value: string): value is PinTypeGroupId {
    return (PIN_TYPE_GROUP_IDS as readonly string[]).includes(value);
}

/** The chip a raw pin type belongs to; anything unknown is "other". */
export function groupOf(type: string): PinTypeGroupId {
    return PIN_TYPE_GROUPS.find((g) => g.id !== 'other' && g.match(type))?.id ?? 'other';
}

/**
 * The raw types to send as the server layer's `types` (D4), in registry order.
 * `undefined` = send nothing (all types): no selection, or "Other" is picked —
 * an open set the server cannot name, so the web filters it instead.
 */
export function rawTypesFor(groupIds: Iterable<PinTypeGroupId> | null): string[] | undefined {
    if (groupIds === null) return undefined;
    const picked = new Set(groupIds);
    if (picked.has('other')) return undefined;
    return PIN_TYPE_GROUPS.filter((g) => picked.has(g.id)).flatMap((g) => [...g.rawTypes]);
}
