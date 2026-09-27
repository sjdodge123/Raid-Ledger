/**
 * ROK-1630 AC16 — the onboarding "Connect Steam" control is a real <button>
 * (no href: the Steam hop needs a nonce minted on click), it starts the link
 * with returnTo '/onboarding', and it is disabled while the start is pending.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockLinkSteam = vi.fn().mockResolvedValue(undefined);
const linkState = { isLinkPending: false };
vi.mock('../../hooks/use-steam-link', () => ({
    useSteamLink: () => ({ linkSteam: mockLinkSteam, isLinkPending: linkState.isLinkPending }),
}));

import { SteamStep } from './steam-step';

function renderStep() {
    return render(<MemoryRouter initialEntries={['/onboarding']}><SteamStep /></MemoryRouter>);
}

describe('SteamStep connect control (ROK-1630 AC16)', () => {
    beforeEach(() => {
        mockLinkSteam.mockClear();
        linkState.isLinkPending = false;
    });

    it('is a <button> with no href — the session token is never rendered into a link', () => {
        renderStep();
        const button = screen.getByRole('button', { name: /connect steam/i });
        expect(button.tagName).toBe('BUTTON');
        expect(button).not.toHaveAttribute('href');
        expect(button).toHaveAttribute('type', 'button');
    });

    it('is the shared Button primitive with the Steam brand fill (no hand-rolled button)', () => {
        renderStep();
        const button = screen.getByRole('button', { name: /connect steam/i });
        expect(button).toHaveAttribute('data-brand-fill');
        expect(button).toHaveStyle({ backgroundColor: '#171a21' });
    });

    it('matches the replaced anchor exactly: 48px (py-3 + 16px/24px label), 16px/600, 12px gap, #2a475e hover', () => {
        renderStep();
        const button = screen.getByRole('button', { name: /connect steam/i });
        for (const cls of ['w-full', 'px-4', 'py-3', 'min-h-[44px]', 'rounded-lg', 'transition-colors',
            'hover:bg-[#2a475e]!', 'hover:filter-none!']) {
            expect(button).toHaveClass(cls);
        }
        const label = screen.getByText('Connect Steam');
        expect(label).toHaveClass('text-base', 'font-semibold', 'gap-3', 'inline-flex', 'items-center');
        expect(label.querySelector('svg')).toHaveClass('w-5', 'h-5');
    });

    it('clicking starts the Steam link with returnTo /onboarding', () => {
        renderStep();
        fireEvent.click(screen.getByRole('button', { name: /connect steam/i }));
        expect(mockLinkSteam).toHaveBeenCalledWith('/onboarding');
    });

    it('is disabled and shows the redirecting copy while the start is pending', () => {
        linkState.isLinkPending = true;
        renderStep();
        const button = screen.getByRole('button', { name: /redirecting to steam/i });
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-busy', 'true');
    });
});
