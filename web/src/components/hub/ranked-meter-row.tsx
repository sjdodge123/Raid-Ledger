/**
 * ROK-2148 — the shared ranked leaderboard row, extracted from the ROK-1787
 * attendance leaderboard: a rank column, the name, a right-aligned figure and
 * a `GuildMeter` under the name. `badge` replaces the plain rank number (the
 * Forever contributions card passes its medal `RankBadge`); without it the
 * row draws the attendance board's muted number. Design-system §3.2.
 */
import type { JSX, ReactNode } from 'react';
import { GuildMeter } from './events/guild-meter';

export interface RankedMeterRowProps {
    /** 1-based position; drawn as a muted number unless `badge` is given. */
    rank: number;
    /** Optional leading badge that replaces the plain rank number. */
    badge?: ReactNode;
    /** The name cell (usually a `CharacterLink`, optionally followed by a chip). */
    name: ReactNode;
    /** The right-aligned figure ("80% · 4/5", "142 items"). */
    trailing: ReactNode;
    /** Meter fill, 0–100 (clamped by `GuildMeter`). */
    pct: number;
    meterLabel: string;
    testId: string;
    /** `li` inside an `<ol>` (default); `div` for a row outside the list (the viewer's own rank). */
    as?: 'li' | 'div';
}

export function RankedMeterRow({ rank, badge, name, trailing, pct, meterLabel, testId, as = 'li' }: RankedMeterRowProps): JSX.Element {
    const Tag = as;
    return (
        <Tag data-testid={testId} className="flex items-center gap-3">
            {badge ?? <span data-testid="ranked-row-rank" className="w-5 shrink-0 text-right text-xs font-semibold text-muted">{rank}</span>}
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm">{name}</span>
                    <span className="shrink-0 text-xs text-secondary">{trailing}</span>
                </div>
                <GuildMeter pct={pct} label={meterLabel} />
            </div>
        </Tag>
    );
}
