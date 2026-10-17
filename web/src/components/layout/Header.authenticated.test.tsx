/**
 * Header for a signed-in member (ROK-1099 / ROK-1128): the Insights entry
 * replaces the old "Event Metrics" nav link. Lives in its own file because
 * Header.test.tsx pins `useAuth` to a logged-out user with a module-scope mock.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Header } from './Header';
import { at } from '../../test/defined';
import { registerPlugin } from '../../plugins/plugin-registry';
import { usePluginStore } from '../../stores/plugin-store';

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({
        user: { id: 1, username: 'TestUser', role: 'member' },
        isAuthenticated: true,
    }),
}));

vi.mock('../../hooks/use-system-status', () => ({
    useSystemStatus: () => ({ data: null }),
}));

vi.mock('../../hooks/use-scroll-direction', () => ({
    useScrollDirection: () => 'up',
}));

vi.mock('../../lib/config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

vi.mock('../notifications/index', () => ({
    NotificationBell: () => null,
}));

vi.mock('./ThemeToggle', () => ({
    ThemeToggle: () => null,
}));

vi.mock('./UserMenu', () => ({
    UserMenu: () => null,
}));

const NAV_SLUG = 'test-header-nav-links';
registerPlugin(NAV_SLUG, { icon: 'x', color: 'blue', label: 'Test' })
    .registerSlot('nav:primary-links', () => <a href="/x" data-testid="plugin-nav-link">Plugin</a>);

function renderHeader() {
    return render(
        <MemoryRouter>
            <Header onMenuClick={vi.fn()} />
        </MemoryRouter>,
    );
}

describe('Header — authenticated member', () => {
    it('links to /insights from the desktop nav and the screen-reader mobile link', () => {
        renderHeader();
        const insights = screen.getAllByRole('link', { name: 'Insights' });
        expect(insights).toHaveLength(2);
        for (const link of insights) expect(link).toHaveAttribute('href', '/insights');
        const nav = screen.getByRole('navigation', { name: 'Main navigation' });
        expect(nav).toContainElement(at(insights, 0));
    });

    it('has no "Event Metrics" link', () => {
        renderHeader();
        expect(screen.queryByRole('link', { name: /event metrics/i })).not.toBeInTheDocument();
    });
});

describe('Header — plugin nav links (ROK-1785)', () => {
    it('the bar shows plugin links only from lg, so 768–1023px matches the core-only bar', () => {
        usePluginStore.setState({ activeSlugs: new Set([NAV_SLUG]) });
        renderHeader();
        const link = screen.getByTestId('plugin-nav-link');
        const wrapper = link.parentElement;
        expect(wrapper?.className, 'below lg the plugin slot must render nothing in the bar (Codex P2: md overflow)').toBe('hidden lg:contents');
        usePluginStore.setState({ activeSlugs: new Set() });
    });
});
