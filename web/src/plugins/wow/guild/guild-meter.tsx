/**
 * ROK-1787 — thin quantity bar (prototype `proposed/proposed-bits.tsx` `Meter`).
 * New pattern: nothing in the design-system inventory is a quantity meter.
 * Plugin-local (one adopter); tokens only, so it reads in every scheme.
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
