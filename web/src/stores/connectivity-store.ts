import { create } from 'zustand';
import { API_BASE_URL } from '../lib/config';

interface ConnectivityState {
    status: 'checking' | 'online' | 'offline';
    hasBeenOnline: boolean;
    lastOnlineAt: Date | null;
    consecutiveFailures: number;
    check: () => Promise<void>;
    startPolling: () => () => void;
}

const POLL_ONLINE_MS = 60_000;
const POLL_OFFLINE_BASE_MS = 3_000;
const POLL_OFFLINE_MAX_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5_000;
const FAILURES_BEFORE_OFFLINE = 2;

async function fetchHealth(): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const response = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return response;
}

type SetFn = (partial: Partial<ConnectivityState>) => void;
type GetFn = () => ConnectivityState;

function applyFailure(get: GetFn, set: SetFn): void {
    const failures = get().consecutiveFailures + 1;
    set({
        consecutiveFailures: failures,
        status: failures >= FAILURES_BEFORE_OFFLINE ? 'offline' : get().status,
    });
}

function computePollInterval(status: string, offlineAttempt: number): { interval: number; nextAttempt: number } {
    if (status === 'online') return { interval: POLL_ONLINE_MS, nextAttempt: 0 };
    return { interval: Math.min(POLL_OFFLINE_BASE_MS * 2 ** offlineAttempt, POLL_OFFLINE_MAX_MS), nextAttempt: offlineAttempt + 1 };
}

async function performCheck(set: SetFn, get: GetFn): Promise<void> {
    try {
        const response = await fetchHealth();
        if (response.ok) set({ status: 'online', hasBeenOnline: true, lastOnlineAt: new Date(), consecutiveFailures: 0 });
        else applyFailure(get, set);
    } catch { applyFailure(get, set); }
}

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
    status: 'checking',
    hasBeenOnline: false,
    lastOnlineAt: null,
    consecutiveFailures: 0,

    async check() { await performCheck(set, get); },

    startPolling() {
        let timerId: ReturnType<typeof setTimeout>;
        let offlineAttempt = 0;

        const poll = () => {
            const { interval, nextAttempt } = computePollInterval(get().status, offlineAttempt);
            offlineAttempt = nextAttempt;
            timerId = setTimeout(async () => { await get().check(); poll(); }, interval);
        };

        void get().check().then(() => poll());
        return () => clearTimeout(timerId);
    },
}));
