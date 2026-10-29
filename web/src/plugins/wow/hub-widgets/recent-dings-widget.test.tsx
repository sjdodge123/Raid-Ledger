/**
 * ROK-1919 — the WoW: Forever "Recent dings" hub widget: empty state + hint,
 * one row per ding (name · "hit N" · relative time), a linked character vs a
 * plain-text name, and the registration (id, order, audience, owner plugin).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GuildPage, WowRecentDingsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import RecentDingsWidget from './recent-dings-widget';
import { recentDingsWidget } from './recent-dings.register';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const URL = 'http://localhost:3000/plugins/wow/guilds/:id/recent-dings';
const HOUR = 3_600_000;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();
const ANA_ID = '11111111-1111-4111-8111-111111111111';

const DINGS: WowRecentDingsDto = {
    dings: [
        { name: 'Ana', characterId: ANA_ID, fromLevel: 38, toLevel: 41, at: ago(2 * HOUR) },
        { name: 'Garrosh', characterId: null, fromLevel: 59, toLevel: 60, at: ago(3 * 24 * HOUR) },
    ],
};

function ctx(): Pick<HubWidgetCtx, 'page'> {
    const page: GuildPage = {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null,
            memberCount: 5, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever' },
        importedBy: null,
        viewer: { role: 'visitor', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
    return { page };
}

function serve(body: WowRecentDingsDto, seen: string[] = []): void {
    server.use(http.get(URL, ({ params }) => {
        seen.push(String(params.id));
        return HttpResponse.json(body);
    }));
}

describe('RecentDingsWidget', () => {
    it('shows the empty line and the re-export hint when no one dinged', async () => {
        serve({ dings: [] });
        renderWithProviders(<RecentDingsWidget {...ctx()} />);
        const empty = await screen.findByTestId('recent-dings-empty');
        expect(empty).toHaveTextContent('No level-ups seen in the last 30 days.');
        expect(empty).toHaveTextContent(/officer re-exports the roster/);
        expect(screen.queryByRole('list', { name: 'Recent dings' })).toBeNull();
    });

    it('lists one row per ding, newest first, with the level reached and a relative time', async () => {
        const seen: string[] = [];
        serve(DINGS, seen);
        renderWithProviders(<RecentDingsWidget {...ctx()} />);
        const list = await screen.findByRole('list', { name: 'Recent dings' });
        const rows = within(list).getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('Ana');
        expect(rows[0]).toHaveTextContent('hit 41');
        expect(rows[0]).toHaveTextContent('2 h ago');
        expect(rows[1]).toHaveTextContent('hit 60');
        expect(rows[1]).toHaveTextContent('3 days ago');
        expect(seen).toEqual(['7']);
    });

    it('titles the time as the roster-export instant, not the real ding time', async () => {
        serve(DINGS);
        renderWithProviders(<RecentDingsWidget {...ctx()} />);
        const time = (await screen.findAllByTestId('recent-ding-time'))[0];
        expect(time).toHaveAttribute('title', expect.stringMatching(/^Seen in the roster export at /));
        expect(time).toHaveAttribute('datetime', DINGS.dings[0]?.at);
    });

    it('links a ding to the character page when linked, plain text otherwise', async () => {
        serve(DINGS);
        renderWithProviders(<RecentDingsWidget {...ctx()} />);
        const list = await screen.findByRole('list', { name: 'Recent dings' });
        expect(within(list).getByRole('link', { name: 'Ana' })).toHaveAttribute('href', `/characters/${ANA_ID}`);
        expect(within(list).queryByRole('link', { name: 'Garrosh' })).toBeNull();
        expect(within(list).getByText('Garrosh')).toHaveAttribute('data-testid', 'guild-member-unlinked');
    });

    it('says so quietly when the feed fails to load', async () => {
        server.use(http.get(URL, () => HttpResponse.json({ message: 'nope' }, { status: 500 })));
        renderWithProviders(<RecentDingsWidget {...ctx()} />);
        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load recent dings.");
    });
});

describe('recentDingsWidget registration', () => {
    it('is the Forever guild-hub card after Dungeon quests, shown to every viewer', () => {
        expect(recentDingsWidget).toMatchObject({
            id: 'forever-recent-dings',
            title: 'Recent dings',
            games: ['world-of-warcraft-forever'],
            kinds: ['wow_guild'],
            order: 49,
            span: 1,
            audience: 'everyone',
        });
        expect(recentDingsWidget.useVisible).toBeUndefined();
    });
});
