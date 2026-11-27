/**
 * ROK-2352 — the LFG page heading for a keyed group. Kept out of
 * `lfg-grouping-slots.tsx` so that file exports components only (fast refresh).
 */
import type { LfgGroupDetailDto } from '@raid-ledger/contract';
import type {
    LfgGrouping,
    LfgGroupingContext,
} from '../../plugins/lfg-grouping';

/**
 * The page heading for a keyed group — its name through the plugin's labeller
 * ("Deadmines"). Undefined on the whole-game page or with no active grouping,
 * so the heading stays the game name there.
 */
export function groupPageTitle(
    grouping: LfgGrouping | null,
    context: LfgGroupingContext,
    group: Pick<LfgGroupDetailDto, 'groupLabel'>,
): string | undefined {
    if (!grouping || context.groupKey === '') return undefined;
    const ref = {
        groupKey: context.groupKey,
        groupLabel: group.groupLabel ?? null,
    };
    return grouping.groupLabel?.(ref) ?? ref.groupLabel ?? undefined;
}
