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

// ROK-1875: the Hubs item reads `/guilds/mine`; its own spec (hubs-nav-menu.test.tsx) drives the real query.
const hubs = vi.hoisted(() => ({ list: [] as Array<{ id: number; name: string; kind: 'game_server' }> }));
vi.mock('./hub-nav/my-hubs-queries', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./hub-nav/my-hubs-queries')>()),
    useMyGuildsQuery: () => ({ data: { guilds: hubs.list.map((h) => ({ ...h, region: 'us', rankName: null, realmName: null, realmSlug: null, gameIconUrl: null })) } }),
}));

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

vi.mock('../notifications', () => ({
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

describe('Header — the Hubs item (ROK-1870, ROK-1875 operator ruling 2026-10-20)', () => {
    it('no hubs: a plain Hubs link right after Games, pointing at /hubs', () => {
        hubs.list = [];
        renderHeader();
        const nav = screen.getByRole('navigation', { name: 'Main navigation' });
        const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
        expect(labels.slice(0, 5)).toEqual(['Calendar', 'Games', 'Hubs', 'Events', 'Players']);
        expect(screen.getByRole('link', { name: 'Hubs' })).toHaveAttribute('href', '/hubs');
    });

    it('takes the active colour on /hubs like its siblings', () => {
        hubs.list = [];
        render(<MemoryRouter initialEntries={['/hubs']}><Header onMenuClick={vi.fn()} /></MemoryRouter>);
        expect(screen.getByRole('link', { name: 'Hubs' }).className).toContain('text-emerald-400');
        expect(screen.getByRole('link', { name: 'Games' }).className).not.toContain('text-emerald-400');
    });

    it('with hubs: a Hubs menu button between Games and Events, and no separate "Guild" link', () => {
        hubs.list = [{ id: 31, name: 'Valheim — Gamernight', kind: 'game_server' }];
        renderHeader();
        const nav = screen.getByRole('navigation', { name: 'Main navigation' });
        const items = Array.from(nav.querySelectorAll('a, button')).map((el) => el.textContent?.trim());
        expect(items.slice(0, 5)).toEqual(['Calendar', 'Games', 'Hubs', 'Events', 'Players']);
        expect(screen.getByTestId('nav-hubs-menu-trigger')).toHaveAttribute('aria-haspopup', 'menu');
        expect(screen.queryByRole('link', { name: 'Guild' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Guild/ })).not.toBeInTheDocument();
        hubs.list = [];
    });
});
