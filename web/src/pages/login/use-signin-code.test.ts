/**
 * ROK-2370: the sign-in code state machine — start, poll while visible,
 * immediate poll on return to the tab, sessionStorage resume, expiry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSigninCode } from './use-signin-code';
import { SIGNIN_CODE_STORAGE_KEY, pollSigninCode, startSigninCode } from '../../lib/signin-code';

vi.mock('../../lib/signin-code', async (importActual) => ({
    ...(await importActual<typeof import('../../lib/signin-code')>()),
    startSigninCode: vi.fn(),
    pollSigninCode: vi.fn(),
}));

const NOW = Date.parse('2026-11-25T18:00:00.000Z');
const SECRET = 's'.repeat(43);
const pending = { code: 'K7QD-2M9X', deviceSecret: SECRET, expiresAt: '2026-11-25T18:10:00.000Z', pollIntervalMs: 2000 };
const session = { access_token: 'tok', user: { id: 1, username: 'jake', avatar: null, discordId: null, role: 'member' } };

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState): void {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
}

async function flush(): Promise<void> {
    await act(async () => { await Promise.resolve(); });
}

describe('useSigninCode (ROK-2370)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: NOW });
        vi.mocked(startSigninCode).mockReset();
        vi.mocked(pollSigninCode).mockReset();
        visibility = 'visible';
        vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
        sessionStorage.clear();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('starts idle with nothing saved, then waits on a started code and saves it', async () => {
        vi.mocked(startSigninCode).mockResolvedValue(pending);
        const { result } = renderHook(() => useSigninCode(vi.fn()));
        expect(result.current.state.phase).toBe('idle');
        await act(async () => { await result.current.start(); });
        expect(result.current.state).toEqual({ phase: 'waiting', pending, resumed: false });
        expect(JSON.parse(sessionStorage.getItem(SIGNIN_CODE_STORAGE_KEY) ?? 'null')).toEqual(pending);
    });

    it('lands on error when the start is refused', async () => {
        vi.mocked(startSigninCode).mockResolvedValue(null);
        const { result } = renderHook(() => useSigninCode(vi.fn()));
        await act(async () => { await result.current.start(); });
        expect(result.current.state.phase).toBe('error');
    });

    it('polls after the interval and hands the access token over on approval', async () => {
        vi.mocked(startSigninCode).mockResolvedValue(pending);
        vi.mocked(pollSigninCode).mockResolvedValue({ status: 'approved', session } as never);
        const onApproved = vi.fn();
        const { result } = renderHook(() => useSigninCode(onApproved));
        await act(async () => { await result.current.start(); });
        expect(pollSigninCode).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(pollSigninCode).toHaveBeenCalledWith(SECRET);
        expect(onApproved).toHaveBeenCalledWith('tok');
        expect(result.current.state.phase).toBe('approved');
        expect(sessionStorage.getItem(SIGNIN_CODE_STORAGE_KEY)).toBeNull();
    });

    it('does not poll while hidden, and polls at once when the tab is visible again', async () => {
        vi.mocked(startSigninCode).mockResolvedValue(pending);
        vi.mocked(pollSigninCode).mockResolvedValue({ status: 'pending', expiresAt: pending.expiresAt });
        const { result } = renderHook(() => useSigninCode(vi.fn()));
        await act(async () => { await result.current.start(); });
        visibility = 'hidden';
        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        expect(pollSigninCode).not.toHaveBeenCalled();
        act(() => setVisibility('visible'));
        await flush();
        expect(pollSigninCode).toHaveBeenCalledTimes(1);
    });

    it('resumes a saved code on mount and polls it immediately', async () => {
        sessionStorage.setItem(SIGNIN_CODE_STORAGE_KEY, JSON.stringify(pending));
        vi.mocked(pollSigninCode).mockResolvedValue({ status: 'pending', expiresAt: pending.expiresAt });
        const { result } = renderHook(() => useSigninCode(vi.fn()));
        expect(result.current.state).toEqual({ phase: 'waiting', pending, resumed: true });
        await flush();
        expect(pollSigninCode).toHaveBeenCalledTimes(1);
    });

    it('ignores an expired or junk saved code', () => {
        sessionStorage.setItem(SIGNIN_CODE_STORAGE_KEY, JSON.stringify({ ...pending, expiresAt: '2026-11-25T17:59:00.000Z' }));
        expect(renderHook(() => useSigninCode(vi.fn())).result.current.state.phase).toBe('idle');
        sessionStorage.setItem(SIGNIN_CODE_STORAGE_KEY, '{not json');
        expect(renderHook(() => useSigninCode(vi.fn())).result.current.state.phase).toBe('idle');
        expect(sessionStorage.getItem(SIGNIN_CODE_STORAGE_KEY)).toBeNull();
    });

    it('expires when the server says so, and when the clock passes expiresAt', async () => {
        vi.mocked(startSigninCode).mockResolvedValue(pending);
        vi.mocked(pollSigninCode).mockResolvedValueOnce({ status: 'expired' });
        const { result } = renderHook(() => useSigninCode(vi.fn()));
        await act(async () => { await result.current.start(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        expect(result.current.state.phase).toBe('expired');
        vi.mocked(pollSigninCode).mockResolvedValue({ status: 'pending', expiresAt: pending.expiresAt });
        await act(async () => { await result.current.start(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000); });
        expect(result.current.state.phase).toBe('expired');
    });

    it('cancel clears the saved code and returns to idle', async () => {
        vi.mocked(startSigninCode).mockResolvedValue(pending);
        const { result } = renderHook(() => useSigninCode(vi.fn()));
        await act(async () => { await result.current.start(); });
        act(() => result.current.cancel());
        expect(result.current.state.phase).toBe('idle');
        expect(sessionStorage.getItem(SIGNIN_CODE_STORAGE_KEY)).toBeNull();
    });
});
