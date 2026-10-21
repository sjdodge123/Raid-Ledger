/**
 * ROK-1875 (operator ruling 2026-10-21) — the phone bottom bar: five even
 * slots, Calendar · Events · (Hubs) · Games · Players. The raised centre Hubs
 * circle opens a "Your hubs" sheet for a hub member, and is a plain link to
 * /hubs while the viewer has no hubs or the list is still loading / failed (D1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildKind, MyGuild } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { BottomTabBar, TAB_BAR_HIDDEN_CLASS } from './bottom-tab-bar';

const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock('../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../hooks/use-auth')>()),
    useAuth: () => (auth.signedIn ? { user: { id: 1, role: 'member' }, isAuthenticated: true } : { user: null, isAuthenticated: false }),
}));

const MINE = 'http://localhost:3000/guilds/mine';

function hub(id: number, name: string, kind: GuildKind): MyGuild {
    return {
        id, gameId: 7, kind, name, region: kind === 'game_community' ? 'community' : 'us', realmSlug: null, realmName: null,
        faction: null, memberCount: 3, lastSnapshotAt: null, rankIndex: null, rankName: null, canEdit: false, gmPostHeadline: null,
    };
}
const TWO = [hub(31, 'Valheim — Gamernight', 'game_server'), hub(21, 'BG3 Crew', 'game_community')];

function serve(guilds: MyGuild[]): void {
    server.use(http.get(MINE, () => HttpResponse.json({ guilds })));
}

function settled(): Promise<void> {
    return new Promise((resolve) => {
        server.events.on('response:mocked', ({ request }) => { if (request.url.includes('/guilds/mine')) resolve(); });
    });
}

function renderBar(path = '/calendar'): void {
    renderWithProviders(<BottomTabBar />, { initialEntries: [path] });
}

beforeEach(() => { server.events.removeAllListeners(); auth.signedIn = true; });

describe('BottomTabBar — five even slots', () => {
    it('renders Calendar · Events · Hubs · Games · Players in order on a 5-column grid', async () => {
        serve([]);
        renderBar();
        const grid = screen.getByTestId('bottom-tab-grid');
        expect(grid.className).toContain('grid-cols-5');
        const slots = Array.from(grid.children);
        expect(slots).toHaveLength(5);
        expect(slots.map((s) => s.textContent)).toEqual(['Calendar', 'Events', 'Hubs', 'Games', 'Players']);
        expect(within(slots[2] as HTMLElement).getByTestId('bottom-hubs-circle'), 'the Hubs circle sits in the middle slot').toBeInTheDocument();
    });

    it('each slot fills its column (no fixed min width that could overflow at 320px)', () => {
        serve([]);
        renderBar();
        for (const slot of Array.from(screen.getByTestId('bottom-tab-grid').children)) {
            expect(slot.className, `slot "${slot.textContent}"`).not.toMatch(/min-w-\[/);
        }
    });

    it('the circle is at least 48px (w-14 h-14)', async () => {
        serve([]);
        renderBar();
        const circle = screen.getByTestId('bottom-hubs-circle');
        expect(circle.className).toContain('h-14');
        expect(circle.className).toContain('w-14');
    });

    it('the hidden bar slides far enough to tuck the raised circle away too', () => {
        expect(TAB_BAR_HIDDEN_CLASS).toMatch(/translate-y-\[calc\(100%\+/);
    });
});

describe('BottomTabBar — the centre Hubs button', () => {
    it('no hubs → a plain link to /hubs, no sheet trigger', async () => {
        serve([]);
        const done = settled();
        renderBar();
        await done;
        const link = await screen.findByTestId('bottom-hubs-link');
        expect(link).toHaveAttribute('href', '/hubs');
        expect(link).toHaveAttribute('aria-label', 'Hubs');
        expect(screen.queryByTestId('bottom-hubs-trigger')).toBeNull();
    });

    it('a hub member → a dialog trigger; tapping it opens "Your hubs" with the rows, then Browse all hubs', async () => {
        serve(TWO);
        renderBar();
        const trigger = await screen.findByTestId('bottom-hubs-trigger');
        expect(trigger).toHaveAttribute('aria-label', 'Hubs');
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(trigger);
        const sheet = await screen.findByRole('dialog', { name: 'Your hubs' });
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const rows = within(sheet).getAllByTestId('guild-entry-row');
        expect(rows.map((r) => r.getAttribute('href'))).toEqual(['/guilds/31', '/guilds/21']);
        expect(within(sheet).getAllByTestId('hub-kind-chip').map((c) => c.textContent)).toEqual(['Server', 'Community']);
        expect(within(sheet).getByTestId('bottom-hubs-browse-all')).toHaveAttribute('href', '/hubs');
    });

    it('tapping a row closes the sheet', async () => {
        serve(TWO);
        renderBar();
        await userEvent.click(await screen.findByTestId('bottom-hubs-trigger'));
        const sheet = await screen.findByRole('dialog', { name: 'Your hubs' });
        await userEvent.click(within(sheet).getAllByTestId('guild-entry-row')[0] as HTMLElement);
        await waitFor(() => expect(screen.getByTestId('bottom-hubs-trigger')).toHaveAttribute('aria-expanded', 'false'));
    });

    it('tapping Browse all hubs closes the sheet', async () => {
        serve(TWO);
        renderBar();
        await userEvent.click(await screen.findByTestId('bottom-hubs-trigger'));
        await userEvent.click(await screen.findByTestId('bottom-hubs-browse-all'));
        await waitFor(() => expect(screen.getByTestId('bottom-hubs-trigger')).toHaveAttribute('aria-expanded', 'false'));
    });

    it('open → close: the still-mounted sheet\'s links leave the accessibility tree (Codex r4)', async () => {
        serve(TWO);
        renderBar();
        await userEvent.click(await screen.findByTestId('bottom-hubs-trigger'));
        const sheet = await screen.findByRole('dialog', { name: 'Your hubs' });
        expect(within(sheet).getAllByRole('link').length, 'open sheet exposes its links').toBeGreaterThan(0);
        await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
        await waitFor(() => expect(screen.getByTestId('bottom-hubs-trigger')).toHaveAttribute('aria-expanded', 'false'));
        expect(screen.getByTestId('bottom-hubs-sheet'), 'the sheet stays mounted after close').toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /Browse all hubs/ }), 'closed sheet: Browse all hubs is not reachable').toBeNull();
        expect(screen.queryByRole('link', { name: /Valheim — Gamernight/ }), 'closed sheet: hub rows are not reachable').toBeNull();
        expect(screen.queryByRole('button', { name: 'Close' }), 'closed sheet: Close is not reachable').toBeNull();
    });

    it('is active (aria-current="page") on a hub page and on /hubs, not elsewhere', async () => {
        serve(TWO);
        renderBar('/guilds/31');
        expect(await screen.findByTestId('bottom-hubs-trigger')).toHaveAttribute('aria-current', 'page');
    });

    it('is not active on /calendar', async () => {
        serve([]);
        const done = settled();
        renderBar('/calendar');
        await done;
        expect(await screen.findByTestId('bottom-hubs-link')).not.toHaveAttribute('aria-current');
    });
});

describe('BottomTabBar — signed out', () => {
    it('has no Hubs slot: four tabs on a 4-column grid (parity with the header and the More drawer)', () => {
        auth.signedIn = false;
        renderBar();
        const grid = screen.getByTestId('bottom-tab-grid');
        expect(grid.className).toContain('grid-cols-4');
        expect(Array.from(grid.children).map((s) => s.textContent)).toEqual(['Calendar', 'Events', 'Games', 'Players']);
        expect(screen.queryByRole('link', { name: 'Hubs', exact: true })).not.toBeInTheDocument();
        expect(screen.queryByTestId('bottom-hubs-circle')).not.toBeInTheDocument();
    });
});
