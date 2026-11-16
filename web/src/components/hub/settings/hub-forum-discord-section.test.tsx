/**
 * ROK-2208 S3 — the settings sheet's "Discord forum" section: §6 visibility
 * (members never, Officers read-only, a non-community Leader read-only),
 * the opt-in form (Q10: shared #hub-forums preselected, full forum disabled,
 * Turn on gated by the acknowledgement), the bound state and Unlink.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildPage as GuildPageDto, HubForumDiscordStatus } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { forumDiscordBinding, forumDiscordChannel } from '../../../test/mocks/hub-forum-discord-handlers';
import type { HubCtx } from '../../../plugins/hub-module';
import type { HubForumDiscordChannelOption } from './hub-forum-discord-api';
import { HubSettingsSheet } from './settings-sheet';

const BASE = 'http://localhost:3000/guilds/9';
const LEADER = { role: 'leader', canEdit: true, canManageEditors: true } as const;
const OFFICER = { role: 'officer', canEdit: true, canManageEditors: false } as const;

function page(kind: GuildPageDto['guild']['kind'], viewer: GuildPageDto['viewer']): GuildPageDto {
    return {
        guild: { id: 9, gameId: 4, kind, name: 'saloon', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 3, lastSnapshotAt: null, gameSlug: 'valheim' },
        importedBy: null, viewer, ranks: [], roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

interface Calls { puts: unknown[]; deletes: string[] }

function serve(status: HubForumDiscordStatus, channels: HubForumDiscordChannelOption[] = [], put?: () => Response): Calls {
    const calls: Calls = { puts: [], deletes: [] };
    server.use(
        http.get(`${BASE}/discord`, () => HttpResponse.json({ state: 'unset' })),
        http.get(`${BASE}/editors`, () => HttpResponse.json({ editors: [] })),
        http.get(`${BASE}/forum-discord`, () => HttpResponse.json(status)),
        http.get(`${BASE}/forum-discord/channels`, () => HttpResponse.json({ channels })),
        http.put(`${BASE}/forum-discord`, async ({ request }) => {
            calls.puts.push(await request.json());
            return put ? put() : HttpResponse.json({ binding: forumDiscordBinding() });
        }),
        http.delete(`${BASE}/forum-discord`, ({ request }) => { calls.deletes.push(new URL(request.url).search); return new HttpResponse(null, { status: 204 }); }),
    );
    return calls;
}

function renderSheet(p: GuildPageDto): void {
    const ctx: HubCtx = { page: p, raids: { data: undefined, isPending: true } as unknown as HubCtx['raids'] };
    renderWithProviders(<HubSettingsSheet ctx={ctx} module={undefined} onClose={() => undefined} onChangeChannel={() => undefined} />);
}

const section = (): Promise<HTMLElement> => screen.findByTestId('guild-settings-forum-discord');

describe('Discord forum section — who sees what (§6)', () => {
    it('is hidden from a member', async () => {
        serve({ binding: null });
        renderSheet(page('game_community', { role: 'member', canEdit: false, canManageEditors: false }));
        await waitFor(() => expect(screen.getByTestId('guild-settings-sheet')).toBeInTheDocument());
        expect(screen.queryByTestId('guild-settings-forum-discord')).not.toBeInTheDocument();
    });
    it('shows an Officer the status read-only', async () => {
        serve({ binding: forumDiscordBinding() });
        renderSheet(page('game_community', OFFICER));
        expect(await within(await section()).findByTestId('hub-forum-discord-channel-name')).toHaveTextContent('#hub-forums');
        expect(screen.queryByTestId('hub-forum-discord-unlink')).not.toBeInTheDocument();
    });
    it('gives a non-community Leader (not staff) no form', async () => {
        serve({ binding: null }, [forumDiscordChannel()]);
        renderSheet(page('game_server', LEADER));
        expect(await screen.findByTestId('hub-forum-discord-off')).toHaveTextContent('Ask server staff to turn it on.');
        expect(screen.queryByTestId('hub-forum-discord-form')).not.toBeInTheDocument();
    });
});

describe('Discord forum section — turning it on', () => {
    it('joins the shared #hub-forums once the box is ticked (Q10 c)', async () => {
        const calls = serve({ binding: null }, [forumDiscordChannel()]);
        renderSheet(page('game_community', LEADER));
        const turnOn = await screen.findByTestId('hub-forum-discord-turn-on');
        expect(screen.getByRole('radio', { name: /Shared server forum/ })).toBeChecked();
        expect(turnOn).toBeDisabled();
        await userEvent.click(screen.getByTestId('hub-forum-discord-ack'));
        await userEvent.click(turnOn);
        await waitFor(() => expect(calls.puts).toEqual([{ mode: 'create', target: 'shared', ack: true }]));
    });
    it('shows the server’s refusal inline', async () => {
        serve({ binding: null }, [forumDiscordChannel()], () => HttpResponse.json({ message: 'The Discord bot is offline.' }, { status: 503 }));
        renderSheet(page('game_community', LEADER));
        await userEvent.click(await screen.findByTestId('hub-forum-discord-ack'));
        await userEvent.click(screen.getByTestId('hub-forum-discord-turn-on'));
        expect(await screen.findByTestId('hub-forum-discord-bind-error')).toHaveTextContent('The Discord bot is offline.');
    });
});

describe('Discord forum section — bound', () => {
    it('unlinks and deletes a bot-made, unshared forum when asked', async () => {
        const calls = serve({ binding: forumDiscordBinding() });
        renderSheet(page('game_community', LEADER));
        await userEvent.click(await screen.findByTestId('hub-forum-discord-unlink'));
        await userEvent.click(await screen.findByTestId('hub-forum-discord-also-delete'));
        await userEvent.click(screen.getByTestId('hub-forum-discord-unlink-confirm'));
        await waitFor(() => expect(calls.deletes).toEqual(['?deleteForum=true']));
    });
    it('names the share and never offers deleting a shared forum', async () => {
        serve({ binding: forumDiscordBinding({ shared: true, sharedWith: 2, tagName: 'Saloon' }) });
        renderSheet(page('game_community', LEADER));
        expect(await screen.findByTestId('hub-forum-discord-shared')).toHaveTextContent('Shared with 2 other hubs · tag Saloon');
        await userEvent.click(screen.getByTestId('hub-forum-discord-unlink'));
        await screen.findByTestId('hub-forum-discord-unlink-dialog');
        expect(screen.queryByTestId('hub-forum-discord-also-delete')).not.toBeInTheDocument();
    });
    it('labels the chip from health and still lets a Leader unlink while the bot is offline', async () => {
        const calls = serve({ binding: forumDiscordBinding({ health: 'bot-offline' }) });
        renderSheet(page('game_community', LEADER));
        expect(await screen.findByTestId('hub-forum-discord-state')).toHaveTextContent('Paused: bot offline');
        await userEvent.click(screen.getByTestId('hub-forum-discord-unlink'));
        await screen.findByTestId('hub-forum-discord-unlink-dialog');
        expect(screen.queryByTestId('hub-forum-discord-also-delete')).not.toBeInTheDocument();
        await userEvent.click(screen.getByTestId('hub-forum-discord-unlink-confirm'));
        await waitFor(() => expect(calls.deletes).toEqual(['']));
    });
    it('lists missing bot permissions in a banner', async () => {
        serve({ binding: forumDiscordBinding({ health: 'missing-perms', missingPermissions: ['ManageWebhooks', 'ManageThreads'] }) });
        renderSheet(page('game_community', LEADER));
        expect(await screen.findByTestId('hub-forum-discord-health')).toHaveTextContent('Manage Webhooks, Manage Threads');
    });
});
