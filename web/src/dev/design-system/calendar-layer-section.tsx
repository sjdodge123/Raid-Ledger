/**
 * Server-schedule layer (plugin calendar layers) for /dev/design-system
 * (ROK-1774, design-system §4.22).
 *
 * Mounts the REAL `LayerWindowLabel` inside the same `.calendar-container
 * .rbc-day-slot .rbc-background-event.rl-layer-window` DOM the grid uses, so the
 * shipped `calendar-layers.css` hatch applies, and the REAL `LayerMarkerTick`
 * (tick + power glyph + tooltip). Hover, focus or tap the glyph to open it.
 */
import type { JSX } from 'react';
import { LayerWindowLabel } from '../../components/calendar/layers/LayerWindowLabel';
import { LayerMarkerTick } from '../../components/calendar/layers/LayerMarkerTick';
import type { LayerWindowEvent, ZonedLayerMarker } from '../../components/calendar/layers/calendar-layer-events';
import '../../components/calendar/layers/calendar-layers.css';
import { Section, StateFrame } from './design-system-bits';

/** The sample column spans 17:00–24:00; the band runs 18:00–22:00. */
const FIRST_HOUR = 17;
const HOURS = [17, 18, 19, 20, 21, 22, 23];
const ROW = 36;

function sampleWindow(label: string, continued: boolean): LayerWindowEvent {
    const start = new Date(2026, 9, 14, 18, 0);
    const end = new Date(2026, 9, 14, 22, 0);
    return {
        id: `ds-${label}`, title: continued ? `${label} (cont.)` : label, start, end, continued,
        layer: { kind: 'window', id: `ds-${label}`, start: start.toISOString(), end: end.toISOString(), label, ariaLabel: `${label}, 6:00 PM to 10:00 PM` },
    };
}

/** A tick at 20:05 — `minuteOfDay` is mapped onto the 17:00–24:00 sample column. */
const MARKER: ZonedLayerMarker = {
    id: 'ds-restart', dayKey: '2026-10-14', minuteOfDay: ((20 * 60 + 5 - FIRST_HOUR * 60) / (HOURS.length * 60)) * 1440,
    marker: {
        kind: 'marker', id: 'ds-restart', at: '2026-10-14T20:05:00Z', glyph: 'power',
        tip: { title: 'Restart · Valheim Dedicated · 8:05 PM', detail: 'Online · checked 2 min ago' },
    },
};

function SampleColumn({ label, continued, withTick }: { label: string; continued: boolean; withTick: boolean }): JSX.Element {
    return (
        <div className="calendar-container">
            <div className="rbc-day-slot relative w-[220px]" data-testid="ds-calendar-layer-day">
                {HOURS.map((h) => <div key={h} className="border-t border-edge bg-surface" style={{ height: ROW }} />)}
                <div className="rbc-background-event rl-layer-window absolute inset-x-0" style={{ top: ROW, height: ROW * 4 }}>
                    <LayerWindowLabel event={sampleWindow(label, continued)} />
                </div>
                {withTick && <LayerMarkerTick marker={MARKER} />}
            </div>
        </div>
    );
}

export function CalendarLayerSection(): JSX.Element {
    return (
        <Section
            id="calendar-layer"
            title="Pattern — server-schedule layer (plugin calendar layers)"
            blurb="A plugin's non-event time spans and instants on the Week/Day grid: a neutral edge-strong hatch band with a wrapping text-dim label, drawn behind events and pointer-events-none; a 2px solid edge-strong tick whose power glyph is the only pointer target. Hover, focus or tap the glyph for the tooltip; near the grid's right edge it opens to the left."
        >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <StateFrame label="Band + tick · LayerWindowLabel + LayerMarkerTick" note="6–10 PM window, restart tick at 8:05 PM.">
                    <SampleColumn label="Server up · Valheim Dedicated" continued={false} withTick />
                </StateFrame>
                <StateFrame label="Continued segment · wraps, never truncates" note="The post-midnight part of a window that crosses midnight.">
                    <SampleColumn label="Server up · A Very Long Community Server Name That Wraps" continued withTick={false} />
                </StateFrame>
            </div>
        </Section>
    );
}
