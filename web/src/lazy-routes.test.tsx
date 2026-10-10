/**
 * ROK-1763: `lazyWithRetry` must reload the page exactly once on a stale-chunk
 * failure — including WebKit's "Importing a module script failed." — and
 * rethrow to the error boundary when the reload has already been attempted.
 */
import { Component, Suspense } from 'react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CHUNK_RELOAD_KEY, lazyWithRetry } from './lazy-routes';

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

function renderFailingRoute(error: Error) {
    const Route = lazyWithRetry(() => Promise.reject(error));
    render(
        <Boundary>
            <Suspense fallback={<p>loading</p>}>
                <Route />
            </Suspense>
        </Boundary>,
    );
}

describe('lazyWithRetry', () => {
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

    it('reloads once and sets the flag on the WebKit stale-chunk error', async () => {
        renderFailingRoute(new TypeError(WEBKIT_ERROR));
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe('1');
        expect(screen.queryByText(/caught:/)).not.toBeInTheDocument();
    });

    it('rethrows to the boundary when a reload was already attempted', async () => {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
        renderFailingRoute(new TypeError(WEBKIT_ERROR));
        expect(await screen.findByText(`caught: ${WEBKIT_ERROR}`)).toBeInTheDocument();
        expect(reload).not.toHaveBeenCalled();
    });

    it('rethrows a non-chunk error without reloading', async () => {
        renderFailingRoute(new Error('boom'));
        expect(await screen.findByText('caught: boom')).toBeInTheDocument();
        expect(reload).not.toHaveBeenCalled();
        expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
    });
});
