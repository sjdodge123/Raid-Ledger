/**
 * ROK-1754 §3.2: StartupGate renders the app only once the boot refresh has
 * settled — whatever its outcome — so the in-memory token exists before any
 * `enabled: !!getAuthToken()` hook first renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AUTH_METHOD_KEY } from '../../lib/api/auth-storage-keys';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api/refresh-client', () => ({ refreshWithOutcome: refresh }));
vi.mock('../../lib/magic-link-redeem', () => ({
    isMagicLinkRedeemPending: () => false,
    awaitMagicLinkRedeem: () => Promise.resolve(),
}));
vi.mock('../../stores/connectivity-store', async () => {
    const { create } = await import('zustand');
    // Connectivity is already proven: only the boot session can hold the gate.
    return { useConnectivityStore: create(() => ({ hasBeenOnline: true, check: () => {} })) };
});

/** Fresh boot state, started the way App.tsx does, then the gate mounted. */
async function mountGate() {
    vi.resetModules();
    const boot = await import('../../lib/api/boot-session');
    const { StartupGate } = await import('./StartupGate');
    void boot.startBootSession();
    render(<StartupGate><div>App Content</div></StartupGate>);
}

describe('ROK-1754 B2: StartupGate waits for the boot session', () => {
    beforeEach(() => {
        localStorage.clear();
        refresh.mockReset();
        Object.defineProperty(window, 'location', { value: { pathname: '/' }, writable: true });
    });

    it.each([
        ['ok', { kind: 'ok', token: 't' }],
        ['rejected', { kind: 'rejected' }],
        ['indeterminate', { kind: 'indeterminate' }],
    ])('holds children until the boot refresh settles (%s)', async (_label, result) => {
        localStorage.setItem(AUTH_METHOD_KEY, 'local');
        let resolve!: (o: unknown) => void;
        refresh.mockReturnValue(new Promise((r) => { resolve = r; }));
        await mountGate();
        expect(screen.queryByText('App Content')).toBeNull();
        expect(screen.getByText('Starting up...')).toBeInTheDocument();
        await act(async () => { resolve(result); });
        expect(screen.getByText('App Content')).toBeInTheDocument();
    });

    it('an anonymous visitor sees the app at once and makes no refresh', async () => {
        await mountGate();
        expect(screen.getByText('App Content')).toBeInTheDocument();
        expect(refresh).not.toHaveBeenCalled();
    });
});
