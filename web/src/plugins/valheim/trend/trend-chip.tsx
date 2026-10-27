/**
 * ROK-2014 — the shared Valheim trend chip (promoted from ROK-1882's skill
 * chip): "+4.1 over 3 sessions" / "+45 over 3 days" with one dot per play day
 * (oldest → newest, sized by that day's gain; hollow = no change or a loss)
 * and the detail line it toggles. A net loss uses the danger tint. Hover shows
 * the detail via the native `title`; tap / click / Enter / Space expands it
 * inline. Tokens only. Consumers: Skills rows (`character/skill-trend.tsx`)
 * and Materials item rows (`materials/materials-trend-cell.tsx`).
 *
 * New pattern (ROK-1882): delta chip + day dots — docs/design-system.md §3.2,
 * "Valheim trend chip".
 */
import type { JSX } from 'react';
import { Button } from '../../../components/ui/button';
import {
    trendDetail,
    trendDots,
    trendLabel,
    trendSentence,
    trendTone,
    type TrendFormat,
    type TrendSummary,
} from './trend.helpers';

const TONE_CLS = {
    success: 'border-success/30 bg-success/10 text-success',
    danger: 'border-danger/30 bg-danger/10 text-danger',
} as const;

/**
 * Dot colour is per DAY, never the chip's net tone: a gain day is a filled
 * `bg-success` dot even inside a net-loss (danger) chip, and a loss or
 * no-change day is hollow — "net down, but one good day" at a glance.
 */
function DayDots({ trend, testId }: { trend: TrendSummary; testId: string }): JSX.Element {
    return (
        <span aria-hidden="true" data-testid={testId} className="inline-flex items-center gap-0.5">
            {trendDots(trend).map((d) => (
                <span
                    key={d.date}
                    data-filled={d.filled}
                    style={{ width: d.px, height: d.px }}
                    className={`inline-block shrink-0 rounded-full ${d.filled ? 'bg-success' : 'border border-edge-strong'}`}
                />
            ))}
        </span>
    );
}

export interface TrendChipProps {
    trend: TrendSummary;
    format: TrendFormat;
    detailId: string;
    expanded: boolean;
    onToggle: () => void;
    /** `data-testid` of the dots wrapper. */
    dotsTestId?: string;
    /** Extra classes (spacing) from the host row. */
    className?: string;
}

/** The chip — a bare `Button` (inline control in a dense list) that keeps the success focus ring. */
export function TrendChip({
    trend,
    format,
    detailId,
    expanded,
    onToggle,
    dotsTestId = 'trend-dots',
    className = '',
}: TrendChipProps): JSX.Element {
    const tone = trendTone(trend.total);
    return (
        <Button
            variant="bare"
            aria-label={trendSentence(trend, format)}
            aria-expanded={expanded}
            aria-controls={detailId}
            title={trendDetail(trend, format)}
            onClick={onToggle}
            data-tone={tone}
            className={`${className} gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${TONE_CLS[tone]}`}
        >
            <span>{trendLabel(trend, format)}</span>
            <DayDots trend={trend} testId={dotsTestId} />
        </Button>
    );
}

/** The per-day breakdown, newest first; `hidden` until the chip expands it. */
export function TrendDetail({ trend, format, id, expanded, className = '' }: {
    trend: TrendSummary;
    format: TrendFormat;
    id: string;
    expanded: boolean;
    className?: string;
}): JSX.Element {
    return (
        <p id={id} hidden={!expanded} className={`${className} m-0 text-xs tabular-nums text-muted`}>
            {trendDetail(trend, format)}
        </p>
    );
}
