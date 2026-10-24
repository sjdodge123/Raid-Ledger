/**
 * ROK-1859 D14 — the Chests layer on the map. `ChestPinLayer` draws the chest
 * pins with the one `PinLayer` (a tap/Enter opens the chest instead of its
 * label); `ChestPinDetail` is the Materials tab's own `ChestDetail` (Modal
 * ≥1024px, BottomSheet below). The detail mounts OUTSIDE `MapViewport`: both
 * dialogs portal to <body>, but React events still bubble through a portal to
 * its React parent, so a key or pointer press in the dialog would otherwise
 * reach the viewport's pan/zoom handlers.
 */
import { useEffect, type JSX } from 'react';
import type { ValheimContainerSummary, ValheimMapGrid } from '@raid-ledger/contract';
import { ChestDetail } from '../materials/chest-detail';
import { PinLayer } from './pin-layer';
import type { ChestLayer } from './use-chest-layer';

interface ChestPinLayerProps {
    grid: ValheimMapGrid;
    layer: ChestLayer;
    scale: number;
    labels: boolean;
    onOpen: (chest: ValheimContainerSummary) => void;
}

export function ChestPinLayer({ grid, layer, scale, labels, onOpen }: ChestPinLayerProps): JSX.Element | null {
    if (layer.pins.length === 0) return null;
    const open = (index: number): void => {
        const chest = layer.chests[index];
        if (chest !== undefined) onOpen(chest);
    };
    // Chest pins are never cartography pins, so `showShared` cannot hide them.
    return <PinLayer grid={grid} pins={layer.pins} scale={scale} showShared labels={labels} onOpen={open} />;
}

interface ChestPinDetailProps {
    layer: ChestLayer;
    chest: ValheimContainerSummary | null;
    onClose: () => void;
}

/**
 * The opened chest; the layer reads carts and ships too, so the detail does.
 * It closes once the layer no longer lists the chest (Chests chip off, filtered
 * out, gone from the scan): its base names and icons come from the layer.
 */
export function ChestPinDetail({ layer, chest, onClose }: ChestPinDetailProps): JSX.Element | null {
    const gone = chest !== null && !layer.chests.some((c) => c.key === chest.key);
    useEffect(() => {
        if (gone) onClose();
    }, [gone, onClose]);
    return (
        <ChestDetail
            serverId={layer.ctx.serverId}
            includeVehicles
            chest={gone ? null : chest}
            bases={layer.bases}
            ctx={layer.ctx}
            onClose={onClose}
        />
    );
}
