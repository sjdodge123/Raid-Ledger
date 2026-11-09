/**
 * /dev/design-system — the shared `RankedMeterRow` (§3.2, ROK-2148): the
 * attendance board's plain rank number, and the contributions card's medal
 * `RankBadge` in the badge slot (#1 crown, #2 silver, #3 bronze, #4+ number).
 * Static sample data, tokens only, so both flip with the colour family.
 */
import type { JSX } from 'react';
import { CharacterLink } from '../../components/hub/character-link';
import { RankedMeterRow } from '../../components/hub/ranked-meter-row';
import { RankBadge } from '../../plugins/wow/hub-widgets/contributions-rank';
import { StateFrame } from './design-system-bits';

const ROWS = [
    { name: 'Thessaly', count: 142 },
    { name: 'Morwenna', count: 118 },
    { name: 'Brannoc', count: 64 },
    { name: 'Ysolde', count: 21 },
];

const TOP = ROWS[0]?.count ?? 0;

function DemoRow({ name, count, rank, medal }: { name: string; count: number; rank: number; medal: boolean }): JSX.Element {
    const pct = TOP === 0 ? 0 : (count / TOP) * 100;
    return (
        <RankedMeterRow testId="ds-ranked-row" rank={rank} pct={pct} meterLabel={`${name}: ${count}`}
            {...(medal ? { badge: <RankBadge rank={rank} /> } : {})}
            name={<CharacterLink name={name} characterId={null} />}
            trailing={<span className="tabular-nums"><span className="font-semibold text-foreground">{count}</span> items</span>} />
    );
}

export function RankedRowDemo(): JSX.Element {
    return (
        <div data-testid="ds-ranked-rows" className="grid gap-3 md:grid-cols-2">
            <StateFrame label="Plain rank (attendance leaderboard)" note="No badge: a muted right-aligned number.">
                <ol data-testid="ds-ranked-plain" className="flex w-full max-w-sm flex-col gap-2.5">
                    {ROWS.map((r, i) => <DemoRow key={r.name} {...r} rank={i + 1} medal={false} />)}
                </ol>
            </StateFrame>
            <StateFrame label="Medal badge (contributions top givers)" note="RankBadge in the badge slot: crown, silver, bronze, then a plain number.">
                <ol data-testid="ds-ranked-medal" className="flex w-full max-w-sm flex-col gap-2.5">
                    {ROWS.map((r, i) => <DemoRow key={r.name} {...r} rank={i + 1} medal />)}
                </ol>
            </StateFrame>
        </div>
    );
}
