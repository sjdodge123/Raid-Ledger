/**
 * ROK-1943 D7/D8 — the Map pin filter's type chips. Raw pin types mean nothing
 * to players (`Icon3` → "Mine", ROK-1880), so the filter works on groups; the
 * open type set (modded, numeric) lands in "Other". Q2 = (a): all 11 chips,
 * always, in this fixed order.
 *
 * ROK-1946 D11/D13: "Scanned portals" (12th chip, right after Portal) is its
 * own source — it claims no raw map pin type and sends nothing to the server
 * pins read.
 */
import type { ComponentType, SVGProps } from 'react';
import { ArrowsRightLeftIcon, MapPinIcon } from '@heroicons/react/24/solid';
import { pinStyleFor } from './pin-types';

export const PIN_TYPE_GROUP_IDS = [
    'death', 'bed', 'portal', 'scanned-portal', 'boss', 'home', 'fire',
    'workshop', 'mine', 'shout', 'hildir', 'other',
] as const;
export type PinTypeGroupId = (typeof PIN_TYPE_GROUP_IDS)[number];

/** Where a chip's pins come from: the maps' own pins, or the server's portal scan (ROK-1946). */
export type PinSource = 'map' | 'portal-scan';

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

type MapGroupId = Exclude<PinTypeGroupId, 'other' | 'scanned-portal'>;

const RAW_TYPES: Readonly<Record<MapGroupId, readonly string[]>> = {
    death: ['Death'], bed: ['Bed'], portal: ['Icon4'], boss: ['Boss'], home: ['Icon1'],
    fire: ['Icon0'], workshop: ['Icon2'], mine: ['Icon3'], shout: ['Shout'],
    hildir: ['Hildir1', 'Hildir2', 'Hildir3'],
};

const KNOWN_TYPES = new Set(Object.values(RAW_TYPES).flat());

function knownGroup(id: MapGroupId): PinTypeGroup {
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

/** ROK-1946 D9/D11: the portal-scan layer — never claims a map pin. */
const SCANNED_PORTALS: PinTypeGroup = {
    id: 'scanned-portal', label: 'Scanned portals', Icon: ArrowsRightLeftIcon, toneClass: 'text-success',
    rawTypes: [], match: () => false, source: 'portal-scan',
};

function groupFor(id: PinTypeGroupId): PinTypeGroup {
    if (id === 'other') return OTHER;
    return id === 'scanned-portal' ? SCANNED_PORTALS : knownGroup(id);
}

/** The chips, in the ruled order (Q2). */
export const PIN_TYPE_GROUPS: readonly PinTypeGroup[] = PIN_TYPE_GROUP_IDS.map(groupFor);

const MAP_GROUPS = PIN_TYPE_GROUPS.filter((g) => g.source === 'map');

/** True for one of the 12 chip ids (URL tokens are untrusted). */
export function isPinTypeGroupId(value: string): value is PinTypeGroupId {
    return (PIN_TYPE_GROUP_IDS as readonly string[]).includes(value);
}

/** The chip a raw pin type belongs to; anything unknown is "other". */
export function groupOf(type: string): PinTypeGroupId {
    return MAP_GROUPS.find((g) => g.id !== 'other' && g.match(type))?.id ?? 'other';
}

/**
 * The raw types to send as the server layer's `types` (D4), in registry order.
 * `undefined` = send nothing (all types): no selection, or "Other" is picked —
 * an open set the server cannot name, so the web filters it instead. Only map
 * chips count (D13): `[]` = no map chip picked — the caller sends no request.
 */
export function rawTypesFor(groupIds: Iterable<PinTypeGroupId> | null): string[] | undefined {
    if (groupIds === null) return undefined;
    const picked = new Set(groupIds);
    if (picked.has('other')) return undefined;
    return MAP_GROUPS.filter((g) => picked.has(g.id)).flatMap((g) => [...g.rawTypes]);
}
