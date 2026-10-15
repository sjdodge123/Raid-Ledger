/**
 * ROK-1775 — a muted one-line server row in the Schedule (phone list) view,
 * interleaved with the event cards (wireframe `ScheduleListPanel`): no fill, no
 * border, `text-dim`, quieter than any event. It WRAPS rather than truncating so
 * the end time and the server name always stay visible (ROK-1774 nit 2); the
 * live-state line rides in `title`.
 */
import type { JSX } from 'react';
import { PowerIcon } from '@heroicons/react/16/solid';
import type { LayerDayEntry } from './calendar-layer-days';

export function ScheduleLayerRow({ entry }: { entry: LayerDayEntry }): JSX.Element {
    return (
        <div
            data-testid="schedule-layer-row" data-kind={entry.kind}
            title={entry.tip.detail || undefined}
            className="flex items-start gap-2 px-3 py-0.5 text-xs leading-snug text-dim"
        >
            <PowerIcon aria-hidden="true" className="mt-px h-3 w-3 shrink-0" />
            <span className="min-w-0 break-words">{entry.tip.title}</span>
        </div>
    );
}
