/**
 * ROK-1661 diagnostic, DEMO_MODE only: a live readout of the numbers the shell
 * floor (`components/layout/use-shell-height.ts`) and the footer depend on, for
 * checking a real iPad by eye. `Layout.tsx` lazy-loads it only when the URL has
 * `?vpdebug=1`, and it renders nothing unless the server reports DEMO_MODE.
 */
import { useEffect, useState } from 'react';
import { useSystemStatus } from '../hooks/use-system-status';

interface ViewportReadoutProps {
    /** The shell's min-height in px from `useShellHeight` (0 = not measured, `min-h-dvh` applies). */
    shellHeight: number;
}

type Reading = readonly [label: string, value: string];

type Listener = readonly [EventTarget | null | undefined, string];

/** Re-read with no event too: iOS settles a rotation after its last event. */
const POLL_MS = 500;

function round(n: number | undefined): string {
    return n === undefined ? '-' : String(Math.round(n * 100) / 100);
}

function readOrientation(): string {
    const orientation = typeof screen === 'undefined' ? undefined : (screen.orientation as ScreenOrientation | undefined);
    if (orientation) return orientation.type;
    if (typeof window.matchMedia !== 'function') return '-';
    return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape';
}

function readFooterBottom(): string {
    const footer = document.querySelector('footer');
    if (!footer || footer.getClientRects().length === 0) return 'none';
    return round(footer.getBoundingClientRect().bottom);
}

function readViewport(shellHeight: number): Reading[] {
    const vv = window.visualViewport;
    const root = document.documentElement;
    return [
        ['innerHeight', round(window.innerHeight)],
        ['clientHeight', round(root.clientHeight)],
        ['vv.height', round(vv?.height)],
        ['vv.offsetTop', round(vv?.offsetTop)],
        ['vv.scale', round(vv?.scale)],
        ['scrollY', round(window.scrollY)],
        ['scrollHeight', round(root.scrollHeight)],
        ['shell minHeight', shellHeight > 0 ? `${shellHeight}px` : 'min-h-dvh'],
        ['footer bottom', readFooterBottom()],
        ['orientation', readOrientation()],
    ];
}

function useLiveReadings(shellHeight: number): Reading[] {
    const [readings, setReadings] = useState(() => readViewport(shellHeight));
    useEffect(() => {
        let frame = 0;
        const refresh = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => setReadings(readViewport(shellHeight)));
        };
        const vv = window.visualViewport;
        const listeners: Listener[] = [
            [window, 'scroll'], [window, 'resize'], [window, 'orientationchange'], [vv, 'resize'], [vv, 'scroll'],
        ];
        const poll = setInterval(refresh, POLL_MS);
        refresh();
        for (const [target, type] of listeners) target?.addEventListener(type, refresh);
        return () => {
            cancelAnimationFrame(frame);
            clearInterval(poll);
            for (const [target, type] of listeners) target?.removeEventListener(type, refresh);
        };
    }, [shellHeight]);
    return readings;
}

function ReadoutPanel({ shellHeight }: ViewportReadoutProps) {
    const readings = useLiveReadings(shellHeight);
    return (
        <dl
            data-testid="viewport-readout"
            aria-hidden="true"
            className="fixed top-2 right-2 z-[100] pointer-events-none rounded-md border border-edge-subtle bg-surface/90 px-2 py-1 font-mono text-[10px] leading-tight text-foreground"
        >
            {readings.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                    <dt className="text-dim">{label}</dt>
                    <dd>{value}</dd>
                </div>
            ))}
        </dl>
    );
}

/** The ROK-1661 viewport readout; renders nothing outside DEMO_MODE. */
export function ViewportReadout({ shellHeight }: ViewportReadoutProps) {
    const { data } = useSystemStatus();
    if (data?.demoMode !== true) return null;
    return <ReadoutPanel shellHeight={shellHeight} />;
}
