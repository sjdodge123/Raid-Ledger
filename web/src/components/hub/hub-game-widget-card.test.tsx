/**
 * ROK-2251: a hub widget whose lazy chunk 404s after a deploy must reload the
 * page once (shared reload-once guard), not show its error cell — and a second
 * stale chunk in the window, or any other error, still shows the cell.
 */
import { lazy, Suspense, type JSX } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WidgetBoundary } from './hub-game-widget-card';
import { isReloadingChunkError } from '../../lib/chunk-error';

const STALE = 'Failed to fetch dynamically imported module: /assets/dungeon-quests-old.js';

function Throws({ error }: { error: Error }): JSX.Element {
    throw error;
}

function renderWidget(body: JSX.Element): void {
    render(
        <WidgetBoundary fallback={<p role="alert">widget error cell</p>}>
            <Suspense fallback={<p>loading</p>}>{body}</Suspense>
        </WidgetBoundary>,
    );
}

describe('WidgetBoundary — stale deploy chunk (ROK-2251)', () => {
    const originalLocation = window.location;
    let reload: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        sessionStorage.clear();
        reload = vi.fn();
        Object.defineProperty(window, 'location', {
            configurable: true, writable: true, value: { ...originalLocation, reload },
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation });
        vi.restoreAllMocks();
    });

    it('reloads once when the lazy widget body fails to load, without showing the error cell', async () => {
        const stale = new TypeError(STALE);
        const Body = lazy(() => Promise.reject(stale));
        renderWidget(<Body />);
        await vi.waitFor(() => expect(reload, 'stale widget chunk must trigger one reload').toHaveBeenCalledTimes(1));
        expect(screen.queryByText('widget error cell'), 'stale widget chunk showed the error cell').toBeNull();
        expect(isReloadingChunkError(stale), 'the reloading error must be marked so Sentry skips it').toBe(true);
    });

    it('shows the error cell for a second stale chunk inside the reload window (no reload loop)', () => {
        renderWidget(<Throws error={new TypeError(STALE)} />);
        const second = new TypeError(STALE);
        renderWidget(<Throws error={second} />);
        expect(reload, 'only the first stale chunk in the window may reload').toHaveBeenCalledTimes(1);
        expect(screen.getByText('widget error cell')).toBeInTheDocument();
        expect(isReloadingChunkError(second), 'a non-reloading error must still reach Sentry').toBe(false);
    });

    it('shows the error cell and never reloads for a non-chunk render error', () => {
        const crash = new TypeError("Cannot read properties of undefined (reading 'quests')");
        renderWidget(<Throws error={crash} />);
        expect(screen.getByText('widget error cell')).toBeInTheDocument();
        expect(reload, 'a non-chunk error must not reload the page').not.toHaveBeenCalled();
        expect(isReloadingChunkError(crash), 'a non-chunk error must still reach Sentry').toBe(false);
    });
});
