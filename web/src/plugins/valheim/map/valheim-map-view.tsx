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

interface LayerProps {
    meta: ValheimMapMeta;
    baseUrl: string | null;
    personal: Uint8Array | undefined;
    shared: Uint8Array | null;
    sharedOn: boolean;
    pinLabels: boolean;
}

/** The texture-space stack inside the viewport: base image, fog, pins. */
function MapLayers({ layers, scale }: { layers: LayerProps; scale: number }) {
    const { meta, baseUrl, personal, shared, sharedOn, pinLabels } = layers;
    const size = meta.grid.textureSize;
    const box = { width: size, height: size };
    return (
        <div
            className="absolute left-0 top-0"
            style={box}
            data-zoom={scale.toFixed(2)}
        >
            {baseUrl && (
                <img
                    src={baseUrl}
                    alt=""
                    draggable={false}
                    className="absolute left-0 top-0"
                    style={box}
                />
            )}
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

function MapReady(props: ReadyProps & { className?: string | undefined }) {
    const [showShared, setShowShared] = useState(false);
    const [pinLabels, setPinLabels] = useState(false);
    const [commands, setCommands] = useState<MapViewportCommands | null>(null);
    const { base, personal, shared, sharedAvailable } = useMapLayers(
        props,
        showShared,
    );
    const sharedOn = showShared && sharedAvailable;
    if (personal.error) {
        return (
            <MapError
                text="The explored area could not be loaded."
                onRetry={() => void personal.refetch()}
            />
        );
    }
    const layers: LayerProps = {
        meta: props.meta,
        baseUrl: base.url,
        personal: personal.data,
        shared: shared.data ?? null,
        sharedOn,
        pinLabels,
    };
    return (
        <div
            className={props.className ? `${FRAME} ${props.className}` : FRAME}
        >
            <MapViewport
                contentSize={props.meta.grid.textureSize}
                label="Valheim map"
                onCommands={setCommands}
                className="absolute inset-0"
            >
                {(vp) => <MapLayers layers={layers} scale={vp.scale} />}
            </MapViewport>
            <BaseMapStatus
                ready={props.meta.baseMap?.ready === true}
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

const LOADING_CLASS = `${FRAME} rounded-lg border border-edge bg-panel`;

/** One character's map with its controls; loading / error states included. */
export function ValheimMapView({
    characterId,
    mapId,
    className,
}: ValheimMapViewProps) {
    const meta = useValheimMapMeta(characterId, mapId);
    if (meta.isPending)
        return (
            <div
                aria-busy="true"
                aria-label="Loading map"
                className={LOADING_CLASS}
            />
        );
    if (meta.error)
        return (
            <MapError
                text="The map could not be loaded."
                onRetry={() => void meta.refetch()}
            />
        );
    const key = `${characterId}:${mapId}`;
    return (
        <MapReady
            key={key}
            characterId={characterId}
            mapId={mapId}
            meta={meta.data}
            className={className}
        />
    );
}
