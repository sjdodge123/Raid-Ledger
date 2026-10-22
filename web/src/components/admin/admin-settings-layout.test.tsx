/**
 * Prod 2026-10-21: hub-proposal notices go to operators as well as admins and
 * link to `/admin/settings/general/hubs`. An operator reaches that one page
 * (with a sidebar holding only Hubs); every other admin settings page stays
 * admin-only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminSettingsLayout } from './admin-settings-layout';

let mockRole: 'admin' | 'operator' | 'member' = 'operator';

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ user: { id: 1, username: 'u', role: mockRole }, isLoading: false }),
    isAdmin: (user: { role?: string } | null) => user?.role === 'admin',
    isOperatorOrAdmin: (user: { role?: string } | null) => user?.role === 'admin' || user?.role === 'operator',
}));
// The full sidebar fires admin-only status queries; the operator sidebar is real.
vi.mock('./admin-sidebar', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./admin-sidebar')>()),
    AdminSidebar: () => <div data-testid="full-admin-sidebar" />,
}));
vi.mock('../../hooks/use-seen-admin-sections', () => ({
    useSeenAdminSections: () => ({ isNew: () => false, markSeen: () => undefined }),
}));
vi.mock('./UpdateBanner', () => ({ UpdateBanner: () => null }));
vi.mock('./BuildFixesNotice', () => ({ BuildFixesNotice: () => null }));

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/admin/settings" element={<AdminSettingsLayout />}>
                    <Route path="general/hubs" element={<div>hubs review page</div>} />
                    <Route path="general/roles" element={<div>user management page</div>} />
                </Route>
            </Routes>
        </MemoryRouter>,
    );
}

describe('AdminSettingsLayout — operator access', () => {
    beforeEach(() => { mockRole = 'operator'; });

    it('renders the Hubs page for an operator, with only the Hubs nav item', () => {
        renderAt('/admin/settings/general/hubs');
        expect(screen.getByText('hubs review page')).toBeInTheDocument();
        expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
        expect(screen.queryByTestId('full-admin-sidebar')).not.toBeInTheDocument();
        const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
        expect(links).toEqual(['/admin/settings/general/hubs']);
    });

    it('shows Access Denied to an operator on any other admin settings page', () => {
        renderAt('/admin/settings/general/roles');
        expect(screen.getByText('Access Denied')).toBeInTheDocument();
        expect(screen.queryByText('user management page')).not.toBeInTheDocument();
    });

    it('shows Access Denied to a member on the Hubs page', () => {
        mockRole = 'member';
        renderAt('/admin/settings/general/hubs');
        expect(screen.getByText('Access Denied')).toBeInTheDocument();
        expect(screen.queryByText('hubs review page')).not.toBeInTheDocument();
    });

    it('keeps the full admin sidebar for an admin', () => {
        mockRole = 'admin';
        renderAt('/admin/settings/general/roles');
        expect(screen.getByText('user management page')).toBeInTheDocument();
        expect(screen.getByTestId('full-admin-sidebar')).toBeInTheDocument();
    });
});
