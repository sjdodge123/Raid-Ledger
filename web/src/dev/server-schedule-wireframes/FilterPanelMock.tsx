/**
 * ROK-1774 — the "Server schedules" checkbox inside the calendar's existing
 * funnel filter panel (design-system §4.1). Static stand-in for the inline
 * `FilterPanel` card (`bg-panel border-edge rounded-lg p-4`, "Filters" title),
 * using the real `Checkbox` primitive. Default ON. It drives every frame on
 * this page, so toggling it shows the calendar with and without the layer.
 *
 * Badge semantics follow the calendar's rule (count of things HIDDEN): turning
 * server schedules off would add 1 to the funnel badge.
 */
import type { JSX } from 'react';
import { Checkbox } from '../../components/ui/checkbox';

export function FilterPanelMock({ showServers, onChange }: {
  showServers: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <div data-testid="ss-panel-filter" className="w-full max-w-sm rounded-lg border border-edge bg-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Filters</h4>
        {!showServers && (
          <button type="button" onClick={() => onChange(true)} className="text-xs text-muted hover:text-foreground">
            Clear all
          </button>
        )}
      </div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Games</p>
      <p className="mb-3 text-xs text-dim">(existing game checklist — unchanged)</p>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Layers</p>
      <Checkbox
        data-testid="ss-filter-servers"
        label="Server schedules"
        description="Restarts and up-windows from linked game servers"
        checked={showServers}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}
