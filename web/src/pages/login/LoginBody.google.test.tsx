/**
 * ROK-2371: login methods render from `placement` — Discord and Google are
 * top-level buttons, an `'alternate'` method waits behind "Try another way";
 * a Google last-used marker continues with Google.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { LoginMethodDto } from '@raid-ledger/contract';
import { LAST_SIGNIN_KEY } from '../../lib/last-signin';
import { TRY_ANOTHER_WAY_LABEL } from './SignInAnotherWay';
import { LoginBody, OTHER_PROVIDERS_TITLE, type LoginBodyProps } from './LoginBody';

vi.mock('./SigninCodePanel', () => ({ SigninCodePanel: () => <p>code panel</p> }));

const discord: LoginMethodDto = { key: 'discord', label: 'Continue with Discord', icon: 'discord', loginPath: '/auth/discord' };
const google: LoginMethodDto = {
    key: 'google', label: 'Sign in with Google', icon: 'google', loginPath: '/auth/google', placement: 'primary',
};
const alt: LoginMethodDto = { key: 'sso', label: 'Sign in with SSO', loginPath: '/auth/sso', placement: 'alternate' };

function props(over: Partial<LoginBodyProps> = {}): LoginBodyProps {
    return {
        authProviders: [discord, google], isRedirecting: false, onProviderLogin: vi.fn(), isFirstRun: false,
        discordSigninCode: true, onLocalLogin: vi.fn(), isLoading: false, error: null, onCodeSignedIn: vi.fn(),
        ...over,
    };
}

const button = (name: string | RegExp): HTMLElement | null => screen.queryByRole('button', { name });

afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('LoginBody placement split (ROK-2371)', () => {
    it('Discord and Google are both top-level buttons; the workarounds stay collapsed', () => {
        render(<LoginBody {...props()} />);
        expect(button('Continue with Discord')).toBeInTheDocument();
        expect(button('Sign in with Google')).toBeInTheDocument();
        expect(screen.queryByTestId('signin-another-way')).toBeNull();
        expect(screen.queryByLabelText(/username/i)).toBeNull();
    });

    it('Google is a neutral button with no brand fill; Discord keeps its fill', () => {
        render(<LoginBody {...props()} />);
        expect(button('Sign in with Google')).not.toHaveAttribute('data-brand-fill');
        expect(button('Continue with Discord')).toHaveAttribute('data-brand-fill');
    });

    it('an alternate method only appears inside "Try another way"', () => {
        render(<LoginBody {...props({ authProviders: [discord, google, alt] })} />);
        expect(button('Sign in with SSO'), 'alternate must not be top-level').toBeNull();
        fireEvent.click(screen.getByRole('button', { name: TRY_ANOTHER_WAY_LABEL }));
        const disclosure = screen.getByTestId('signin-another-way');
        fireEvent.click(within(disclosure).getByRole('button', { name: OTHER_PROVIDERS_TITLE }));
        expect(within(disclosure).getByRole('button', { name: 'Sign in with SSO' })).toBeInTheDocument();
    });

    it('a top-level Google click hands the Google method to the page', () => {
        const onProviderLogin = vi.fn();
        render(<LoginBody {...props({ onProviderLogin })} />);
        fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
        expect(onProviderLogin).toHaveBeenCalledWith(google);
    });
});

describe('LoginBody Google last-used card (ROK-2371)', () => {
    function seedGoogle(): void {
        localStorage.setItem(LAST_SIGNIN_KEY, JSON.stringify({ method: 'google', name: 'Roknua', avatarUrl: null, at: 1 }));
    }

    it('shows the Google card and one tap continues with Google', () => {
        seedGoogle();
        const onProviderLogin = vi.fn();
        render(<LoginBody {...props({ onProviderLogin })} />);
        fireEvent.click(screen.getByRole('button', { name: 'Continue as Roknua with Google' }));
        expect(onProviderLogin).toHaveBeenCalledWith(google);
    });

    it('hides the Google card when the server no longer offers Google', () => {
        seedGoogle();
        render(<LoginBody {...props({ authProviders: [discord] })} />);
        expect(button(/Continue as Roknua/)).toBeNull();
        expect(button('Continue with Discord')).toBeInTheDocument();
    });
});
