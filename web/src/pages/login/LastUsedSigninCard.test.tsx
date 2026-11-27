/**
 * ROK-2370: the "Last used" sign-in card — renders per method, one click
 * continues, "Not you?" is its own control.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { LastSignin } from '../../lib/last-signin';
import { LastUsedSigninCard, LAST_USED_LABEL, NOT_YOU_LABEL } from './LastUsedSigninCard';

function marker(method: LastSignin['method']): LastSignin {
    return { method, name: 'Roknua', avatarUrl: null, at: 1 };
}

describe('LastUsedSigninCard (ROK-2370)', () => {
    it.each([
        ['discord', 'Discord'],
        ['discord-app-code', 'Discord app code'],
        ['password', 'Username and password'],
        ['google', 'Google'],
    ] as const)('shows name, method (%s) and the Last used pill', (method, label) => {
        render(<LastUsedSigninCard marker={marker(method)} onContinue={vi.fn()} onNotYou={vi.fn()} />);
        const card = screen.getByRole('button', { name: `Continue as Roknua with ${label}` });
        expect(card).toHaveTextContent('Roknua');
        expect(card).toHaveTextContent(label);
        expect(card).toHaveTextContent(LAST_USED_LABEL);
    });

    it('one click continues with the remembered method', () => {
        const onContinue = vi.fn();
        render(<LastUsedSigninCard marker={marker('password')} onContinue={onContinue} onNotYou={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Continue as Roknua/ }));
        expect(onContinue).toHaveBeenCalledWith('password');
    });

    it('"Not you?" calls onNotYou and does not continue', () => {
        const onContinue = vi.fn();
        const onNotYou = vi.fn();
        render(<LastUsedSigninCard marker={marker('discord')} onContinue={onContinue} onNotYou={onNotYou} />);
        fireEvent.click(screen.getByRole('button', { name: NOT_YOU_LABEL }));
        expect(onNotYou).toHaveBeenCalledTimes(1);
        expect(onContinue).not.toHaveBeenCalled();
    });

    it('falls back to the initial when there is no avatar', () => {
        render(<LastUsedSigninCard marker={marker('discord')} onContinue={vi.fn()} onNotYou={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Continue as Roknua/ })).toHaveTextContent('R');
    });
});
