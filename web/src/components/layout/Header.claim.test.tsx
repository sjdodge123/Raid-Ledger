/** ROK-1701 D-15: while the instance awaits its claim every route bounces to /claim, so the header drops its nav. */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Header } from './Header';

const status = vi.hoisted(() => ({ value: { claimRequired: true } as { claimRequired?: boolean } }));
vi.mock('../../hooks/use-auth', () => ({ useAuth: () => ({ user: null, isAuthenticated: false }) }));
vi.mock('../../hooks/use-system-status', () => ({ useSystemStatus: () => ({ data: status.value }) }));
vi.mock('../../hooks/use-scroll-direction', () => ({ useScrollDirection: () => 'up' }));
vi.mock('../../lib/config', () => ({ API_BASE_URL: 'http://localhost:3000' }));
vi.mock('./ThemeToggle', () => ({ ThemeToggle: () => null }));

function renderHeader(): void {
    render(<MemoryRouter initialEntries={['/claim']}><Header onMenuClick={vi.fn()} /></MemoryRouter>);
}

describe('Header on /claim (ROK-1701 D-15)', () => {
    beforeEach(() => { status.value = { claimRequired: true }; });

    it('claim pending: brand + "First-time setup" only — no nav, Login or menu', () => {
        renderHeader();
        expect(screen.getByTestId('header-brand')).toBeInTheDocument();
        expect(screen.getByText('First-time setup')).toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Login' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument();
    });

    it('claimed: the normal signed-out header returns', () => {
        status.value = { claimRequired: false };
        renderHeader();
        expect(screen.queryByText('First-time setup')).not.toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Login' })).toBeInTheDocument();
    });
});
