/**
 * NominatingTabs — All / Yours / Trending filter strip for the S1
 * Nominating composite (ROK-1297). Pure presentational: receives the
 * active tab + counts + onChange handler. Implements the WAI-ARIA
 * tablist pattern so screen readers announce selection state.
 */
import type { JSX } from 'react';

export type NominatingTab = 'all' | 'yours' | 'trending';

export interface NominatingTabsProps {
  activeTab: NominatingTab;
  onChange: (tab: NominatingTab) => void;
  counts: { all: number; yours: number };
}

interface TabSpec {
  id: NominatingTab;
  label: string;
  countKey: 'all' | 'yours' | null;
}

const TABS: readonly TabSpec[] = [
  { id: 'all', label: 'All', countKey: 'all' },
  { id: 'yours', label: 'Yours', countKey: 'yours' },
  { id: 'trending', label: 'Trending', countKey: null },
];

const BASE_BTN =
  'px-3 py-1.5 text-[12px] rounded border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300';
const ACTIVE_BTN =
  'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
const INACTIVE_BTN =
  'border-edge bg-overlay/30 text-muted hover:text-foreground';

export function NominatingTabs(props: NominatingTabsProps): JSX.Element {
  const { activeTab, onChange, counts } = props;
  return (
    <div
      role="tablist"
      aria-label="Filter nominations"
      data-testid="nominating-tabs"
      className="flex items-center gap-2 mb-3"
    >
      {TABS.map((tab) => {
        const selected = tab.id === activeTab;
        const count = tab.countKey ? counts[tab.countKey] : null;
        const label =
          count != null ? `${tab.label} (${count})` : tab.label;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`nominating-panel-${tab.id}`}
            id={`nominating-tab-${tab.id}`}
            aria-label={label}
            onClick={() => onChange(tab.id)}
            className={`${BASE_BTN} ${selected ? ACTIVE_BTN : INACTIVE_BTN}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
