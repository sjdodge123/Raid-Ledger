/**
 * Live download gauge for the speed test (ROK-1374, operator ask 2026-09-05).
 *
 * A 240° arc with a log-ish scale — 0 · 1 · 5 · 10 · 20 · 50 · 100+ Mbps — and
 * the latest sample in the centre, the way the familiar consumer speed tests
 * present it. The first megabit gets a sixth of the sweep so a slow line still
 * visibly moves; everything above 100 Mbps pins to the end.
 *
 * Renders ONLY the number handed to it. No server name, no latency, no
 * diagnostics reach this component (AC20).
 */
import type { JSX } from 'react';
import { formatMbps, gaugeFraction } from './speed-gauge.helpers';

const CX = 100;
const CY = 100;
const ARC_R = 78;
const LABEL_R = 96;
const START_DEG = 210;
const SWEEP_DEG = 240;
const TICKS: ReadonlyArray<{ mbps: number; label: string }> = [
    { mbps: 0, label: '0' },
    { mbps: 1, label: '1' },
    { mbps: 5, label: '5' },
    { mbps: 10, label: '10' },
    { mbps: 20, label: '20' },
    { mbps: 50, label: '50' },
    { mbps: 100, label: '100+' },
];

function polar(fraction: number, radius: number): { x: number; y: number } {
    const rad = ((START_DEG - SWEEP_DEG * fraction) * Math.PI) / 180;
    return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) };
}

function arcPath(): string {
    const a = polar(0, ARC_R);
    const b = polar(1, ARC_R);
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${ARC_R} ${ARC_R} 0 1 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

function TickLabels(): JSX.Element {
    return (
        <>
            {TICKS.map((tick) => {
                const p = polar(gaugeFraction(tick.mbps), LABEL_R);
                return (
                    <text
                        key={tick.label}
                        x={p.x}
                        y={p.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="fill-current text-[9px] text-muted"
                    >
                        {tick.label}
                    </text>
                );
            })}
        </>
    );
}

interface Props {
    /** Latest sample in Mbps, or null before the first one arrives. */
    mbps: number | null;
    /** Line under the unit, e.g. "Testing download…". */
    caption: string;
}

export function SpeedGauge({ mbps, caption }: Props): JSX.Element {
    const fraction = gaugeFraction(mbps);
    const path = arcPath();
    return (
        <div
            data-testid="speed-gauge"
            role="img"
            aria-label={`Download speed ${formatMbps(mbps)} megabits per second, ${caption}`}
            className="mx-auto w-56"
        >
            <svg viewBox="0 0 200 170" className="block w-full">
                <path d={path} fill="none" strokeWidth="10" strokeLinecap="round" className="stroke-edge" />
                <path
                    d={path}
                    fill="none"
                    strokeWidth="10"
                    strokeLinecap="round"
                    pathLength={1}
                    strokeDasharray={`${fraction} 1`}
                    className="stroke-emerald-500 transition-[stroke-dasharray] duration-300 ease-out"
                    data-testid="speed-gauge-fill"
                    data-fraction={fraction.toFixed(3)}
                />
                <TickLabels />
                <text x={CX} y={CY - 4} textAnchor="middle" className="fill-current text-[28px] font-semibold text-foreground" data-testid="speed-gauge-value">
                    {formatMbps(mbps)}
                </text>
                <text x={CX} y={CY + 16} textAnchor="middle" className="fill-current text-[9px] text-muted">
                    Megabits per second
                </text>
                <text x={CX} y={CY + 30} textAnchor="middle" className="fill-current text-[9px] text-muted">
                    {caption}
                </text>
            </svg>
        </div>
    );
}
