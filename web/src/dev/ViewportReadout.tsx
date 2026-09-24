/**
 * ROK-1661 diagnostic, DEMO_MODE only: a live readout of the numbers the shell
 * floor (`components/layout/use-shell-height.ts`), the footer and the root canvas
 * depend on, for checking a real iPad by eye. `Layout.tsx` lazy-loads it only
 * while the `?vpdebug` flag is on (`vpdebug-flag.ts`), and it renders nothing
 * unless the server reports DEMO_MODE. It sits in the shell (absolute, just above
 * the footer), not on the fixed layer: iPad Safari slid that layer under its
 * toolbar in plan 2026-09-23-2034-11b7 frames B and D, hiding the readout.
 */
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useSystemStatus } from '../hooks/use-system-status';
import { type LastEvent, type Reading, readSignals, watchViewportEvents } from './viewport-signals';

interface ViewportReadoutProps {
    /** The shell's min-height in px from `useShellHeight` (0 = not measured, `min-h-dvh` applies). */
    shellHeight: number;
}

type Listener = readonly [EventTarget | null | undefined, string];

/** Re-read with no event too: iOS settles a rotation after its last event. */
const POLL_MS = 250;

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

function readBackground(el: Element | null): string {
    return el ? getComputedStyle(el).backgroundColor || '-' : '-';
}

/** Where Safari's fixed layer ends: the top of a zero-height `fixed bottom-0` probe. */
function readProbe(probe: HTMLElement | null): string {
    return probe ? round(probe.getBoundingClientRect().top) : '-';
}

function readViewport(shellHeight: number, probe: HTMLElement | null, lastEvent: LastEvent | null): Reading[] {
    const vv = window.visualViewport;
    const root = document.documentElement;
    return [
        ['innerHeight', round(window.innerHeight)],
        ['clientHeight', round(root.clientHeight)],
        ['vv.height', round(vv?.height)],
        ['vv.offsetTop', round(vv?.offsetTop)],
        ['vv.pageTop', round(vv?.pageTop)],
        ['vv.scale', round(vv?.scale)],
        ['scrollY', round(window.scrollY)],
        ['max scroll', round(root.scrollHeight - window.innerHeight)],
        ['scrollHeight', round(root.scrollHeight)],
        ['fixed probe bottom', readProbe(probe)],
        ['shell minHeight', shellHeight > 0 ? `${shellHeight}px` : 'min-h-dvh'],
        ['footer bottom', readFooterBottom()],
        ['html bg', readBackground(root)],
        ['body bg', readBackground(document.body)],
        ['orientation', readOrientation()],
        ...readSignals(lastEvent),
    ];
}

/**
 * Attempt-4 experiment, not shipped behaviour: pull the scroll back inside the
 * document (`scrollHeight - innerHeight`) after Safari has panned past it.
 */
function nudgeScroll(): void {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(window.scrollX, Math.min(window.scrollY, maxScroll));
}

function useLiveReadings(shellHeight: number, probeRef: RefObject<HTMLElement | null>) {
    const lastEventRef = useRef<LastEvent | null>(null);
    const [readings, setReadings] = useState(() => readViewport(shellHeight, null, null));
    const reread = useCallback(
        () => setReadings(readViewport(shellHeight, probeRef.current, lastEventRef.current)),
        [shellHeight, probeRef],
    );
    useEffect(() => {
        let frame = 0;
        const refresh = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(reread);
        };
        // Resize, focus and lifecycle events come through the watcher, which also records the last one.
        const stopWatching = watchViewportEvents((name) => {
            lastEventRef.current = { name, at: Date.now() };
            refresh();
        });
        const listeners: Listener[] = [[window, 'scroll'], [window, 'orientationchange']];
        const poll = setInterval(refresh, POLL_MS);
        refresh();
        for (const [target, type] of listeners) target?.addEventListener(type, refresh);
        return () => {
            cancelAnimationFrame(frame);
            clearInterval(poll);
            stopWatching();
            for (const [target, type] of listeners) target?.removeEventListener(type, refresh);
        };
    }, [reread]);
    return [readings, reread] as const;
}

function ReadingList({ readings }: { readings: Reading[] }) {
    return (
        <dl aria-hidden="true" className="rounded-md border border-edge-subtle bg-surface/90 px-2 py-1">
            {readings.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                    <dt className="text-dim">{label}</dt>
                    <dd>{value}</dd>
                </div>
            ))}
        </dl>
    );
}

function ReadoutPanel({ shellHeight }: ViewportReadoutProps) {
    const probeRef = useRef<HTMLDivElement>(null);
    const [readings, reread] = useLiveReadings(shellHeight, probeRef);
    const nudge = () => {
        nudgeScroll();
        reread();
    };
    return (
        <div
            data-testid="viewport-readout"
            className="absolute bottom-20 right-2 z-[100] flex flex-col items-end gap-1 pointer-events-none font-mono text-[10px] leading-tight text-foreground"
        >
            <div ref={probeRef} aria-hidden="true" className="fixed bottom-0 left-0 h-0 w-0" />
            <ReadingList readings={readings} />
            <button
                type="button"
                onClick={nudge}
                className="pointer-events-auto rounded-md border border-edge-subtle bg-surface px-2 py-1"
            >
                nudge
            </button>
        </div>
    );
}
/** The ROK-1661 viewport readout; renders nothing outside DEMO_MODE. */
export function ViewportReadout({ shellHeight }: ViewportReadoutProps) {
    const { data } = useSystemStatus();
    if (data?.demoMode !== true) return null;
    return <ReadoutPanel shellHeight={shellHeight} />;
}
