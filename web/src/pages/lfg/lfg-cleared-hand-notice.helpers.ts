/**
 * ROK-2352 §3.2 — copy and labels for the show-once "your hand was withdrawn"
 * notice. A notice's label is null for the whole-game (`''`) group or when the
 * server had none; the web then uses the label the group view shows for that
 * key (the groups list, then the grouping's own labeller, e.g. WoW's "Any
 * dungeon" for `''`), and a neutral "another group" when neither knows it.
 */
import type { LfgGroupListItemDto } from '@raid-ledger/contract';
import type { LfgGrouping } from '../../plugins/lfg-grouping';

export const CLEARED_HAND_COPY = {
    fallbackLabel: 'another group',
    dismiss: 'Dismiss',
} as const;

/** "Your hand for <from> was withdrawn because you're in <to> now." */
export function clearedHandNoticeText(from: string, to: string): string {
    return `Your hand for ${from} was withdrawn because you're in ${to} now.`;
}

/** The display name of `groupKey`: the notice's label, else what the group view would show. */
export function noticeGroupLabel(
    groupKey: string,
    label: string | null,
    grouping: LfgGrouping | null,
    groups: readonly LfgGroupListItemDto[],
): string {
    const listed = groups.find((g) => (g.groupKey ?? '') === groupKey)?.groupLabel ?? null;
    const known = label ?? listed;
    if (known === null && groupKey !== '') return CLEARED_HAND_COPY.fallbackLabel;
    return grouping?.groupLabel?.({ groupKey, groupLabel: known }) ?? known ?? CLEARED_HAND_COPY.fallbackLabel;
}
