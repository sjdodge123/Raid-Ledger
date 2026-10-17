/**
 * Group availability marks for /dev/design-system (ROK-1586 §5.1, §4.16 + §4.19).
 *
 * Mounts the REAL `GroupWeekLegend` (whose swatches are painted by the same
 * helpers the cells use) and paints sample week cells with the SHIPPED class
 * constants from `group-marks.classes.ts` — `weekCellClass` composes them
 * exactly as `GroupWeekCell` does. Nothing here is a hand-drawn approximation.
 */
import type { JSX } from 'react';
import { GroupWeekLegend } from '../../components/features/game-time/week/GroupWeekLegend';
import {
    weekCellClass,
    type WeekCellFlags,
} from '../../components/features/game-time/week/group-marks.classes';
import { Section, StateFrame, StateGrid } from './design-system-bits';

interface CellExample {
    id: string;
    label: string;
    flags: WeekCellFlags;
    copy: string;
}

const NONE: WeekCellFlags = { busy: false, slot: false, picked: false, disabled: false };

const CELL_EXAMPLES: CellExample[] = [
    { id: 'plain', label: 'Plain · WEEK_CELL_EDGES', flags: NONE, copy: '3 free' },
    { id: 'busy', label: 'Busy · BUSY_EDGE_4', flags: { ...NONE, busy: true }, copy: '3 free' },
    { id: 'slot', label: 'Suggested · SLOT_MARK', flags: { ...NONE, slot: true }, copy: '4 free' },
    { id: 'picked', label: 'Your pick · PICKED_MARK', flags: { ...NONE, picked: true }, copy: '5 free' },
    { id: 'disabled', label: 'Not pickable · DISABLED_MARK', flags: { ...NONE, disabled: true }, copy: '2 free' },
];

/** A sample week cell. The busy clause is appended in `text-busy`, never a badge. */
function SampleCell({ example }: { example: CellExample }): JSX.Element {
    return (
        <StateFrame label={example.label}>
            <div data-testid={`ds-cell-${example.id}`} className={`w-28 bg-surface px-2 ${weekCellClass(example.flags)}`}>
                <span className="text-[11px] text-secondary leading-10">
                    {example.copy}
                    {example.flags.busy && <span className="text-busy"> · 2 busy</span>}
                </span>
            </div>
        </StateFrame>
    );
}

function LegendExamples(): JSX.Element {
    return (
        <div className="flex flex-col gap-3 mb-6">
            <StateFrame label="Legend — no freshness data" note="Four keys, fixed order, verbatim copy.">
                <GroupWeekLegend />
            </StateFrame>
            <StateFrame label="Legend — with members clause">
                <div className="w-full"><GroupWeekLegend memberCounts={{ total: 6, fresh: 4, stale: 1, unknown: 1 }} /></div>
            </StateFrame>
        </div>
    );
}

/** Legend + the marks a group week cell can wear. */
export function GroupMarksSection(): JSX.Element {
    return (
        <Section
            id="group-marks"
            title="Pattern — group marks and legend"
            blurb="Busy is a left edge, not a fill (4px desktop, 5px phone), and a text-busy count clause after the free count. Suggested is a dashed slot outline; the viewer's pick is a success ring."
        >
            <LegendExamples />
            <StateGrid>
                {CELL_EXAMPLES.map((ex) => <SampleCell key={ex.id} example={ex} />)}
            </StateGrid>
        </Section>
    );
}
