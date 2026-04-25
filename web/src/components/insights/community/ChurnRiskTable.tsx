import { useState } from 'react';
import type { CommunityChurnResponseDto } from '@raid-ledger/contract';

interface Props {
    thresholdPct: number;
    atRisk: CommunityChurnResponseDto['atRisk'];
    notEnoughHistory: boolean;
}

type SortKey = 'username' | 'baselineHours' | 'recentHours' | 'dropPct';

export function ChurnRiskTable({ thresholdPct, atRisk, notEnoughHistory }: Props) {
    const [sortKey, setSortKey] = useState<SortKey>('dropPct');
    const [descending, setDescending] = useState(true);

    if (notEnoughHistory) {
        return (
            <p className="text-sm text-muted">
                Not enough history yet to compute churn risk. Check back after the community has
                accumulated more sessions.
            </p>
        );
    }
    if (atRisk.length === 0) {
        return (
            <p className="text-sm text-muted">
                No churn risks detected — your community is healthy.
            </p>
        );
    }
    const sorted = sortAtRisk(atRisk, sortKey, descending);

    return (
        <div className="overflow-x-auto" data-testid="churn-risk-table">
            <p className="text-xs text-muted mb-2">
                Threshold: {thresholdPct}% drop vs. 12-week baseline.
            </p>
            <table className="min-w-full text-sm">
                <caption className="sr-only">Players at risk of churn</caption>
                <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted">
                        <HeaderCell label="Player" k="username" sortKey={sortKey} desc={descending} onSort={toggle} />
                        <HeaderCell label="Baseline (hrs)" k="baselineHours" sortKey={sortKey} desc={descending} onSort={toggle} />
                        <HeaderCell label="Recent (hrs)" k="recentHours" sortKey={sortKey} desc={descending} onSort={toggle} />
                        <HeaderCell label="Drop" k="dropPct" sortKey={sortKey} desc={descending} onSort={toggle} />
                    </tr>
                </thead>
                <tbody>
                    {sorted.map((row) => (
                        <tr key={row.userId} className="border-t border-edge/30">
                            <td className="py-2 pr-4 text-foreground">{row.username}</td>
                            <td className="py-2 pr-4 text-muted">{row.baselineHours.toFixed(1)}</td>
                            <td className="py-2 pr-4 text-muted">{row.recentHours.toFixed(1)}</td>
                            <td className="py-2 text-red-400">{Math.round(row.dropPct)}%</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    function toggle(k: SortKey) {
        if (k === sortKey) setDescending((d) => !d);
        else {
            setSortKey(k);
            setDescending(true);
        }
    }
}

function HeaderCell({ label, k, sortKey, desc, onSort }: {
    label: string; k: SortKey; sortKey: SortKey; desc: boolean; onSort: (k: SortKey) => void;
}) {
    const active = k === sortKey;
    return (
        <th scope="col" className="py-2 pr-4">
            <button type="button" onClick={() => onSort(k)} className="font-semibold hover:text-foreground">
                {label}{active ? (desc ? ' ↓' : ' ↑') : ''}
            </button>
        </th>
    );
}

function sortAtRisk(
    rows: CommunityChurnResponseDto['atRisk'],
    sortKey: SortKey,
    descending: boolean,
) {
    const out = rows.slice();
    out.sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (typeof av === 'number' && typeof bv === 'number') return descending ? bv - av : av - bv;
        return descending
            ? String(bv).localeCompare(String(av))
            : String(av).localeCompare(String(bv));
    });
    return out;
}
