/**
 * ROK-2352 §3.6 — the WoW LFG page's hub picker, registered by the WoW plugin
 * as the `lfg-grouping` `HeaderControls` (inert while the plugin is off).
 * Options = the viewer's WoW hubs, "<hub> · <variant>"; picking one opens that
 * variant's LFG page with `?hub`. With a hub: a "from <hub>" chip + a link back
 * to the hub. Viewers with no WoW hubs see nothing.
 */
import type { ChangeEvent, JSX } from 'react';
import { Link } from 'react-router-dom';
import { Select } from '../../../components/ui/select';
import { StatusChip } from '../../../components/ui/status-chip';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { guildHref } from '../../../components/layout/hub-nav/my-hubs-queries';
import type { LfgGroupingContext } from '../../lfg-grouping';
import { ALL_HUBS_VALUE, useLfgHubPicker } from './use-lfg-hub-picker';
import type { WowHubOption } from './lfg-hub-picker-state';

const BACK_LINK_CLASS = `inline-flex min-h-[44px] items-center rounded text-sm text-muted underline underline-offset-2 hover:text-foreground ${FOCUS_RING}`;

/** The hub picker for a WoW LFG page header; props are the page's grouping context. */
export function LfgHubPicker(props: LfgGroupingContext): JSX.Element | null {
    const state = useLfgHubPicker(props);
    if (!state.ready || state.options.length === 0) return null;
    const value = state.selected ? String(state.selected.hubId) : state.mismatched ? '' : ALL_HUBS_VALUE;
    return (
        <div className="flex flex-wrap items-center gap-2" data-testid="lfg-hub-picker">
            <Select aria-label="Hub" fieldSize="sm" wrapperClassName="w-full sm:w-auto" value={value}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => state.pick(e.target.value)}
                {...(state.mismatched ? { placeholder: 'Pick a hub' } : {})}>
                <option value={ALL_HUBS_VALUE}>All of {state.variantLabel}</option>
                {state.options.map((o) => (
                    <option key={o.hubId} value={String(o.hubId)}>{o.label}</option>
                ))}
            </Select>
            {state.selected && <FromHub hub={state.selected} />}
        </div>
    );
}

/** "from <hub>" + the back link to `/hubs/:id`. */
function FromHub({ hub }: { hub: WowHubOption }): JSX.Element {
    return (
        <>
            <StatusChip tone="neutral">from {hub.hubName}</StatusChip>
            <Link to={guildHref(hub.hubId)} className={BACK_LINK_CLASS}>Back to {hub.hubName}</Link>
        </>
    );
}
