/**
 * ROK-2370: the code panel's success hold. "Signed in as … · Not you? Sign
 * out" shows BEFORE the session is adopted (on `/`, adopting it swaps the
 * login page out at once), "Not you?" never adopts it, and an unmount during
 * the hold still hands the user over so the marker and route are not lost.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SIGNIN_CODE_STORAGE_KEY, fetchSigninCodeAccountName, pollSigninCode } from '../../lib/signin-code';
import { SIGNED_IN_HOLD_MS, SigninCodePanel } from './SigninCodePanel';

const USER = { id: 3, username: 'raider3', displayName: 'Raider Three' };
const login = vi.hoisted(() => vi.fn());
const logout = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/use-auth', () => ({ useAuth: () => ({ login, logout }) }));
vi.mock('../../lib/signin-code', async (importActual) => ({
    ...(await importActual<typeof import('../../lib/signin-code')>()),
    startSigninCode: vi.fn(),
    pollSigninCode: vi.fn(),
    fetchSigninCodeAccountName: vi.fn(),
}));

const NOW = Date.parse('2026-11-25T18:00:00.000Z');
const pending = { code: 'K7QD-2M9X', deviceSecret: 's'.repeat(43), expiresAt: '2026-11-25T18:10:00.000Z', pollIntervalMs: 2000 };
const notYou = (): HTMLElement | null => screen.queryByRole('button', { name: 'Not you? Sign out' });

/** Resume a saved code whose first poll comes back approved, and settle the panel. */
async function renderApproved(onSignedIn = vi.fn()): Promise<{ onSignedIn: typeof onSignedIn; unmount: () => void }> {
    sessionStorage.setItem(SIGNIN_CODE_STORAGE_KEY, JSON.stringify(pending));
    const { unmount } = render(<SigninCodePanel onSignedIn={onSignedIn} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    return { onSignedIn, unmount };
}

describe('SigninCodePanel success hold (ROK-2370)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: NOW });
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        vi.mocked(pollSigninCode).mockResolvedValue({ status: 'approved', session: { access_token: 'tok' } });
        vi.mocked(fetchSigninCodeAccountName).mockResolvedValue('Raider Three');
        login.mockReset().mockResolvedValue(USER);
        logout.mockReset();
        sessionStorage.clear();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('names the account with "Not you? Sign out" before the session is adopted', async () => {
        await renderApproved();
        expect(screen.getByText(/Signed in as Raider Three/)).toBeInTheDocument();
        expect(notYou()).toBeInTheDocument();
        expect(login, 'the session must not be published while "Not you?" is on screen').not.toHaveBeenCalled();
    });

    it('adopts the session and hands the user over once the hold ends', async () => {
        const { onSignedIn } = await renderApproved();
        await act(async () => { await vi.advanceTimersByTimeAsync(SIGNED_IN_HOLD_MS); });
        expect(login).toHaveBeenCalledWith('tok');
        expect(onSignedIn).toHaveBeenCalledWith(USER);
    });

    it('"Not you? Sign out" signs out and never adopts the session', async () => {
        const { onSignedIn } = await renderApproved();
        fireEvent.click(notYou() as HTMLElement);
        await act(async () => { await vi.advanceTimersByTimeAsync(SIGNED_IN_HOLD_MS * 2); });
        expect(logout).toHaveBeenCalledTimes(1);
        expect(login, '"Not you?" must not publish the session').not.toHaveBeenCalled();
        expect(onSignedIn).not.toHaveBeenCalled();
    });

    it('an unmount during the hold still adopts the session and hands the user over', async () => {
        const { onSignedIn, unmount } = await renderApproved();
        unmount();
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(onSignedIn, 'the marker + route handler must run even when the page is swapped out').toHaveBeenCalledWith(USER);
    });
});
