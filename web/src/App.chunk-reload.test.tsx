/**
 * ROK-1763 review: the reload-once guard must survive the reload it triggers.
 * Sequence: a stale chunk fails → one reload → the reloaded page boots App →
 * the same chunk fails again → the error boundary shows, no second reload.
 * App's shell is stubbed; only its bootstrap effects matter here.
 */
import { Component, Suspense } from 'react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { lazyWithRetry } from './lazy-routes';
import App from './App';

const { passthrough } = vi.hoisted(() => ({
    passthrough: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock('./app-routes', () => ({ AppRoutes: () => null }));
vi.mock('./components/layout/index', () => ({ Layout: passthrough }));
vi.mock('./components/ui/StartupGate', () => ({ StartupGate: passthrough }));
vi.mock('./components/ui/ConnectivityBanner', () => ({ ConnectivityBanner: () => null }));
vi.mock('./components/ui/ThemeParticles', () => ({ ThemeParticles: () => null }));
vi.mock('./plugins/wow/register', () => ({}));
vi.mock('./plugins/discord/register', () => ({}));
vi.mock('./plugins/ai/register', () => ({}));
vi.mock('./plugins/pelican/register', () => ({}));
vi.mock('./stores/connectivity-store', () => ({
    useConnectivityStore: (sel: (s: { startPolling: () => () => void }) => unknown) =>
        sel({ startPolling: () => () => {} }),
}));

const WEBKIT_ERROR = 'Importing a module script failed.';

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    render() {
        return this.state.error ? <p>caught: {this.state.error.message}</p> : this.props.children;
    }
}

function renderFailingRoute() {
    const Route = lazyWithRetry(() => Promise.reject(new TypeError(WEBKIT_ERROR)));
    render(
        <Boundary>
            <Suspense fallback={<p>loading</p>}>
                <Route />
            </Suspense>
        </Boundary>,
    );
}

describe('stale-chunk reload guard across a reload', () => {
    const originalLocation = window.location;
    let reload: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        sessionStorage.clear();
        reload = vi.fn();
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: { ...originalLocation, reload },
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: originalLocation,
        });
        vi.restoreAllMocks();
    });

    it('does not reload a second time when the chunk still fails after App boots', async () => {
        renderFailingRoute();
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        cleanup();

        // The reloaded page: App mounts first, then the route's import fails again.
        render(<App />);
        renderFailingRoute();
        // Settle on whichever happens: a second reload (the bug) or the boundary.
        await vi.waitFor(() =>
            expect(reload.mock.calls.length > 1 || screen.queryByText(/caught:/) !== null).toBe(true),
        );
        expect(reload).toHaveBeenCalledTimes(1);
        expect(screen.getByText(`caught: ${WEBKIT_ERROR}`)).toBeInTheDocument();
    });
});
