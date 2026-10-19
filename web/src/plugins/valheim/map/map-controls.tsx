/**
 * ROK-1837 D9 — the map's overlay controls: zoom in / out / fit (wired to the
 * viewport's commands) and the two layer switches. ≥1024px the switches sit
 * inline under the buttons; below it a "Layers" button opens a BottomSheet
 * holding them (§4.4, §4.18). Every target is 44px (§4.20).
 */
import { useId, useState } from 'react';
import {
    ArrowsPointingInIcon,
    MinusIcon,
    PlusIcon,
} from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';
import { Switch } from '../../../components/ui/switch';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { useMediaQuery } from '../../../hooks/use-media-query';
import type { MapViewportCommands } from './map-viewport';

export interface MapLayerState {
    showShared: boolean;
    onShowShared: (on: boolean) => void;
    /** False when the world has no cartography-table layer: the switch is disabled with a hint. */
    sharedAvailable: boolean;
    pinLabels: boolean;
    onPinLabels: (on: boolean) => void;
}

export interface MapControlsProps extends MapLayerState {
    /** Null until the viewport has mounted. */
    commands: MapViewportCommands | null;
}

const SHARED_LABEL = 'Show cartography table';
const SHARED_HINT = 'No cartography table data for this world yet.';

function SwitchRow(props: { text: string; children: React.ReactNode }) {
    return (
        <div className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-sm text-foreground">{props.text}</span>
            {props.children}
        </div>
    );
}

/** The two layer switches — shared by the inline panel and the phone sheet. */
export function LayerSwitches(props: MapLayerState) {
    const hintId = useId();
    const { sharedAvailable } = props;
    return (
        <div className="grid gap-1">
            <SwitchRow text={SHARED_LABEL}>
                <Switch
                    label={SHARED_LABEL}
                    checked={props.showShared && sharedAvailable}
                    onChange={props.onShowShared}
                    disabled={!sharedAvailable}
                    {...(sharedAvailable ? {} : { 'aria-describedby': hintId })}
                />
            </SwitchRow>
            {!sharedAvailable && (
                <p id={hintId} className="text-xs text-dim">
                    {SHARED_HINT}
                </p>
            )}
            <SwitchRow text="Pin labels">
                <Switch
                    label="Pin labels"
                    checked={props.pinLabels}
                    onChange={props.onPinLabels}
                />
            </SwitchRow>
        </div>
    );
}

function ZoomButtons({ commands }: { commands: MapViewportCommands | null }) {
    const items = [
        { label: 'Zoom in', Icon: PlusIcon, run: commands?.zoomIn },
        { label: 'Zoom out', Icon: MinusIcon, run: commands?.zoomOut },
        { label: 'Fit map', Icon: ArrowsPointingInIcon, run: commands?.fit },
    ];
    return (
        <div className="flex gap-1 rounded-lg border border-edge bg-surface p-1">
            {items.map(({ label, Icon, run }) => (
                <Button key={label} variant="ghost" size="sm" iconOnly aria-label={label}
                    className="min-h-11" disabled={!run} onClick={run}>
                    <Icon aria-hidden="true" className="h-5 w-5" />
                </Button>
            ))}
        </div>
    );
}

export function MapControls({ commands, ...layers }: MapControlsProps) {
    const wide = useMediaQuery('(min-width: 1024px)');
    const [sheetOpen, setSheetOpen] = useState(false);
    return (
        <div className="flex flex-col items-end gap-2">
            <ZoomButtons commands={commands} />
            {wide ? (
                <div className="w-64 rounded-lg border border-edge bg-surface px-3 py-1">
                    <LayerSwitches {...layers} />
                </div>
            ) : (
                <Button variant="secondary" size="sm" className="min-h-11"
                    onClick={() => setSheetOpen(true)}>
                    Layers
                </Button>
            )}
            {!wide && (
                <BottomSheet isOpen={sheetOpen} onClose={() => setSheetOpen(false)} title="Layers">
                    <LayerSwitches {...layers} />
                </BottomSheet>
            )}
        </div>
    );
}
