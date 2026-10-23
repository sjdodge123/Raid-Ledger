/**
 * ROK-1899 — the crafting window's station switcher (spec §3.1.1): a wrapping
 * segmented `RadioGroup` "Crafting station" of every station with ≥1 row in
 * the current mode (built or not — the hub has no world data yet, operator
 * ruling), then "By hand". Chips are content-width and wrap (the approved
 * mockup), each with the catalogue station icon — initials only when the
 * station has none. The star badge shows the chosen station's
 * catalogue max level ("★ max 5"); while searching nothing is chosen
 * (`value` null) and the badge hides.
 */
import type { JSX } from 'react';
import { RadioGroup, type RadioOption } from '../../../components/ui/radio-group';
import { ItemIcon } from '../character/item-icon';
import { resolveItem } from '../character/item-icon.helpers';
import { BY_HAND_KEY, type StationGroup } from './crafting.helpers';
import type { PlannerNames } from './use-planner-names';

export interface StationSwitcherProps {
    groups: readonly StationGroup[];
    /** The chosen station key; null = none (searching). */
    value: string | null;
    onChange: (key: string) => void;
    /** Station icons; omit to show names only. */
    names?: PlannerNames;
    className?: string;
}

/** A small station icon (decorative: the segment's name is the label). */
function StationIcon({ prefab, names }: { prefab: string; names: PlannerNames }): JSX.Element {
    const ctx = names.ctxFor(prefab, 'piece');
    const resolved = { ...resolveItem(prefab, ctx.items, ctx.atlas), label: names.stationName(prefab) };
    if (resolved.kind === 'unknown') return <></>;
    return (
        <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden [&>*]:scale-[0.6]">
            <ItemIcon resolved={resolved} prefab={prefab} ctx={ctx} />
        </span>
    );
}

function optionOf(group: StationGroup, names: PlannerNames | undefined): RadioOption<string> {
    const icon = names !== undefined && group.key !== BY_HAND_KEY ? <StationIcon prefab={group.key} names={names} /> : null;
    return {
        value: group.key,
        label: (
            <span className="inline-flex items-center gap-1.5">
                {icon}
                {group.label}
            </span>
        ),
    };
}

/** "★ max N": the highest level the station reaches (its built level is unknown). */
export function StationStarBadge({ maxLevel }: { maxLevel: number }): JSX.Element {
    return (
        <span
            title="Highest level this station reaches"
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-edge-strong bg-surface px-2.5 py-1 text-xs text-secondary"
        >
            <span aria-hidden="true">★</span>
            <span className="sr-only">Highest station level:</span>
            <b className="text-sm text-success">max {maxLevel}</b>
        </span>
    );
}

/** The station switcher plus the chosen station's star badge. */
export function StationSwitcher({ groups, value, onChange, names, className }: StationSwitcherProps): JSX.Element {
    const chosen = value === null ? undefined : groups.find((g) => g.key === value);
    return (
        <div className={`flex items-start gap-2 ${className ?? ''}`}>
            <RadioGroup
                label="Crafting station"
                hideLabel
                appearance="segmented"
                className="min-w-0 flex-1 [&_label]:flex-none"
                options={groups.map((g) => optionOf(g, names))}
                // '' matches no option: the track shows no selection while searching.
                value={value ?? ''}
                onChange={onChange}
            />
            {chosen?.maxLevel != null && <StationStarBadge maxLevel={chosen.maxLevel} />}
        </div>
    );
}
