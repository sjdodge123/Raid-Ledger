/**
 * ROK-1837 — THE SEAM: one character's map. Fetches the meta, the base-map
 * image and the fog (personal always; shared only while its switch is on),
 * composes MapViewport → base <img> + FogCanvas + PinLayer, and owns the layer
 * switches. Exported so ROK-1836's character page can embed it (spec Q3).
 */
import { useEffect, useState } from 'react';
import type { ValheimMapMeta } from '@raid-ledger/contract';
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
import { MapControls, type MapLayerState } from './map-controls';
import { MapError } from './map-error';

export interface ValheimMapViewProps {
    characterId: number;
    mapId: number;
    className?: string;
}

const FRAME =
    'relative h-[calc(100dvh-12rem)] w-full overflow-hidden lg:h-[min(70dvh,720px)]';

interface ReadyProps {
    characterId: number;
    mapId: number;
    meta: ValheimMapMeta;
}

/**
 * Fog + base-map fetches for a loaded meta. `no_shared_layer` disables the
 * shared switch; any other shared failure is `sharedFailed` (switch off +
 * an inline chip) — never a silent ON switch that shows nothing.
 */
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
    const sharedFailed =
        shared.error !== null && !noShared && !shared.isFetching;
    return {
        base,
        personal,
        shared,
        sharedAvailable: meta.hasSharedExplored && !noShared,
        sharedFailed,
    };
}

interface MapStatusProps {
    ready: boolean;
    failed: boolean;
    sharedFailed: boolean;
}

function MapStatus({ ready, failed, sharedFailed }: MapStatusProps) {
    if (ready && !failed && !sharedFailed) return null;
    return (
        <div
            role="status"
            className="pointer-events-none absolute left-2 top-2 z-10 flex flex-col items-start gap-1"
        >
            {(!ready || failed) && (
                <StatusChip
                    tone={failed ? 'danger' : 'warning'}
                    title="Base map"
                >
                    {failed
                        ? 'Base map failed to load'
                        : 'Base map not uploaded yet'}
                </StatusChip>
            )}
            {sharedFailed && (
                <StatusChip tone="danger" title="Cartography table">
                    Cartography layer could not be loaded
                </StatusChip>
            )}
        </div>
    );
}

interface LayerProps {
    meta: ValheimMapMeta;
    baseUrl: string | null;
    personal: Uint8Array | undefined;
    shared: Uint8Array | null;
    sharedOn: boolean;
    pinLabels: boolean;
}

function BaseImage({ url, size }: { url: string; size: number }) {
    return (
        <img
            src={url}
            alt=""
            draggable={false}
            className="absolute left-0 top-0"
            style={{ width: size, height: size }}
        />
    );
}

/** Opaque backdrop-token cover while the personal fog is still decoding (AC1). */
function FogPending({ size }: { size: number }) {
    return (
        <div
            data-testid="map-fog-pending"
            aria-hidden="true"
            className="absolute left-0 top-0 bg-backdrop"
            style={{ width: size, height: size }}
        />
    );
}

/**
 * The texture-space stack inside the viewport: base image, fog, pins. The
 * base image renders only once the personal fog can paint over it — before
 * that an opaque cover, so unexplored terrain never flashes (AC1).
 */
function MapLayers({ layers, scale }: { layers: LayerProps; scale: number }) {
    const { meta, baseUrl, personal, shared, sharedOn, pinLabels } = layers;
    const size = meta.grid.textureSize;
    return (
        <div
            className="absolute left-0 top-0"
            style={{ width: size, height: size }}
            data-zoom={scale.toFixed(2)}
        >
            {!personal && <FogPending size={size} />}
            {personal && baseUrl && <BaseImage url={baseUrl} size={size} />}
            {personal && (
                <FogCanvas
                    size={size}
                    personal={personal}
                    shared={sharedOn ? shared : null}
                />
            )}
            <PinLayer
                grid={meta.grid}
                pins={meta.pins}
                scale={scale}
                showShared={sharedOn}
                labels={pinLabels}
            />
        </div>
    );
}

/** Switch state + fetched layers for a loaded meta. */
function useMapReadyState(props: ReadyProps) {
    const [showShared, setShowShared] = useState(false);
    const [pinLabels, setPinLabels] = useState(false);
    const { base, personal, shared, sharedAvailable, sharedFailed } =
        useMapLayers(props, showShared);
    useEffect(() => {
        if (sharedFailed) setShowShared(false);
    }, [sharedFailed]);
    const sharedOn = showShared && sharedAvailable && !sharedFailed;
    const layers: LayerProps = {
        meta: props.meta,
        baseUrl: base.url,
        personal: personal.data,
        shared: shared.data ?? null,
        sharedOn,
        pinLabels,
    };
    const controls: MapLayerState = {
        showShared: sharedOn,
        onShowShared: setShowShared,
        sharedAvailable,
        pinLabels,
        onPinLabels: setPinLabels,
    };
    const status = {
        ready: props.meta.baseMap?.ready === true,
        failed: base.error !== null,
        sharedFailed,
    };
    return { layers, controls, personal, status };
}

interface MapFrameProps {
    className?: string | undefined;
    layers: LayerProps;
    controls: MapLayerState;
    status: MapStatusProps;
}

/** Viewport + status chip + overlay controls in the sized frame (D10). */
function MapFrame({ className, layers, controls, status }: MapFrameProps) {
    const [commands, setCommands] = useState<MapViewportCommands | null>(null);
    return (
        <div className={className ? `${FRAME} ${className}` : FRAME}>
            <MapViewport
                contentSize={layers.meta.grid.textureSize}
                label="Valheim map"
                onCommands={setCommands}
                className="absolute inset-0"
            >
                {(vp) => <MapLayers layers={layers} scale={vp.scale} />}
            </MapViewport>
            <MapStatus {...status} />
            <div className="absolute right-2 top-2 z-10">
                <MapControls commands={commands} {...controls} />
            </div>
        </div>
    );
}

function MapReady(props: ReadyProps & { className?: string | undefined }) {
    const { layers, controls, personal, status } = useMapReadyState(props);
    if (personal.error) {
        return (
            <MapError
                text="The explored area could not be loaded."
                onRetry={() => void personal.refetch()}
            />
        );
    }
    return (
        <MapFrame
            className={props.className}
            layers={layers}
            controls={controls}
            status={status}
        />
    );
}

const LOADING_CLASS = `${FRAME} rounded-lg border border-edge bg-panel`;

function MapLoading() {
    return (
        <div
            aria-busy="true"
            aria-label="Loading map"
            className={LOADING_CLASS}
        />
    );
}

/** One character's map with its controls; loading / error states included. */
export function ValheimMapView({
    characterId,
    mapId,
    className,
}: ValheimMapViewProps) {
    const meta = useValheimMapMeta(characterId, mapId);
    if (meta.isPending) return <MapLoading />;
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
