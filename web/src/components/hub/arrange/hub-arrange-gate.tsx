/**
 * ROK-1918 L5 — the editor's Overview controls: the Arrange button above the
 * grid, and arrange mode once pressed. `HubOverview` mounts this (lazily,
 * through `overview-editor-tools`) only for `viewer.canEdit` — leaders,
 * officers and staff (Q8) — so the button, its icon and arrange mode never
 * ship in the `hub-page` chunk. The grid is NOT rendered here: it stays in
 * `HubOverview` at one tree position (hidden while arranging), so neither the
 * chunk loading nor leaving arrange mode remounts its widgets.
 */
import type { JSX } from 'react';
import { Squares2X2Icon } from '@heroicons/react/24/outline';
import type { HubWidgetPrefs } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import type { HubLayoutEntry, ResolvedHubLayout } from '../layout/resolve-hub-layout';
import HubArrangeMode from './hub-arrange-mode';

export interface HubArrangeGateProps {
    guildId: number;
    kind: string;
    layout: ResolvedHubLayout<HubLayoutEntry>;
    prefs: HubWidgetPrefs | null;
    /**
     * `raids` has no data — still loading OR failed: the core schedule/events/
     * attendance/role-composition widgets join the catalog only with it, and a
     * draft built without them would drop their saved slots (and un-hide them)
     * on Save — so Arrange waits.
     */
    raidsUnavailable: boolean;
    arranging: boolean;
    onArrange: (on: boolean) => void;
}

export function HubArrangeGate({ guildId, kind, layout, prefs, raidsUnavailable, arranging, onArrange }: HubArrangeGateProps): JSX.Element {
    if (arranging) {
        return <HubArrangeMode guildId={guildId} kind={kind} arranged={layout.arranged} available={layout.available} prefs={prefs} onExit={() => onArrange(false)} />;
    }
    return (
        <div className="mb-3 flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => onArrange(true)} disabled={raidsUnavailable} data-testid="hub-arrange">
                <Squares2X2Icon className="h-4 w-4" aria-hidden="true" />Arrange
            </Button>
        </div>
    );
}
