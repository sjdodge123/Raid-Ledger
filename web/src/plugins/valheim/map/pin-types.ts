/**
 * ROK-1837 D8 — pin type → heroicon + tone. Tone classes are `--color-*`
 * token utilities only (fifteen themes remap them; never a raw colour). The
 * type set is open (`Minimap.PinType.ToString()`, modded types too), so any
 * unknown type (incl. a modded bare integer like `"17"`) falls back to the
 * generic map pin. ROK-1880: the five player map markers `Icon0`…`Icon4`
 * (Valheim's marker-picker order: fire, home, hammer, mine, portal) and the
 * Hildir quest chests `Hildir1`…`Hildir3` get their own icon + name.
 */
import type { ComponentType, SVGProps } from 'react';
import type { ValheimMapPin } from '@raid-ledger/contract';
import {
    ArchiveBoxIcon,
    ArrowsRightLeftIcon,
    CubeIcon,
    FireIcon,
    HomeIcon,
    MapPinIcon,
    MegaphoneIcon,
    SparklesIcon,
    WrenchIcon,
    XCircleIcon,
} from '@heroicons/react/24/solid';
import { cleanPinLabel } from './pin-label';

export type PinIconName =
    | 'home'
    | 'x-circle'
    | 'fire'
    | 'megaphone'
    | 'map-pin'
    | 'wrench'
    | 'cube'
    | 'sparkles'
    | 'archive-box'
    | 'arrows-right-left';

export interface PinStyle {
    Icon: ComponentType<SVGProps<SVGSVGElement>>;
    iconName: PinIconName;
    /** Text-colour token utility for the icon. */
    toneClass: string;
    /** Human name for the type — the accessible name when the label is empty. */
    typeLabel: string;
    /** ROK-1946 D9: a 2px `border-success` ring — server data, not a hand-placed pin. */
    ring?: boolean;
}

/** The disc every pin icon sits on. */
export const PIN_DISC_CLASS = 'bg-surface/80';
/** Applied to a pin the player crossed out (`checked`). */
export const PIN_CHECKED_CLASS = 'line-through opacity-60';

const NEUTRAL_TONE = 'text-foreground';

const GENERIC: PinStyle = {
    Icon: MapPinIcon,
    iconName: 'map-pin',
    toneClass: NEUTRAL_TONE,
    typeLabel: 'Map pin',
};

/** A player map marker / quest pin: neutral tone, its own icon and name. */
function marker(
    Icon: PinStyle['Icon'],
    iconName: PinIconName,
    typeLabel: string,
): PinStyle {
    return { Icon, iconName, toneClass: NEUTRAL_TONE, typeLabel };
}

const HILDIR_CHEST = marker(ArchiveBoxIcon, 'archive-box', "Hildir's chest");

const KNOWN: Readonly<Record<string, PinStyle>> = {
    Bed: {
        Icon: HomeIcon,
        iconName: 'home',
        toneClass: 'text-success',
        typeLabel: 'Bed',
    },
    Death: {
        Icon: XCircleIcon,
        iconName: 'x-circle',
        toneClass: 'text-danger',
        typeLabel: 'Death',
    },
    Boss: {
        Icon: FireIcon,
        iconName: 'fire',
        toneClass: 'text-warning',
        typeLabel: 'Boss',
    },
    Shout: {
        Icon: MegaphoneIcon,
        iconName: 'megaphone',
        toneClass: NEUTRAL_TONE,
        typeLabel: 'Shout',
    },
    Icon0: marker(FireIcon, 'fire', 'Fire'),
    Icon1: marker(HomeIcon, 'home', 'Home'),
    Icon2: marker(WrenchIcon, 'wrench', 'Workshop'),
    Icon3: marker(CubeIcon, 'cube', 'Mine'),
    Icon4: marker(SparklesIcon, 'sparkles', 'Portal'),
    Hildir1: HILDIR_CHEST,
    Hildir2: HILDIR_CHEST,
    Hildir3: HILDIR_CHEST,
    // ROK-1946 D14: the reserved portal-scan type (`portal-pins.ts`); the colon
    // keeps it apart from every game or modded type.
    'rl:scanned-portal': {
        Icon: ArrowsRightLeftIcon,
        iconName: 'arrows-right-left',
        toneClass: 'text-success',
        typeLabel: 'Scanned portal',
        ring: true,
    },
};

/** Style for a pin type; anything unknown (modded, numeric) gets the generic pin. */
export function pinStyleFor(type: string): PinStyle {
    return Object.hasOwn(KNOWN, type) ? (KNOWN[type] ?? GENERIC) : GENERIC;
}

/** The pin's visible / accessible text: its cleaned label, else the type name. */
export function pinDisplayLabel(label: string, type: string): string {
    return cleanPinLabel(label, pinStyleFor(type).typeLabel);
}

/**
 * The pin button's accessible name (approved prototype):
 * `<label> (<type name>[, cartography table][, checked])` — the human type
 * name, never the raw enum (`Icon3` → "Mine", ROK-1880).
 */
export function pinAccessibleName(
    pin: Pick<ValheimMapPin, 'label' | 'type' | 'shared' | 'checked'>,
): string {
    const parts = [pinStyleFor(pin.type).typeLabel];
    if (pin.shared) parts.push('cartography table');
    if (pin.checked) parts.push('checked');
    return `${pinDisplayLabel(pin.label, pin.type)} (${parts.join(', ')})`;
}
