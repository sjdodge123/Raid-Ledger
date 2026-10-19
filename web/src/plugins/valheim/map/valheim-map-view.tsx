/**
 * ROK-1837 — THE SEAM: one character's map. Fetches the meta, the base-map
 * image and the fog (personal always; shared only while its switch is on),
 * composes MapViewport → base <img> + FogCanvas + PinLayer, and owns the layer
 * switches. Exported so ROK-1836's character page can embed it (spec Q3).
 */
import { useState } from 'react';
import type { ValheimMapMeta } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { StatusChip } from '../../../components/ui/status-chip';
import {
    MapBytesError,
    useFogLayer,
    useMapBaseImage,
    useValheimMapMeta,
} from '../hooks/use-valheim-map';
import { MapViewport, type MapViewportCommands } from './map-viewport';
import { FogCanvas } from './fog-canvas';
import { PinLayer } from './pin-layer';
import { MapControls } from './map-controls';

export interface ValheimMapViewProps {
    characterId: number;
    mapId: number;
    className?: string;
}

const FRAME =
    'relative h-[calc(100dvh-12rem)] w-full overflow-hidden lg:h-[min(70dvh,720px)]';

function MapError({ text, onRetry }: { text: string; onRetry: () => void }) {
    return (
        <div
            role="alert"
            className="flex flex-col items-center gap-3 py-12 text-center"
        >
            <p className="text-sm text-muted">{text}</p>
            <Button
                variant="secondary"
                size="sm"
                className="min-h-11"
                onClick={onRetry}
            >
                Retry
            </Button>
        </div>
    );
}

interface ReadyProps {
    characterId: number;
    mapId: number;
    meta: ValheimMapMeta;
}

/** Fog + base-map fetches for a loaded meta; `no_shared_layer` turns the shared switch off. */
function useMapLayers(
    { characterId, mapId, meta }: ReadyProps,
    showShared: boolean,
) {
    const fog = {
        characterId,
        mapId,
        textureSize: meta.grid.textureSize,
        capturedAt: meta.capturedAt,
    };
    const base = useMapBaseImage(characterId, mapId, meta.baseMap);
    const personal = useFogLayer({ ...fog, layer: 'personal' });
    const shared = useFogLayer({
        ...fog,
        layer: 'shared',
        enabled: showShared && meta.hasSharedExplored,
    });
    const noShared =
        shared.error instanceof MapBytesError &&
        shared.error.code === 'no_shared_layer';
    return {
        base,
        personal,
        shared,
        sharedAvailable: meta.hasSharedExplored && !noShared,
    };
}

function BaseMapStatus({ ready, failed }: { ready: boolean; failed: boolean }) {
    if (ready && !failed) return null;
    return (
        <div className="pointer-events-none absolute left-2 top-2 z-10">
            <StatusChip tone={failed ? 'danger' : 'warning'} title="Base map">
                {failed
                    ? 'Base map failed to load'
                    : 'Base map not uploaded yet'}
            </StatusChip>
        </div>
    );
}

function MapReady(props: ReadyProps & { className?: string | undefined }) {
    const { meta } = props;
    const [showShared, setShowShared] = useState(false);
    const [pinLabels, setPinLabels] = useState(false);
    const [commands, setCommands] = useState<MapViewportCommands | null>(null);
    const { base, personal, shared, sharedAvailable } = useMapLayers(
        props,
        showShared,
    );
    const sharedOn = showShared && sharedAvailable;
    const size = meta.grid.textureSize;
    if (personal.error) {
        return (
            <MapError
                text="The explored area could not be loaded."
                onRetry={() => void personal.refetch()}
            />
        );
    }
    return (
        <div
            className={props.className ? `${FRAME} ${props.className}` : FRAME}
        >
            <MapViewport
                contentSize={size}
                label="Valheim map"
                onCommands={setCommands}
                className="absolute inset-0"
            >
                {(vp) => (
                    <div
                        className="absolute left-0 top-0"
                        style={{ width: size, height: size }}
                        data-zoom={vp.scale.toFixed(2)}
                    >
                        {base.url && (
                            <img
                                src={base.url}
                                alt=""
                                draggable={false}
                                className="absolute left-0 top-0"
                                style={{ width: size, height: size }}
                            />
                        )}
                        {personal.data && (
                            <FogCanvas
                                size={size}
                                personal={personal.data}
                                shared={sharedOn ? (shared.data ?? null) : null}
                            />
                        )}
                        <PinLayer
                            grid={meta.grid}
                            pins={meta.pins}
                            scale={vp.scale}
                            showShared={sharedOn}
                            labels={pinLabels}
                        />
                    </div>
                )}
            </MapViewport>
            <BaseMapStatus
                ready={meta.baseMap?.ready === true}
                failed={base.error !== null}
            />
            <div className="absolute right-2 top-2 z-10">
                <MapControls
                    commands={commands}
                    showShared={sharedOn}
                    onShowShared={setShowShared}
                    sharedAvailable={sharedAvailable}
                    pinLabels={pinLabels}
                    onPinLabels={setPinLabels}
                />
            </div>
        </div>
    );
}

/** One character's map with its controls; loading / error states included. */
export function ValheimMapView({
    characterId,
    mapId,
    className,
}: ValheimMapViewProps) {
    const meta = useValheimMapMeta(characterId, mapId);
    if (meta.isPending) {
        return (
            <div
                aria-busy="true"
                aria-label="Loading map"
                className={`${FRAME} rounded-lg border border-edge bg-panel`}
            />
        );
    }
    if (meta.error)
        return (
            <MapError
                text="The map could not be loaded."
                onRetry={() => void meta.refetch()}
            />
        );
    return (
        <MapReady
            key={`${characterId}:${mapId}`}
            characterId={characterId}
            mapId={mapId}
            meta={meta.data}
            className={className}
        />
    );
}
