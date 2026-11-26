/**
 * ROK-2370 (verify step e): at 320–375px the code, "Copy code" and the
 * `/login code:` command each stay on one line — the tile may wrap the button
 * under the code, but nothing breaks at the code's hyphen.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SigninCodeWaiting } from './signin-code-panel-parts';

const EXPIRES = new Date(Date.now() + 9 * 60_000).toISOString();

function renderWaiting(): void {
    render(<SigninCodeWaiting code="NRXF-6ZAK" expiresAt={EXPIRES} onCancel={() => undefined} />);
}

describe('SigninCodeWaiting phone layout (ROK-2370)', () => {
    it('keeps the code on one line at a phone-sized type', () => {
        renderWaiting();
        const code = screen.getByTestId('signin-code-value');
        expect(code).toHaveTextContent('NRXF-6ZAK');
        expect(code).toHaveClass('whitespace-nowrap', 'text-xl', 'sm:text-2xl');
    });

    it('lets "Copy code" wrap under the code as a whole, never mid-label', () => {
        renderWaiting();
        const tile = screen.getByTestId('signin-code-value').parentElement;
        expect(tile).toHaveClass('flex-wrap');
        expect(screen.getByRole('button', { name: 'Copy code' })).toHaveClass('whitespace-nowrap', 'shrink-0');
    });

    it('keeps the /login code: command unbroken', () => {
        renderWaiting();
        const command = screen.getByTestId('signin-code-command');
        expect(command).toHaveTextContent('/login code:NRXF-6ZAK');
        expect(command).toHaveClass('whitespace-nowrap');
    });
});
