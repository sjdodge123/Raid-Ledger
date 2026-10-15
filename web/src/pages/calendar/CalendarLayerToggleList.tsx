/**
 * ROK-1775 — the "Layers" group of the calendar Filters panel (wireframe
 * `dev/server-schedule-wireframes/FilterPanelMock.tsx`): one `Checkbox` per
 * active plugin calendar layer, checked = shown. Renders nothing when no
 * layer is togglable.
 */
import type { JSX } from 'react';
import { Checkbox } from '../../components/ui/checkbox';
import type { CalendarLayerToggles } from './use-calendar-layer-toggles';

export function CalendarLayerToggleList({ layers }: { layers: CalendarLayerToggles }): JSX.Element | null {
    if (layers.toggles.length === 0) return null;
    return (
        <div data-testid="calendar-layer-toggles" className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Layers</p>
            {layers.toggles.map((t) => (
                <Checkbox key={t.key} data-testid={`calendar-layer-toggle-${t.key}`} label={t.label}
                    description={t.description} checked={t.visible} onChange={() => layers.toggleLayer(t.key)} />
            ))}
        </div>
    );
}
