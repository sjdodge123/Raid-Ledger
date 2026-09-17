import type { JSX, ReactNode } from 'react';
import type { MemberCounts } from '../../../../pages/scheduling/availability-freshness';
import { computeHeatmapBg } from '../grid-cell.utils';
import { BUSY_EDGE_4 } from './group-marks.classes';
import { membersClause } from './week-label';

export interface GroupWeekLegendProps {
    /** Undefined (aggregates without freshness data) → no right-hand clause. */
    memberCounts?: MemberCounts;
}

const SWATCH = 'relative inline-block h-3.5 w-3.5 shrink-0 overflow-hidden rounded';

/** A full-strength fill — the same helper the cells paint with. */
const FULL_FILL = computeHeatmapBg({ available: 1, total: 1 });

function Key({ swatch, children }: { swatch: JSX.Element; children: ReactNode }): JSX.Element {
    return <span className="inline-flex items-center gap-1.5">{swatch}{children}</span>;
}

/**
 * The week view's key (ROK-1588): what each mark means, and — for the poll
 * aggregate — how many members the counts are drawn from and how current they are.
 */
export function GroupWeekLegend({ memberCounts }: GroupWeekLegendProps): JSX.Element {
    return (
        <div data-testid="group-week-legend" className="flex flex-wrap items-center gap-3.5 text-xs text-muted">
            <Key swatch={<i className={`${SWATCH} border border-edge`} style={{ background: FULL_FILL }} />}>
                More people free
            </Key>
            <Key swatch={<i className={`${SWATCH} border border-edge ${BUSY_EDGE_4}`} />}>Someone busy</Key>
            <Key swatch={<i className={`${SWATCH} border-2 border-dashed border-foreground/70`} />}>Your game time</Key>
            <Key swatch={<i className={`${SWATCH} border-2 border-dashed border-slot`} />}>Already suggested</Key>
            {memberCounts && (
                <span data-testid="group-week-members" className="ml-auto">{membersClause(memberCounts)}</span>
            )}
        </div>
    );
}
