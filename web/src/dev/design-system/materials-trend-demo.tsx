/**
 * ROK-2014 — the Valheim trend chip on Materials item rows for
 * /dev/design-system (§3.2 "Valheim trend chip"). The real
 * `MaterialsTotalsTable`: a gain over 3 days, a net drop (danger), a one-day
 * gain and a row with no change (no chip). ≥1024px a "Trend" column; below,
 * the chip on its own line under the name. Tokens only.
 */
import { useState, type JSX } from 'react';
import type { ValheimMaterialsResponse } from '@raid-ledger/contract';
import { MaterialsTotalsTable } from '../../plugins/valheim/materials/materials-totals-table';
import { groupTotals, sortRows, type MaterialSort } from '../../plugins/valheim/materials/materials.helpers';
import { StateFrame } from './design-system-bits';

const ITEMS: ValheimMaterialsResponse['items'] = {
    Wood: { name: 'Wood', category: 'Material', icon: null },
    Stone: { name: 'Stone', category: 'Material', icon: null },
    BlackMetal: { name: 'Black metal', category: 'Material', icon: null },
    SwordIron: { name: 'Iron sword', category: 'Weapon', icon: null },
};
const TOTALS = [
    { prefab: 'Wood', quality: 1, total: 1240, chests: 3 },
    { prefab: 'Stone', quality: 1, total: 20, chests: 1 },
    { prefab: 'BlackMetal', quality: 1, total: 60, chests: 1 },
    { prefab: 'SwordIron', quality: 2, total: 1, chests: 1 },
];
const TREND = {
    days: [
        { date: '2026-10-17', gains: { Wood: 20, Stone: -10 } },
        { date: '2026-10-16', gains: { Wood: 15 } },
        { date: '2026-10-14', gains: { Wood: 1205, BlackMetal: 60 } },
    ],
};
const CTX = { serverId: 0, items: ITEMS, atlas: null, atlasUrl: null };

export function MaterialsTrendDemo(): JSX.Element {
    const [sort, setSort] = useState<MaterialSort>({ key: 'total', dir: 'desc' });
    const [selected, setSelected] = useState<string | null>(null);
    const rows = sortRows(groupTotals(TOTALS, ITEMS, null), sort);
    return (
        <StateFrame label="Materials item rows — gain / net drop / one day / no change" note="Whole items, &quot;over 3 days&quot;. Tap a chip for the per-day line; the row itself still selects the item.">
            <div className="w-full max-w-2xl">
                <MaterialsTotalsTable
                    rows={rows}
                    sort={sort}
                    onSort={setSort}
                    ctx={CTX}
                    caption="Demo chest totals"
                    selected={selected}
                    onSelect={(p) => setSelected(selected === p ? null : p)}
                    trend={TREND}
                />
            </div>
        </StateFrame>
    );
}
