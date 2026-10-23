/**
 * ROK-1918 L5 — the editor's Overview: the Arrange button above the grid, and
 * arrange mode in its place once pressed. `HubOverview` mounts this (lazily,
 * through `overview-editor-tools`) only for `viewer.canEdit` — leaders,
 * officers and staff (Q8) — with the grid as the Suspense fallback, so the
 * button, its icon and this state never ship in the `hub-page` chunk.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { Squares2X2Icon } from '@heroicons/react/24/outline';
import type { HubWidgetPrefs } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import type { HubLayoutEntry, ResolvedHubLayout } from '../layout/resolve-hub-layout';
import HubArrangeMode from './hub-arrange-mode';

export interface HubArrangeGateProps {
    grid: ReactNode;
    guildId: number;
    layout: ResolvedHubLayout<HubLayoutEntry>;
    prefs: HubWidgetPrefs | null;
    /**
     * `raids` still loading: the core schedule/events/attendance widgets join
     * the catalog only once it settles, and a draft built before then would
     * drop their saved slots on Save — so Arrange waits.
     */
    raidsPending: boolean;
}

export function HubArrangeGate({ grid, guildId, layout, prefs, raidsPending }: HubArrangeGateProps): JSX.Element {
    const [arranging, setArranging] = useState(false);
    if (arranging) {
        return <HubArrangeMode guildId={guildId} arranged={layout.arranged} available={layout.available} prefs={prefs} onExit={() => setArranging(false)} />;
    }
    return (
        <>
            <div className="mb-3 flex justify-end">
                <Button variant="secondary" size="sm" onClick={() => setArranging(true)} disabled={raidsPending} data-testid="hub-arrange">
                    <Squares2X2Icon className="h-4 w-4" aria-hidden="true" />Arrange
                </Button>
            </div>
            {grid}
        </>
    );
}
