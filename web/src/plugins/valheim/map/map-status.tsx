/**
 * ROK-1837 — the map's status chips (base map missing / failed, cartography
 * layer failed). Moved out of `valheim-map-view.tsx` (ROK-1859 D15, no
 * behaviour change).
 */
import { StatusChip } from '../../../components/ui/status-chip';

export interface MapStatusProps {
    ready: boolean;
    failed: boolean;
    sharedFailed: boolean;
}

/**
 * Below 1024px the zoom column sits top-LEFT (ROK-1943 D12), so the stack is
 * capped short of it and a long chip wraps instead of running underneath it
 * on a 320–393px phone frame. At ≥1024px the sides swap and there is room.
 */
const STACK_CLASS =
    'pointer-events-none absolute right-2 top-2 z-10 flex max-w-[calc(100%-4.5rem)] flex-col items-end gap-1 lg:left-2 lg:right-auto lg:max-w-none lg:items-start';
const CHIP_WRAP_CLASS = 'max-lg:whitespace-normal max-lg:text-right';

export function MapStatus({ ready, failed, sharedFailed }: MapStatusProps) {
    if (ready && !failed && !sharedFailed) return null;
    return (
        <div role="status" className={STACK_CLASS}>
            {(!ready || failed) && (
                <StatusChip
                    tone={failed ? 'danger' : 'warning'}
                    title="Base map"
                    className={CHIP_WRAP_CLASS}
                >
                    {failed
                        ? 'Base map failed to load'
                        : 'Base map not uploaded yet'}
                </StatusChip>
            )}
            {sharedFailed && (
                <StatusChip
                    tone="danger"
                    title="Cartography table"
                    className={CHIP_WRAP_CLASS}
                >
                    Cartography layer could not be loaded
                </StatusChip>
            )}
        </div>
    );
}
