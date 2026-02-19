import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { StartupGate } from './StartupGate';
import { useConnectivityStore } from '../../stores/connectivity-store';

// Mock the connectivity store so we control state directly
const { create } = await vi.hoisted(async () => {
    const zustand = await import('zustand');
    return { create: zustand.create };
});

vi.mock('../../stores/connectivity-store', () => {
    const store = create(() => ({
        status: 'checking',
        hasBeenOnline: false,
        lastOnlineAt: null,
        consecutiveFailures: 0,
        check: vi.fn(),
        startPolling: vi.fn(() => vi.fn()),
    }));

    return { useConnectivityStore: store };
});

function setStoreState(partial: Partial<{ status: string; hasBeenOnline: boolean; check: () => void }>) {
    useConnectivityStore.setState(partial as Parameters<typeof useConnectivityStore.setState>[0]);
}

describe('StartupGate', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setStoreState({ status: 'checking', hasBeenOnline: false, check: vi.fn() });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('startup blocking (hasBeenOnline = false)', () => {
        it('shows "Starting up..." when status is "checking" and hasBeenOnline is false', () => {
            setStoreState({ status: 'checking', hasBeenOnline: false });

            render(
                <StartupGate>
                    <div>App Content</div>
                </StartupGate>,
            );

            expect(screen.getByText('Starting up...')).toBeInTheDocument();
        });

        it('does NOT render children while waiting for API', () => {
            setStoreState({ status: 'checking', hasBeenOnline: false });

            render(
                <StartupGate>
                    <div>App Content</div>
                </StartupGate>,
            );

            expect(screen.queryByText('App Content')).not.toBeInTheDocument();
        });

        it('renders the "Raid Ledger" heading during startup', () => {
            setStoreState({ status: 'checking', hasBeenOnline: false });

            render(
                <StartupGate>
                    <div>App Content</div>
                </StartupGate>,
            );

            expect(screen.getByText('Raid Ledger')).toBeInTheDocument();
        });

        it('renders a spinner during startup', () => {
            setStoreState({ status: 'checking', hasBeenOnline: false });

            const { container } = render(
                <StartupGate>
                    <div>App Content</div>
                </StartupGate>,
            );

            expect(container.querySelector('.animate-spin')).toBeInTheDocument();
        });
    });

    describe('"Taking longer than usual" after 30 seconds', () => {
        it('shows "Starting up..." before 30 seconds', () => {
            setStoreState({ status: 'checking', hasBeenOnline: false });

            render(
                <StartupGate>
                    <div>App Content</div>
                </StartupGate>,
            );

            act(() => {
                vi.advanceTimersByTime(29_999);
            });

            expect(screen.getByText('Starting up...')).toBeInTheDocument();
            expect(screen.queryByText('Taking longer than usual...')).not.toBeInTheDocument();
        });

        it('shows "Taking longer than usual..." after 30 seconds', () => {
            setStoreState({ status: 'checking', hasBeenOnline: false });

            render(
                <StartupGate>
                    <div>App Content</div>
                </StartupGate>,
            );

            act(() => {
                vi.advanceTimersByTime(30_001);
            });

            expect(screen.getByText('Taking longer than usual...')).toBeInTheDocument();
            expect(screen.queryByText('Starting up...')).not.toBeInTheDocument();
        });

        it('shows "Retry now" button after 30 seconds', () => {
            setStoreState({ status: 'checking', hasBeenOnline: false });

            render(
                <StartupGate>
                    <div>App Content</div>
                </StartupGate>,
            );

            act(() => {
                vi.advanceTimersByTime(30_001);
            });

            expect(screen.getByRole('button', { name: 'Retry now' })).toBeInTheDocument();
        });

        it('does NOT show "Retry now" button before 30 seconds', () => {
            setStoreState({ status: 'checking', hasBeenOnline: false });

            render(
                <StartupGate>
                    <div>App Content</div>
                </StartupGate>,
            );

            act(() => {
                vi.advanceTimersByTime(15_000);
            });

            expect(screen.queryByRole('button', { name: 'Retry now' })).not.toBeInTheDocument();
        });
    });

    describe('gate dismissal when API comes online (hasBeenOnline transitions to true)', () => {
        it('renders children when hasBeenOnline becomes true (after fade timeout)', () => {
            setStoreState({ status: 'online', hasBeenOnline: true });

            render(
                <StartupGate>
                    <div>App Content</div>
                </StartupGate>,
            );

            // Advance past the fade duration (300ms)
            act(() => {
                vi.advanceTimersByTime(400);
            });

            expect(screen.getByText('App Content')).toBeInTheDocument();
        });

        it('does NOT show startup gate when hasBeenOnline is true (runtime scenario)', () => {
            setStoreState({ status: 'online', hasBeenOnline: true });

            render(
                <StartupGate>
                    <div>App Content</div>
                </StartupGate>,
            );

            // After the fade, the gate overlay should be gone
            act(() => {
                vi.advanceTimersByTime(400);
            });

            expect(screen.queryByText('Starting up...')).not.toBeInTheDocument();
            expect(screen.queryByText('Raid Ledger')).not.toBeInTheDocument();
        });
    });
});
