/**
 * ROK-1941 — the settings sheet's "Pictures" section: game-server hubs only,
 * Leader / staff only (the sheet's `canManageEditors` gate), a channel Select
 * pre-filled from the mirror channel when unset (OQ2), Save / Remove, and the
 * "Scan the last 21 days" backfill with its summary and 409 state.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildPage as GuildPageDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { PRIVATE_CHANNEL, PUBLIC_CHANNEL } from '../../../test/mocks/guild-discord-handlers';
import { backfillStatus, backfillSummary, mediaChannelState } from '../../../test/mocks/hub-media-channel-handlers';
import type { HubCtx } from '../../../plugins/hub-module';
import { HubSettingsSheet } from './settings-sheet';
import type { HubMediaBackfillStatus, HubMediaChannelState } from './hub-media-channel-api';

const BASE = 'http://localhost:3000/guilds/9';
const PAGE: GuildPageDto = {
    guild: {
        id: 9, gameId: 4, kind: 'game_server', name: 'gamersaloon', region: 'us', realmSlug: null, realmName: null,
        faction: null, memberCount: 3, lastSnapshotAt: null, gameSlug: 'valheim',
    },
    importedBy: null,
    viewer: { role: 'leader', canEdit: true, canManageEditors: true },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};
const RAIDS = { data: undefined, isPending: true } as unknown as HubCtx['raids'];

interface Calls { puts: unknown[]; deletes: number; posts: number }

function serve(state: HubMediaChannelState, backfill: HubMediaBackfillStatus = backfillStatus('idle'), post?: () => Response): Calls {
    const calls: Calls = { puts: [], deletes: 0, posts: 0 };
    server.use(
        http.get(`${BASE}/discord`, () => HttpResponse.json({ state: 'unset' })),
        http.get(`${BASE}/editors`, () => HttpResponse.json({ editors: [] })),
        http.get(`${BASE}/discord/channels`, () => HttpResponse.json({ connected: true, channels: [PUBLIC_CHANNEL, PRIVATE_CHANNEL] })),
        http.get(`${BASE}/media-channel`, () => HttpResponse.json(state)),
        http.put(`${BASE}/media-channel`, async ({ request }) => {
            const body = await request.json(); calls.puts.push(body);
            return HttpResponse.json(mediaChannelState({ channelId: PUBLIC_CHANNEL.id, channelName: PUBLIC_CHANNEL.name }));
        }),
        http.delete(`${BASE}/media-channel`, () => { calls.deletes += 1; return new HttpResponse(null, { status: 204 }); }),
        http.get(`${BASE}/media-channel/backfill`, () => HttpResponse.json(backfill)),
        http.post(`${BASE}/media-channel/backfill`, () => { calls.posts += 1; return post ? post() : HttpResponse.json(backfillStatus('running'), { status: 202 }); }),
    );
    return calls;
}

function renderSheet(page: GuildPageDto = PAGE): void {
    const ctx: HubCtx = { page, raids: RAIDS };
    renderWithProviders(<HubSettingsSheet ctx={ctx} module={undefined} onClose={() => undefined} onChangeChannel={() => undefined} />);
}

const select = (): Promise<HTMLSelectElement> => screen.findByTestId<HTMLSelectElement>('hub-media-channel-select');

describe('Pictures section — who sees it', () => {
    it('renders for a game-server hub Leader', async () => {
        serve(mediaChannelState());
        renderSheet();
        expect(await screen.findByTestId('guild-settings-pictures')).toHaveTextContent('Pictures');
    });

    it('is absent for a viewer who cannot manage editors (officer / member)', async () => {
        serve(mediaChannelState());
        renderSheet({ ...PAGE, viewer: { role: 'officer', canEdit: true, canManageEditors: false } });
        await screen.findByTestId('guild-settings-sheet');
        expect(screen.queryByTestId('guild-settings-pictures')).toBeNull();
    });

    it('is absent for a hub that is not a game server', async () => {
        serve(mediaChannelState());
        renderSheet({ ...PAGE, guild: { ...PAGE.guild, kind: 'wow_guild', gameSlug: 'wow' } });
        await screen.findByTestId('guild-settings-discord');
        expect(screen.queryByTestId('guild-settings-pictures')).toBeNull();
    });
});

describe('Pictures section — the channel', () => {
    it('pre-fills the mirror channel when unset, says so, and one click saves it', async () => {
        const calls = serve(mediaChannelState({ suggestedChannelId: PUBLIC_CHANNEL.id }));
        renderSheet();
        await waitFor(async () => expect((await select()).value).toBe(PUBLIC_CHANNEL.id));
        expect(screen.getByTestId('hub-media-channel-suggested')).toHaveTextContent(/mirrored channel/i);
        await userEvent.click(screen.getByTestId('hub-media-channel-save'));
        await waitFor(() => expect(calls.puts).toEqual([{ channelId: PUBLIC_CHANNEL.id }]));
    });

    it('keeps Save disabled on the bound channel and enables it on a change', async () => {
        serve(mediaChannelState({ channelId: PUBLIC_CHANNEL.id, channelName: 'announcements', setAt: '2026-10-20T10:00:00.000Z' }));
        renderSheet();
        await waitFor(async () => expect((await select()).value).toBe(PUBLIC_CHANNEL.id));
        expect(screen.getByTestId('hub-media-channel-save')).toBeDisabled();
        await userEvent.selectOptions(await select(), PRIVATE_CHANNEL.id);
        expect(screen.getByTestId('hub-media-channel-save')).toBeEnabled();
    });

    it('Remove clears a bound channel', async () => {
        const calls = serve(mediaChannelState({ channelId: PUBLIC_CHANNEL.id, channelName: 'announcements' }));
        renderSheet();
        await userEvent.click(await screen.findByTestId('hub-media-channel-remove'));
        await waitFor(() => expect(calls.deletes).toBe(1));
    });

    it('shows no Remove and no scan while nothing is bound', async () => {
        serve(mediaChannelState());
        renderSheet();
        await select();
        expect(screen.queryByTestId('hub-media-channel-remove')).toBeNull();
        expect(screen.queryByTestId('hub-media-backfill-start')).toBeNull();
    });
});

describe('Pictures section — the 21-day scan', () => {
    const BOUND = mediaChannelState({ channelId: PUBLIC_CHANNEL.id, channelName: 'announcements' });

    it('starts a scan and shows it running', async () => {
        const calls = serve(BOUND);
        renderSheet();
        await userEvent.click(await screen.findByTestId('hub-media-backfill-start'));
        await waitFor(() => expect(calls.posts).toBe(1));
        expect(await screen.findByTestId('hub-media-backfill-status')).toHaveTextContent('Scanning…');
        expect(screen.getByTestId('hub-media-backfill-start')).toBeDisabled();
    });

    it('shows the finished summary counts', async () => {
        serve(BOUND, backfillStatus('done', backfillSummary()));
        renderSheet();
        expect(await screen.findByTestId('hub-media-backfill-status')).toHaveTextContent(
            'Finished. Scanned 40 messages · 12 pictures stored · 3 duplicates · 5 deaths linked · 2 deaths inferred · 1 failed',
        );
    });

    it('a 409 says a scan is already running and shows that run', async () => {
        const job = backfillStatus('running', backfillSummary({ scanned: 7 }));
        serve(BOUND, backfillStatus('idle'), () => HttpResponse.json({ message: 'A backfill is already running', job }, { status: 409 }));
        renderSheet();
        await userEvent.click(await screen.findByTestId('hub-media-backfill-start'));
        expect(await screen.findByTestId('hub-media-backfill-conflict')).toHaveTextContent(/already running/i);
        expect(screen.getByTestId('hub-media-backfill-status')).toHaveTextContent('Scanning… Scanned 7 messages');
    });
});
