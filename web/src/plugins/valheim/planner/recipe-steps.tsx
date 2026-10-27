/**
 * ROK-1861 — the per-step breakdown under a recipe row that spans several
 * quality steps (spec §5): a "N steps" disclosure, then one line per step
 * (label, an "Upgrade station · lvl N" chip at an upgrade station, the cost
 * line). Steps are not plan nodes (D1) — no have/need bar. An upgrade
 * station with a build cost gets a nested "Build <Station> (optional)"
 * disclosure that is never added to the shopping list. Open by default when
 * any step is at an upgrade station (Q4).
 */
import { useState, type JSX } from 'react';
import type { ValheimPlanStep, ValheimStationBuilds } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { StatusChip } from '../../../components/ui/status-chip';
import { costLine, stepLabel } from './planner.helpers';
import type { PlannerNames } from './use-planner-names';

type BuildLines = ValheimStationBuilds[string];

interface RecipeStepsProps {
    steps: readonly ValheimPlanStep[];
    builds: ValheimStationBuilds | undefined;
    names: PlannerNames;
}

const itemName = (names: PlannerNames) => (prefab: string): string => names.nameOf(prefab, 'item');

function StationBuild({ station, lines, names }: { station: string; lines: BuildLines; names: PlannerNames }): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <div>
            <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                Build {names.stationName(station)} (optional)
            </Button>
            {open && (
                <div className="ml-3 space-y-0.5 text-xs text-muted" data-testid="valheim-planner-station-build">
                    <p>{costLine(lines, itemName(names))}</p>
                    <p>Not added to your list.</p>
                </div>
            )}
        </div>
    );
}

function StepItem({ step, build, names }: { step: ValheimPlanStep; build: BuildLines | null; names: PlannerNames }): JSX.Element {
    const { label, chip } = stepLabel(step, names.stationName);
    const at = step.station === null ? '' : names.stationName(step.station);
    return (
        <li className="space-y-0.5 py-1" data-testid="valheim-planner-step" data-quality={step.quality}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm text-foreground">{label}</span>
                {chip !== null && (
                    <StatusChip tone="neutral" title={`Upgraded at ${at}, level ${step.stationLevel}`}>
                        {chip}
                    </StatusChip>
                )}
            </div>
            {step.resources.length > 0 && <p className="text-xs text-muted">{costLine(step.resources, itemName(names))}</p>}
            {build !== null && step.station !== null && <StationBuild station={step.station} lines={build} names={names} />}
        </li>
    );
}

/** The build cost to offer on each step: only the first upgrade-station step per station, and only when the response has one. */
function buildsPerStep(steps: readonly ValheimPlanStep[], builds: ValheimStationBuilds | undefined): (BuildLines | null)[] {
    const offered = new Set<string>();
    return steps.map((s) => {
        if (!s.upgraderStation || s.station === null || offered.has(s.station)) return null;
        const lines = builds !== undefined && Object.hasOwn(builds, s.station) ? builds[s.station] : undefined;
        if (lines === undefined || lines.length === 0) return null;
        offered.add(s.station);
        return lines;
    });
}

export function RecipeSteps({ steps, builds, names }: RecipeStepsProps): JSX.Element {
    const [open, setOpen] = useState(() => steps.some((s) => s.upgraderStation));
    const perStep = buildsPerStep(steps, builds);
    return (
        <div data-testid="valheim-planner-steps">
            <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                <span aria-hidden="true" className={`mr-1 inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
                {steps.length} steps
            </Button>
            {open && (
                <ul aria-label="Quality steps" className="ml-5 border-l border-edge pl-2">
                    {steps.map((s, i) => (
                        <StepItem key={s.quality} step={s} build={perStep[i] ?? null} names={names} />
                    ))}
                </ul>
            )}
        </div>
    );
}
