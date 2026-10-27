/**
 * ROK-2014 — a Materials item row's trend: the shared Valheim trend chip
 * ("+45 over 3 days" + one dot per play day) and the per-day line it toggles,
 * with its own expanded state. Rendered only for a row that has a trend, so a
 * row without history spaces exactly as before (AC3).
 */
import { useId, useState, type JSX } from 'react';
import { TrendChip, TrendDetail } from '../trend/trend-chip';
import type { TrendSummary } from '../trend/trend.helpers';
import { MATERIALS_TREND_FORMAT } from './materials-trend.helpers';

export function MaterialsTrendCell({
    trend,
    className = '',
}: {
    trend: TrendSummary;
    className?: string;
}): JSX.Element {
    const detailId = useId();
    const [expanded, setExpanded] = useState(false);
    return (
        <div className={className} data-testid="materials-trend">
            <TrendChip
                trend={trend}
                format={MATERIALS_TREND_FORMAT}
                detailId={detailId}
                expanded={expanded}
                onToggle={() => setExpanded((e) => !e)}
                dotsTestId="materials-trend-dots"
            />
            <TrendDetail
                trend={trend}
                format={MATERIALS_TREND_FORMAT}
                id={detailId}
                expanded={expanded}
                className="mt-1"
            />
        </div>
    );
}
