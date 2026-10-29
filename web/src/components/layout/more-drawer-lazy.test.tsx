/**
 * ROK-1901 review M1: a More-drawer chunk that 404s after a deploy must take
 * the stale-chunk reload path (one `location.reload()`), not throw to the root
 * error boundary and replace the whole app with "New Version Available".
 */
import { Component } from 'react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LazyAdminSubmenuContent, LazyGameTimeDrawer, LazyProfileSubmenuContent } from './more-drawer-lazy';

const STALE = 'Failed to fetch dynamically imported module: /assets/more-drawer-submenus-old.js';

vi.mock('./more-drawer-chunks', () => ({
    loadSubmenus: () => Promise.reject(new TypeError(STALE)),
    loadGameTime: () => Promise.reject(new TypeError(STALE)),
}));

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    render() {
        return this.state.error ? <p>boundary: {this.state.error.message}</p> : this.props.children;
    }
}

describe('More drawer lazy content — stale chunk (ROK-1901)', () => {
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

    it.each([
        ['Profile submenu', () => <LazyProfileSubmenuContent pathname="/profile/identity" onClose={() => {}} />],
        ['Admin submenu', () => <LazyAdminSubmenuContent pathname="/admin/settings/general" onClose={() => {}} />],
        ['Game Time sheet', () => <LazyGameTimeDrawer onClose={() => {}} />],
    ])('%s reloads once instead of reaching the error boundary', async (_name, element) => {
        render(<Boundary>{element()}</Boundary>);
        await vi.waitFor(() => expect(reload, 'stale drawer chunk must trigger one reload').toHaveBeenCalledTimes(1));
        expect(screen.queryByText(/^boundary:/), 'stale drawer chunk reached the error boundary').toBeNull();
    });
});
