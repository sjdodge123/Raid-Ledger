import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useConnectivityStore } from '../../stores/connectivity-store';

const SLOW_THRESHOLD_MS = 30_000;
const FADE_DURATION_MS = 300;

export function StartupGate({ children }: { children: ReactNode }) {
    const hasBeenOnline = useConnectivityStore((s) => s.hasBeenOnline);
    const check = useConnectivityStore((s) => s.check);

    const [isSlow, setIsSlow] = useState(false);
    const [gateVisible, setGateVisible] = useState(true);

    // Track how long we've been waiting
    useEffect(() => {
        if (hasBeenOnline) return;

        const timer = setTimeout(() => setIsSlow(true), SLOW_THRESHOLD_MS);
        return () => clearTimeout(timer);
    }, [hasBeenOnline]);

    // When API comes online, schedule gate removal after fade
    useEffect(() => {
        if (!hasBeenOnline) return;

        const timer = setTimeout(() => setGateVisible(false), FADE_DURATION_MS);
        return () => clearTimeout(timer);
    }, [hasBeenOnline]);

    // Handle the CSS transition end to fully remove the gate overlay sooner
    const handleTransitionEnd = useCallback(() => {
        setGateVisible(false);
    }, []);

    // Once the gate is fully gone, just render children
    if (!gateVisible) {
        return <>{children}</>;
    }

    // Gate is fading out — show both overlay (fading) and children underneath
    if (hasBeenOnline) {
        return (
            <>
                <div
                    className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface transition-opacity duration-300"
                    style={{ opacity: 0 }}
                    aria-hidden
                    onTransitionEnd={handleTransitionEnd}
                />
                {children}
            </>
        );
    }

    // Still waiting for API
    return (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface">
            <h1 className="text-2xl font-bold text-heading mb-6">Raid Ledger</h1>

            <div className="w-8 h-8 border-4 border-dim border-t-emerald-500 rounded-full animate-spin mb-4" />

            <p className="text-sm text-muted">
                {isSlow ? 'Taking longer than usual...' : 'Starting up...'}
            </p>

            {isSlow && (
                <button
                    type="button"
                    onClick={() => void check()}
                    className="mt-4 px-4 py-2 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                >
                    Retry now
                </button>
            )}
        </div>
    );
}
