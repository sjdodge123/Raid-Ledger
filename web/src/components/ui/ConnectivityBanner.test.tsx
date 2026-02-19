import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConnectivityBanner } from './ConnectivityBanner';
import { useConnectivityStore } from '../../stores/connectivity-store';

// Mock toast so we don't need sonner rendering in tests
vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// Mock the connectivity store
const { create } = await vi.hoisted(async () => {
    const zustand = await import('zustand');
    return { create: zustand.create };
});

vi.mock('../../stores/connectivity-store', () => {
    const store = create(() => ({
        status: 'online' as 'checking' | 'online' | 'offline',
        hasBeenOnline: true,
        lastOnlineAt: null as Date | null,
        consecutiveFailures: 0,
        check: vi.fn(),
        startPolling: vi.fn(() => vi.fn()),
    }));

    return { useConnectivityStore: store };
});

function setStoreState(partial: Partial<{
    status: 'checking' | 'online' | 'offline';
    hasBeenOnline: boolean;
    lastOnlineAt: Date | null;
    consecutiveFailures: number;
}>) {
    useConnectivityStore.setState(partial as Parameters<typeof useConnectivityStore.setState>[0]);
}

describe('ConnectivityBanner', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setStoreState({
            status: 'online',
            hasBeenOnline: true,
            lastOnlineAt: null,
            consecutiveFailures: 0,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    describe('visibility conditions', () => {
        it('does NOT render when status is "online"', () => {
            setStoreState({ status: 'online', hasBeenOnline: true });

            const { container } = render(<ConnectivityBanner />);

            expect(container.firstChild).toBeNull();
        });

        it('does NOT render during startup (hasBeenOnline is false)', () => {
            setStoreState({ status: 'offline', hasBeenOnline: false });

            const { container } = render(<ConnectivityBanner />);

            expect(container.firstChild).toBeNull();
        });

        it('does NOT render when status is "checking"', () => {
            setStoreState({ status: 'checking', hasBeenOnline: true });

            const { container } = render(<ConnectivityBanner />);

            expect(container.firstChild).toBeNull();
        });

        it('shows banner when status is "offline" and hasBeenOnline is true', () => {
            setStoreState({ status: 'offline', hasBeenOnline: true, lastOnlineAt: new Date() });

            render(<ConnectivityBanner />);

            expect(screen.getByText(/Unable to reach the server/)).toBeInTheDocument();
        });
    });

    describe('elapsed time display', () => {
        it('shows elapsed time since lastOnlineAt', () => {
            const lastOnlineAt = new Date(Date.now() - 65_000); // 1m 5s ago
            setStoreState({ status: 'offline', hasBeenOnline: true, lastOnlineAt });

            render(<ConnectivityBanner />);

            expect(screen.getByText(/1m 5s ago/)).toBeInTheDocument();
        });

        it('shows elapsed time in seconds when less than a minute', () => {
            const lastOnlineAt = new Date(Date.now() - 45_000); // 45s ago
            setStoreState({ status: 'offline', hasBeenOnline: true, lastOnlineAt });

            render(<ConnectivityBanner />);

            expect(screen.getByText(/45s ago/)).toBeInTheDocument();
        });

        it('updates elapsed time every second', () => {
            const lastOnlineAt = new Date(Date.now() - 10_000); // 10s ago
            setStoreState({ status: 'offline', hasBeenOnline: true, lastOnlineAt });

            render(<ConnectivityBanner />);

            expect(screen.getByText(/10s ago/)).toBeInTheDocument();

            act(() => {
                vi.advanceTimersByTime(5_000);
            });

            expect(screen.getByText(/15s ago/)).toBeInTheDocument();
        });
    });

    describe('dismiss button', () => {
        it('renders a dismiss button', () => {
            setStoreState({ status: 'offline', hasBeenOnline: true, lastOnlineAt: new Date() });

            render(<ConnectivityBanner />);

            expect(screen.getByRole('button', { name: 'Dismiss connectivity warning' })).toBeInTheDocument();
        });

        it('hides the banner when dismiss button is clicked', () => {
            setStoreState({ status: 'offline', hasBeenOnline: true, lastOnlineAt: new Date() });

            render(<ConnectivityBanner />);

            const dismissBtn = screen.getByRole('button', { name: 'Dismiss connectivity warning' });
            fireEvent.click(dismissBtn);

            expect(screen.queryByText(/Unable to reach the server/)).not.toBeInTheDocument();
        });
    });

    describe('banner reappears after dismiss on new offline period', () => {
        it('resets dismissed state when status transitions to offline again', () => {
            setStoreState({ status: 'offline', hasBeenOnline: true, lastOnlineAt: new Date() });

            render(<ConnectivityBanner />);

            // Dismiss the banner
            fireEvent.click(screen.getByRole('button', { name: 'Dismiss connectivity warning' }));
            expect(screen.queryByText(/Unable to reach the server/)).not.toBeInTheDocument();

            // Simulate going online then offline again (new offline period)
            act(() => {
                setStoreState({ status: 'online' });
            });
            act(() => {
                setStoreState({ status: 'offline', lastOnlineAt: new Date() });
            });

            expect(screen.getByText(/Unable to reach the server/)).toBeInTheDocument();
        });
    });

    describe('reconnection toast', () => {
        it('fires toast.success("Reconnected") when recovering from offline', async () => {
            const { toast } = await import('../../lib/toast');

            setStoreState({ status: 'offline', hasBeenOnline: true, lastOnlineAt: new Date() });

            render(<ConnectivityBanner />);

            // Transition to online
            act(() => {
                setStoreState({ status: 'online' });
            });

            expect(toast.success).toHaveBeenCalledWith('Reconnected');
        });
    });
});
