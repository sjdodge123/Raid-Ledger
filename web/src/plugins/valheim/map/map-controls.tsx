/**
 * ROK-1837 D9 — the map's overlay controls: zoom in / out / fit (wired to the
 * viewport's commands) and the two layer switches. ≥1024px the switches sit
 * inline under the vertical zoom group; below it a "Layers" button opens a BottomSheet
 * holding them (§4.4, §4.18). Every target is 44px (§4.20) — `size="md"`, since
 * `sm` drops to 36px (`lg:min-h-9`) at ≥1024px.
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

const ZOOM_BUTTON_CLASS =
    'h-11 w-11 text-foreground hover:bg-overlay disabled:text-dim';

/** The prototype's `.ctlgroup`: a vertical stack of 44px zoom buttons. */
function ZoomButtons({ commands }: { commands: MapViewportCommands | null }) {
    const items = [
        { label: 'Zoom in', Icon: PlusIcon, run: commands?.zoomIn },
        { label: 'Zoom out', Icon: MinusIcon, run: commands?.zoomOut },
        { label: 'Fit map', Icon: ArrowsPointingInIcon, run: commands?.fit },
    ];
    return (
        <div
            role="group"
            aria-label="Map zoom"
            className="flex flex-col divide-y divide-edge overflow-hidden rounded-lg border border-edge bg-surface shadow-md"
        >
            {items.map(({ label, Icon, run }) => (
                <Button
                    key={label}
                    variant="bare"
                    className={ZOOM_BUTTON_CLASS}
                    aria-label={label}
                    disabled={!run}
                    onClick={run}
                >
                    <Icon aria-hidden="true" className="h-5 w-5" />
                </Button>
            ))}
        </div>
    );
}

/** Below 1024px: a Layers button opening a BottomSheet with the switches. */
function LayersSheet({ layers }: { layers: MapLayerState }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button variant="secondary" size="md" onClick={() => setOpen(true)}>
                Layers
            </Button>
            <BottomSheet
                isOpen={open}
                onClose={() => setOpen(false)}
                title="Layers"
            >
                <LayerSwitches {...layers} />
            </BottomSheet>
        </>
    );
}

/** ≥1024px: the switches inline; below it a Layers button + BottomSheet. */
function LayersPanel({
    wide,
    layers,
}: {
    wide: boolean;
    layers: MapLayerState;
}) {
    if (!wide) return <LayersSheet layers={layers} />;
    return (
        <div className="w-64 rounded-lg border border-edge bg-surface px-3 py-1">
            <LayerSwitches {...layers} />
        </div>
    );
}

export function MapControls({ commands, ...layers }: MapControlsProps) {
    const wide = useMediaQuery('(min-width: 1024px)');
    return (
        <div className="flex flex-col items-end gap-2">
            <ZoomButtons commands={commands} />
            <LayersPanel wide={wide} layers={layers} />
        </div>
    );
}
