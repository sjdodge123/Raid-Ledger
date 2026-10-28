/**
 * ROK-1943 D12/D15 — the row above the map: the Map tab's pickers (ROK-2028,
 * `leading`), then the filter summary (`flex-1`,
 * `role="status"`) and the §4.1 funnel trigger (right, ≥1024px only), with the
 * filter body under it (`PinFilterPanel`). Below 1024px the trigger renders
 * nothing and the Filters FAB opens the same body in a BottomSheet.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { FilterEntryTrigger } from '../../../components/ui/filter-entry';
import { StatusChip } from '../../../components/ui/status-chip';
import { Button } from '../../../components/ui/button';
import { PinFilterPanel } from './pin-filter-panel';
import { PIN_SUMMARY_TEXT, portalsOmittedText } from './pin-filter-summary';
import type { PinFilterSummary, PinFilterView } from './use-pin-filter';

/** ROK-1946 D15: the portal layer's error chip + Retry and the omitted line. */
function PortalSummary({ summary }: { summary: PinFilterSummary }): JSX.Element {
    return (
        <>
            {summary.portalsError && (
                <>
                    <StatusChip tone="danger" title="Portals">{PIN_SUMMARY_TEXT.portalsError}</StatusChip>
                    <Button variant="ghost" size="md" onClick={summary.onRetryPortals}>Retry</Button>
                </>
            )}
            {summary.portalsOmitted > 0 && <span>{portalsOmittedText(summary.portalsOmitted)}</span>}
        </>
    );
}

/** ROK-1859: the Chests layer's error chip + Retry and the other-world line (D13). */
function ChestSummary({ summary }: { summary: PinFilterSummary }): JSX.Element {
    return (
        <>
            {summary.chestsError && (
                <>
                    <StatusChip tone="danger" title="Chests">{PIN_SUMMARY_TEXT.chestsError}</StatusChip>
                    <Button variant="ghost" size="md" onClick={summary.onRetryChests}>Retry</Button>
                </>
            )}
            {summary.chestsOtherWorld && <span>{PIN_SUMMARY_TEXT.chestsOtherWorld}</span>}
        </>
    );
}

/** Any enabled layer still loading or failed → not "no match" (ROK-1946, ROK-1859). */
function layersSettled(summary: PinFilterSummary): boolean {
    const { status, portalsPending, portalsError, chestsPending, chestsError } = summary;
    return status !== 'loading' && status !== 'error' && !portalsPending && !portalsError && !chestsPending && !chestsError;
}

/** The D15 summary line; empty (but mounted, a live region) when there is nothing to say. */
export function PinSummaryLine({ summary, onClear }: { summary: PinFilterSummary; onClear: () => void }): JSX.Element {
    const { status, activeCount, count, truncated } = summary;
    const empty = activeCount > 0 && count === 0 && layersSettled(summary);
    return (
        <div role="status" data-testid="map-pin-filter" className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm text-muted">
            {status === 'loading' && <span>{PIN_SUMMARY_TEXT.loading}</span>}
            {status === 'forbidden' && <span>{PIN_SUMMARY_TEXT.forbidden}</span>}
            {status === 'error' && (
                <>
                    <StatusChip tone="danger" title="Pins">{PIN_SUMMARY_TEXT.error}</StatusChip>
                    <Button variant="ghost" size="md" onClick={summary.onRetry}>Retry</Button>
                </>
            )}
            {empty && (
                <>
                    <span className="text-foreground">{PIN_SUMMARY_TEXT.empty}</span>
                    <Button variant="ghost" size="md" onClick={onClear}>Clear filters</Button>
                </>
            )}
            {truncated && <span>{PIN_SUMMARY_TEXT.truncated}</span>}
            <PortalSummary summary={summary} />
            <ChestSummary summary={summary} />
        </div>
    );
}

export interface MapPinFiltersProps {
    filter: Pick<PinFilterView, 'panel' | 'summary'>;
    serverId?: number | undefined;
    /** ROK-2028: the Map tab's pickers, at the row's start so picker and Filters share one line. */
    leading?: ReactNode;
}

/** Owns the panel's open state and reset key; renders the toolbar row + the filter body. */
export function MapPinFilters({ filter, serverId, leading }: MapPinFiltersProps): JSX.Element {
    const [isOpen, setOpen] = useState(false);
    const [resetKey, setResetKey] = useState(0);
    const [clearing, setClearing] = useState(false);
    const { panel, summary } = filter;
    // The router commits the cleared URL in a transition: remount the local
    // inputs (search text, Choose) only once it lands, so they seed from it.
    if (clearing && panel.activeCount === 0) {
        setClearing(false);
        setResetKey((k) => k + 1);
    }
    const clear = (): void => {
        setClearing(true);
        panel.onClearAll();
    };
    return (
        <>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2" data-testid="map-filter-toolbar">
                {leading}
                <PinSummaryLine summary={summary} onClear={clear} />
                <FilterEntryTrigger activeCount={panel.activeCount} isOpen={isOpen} onOpenChange={setOpen} />
            </div>
            <PinFilterPanel panel={panel} serverId={serverId} isOpen={isOpen} onOpenChange={setOpen}
                resetKey={resetKey} onClearAll={clear} />
        </>
    );
}
