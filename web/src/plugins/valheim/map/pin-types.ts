/**
 * ROK-1837 D8 — pin type → heroicon + tone. Tone classes are `--color-*`
 * token utilities only (fifteen themes remap them; never a raw colour). The
 * type set is open (`Minimap.PinType.ToString()`, modded types too), so any
 * unknown type falls back to the generic map pin.
 */
import type { ComponentType, SVGProps } from 'react';
import { FireIcon, HomeIcon, MapPinIcon, MegaphoneIcon, XCircleIcon } from '@heroicons/react/24/solid';

export type PinIconName = 'home' | 'x-circle' | 'fire' | 'megaphone' | 'map-pin';

export interface PinStyle {
    Icon: ComponentType<SVGProps<SVGSVGElement>>;
    iconName: PinIconName;
    /** Text-colour token utility for the icon. */
    toneClass: string;
    /** Human name for the type — the accessible name when the label is empty. */
    typeLabel: string;
}

/** The disc every pin icon sits on. */
export const PIN_DISC_CLASS = 'bg-surface/80';
/** Applied to a pin the player crossed out (`checked`). */
export const PIN_CHECKED_CLASS = 'line-through opacity-60';

const NEUTRAL_TONE = 'text-foreground';

const GENERIC: PinStyle = { Icon: MapPinIcon, iconName: 'map-pin', toneClass: NEUTRAL_TONE, typeLabel: 'Pin' };

const KNOWN: Readonly<Record<string, PinStyle>> = {
    Bed: { Icon: HomeIcon, iconName: 'home', toneClass: 'text-success', typeLabel: 'Bed' },
    Death: { Icon: XCircleIcon, iconName: 'x-circle', toneClass: 'text-danger', typeLabel: 'Death' },
    Boss: { Icon: FireIcon, iconName: 'fire', toneClass: 'text-warning', typeLabel: 'Boss' },
    Shout: { Icon: MegaphoneIcon, iconName: 'megaphone', toneClass: NEUTRAL_TONE, typeLabel: 'Shout' },
};

/** Style for a pin type; `Icon0`…`Icon4` and anything unknown get the generic pin. */
export function pinStyleFor(type: string): PinStyle {
    return Object.hasOwn(KNOWN, type) ? (KNOWN[type] ?? GENERIC) : GENERIC;
}

/** The pin's visible / accessible text: its label, else the type name. */
export function pinDisplayLabel(label: string, type: string): string {
    const trimmed = label.trim();
    return trimmed.length > 0 ? trimmed : pinStyleFor(type).typeLabel;
}
