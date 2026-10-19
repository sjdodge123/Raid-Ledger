/**
 * Map viewport (pannable/zoomable layered image) for /dev/design-system
 * (ROK-1837, design-system §4.25). Mounts the REAL Valheim `MapViewport`,
 * `FogCanvas`, `PinLayer` and `MapControls` over static sample data — drag,
 * pinch, wheel or use the keyboard; the controls switch to the Layers sheet
 * below 1024px.
 */
import { useState, type JSX } from 'react';
import {
    MapViewport,
    type MapViewportCommands,
} from '../../plugins/valheim/map/map-viewport';
import { FogCanvas } from '../../plugins/valheim/map/fog-canvas';
import { PinLayer } from '../../plugins/valheim/map/pin-layer';
import { MapControls } from '../../plugins/valheim/map/map-controls';
import { Section, StateFrame } from './design-system-bits';
import {
    DEMO_BASE_MAP_URL,
    DEMO_GRID,
    DEMO_PERSONAL_FOG,
    DEMO_PINS,
    DEMO_SHARED_FOG,
} from './map-viewport-demo-data';

const SIZE = DEMO_GRID.textureSize;

const BOX = { width: SIZE, height: SIZE };

interface DemoState {
    shared: boolean;
    labels: boolean;
}

function DemoLayers({ scale, shared, labels }: DemoState & { scale: number }) {
    const fog = shared ? DEMO_SHARED_FOG : null;
    return (
        <div className="absolute left-0 top-0" style={BOX} data-zoom={scale}>
            <img
                src={DEMO_BASE_MAP_URL}
                alt=""
                className="absolute"
                style={BOX}
            />
            <FogCanvas size={SIZE} personal={DEMO_PERSONAL_FOG} shared={fog} />
            <PinLayer
                grid={DEMO_GRID}
                pins={DEMO_PINS}
                scale={scale}
                showShared={shared}
                labels={labels}
            />
        </div>
    );
}

function MapDemo(): JSX.Element {
    const [commands, setCommands] = useState<MapViewportCommands | null>(null);
    const [shared, setShared] = useState(false);
    const [labels, setLabels] = useState(false);
    return (
        <div className="relative h-80 w-full max-w-xl overflow-hidden">
            <MapViewport
                contentSize={SIZE}
                label="Sample map"
                onCommands={setCommands}
                className="absolute inset-0"
            >
                {(vp) => (
                    <DemoLayers scale={vp.scale} {...{ shared, labels }} />
                )}
            </MapViewport>
            <div className="absolute right-2 top-2 z-10">
                <MapControls
                    {...{ commands, sharedAvailable: true }}
                    showShared={shared}
                    onShowShared={setShared}
                    pinLabels={labels}
                    onPinLabels={setLabels}
                />
            </div>
        </div>
    );
}

export function MapViewportSection(): JSX.Element {
    return (
        <Section
            id="map-viewport"
            title="Map viewport"
            blurb="§4.25 — a pannable/zoomable layered image: base map, fog canvas (backdrop token) and counter-scaled pins share one transform. touch-action is scoped to the map; every control is 44px."
        >
            <StateFrame
                label="Valheim map — static 256² sample, 1 personal + 1 cartography-table pin"
                note="Toggle 'Show cartography table' to widen the explored area and reveal the second pin."
            >
                <MapDemo />
            </StateFrame>
        </Section>
    );
}
