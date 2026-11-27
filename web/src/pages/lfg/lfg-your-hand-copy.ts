/**
 * ROK-2352 §4.1 — copy, links and labels for the group view's "Your hand"
 * card (`lfg-your-hand-card.tsx`), kept apart so the card file exports only
 * components (react-refresh) and the tests pin the same strings.
 */
import type { LfgGroupRefDto } from '@raid-ledger/contract';
import type { LfgGrouping } from '../../plugins/lfg-grouping';

export const YOUR_HAND_COPY = {
    heading: 'Your hand',
    notInGroup: 'Not in this group.',
    alsoIn: 'Also in:',
    /** Core fallback when the grouping has no label for the whole-game group. */
    anyGroup: 'Any group',
    inThisGroup: 'Your hand in this group',
    separateHands: (n: number): string => `${n} separate hands — each expires and is withdrawn on its own.`,
} as const;

/** `/lfg/<slug>` for `''`, `/lfg/<slug>/<encoded key>` otherwise, keeping `?hub`. */
export function lfgGroupHref(gameSlug: string, groupKey: string, hubId: number | null): string {
    const base = groupKey === '' ? `/lfg/${gameSlug}` : `/lfg/${gameSlug}/${encodeURIComponent(groupKey)}`;
    return hubId == null ? base : `${base}?hub=${hubId}`;
}

/** The plugin's label for a group, else the adapter label, else the core fallback. */
export function yourHandLabel(grouping: LfgGrouping | null, ref: LfgGroupRefDto): string {
    if (grouping?.groupLabel) return grouping.groupLabel(ref);
    return ref.groupKey === '' ? YOUR_HAND_COPY.anyGroup : (ref.groupLabel ?? ref.groupKey);
}
