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

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
    status: 'checking',
    hasBeenOnline: false,
    lastOnlineAt: null,
    consecutiveFailures: 0,

    async check() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

            const response = await fetch(`${API_BASE_URL}/health`, {
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (response.ok) {
                set({
                    status: 'online',
                    hasBeenOnline: true,
                    lastOnlineAt: new Date(),
                    consecutiveFailures: 0,
                });
            } else {
                const failures = get().consecutiveFailures + 1;
                set({
                    consecutiveFailures: failures,
                    status: failures >= FAILURES_BEFORE_OFFLINE ? 'offline' : get().status,
                });
            }
        } catch {
            const failures = get().consecutiveFailures + 1;
            set({
                consecutiveFailures: failures,
                status: failures >= FAILURES_BEFORE_OFFLINE ? 'offline' : get().status,
            });
        }
    },

    startPolling() {
        let timerId: ReturnType<typeof setTimeout>;
        let offlineAttempt = 0;

        const getOfflineInterval = () =>
            Math.min(POLL_OFFLINE_BASE_MS * 2 ** offlineAttempt, POLL_OFFLINE_MAX_MS);

        const poll = () => {
            const state = get();
            let interval: number;

            if (state.status === 'online') {
                offlineAttempt = 0;
                interval = POLL_ONLINE_MS;
            } else {
                interval = getOfflineInterval();
                offlineAttempt++;
            }

            timerId = setTimeout(async () => {
                await get().check();
                poll();
            }, interval);
        };

        // Initial check immediately
        void get().check().then(() => poll());

        return () => clearTimeout(timerId);
    },
}));
