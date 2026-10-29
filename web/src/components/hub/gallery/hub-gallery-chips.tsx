/**
 * ROK-1942 (operator ruling 2026-10-24) — the All · Deaths · Screenshots (· Saves, ROK-1959) chips
 * on the Overview card: an exclusive choice drawn with the shared §4.3
 * `FilterChip` (the selected one is pressed). Rendered only when the hub has
 * at least two kinds — with one kind, "All" already is that kind.
 */
import type { JSX } from 'react';
import type { HubMediaFilter } from '../../../lib/hub-media-query';
import { FilterChip } from '../../ui/filter-chip';

const LABEL: Record<HubMediaFilter, string> = {
    all: 'All',
    death: 'Deaths',
    screenshot: 'Screenshots',
    /** ROK-1959 D-7 — game-save pictures. */
    save: 'Saves',
};

export interface HubGalleryChipsProps {
    filters: readonly HubMediaFilter[];
    value: HubMediaFilter;
    onChange: (filter: HubMediaFilter) => void;
}

export function HubGalleryChips({ filters, value, onChange }: HubGalleryChipsProps): JSX.Element | null {
    if (filters.length < 3) return null;
    return (
        <div role="group" aria-label="Show pictures" className="flex flex-wrap gap-2">
            {filters.map((f) => (
                <FilterChip key={f} label={LABEL[f]} pressed={value === f} testId={`hub-gallery-chip-${f}`}
                    onPressedChange={() => onChange(f)} />
            ))}
        </div>
    );
}
