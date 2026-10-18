/**
 * ROK-1787 — thin quantity bar (prototype `proposed/proposed-bits.tsx` `Meter`).
 * Nothing in the design-system inventory was a quantity meter, so this is the
 * one; tokens only, so it reads in every scheme. ROK-1840 gave it a second
 * adopter (the hub setup checklist's progress bar), so it is now listed in
 * design-system.md §3.2 — reuse it rather than hand-rolling a track + fill.
 */
import type { JSX } from 'react';

export type MeterTone = 'success' | 'warning';

const METER_FILL: Record<MeterTone, string> = {
    success: 'bg-success',
    warning: 'bg-warning',
};

export function GuildMeter({ pct, tone = 'success', label }: { pct: number; tone?: MeterTone; label: string }): JSX.Element {
    const width = Math.max(0, Math.min(100, Math.round(pct)));
    return (
        <div role="meter" aria-label={label} aria-valuenow={width} aria-valuemin={0} aria-valuemax={100}
            className="h-1.5 w-full overflow-hidden rounded-full bg-overlay">
            <div className={`h-full rounded-full ${METER_FILL[tone]}`} style={{ width: `${width}%` }} />
        </div>
    );
}
