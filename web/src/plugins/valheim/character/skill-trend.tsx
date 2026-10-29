/**
 * ROK-1882 — a skill row's trend chip and detail line. ROK-2014 promoted the
 * chip to the shared `../trend/trend-chip.tsx`; these wrappers bind it to the
 * Skills format (0.1, "sessions") and the row's grid, and keep the names
 * `skills-section.tsx` and its tests use. docs/design-system.md §3.2,
 * "Valheim trend chip".
 */
import type { JSX } from 'react';
import { TrendChip, TrendDetail } from '../trend/trend-chip';
import { SKILL_TREND_FORMAT, type SkillTrendSummary } from './skill-trend.helpers';

/** The chip between the skill name and its level. */
export function SkillTrendChip({ trend, detailId, expanded, onToggle }: {
    trend: SkillTrendSummary;
    detailId: string;
    expanded: boolean;
    onToggle: () => void;
}): JSX.Element {
    return (
        <TrendChip
            trend={trend}
            format={SKILL_TREND_FORMAT}
            detailId={detailId}
            expanded={expanded}
            onToggle={onToggle}
            dotsTestId="skill-trend-dots"
            className="mr-3"
        />
    );
}

/** The per-day breakdown under the meter, newest first; `hidden` until the chip expands it. */
export function SkillTrendDetail({ trend, id, expanded }: {
    trend: SkillTrendSummary;
    id: string;
    expanded: boolean;
}): JSX.Element {
    return <TrendDetail trend={trend} format={SKILL_TREND_FORMAT} id={id} expanded={expanded} className="col-span-3" />;
}
