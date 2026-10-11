import { useState, useEffect, useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { useConnectivityStore } from '../../stores/connectivity-store';
import { BOOT_BYPASS_PATHS, isBootSettled, subscribeBootSession } from '../../lib/api/boot-session';

const SLOW_THRESHOLD_MS = 30_000;
const FADE_DURATION_MS = 300;

function FadingOverlay({ onTransitionEnd }: { onTransitionEnd: () => void }) {
    return (
        <div
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface transition-opacity duration-300"
            style={{ opacity: 0 }}
            aria-hidden
            onTransitionEnd={onTransitionEnd}
        />
    );
}

function WaitingScreen({ isSlow, onRetry }: { isSlow: boolean; onRetry: () => void }) {
    return (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface">
            <h1 className="text-2xl font-bold text-foreground mb-6">Raid Ledger</h1>
            <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin mb-4" />
            <p className="text-sm text-muted">
                {isSlow ? 'Taking longer than usual...' : 'Starting up...'}
            </p>
            {isSlow && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="mt-4 px-4 py-2 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                >
                    Retry now
                </button>
            )}
        </div>
    );
}

export function StartupGate({ children }: { children: ReactNode }) {
    const hasBeenOnline = useConnectivityStore((s) => s.hasBeenOnline);
    // ROK-1754 §3.2: also wait for the boot refresh (any outcome) so the
    // in-memory token exists before the first render of any query hook.
    const bootSettled = useSyncExternalStore(subscribeBootSession, isBootSettled, isBootSettled);
    const ready = hasBeenOnline && bootSettled;
    const check = useConnectivityStore((s) => s.check);
    const [isSlow, setIsSlow] = useState(false);
    const [gateVisible, setGateVisible] = useState(true);

    useEffect(() => {
        if (ready) return;
        const timer = setTimeout(() => setIsSlow(true), SLOW_THRESHOLD_MS);
        return () => clearTimeout(timer);
    }, [ready]);

    useEffect(() => {
        if (!ready) return;
        const timer = setTimeout(() => setGateVisible(false), FADE_DURATION_MS);
        return () => clearTimeout(timer);
    }, [ready]);

    const handleTransitionEnd = useCallback(() => setGateVisible(false), []);
    const isBypassRoute = BOOT_BYPASS_PATHS.includes(window.location.pathname);

    const gateActive = gateVisible && !isBypassRoute;
    if (gateActive && !ready) {
        return <WaitingScreen isSlow={isSlow} onRetry={() => void check()} />;
    }

    // `children` must stay in the SAME child slot while the overlay fades and
    // after it is gone: `false` still occupies slot 0. Moving it (overlay +
    // children -> children alone) made React remount the whole app ~300ms
    // after startup, wiping any state set in that window (e.g. a modal opened
    // by a one-shot effect).
    return (
        <>
            {gateActive && <FadingOverlay onTransitionEnd={handleTransitionEnd} />}
            {children}
        </>
    );
}
