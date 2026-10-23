/**
 * ROK-1882 — a skill row's trend: the "+4.1 over 3 sessions" chip with one dot
 * per play day (oldest → newest, sized by that day's gain; hollow = no change
 * or a loss) and the detail line it toggles. A net loss (death penalty) uses
 * the danger tint. Hover shows the detail via the native `title`; tap / click
 * / Enter / Space expands it inline. Tokens only.
 *
 * New pattern: skill delta chip + session dots — no trend primitive in the
 * inventory (docs/design-system.md §3.2, "Character section slots").
 */
import type { JSX } from 'react';
import { Button } from '../../../components/ui/button';
import {
    trendDetail,
    trendDots,
    trendLabel,
    trendSentence,
    trendTone,
    type SkillTrendSummary,
} from './skill-trend.helpers';

const TONE_CLS = {
    success: 'border-success/30 bg-success/10 text-success',
    danger: 'border-danger/30 bg-danger/10 text-danger',
} as const;

/**
 * Dot colour is per DAY, never the chip's net tone (spec §5 + Q3): a gain day
 * is a filled `bg-success` dot even inside a net-loss (danger) chip, and a
 * loss or no-change day is hollow — so a chip reads "net down, but one good
 * session" at a glance.
 */
function SessionDots({ trend }: { trend: SkillTrendSummary }): JSX.Element {
    return (
        <span aria-hidden="true" data-testid="skill-trend-dots" className="inline-flex items-center gap-0.5">
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

/** The chip — a bare `Button` (inline control in a dense list) that keeps the success focus ring. */
export function SkillTrendChip({ trend, detailId, expanded, onToggle }: {
    trend: SkillTrendSummary;
    detailId: string;
    expanded: boolean;
    onToggle: () => void;
}): JSX.Element {
    return (
        <Button
            variant="bare"
            aria-label={trendSentence(trend)}
            aria-expanded={expanded}
            aria-controls={detailId}
            title={trendDetail(trend)}
            onClick={onToggle}
            data-tone={trendTone(trend.total)}
            className={`mr-3 gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${TONE_CLS[trendTone(trend.total)]}`}
        >
            <span>{trendLabel(trend)}</span>
            <SessionDots trend={trend} />
        </Button>
    );
}

/** The per-day breakdown under the meter, newest first; `hidden` until the chip expands it. */
export function SkillTrendDetail({ trend, id, expanded }: {
    trend: SkillTrendSummary;
    id: string;
    expanded: boolean;
}): JSX.Element {
    return (
        <p id={id} hidden={!expanded} className="col-span-3 m-0 text-xs tabular-nums text-muted">
            {trendDetail(trend)}
        </p>
    );
}
