/**
 * ROK-2370: the "Try another way" disclosure — closed by default, ordered
 * sections with one open at a time, `initialSection`, close callback.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SignInAnotherWay, TRY_ANOTHER_WAY_LABEL, type SignInSection } from './SignInAnotherWay';

const sections: SignInSection[] = [
    { id: 'discord-app-code', title: 'Get a code to confirm in Discord', showHeading: false, node: <p>code body</p> },
    { id: 'password', title: 'Sign in with username', showHeading: true, node: <p>password body</p> },
];

function trigger(): HTMLElement {
    return screen.getByRole('button', { name: TRY_ANOTHER_WAY_LABEL });
}

describe('SignInAnotherWay (ROK-2370)', () => {
    it('is closed by default: only the trigger, aria-expanded false', () => {
        render(<SignInAnotherWay sections={sections} intro="intro copy" />);
        expect(trigger()).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('code body')).not.toBeInTheDocument();
        expect(screen.queryByText('password body')).not.toBeInTheDocument();
    });

    it('opens on the first section, with the password section collapsed below it', () => {
        render(<SignInAnotherWay sections={sections} intro="intro copy" />);
        fireEvent.click(trigger());
        expect(trigger()).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('heading', { name: 'Sign in another way' })).toBeInTheDocument();
        expect(screen.getByText('intro copy')).toBeInTheDocument();
        const code = screen.getByText('code body');
        const passwordRow = screen.getByRole('button', { name: 'Sign in with username' });
        expect(code.compareDocumentPosition(passwordRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByText('password body')).not.toBeInTheDocument();
    });

    it('switches to another section, one open at a time', () => {
        render(<SignInAnotherWay sections={sections} />);
        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('button', { name: 'Sign in with username' }));
        expect(screen.getByText('password body')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Sign in with username' })).toBeInTheDocument();
        expect(screen.queryByText('code body')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Get a code to confirm in Discord' })).toBeInTheDocument();
    });

    it('defaultOpen + initialSection open straight onto that section', () => {
        render(<SignInAnotherWay sections={sections} defaultOpen initialSection="password" />);
        expect(screen.getByText('password body')).toBeInTheDocument();
        expect(screen.queryByText('code body')).not.toBeInTheDocument();
    });

    it('falls back to the first section when initialSection is not offered', () => {
        const passwordOnly = sections.filter((s) => s.id === 'password');
        render(<SignInAnotherWay sections={passwordOnly} defaultOpen initialSection="discord-app-code" />);
        expect(screen.getByText('password body')).toBeInTheDocument();
    });

    it('calls onClose when the member closes it, not when opening', () => {
        const onClose = vi.fn();
        render(<SignInAnotherWay sections={sections} onClose={onClose} />);
        fireEvent.click(trigger());
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(trigger());
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('code body')).not.toBeInTheDocument();
    });
});
