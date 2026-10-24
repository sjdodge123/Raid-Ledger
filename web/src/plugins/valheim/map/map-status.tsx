/**
 * ROK-1837 — the map's status chips (base map missing / failed, cartography
 * layer failed). Moved out of `valheim-map-view.tsx` (ROK-1859 D15, no
 * behaviour change).
 */
import type { ValheimMapMeta } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';

export interface MapStatusProps {
    ready: boolean;
    failed: boolean;
    sharedFailed: boolean;
}

export function MapStatus({ ready, failed, sharedFailed }: MapStatusProps) {
    if (ready && !failed && !sharedFailed) return null;
    return (
        <div
            role="status"
            className="pointer-events-none absolute right-2 top-2 z-10 flex flex-col items-end gap-1 lg:left-2 lg:right-auto lg:items-start"
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

export function layerStatus(
    meta: ValheimMapMeta,
    failed: boolean,
    sharedFailed: boolean,
): MapStatusProps {
    return { ready: meta.baseMap?.ready === true, failed, sharedFailed };
}
