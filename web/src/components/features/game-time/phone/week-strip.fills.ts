/**
 * The week strip's band fills, as Tailwind classes and as raw CSS values.
 *
 * A separate module from `WeekStrip.tsx` so the maps can be exported without
 * tripping `react-refresh/only-export-components` (an error in this workspace)
 * — the same split as `duration-options.ts` and `start-lineup-config.ts`.
 * ROK-1586 moved them off raw hues onto the semantic tokens.
 */
import type { BandKind } from './phone-week.utils';
import type { GroupBandKind } from './group-day.utils';

/** What a bar can represent: the viewer's own week, or the group's (ROK-1580). */
export type StripKind = BandKind | GroupBandKind;

/** Fill for a band's bar — solid when it is all claimed, half-tone when some is. */
export const BAND_FILL: Record<BandKind, string> = {
    full: 'bg-success',
    partial: 'bg-success/50',
    none: 'bg-edge',
};

/**
 * Fill for a GROUP band (ROK-1580) — the same success / warning / danger ramp
 * the heatmap cells use, so the strip summarises what is under it rather than
 * introducing a second colour language.
 */
export const GROUP_FILL: Record<GroupBandKind, string> = {
    all: 'bg-success',
    most: 'bg-warning/70',
    few: 'bg-danger/50',
    none: 'bg-edge',
};

/**
 * Heat colours for the two-tone gradient (ROK-1584).
 *
 * The same ramp `GROUP_FILL` paints as classes, as CSS values — a gradient
 * cannot be expressed in two Tailwind classes. They are the THEME variables
 * behind those classes (`--color-success` etc., which the schemes remap),
 * never literal rgba (review MAJOR-2); the alpha comes from `color-mix`, the
 * same way Tailwind's `/70` opacity modifier is built — including the
 * interpolation space, which MUST stay `in oklab`: Tailwind compiles
 * `bg-warning/70` to `color-mix(in oklab, …)`, and `in srgb` at the same
 * percentage lands a visibly different shade, so a split band's half would
 * read off its solid twin.
 *
 * ROK-1586: this map and `GROUP_FILL` are a MATCHED PAIR — every key must name
 * the same token with the same alpha in both, or a solid bar silently stops
 * matching its two-tone twin. `WeekStrip.test.tsx` asserts that key by key.
 */
export const GROUP_GRADIENT: Record<GroupBandKind, string> = {
    all: 'var(--color-success)',
    most: 'color-mix(in oklab, var(--color-warning) 70%, transparent)',
    few: 'color-mix(in oklab, var(--color-danger) 50%, transparent)',
    none: 'var(--color-edge)',
};

/** The class for a bar, whichever of the two kind spaces it came from. */
export function bandFill(kind: StripKind): string {
    return kind in GROUP_FILL ? GROUP_FILL[kind as GroupBandKind] : BAND_FILL[kind as BandKind];
}
