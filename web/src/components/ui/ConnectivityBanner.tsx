import { useState, useEffect } from 'react';
import { useConnectivityStore } from '../../stores/connectivity-store';
import { toast } from '../../lib/toast';

function formatElapsed(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}

function useConnectivitySubscription(setDismissed: (v: boolean) => void) {
    useEffect(() => {
        const unsubscribe = useConnectivityStore.subscribe(
            (state, prevState) => {
                if (state.status === 'offline' && prevState.status !== 'offline') setDismissed(false);
                if (state.status === 'online' && prevState.status === 'offline') toast.success('Reconnected');
            },
        );
        return unsubscribe;
    }, [setDismissed]);
}

function useElapsedTimer(status: string, lastOnlineAt: Date | null) {
    const [elapsed, setElapsed] = useState('');
    useEffect(() => {
        if (status !== 'offline' || !lastOnlineAt) return;
        const update = () => setElapsed(formatElapsed(Date.now() - lastOnlineAt.getTime()));
        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [status, lastOnlineAt]);
    return elapsed;
}

function CloseIcon() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
            />
        </svg>
    );
}

export function ConnectivityBanner() {
    const status = useConnectivityStore((s) => s.status);
    const hasBeenOnline = useConnectivityStore((s) => s.hasBeenOnline);
    const lastOnlineAt = useConnectivityStore((s) => s.lastOnlineAt);
    const [dismissed, setDismissed] = useState(false);

    useConnectivitySubscription(setDismissed);
    const elapsed = useElapsedTimer(status, lastOnlineAt);

    if (status !== 'offline' || !hasBeenOnline || dismissed) return null;

    return (
        <div className="sticky top-0 z-50 flex items-center justify-between gap-2 bg-amber-600 px-4 py-2 text-sm text-white shadow-md">
            <span>
                Unable to reach the server — retrying...
                {elapsed && <span className="ml-2 opacity-80">({elapsed} ago)</span>}
            </span>
            <button
                type="button"
                onClick={() => setDismissed(true)}
                className="shrink-0 rounded p-1 hover:bg-amber-700 transition-colors"
                aria-label="Dismiss connectivity warning"
            >
                <CloseIcon />
            </button>
        </div>
    );
}
