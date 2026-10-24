/**
 * ROK-1943 D12/D15 — the row above the map: the filter summary (left,
 * `role="status"`) and the §4.1 funnel trigger (right, ≥1024px only), with the
 * filter body under it (`PinFilterPanel`). Below 1024px the trigger renders
 * nothing and the Filters FAB opens the same body in a BottomSheet.
 */
import { useState, type JSX } from 'react';
import { FilterEntryTrigger } from '../../../components/ui/filter-entry';
import { StatusChip } from '../../../components/ui/status-chip';
import { Button } from '../../../components/ui/button';
import { PinFilterPanel } from './pin-filter-panel';
import { PIN_SUMMARY_TEXT } from './pin-filter-summary';
import type { PinFilterSummary, PinFilterView } from './use-pin-filter';

/** The D15 summary line; empty (but mounted, a live region) when there is nothing to say. */
export function PinSummaryLine({ summary, onClear }: { summary: PinFilterSummary; onClear: () => void }): JSX.Element {
    const { status, activeCount, count, truncated } = summary;
    const empty = activeCount > 0 && count === 0 && status !== 'loading' && status !== 'error';
    return (
        <div role="status" data-testid="map-pin-filter" className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted">
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
        </div>
    );
}

export interface MapPinFiltersProps {
    filter: Pick<PinFilterView, 'panel' | 'summary'>;
    serverId?: number | undefined;
}

/** Owns the panel's open state and reset key; renders the toolbar row + the filter body. */
export function MapPinFilters({ filter, serverId }: MapPinFiltersProps): JSX.Element {
    const [isOpen, setOpen] = useState(false);
    const [resetKey, setResetKey] = useState(0);
    const { panel, summary } = filter;
    const clear = (): void => {
        setResetKey((k) => k + 1);
        panel.onClearAll();
    };
    return (
        <>
            <div className="flex min-w-0 items-center justify-between gap-2" data-testid="map-filter-toolbar">
                <PinSummaryLine summary={summary} onClear={clear} />
                <FilterEntryTrigger activeCount={panel.activeCount} isOpen={isOpen} onOpenChange={setOpen} />
            </div>
            <PinFilterPanel panel={panel} serverId={serverId} isOpen={isOpen} onOpenChange={setOpen}
                resetKey={resetKey} onClearAll={clear} />
        </>
    );
}
