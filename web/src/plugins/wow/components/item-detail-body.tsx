/**
 * ROK-2176: the shared item body — the character-page item modal and both
 * columns of the boss-loot compare popup render it. Takes an equipped item or
 * a boss-loot drop; with `deltas` (loot − equipped, keyed by `StatDelta.key`)
 * every stat, armor and DPS line shows its change on the right.
 */
import { useMemo } from 'react';
import type { StatDelta } from '../lib/item-stat-diff';
import { toDetailItem, type DetailSource } from '../lib/item-detail-view';
import { ItemCombatInfo, ItemEnhancements, ItemFooter, ItemHeader, ItemStatLines } from './item-detail-sections';

export interface ItemDetailBodyProps {
    item: DetailSource;
    gameVariant: string | null;
    deltas?: StatDelta[] | null | undefined;
    /** Overrides a loot item's expansion-derived Wowhead link (ROK-2186). */
    lootUrl?: string | undefined;
}

export function ItemDetailBody({ item, gameVariant, deltas, lootUrl }: ItemDetailBodyProps) {
    const detail = useMemo(() => toDetailItem(item, gameVariant, lootUrl), [item, gameVariant, lootUrl]);
    const byKey = useMemo(() => (deltas ? new Map(deltas.map((d) => [d.key, d])) : undefined), [deltas]);
    return (
        <div className="space-y-3" data-testid="item-detail-body">
            <ItemHeader item={detail} />
            <ItemCombatInfo item={detail} deltas={byKey} />
            <ItemStatLines item={detail} deltas={byKey} />
            <ItemEnhancements item={detail} />
            <ItemFooter item={detail} />
        </div>
    );
}
