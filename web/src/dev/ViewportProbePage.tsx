/**
 * ROK-1661 experiment, DEMO_MODE only: `/dev/viewport-probe`, a bare page with
 * no app shell (`Layout.tsx` renders it with no `ViewportShell`, `useShellHeight`,
 * header, footer or feedback widget), for telling a browser-side viewport bug
 * from one of ours on a real iPad. `?mode=short` makes the content 1.1x the
 * viewport, `?mode=tall` 3x (from `innerHeight` at load). It shows the live
 * readout (sticky at the top), a `fixed bottom-0` marker bar where the fixed
 * layer ends, and an in-flow END OF PAGE block where the document ends:
 * anything shown below that block is past the document.
 */
import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useSystemStatus } from '../hooks/use-system-status';
import { ReadoutPanel } from './ViewportReadout';

const MODE_FACTORS = { short: 1.1, tall: 3 } as const;
type ProbeMode = keyof typeof MODE_FACTORS;

/** Distance between the y labels in the content block, in CSS px. */
const LABEL_EVERY_PX = 250;

function readMode(value: string | null): ProbeMode {
    return value === 'tall' ? 'tall' : 'short';
}

function ProbeContent({ mode, height, viewport }: { mode: ProbeMode; height: number; viewport: number }) {
    const labels = Array.from({ length: Math.ceil(height / LABEL_EVERY_PX) }, (_, i) => i * LABEL_EVERY_PX);
    return (
        <div data-testid="viewport-probe-content" className="relative border-x border-edge-subtle" style={{ height }}>
            {labels.map((y) => (
                <div key={y} className="absolute inset-x-0 border-t border-dashed border-edge-subtle px-2 font-mono text-xs text-dim" style={{ top: y }}>
                    y {y}
                </div>
            ))}
            <p className="absolute left-2 top-5 font-mono text-xs text-foreground">
                viewport-probe · mode {mode} · content {height}px = {MODE_FACTORS[mode]} × innerHeight {viewport} at load
            </p>
        </div>
    );
}

function ProbeBody({ mode, viewport }: { mode: ProbeMode; viewport: number }) {
    const height = Math.round(viewport * MODE_FACTORS[mode]);
    return (
        <div className="relative">
            <div className="sticky top-2 z-10 flex h-0 justify-end pr-2">
                <ReadoutPanel shellHeight={null} placement="relative" />
            </div>
            <ProbeContent mode={mode} height={height} viewport={viewport} />
            <div
                data-testid="viewport-probe-fixed-bottom"
                className="fixed bottom-0 inset-x-0 z-20 flex h-6 items-center justify-center bg-warning/80 font-mono text-xs font-bold text-foreground"
            >
                FIXED BOTTOM
            </div>
            <div
                data-testid="viewport-probe-end"
                className="flex h-12 items-center justify-center bg-danger font-mono text-sm font-bold text-foreground"
            >
                END OF PAGE · the document ends here
            </div>
        </div>
    );
}

/** DEMO_MODE-gated bare viewport probe; redirects to / otherwise, like the other /dev pages. */
export function ViewportProbePage() {
    const { data, isLoading } = useSystemStatus();
    const [params] = useSearchParams();
    const [viewport] = useState(() => window.innerHeight);
    if (isLoading) return null;
    if (data?.demoMode !== true) return <Navigate to="/" replace />;
    return <ProbeBody mode={readMode(params.get('mode'))} viewport={viewport} />;
}
