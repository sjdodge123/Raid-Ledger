/**
 * ROK-2370: LoginBody with and without the last-used marker — card first,
 * the rest behind "Sign in another way", "Not you?" restores today's layout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { LoginMethodDto } from '@raid-ledger/contract';
import { LAST_SIGNIN_KEY, type LastSignin } from '../../lib/last-signin';
import { SIGNIN_CODE_STORAGE_KEY } from '../../lib/signin-code';
import { TRY_ANOTHER_WAY_LABEL } from './SignInAnotherWay';
import { LoginBody, SIGN_IN_ANOTHER_WAY_TOGGLE, type LoginBodyProps } from './LoginBody';

vi.mock('./SigninCodePanel', () => ({ SigninCodePanel: () => <p>code panel</p> }));

const discord = { key: 'discord', label: 'Continue with Discord', icon: 'discord', loginPath: '/auth/discord' } as LoginMethodDto;

function props(over: Partial<LoginBodyProps> = {}): LoginBodyProps {
    return {
        authProviders: [discord], isRedirecting: false, onProviderLogin: vi.fn(), isFirstRun: false,
        discordSigninCode: true, onLocalLogin: vi.fn(), isLoading: false, error: null, onCodeSignedIn: vi.fn(),
        ...over,
    };
}

function seed(method: LastSignin['method']): void {
    localStorage.setItem(LAST_SIGNIN_KEY, JSON.stringify({ method, name: 'Roknua', avatarUrl: null, at: 1 }));
}

const providerButton = (): HTMLElement | null => screen.queryByRole('button', { name: 'Continue with Discord' });
const card = (): HTMLElement | null => screen.queryByRole('button', { name: /Continue as Roknua/ });

afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('LoginBody last-used card (ROK-2370)', () => {
    it('without a marker: today\'s layout, no card', () => {
        render(<LoginBody {...props()} />);
        expect(card()).toBeNull();
        expect(providerButton()).toBeInTheDocument();
        expect(screen.getByRole('button', { name: TRY_ANOTHER_WAY_LABEL })).toBeInTheDocument();
    });

    it('with a marker: card first, providers hidden behind "Sign in another way"', () => {
        seed('discord');
        render(<LoginBody {...props()} />);
        expect(card()).toBeInTheDocument();
        expect(screen.getByText('or')).toBeInTheDocument();
        expect(providerButton()).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: SIGN_IN_ANOTHER_WAY_TOGGLE }));
        expect(providerButton()).toBeInTheDocument();
    });

    it('a Discord card starts the Discord provider login', () => {
        seed('discord');
        const p = props();
        render(<LoginBody {...p} />);
        fireEvent.click(card() as HTMLElement);
        expect(p.onProviderLogin).toHaveBeenCalledWith(discord);
    });

    it('a password card opens the disclosure on the password section', () => {
        seed('password');
        render(<LoginBody {...props()} />);
        fireEvent.click(card() as HTMLElement);
        expect(screen.getByLabelText(/password/i, { selector: 'input' })).toBeInTheDocument();
        expect(screen.queryByText('code panel')).toBeNull();
    });

    it('a code card opens the disclosure on the code section', () => {
        seed('discord-app-code');
        render(<LoginBody {...props()} />);
        fireEvent.click(card() as HTMLElement);
        expect(screen.getByText('code panel')).toBeInTheDocument();
    });

    it('"Not you?" forgets the marker and shows the default layout', () => {
        seed('discord');
        render(<LoginBody {...props()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Not you?' }));
        expect(card()).toBeNull();
        expect(providerButton()).toBeInTheDocument();
        expect(localStorage.getItem(LAST_SIGNIN_KEY)).toBeNull();
    });

    it('ignores a marker whose method is no longer offered', () => {
        seed('discord-app-code');
        render(<LoginBody {...props({ discordSigninCode: false })} />);
        expect(card()).toBeNull();
        expect(providerButton()).toBeInTheDocument();
    });

    it('with a marker AND a code pending in this tab: the code panel is shown at once (resume after a reload)', () => {
        seed('discord-app-code');
        sessionStorage.setItem(SIGNIN_CODE_STORAGE_KEY, JSON.stringify({
            code: 'K7QD-2M9X', deviceSecret: 's'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z', pollIntervalMs: 2000,
        }));
        render(<LoginBody {...props()} />);
        expect(card()).toBeInTheDocument();
        expect(screen.queryByText('code panel'), 'a pending code must not hide behind the collapsed card').toBeInTheDocument();
    });
});
