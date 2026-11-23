/**
 * ROK-2208 Q10 (option c, RULED) — the unbound "Discord forum" form:
 * shared `#event-planning` vs the hub's own channel, the preflight Ready /
 * Missing line (once, for the picked forum too), the acknowledgement
 * reset on every change of channel, the bot-offline state and
 * every bind error code the api answers with.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    forumDiscordBinding, forumDiscordChannel, forumDiscordPreflight, forumDiscordShared,
} from '../../../test/mocks/hub-forum-discord-handlers';
import type { HubForumDiscordChannelOption, HubForumDiscordPreflight } from './hub-forum-discord-api';
import { HubForumDiscordSection } from './hub-forum-discord-section';

const BASE = 'http://localhost:3000/guilds/9';
const OWN_ID = '323456789012345678';

interface Calls { puts: unknown[]; channelGets: number }

function serve(preflight: HubForumDiscordPreflight, channels: HubForumDiscordChannelOption[] = [], put?: () => Response): Calls {
    const calls: Calls = { puts: [], channelGets: 0 };
    server.use(
        http.get(`${BASE}/forum-discord`, () => HttpResponse.json({ binding: null })),
        http.get(`${BASE}/forum-discord/preflight`, () => HttpResponse.json(preflight)),
        http.get(`${BASE}/forum-discord/channels`, () => { calls.channelGets += 1; return HttpResponse.json({ channels }); }),
        http.put(`${BASE}/forum-discord`, async ({ request }) => {
            calls.puts.push(await request.json());
            return put ? put() : HttpResponse.json({ binding: forumDiscordBinding() });
        }),
    );
    return calls;
}

const refuse = (status: number, body: Record<string, unknown>) => (): Response => HttpResponse.json(body, { status });

function renderForm(): void {
    renderWithProviders(<HubForumDiscordSection guildId={9} canManage />);
}

async function tickAndTurnOn(): Promise<void> {
    await userEvent.click(await screen.findByTestId('hub-forum-discord-ack'));
    await userEvent.click(screen.getByTestId('hub-forum-discord-turn-on'));
}

async function pickOwn(): Promise<void> {
    await userEvent.click(await screen.findByRole('radio', { name: /This hub’s own channel/ }));
}

describe('Discord forum form — shared vs own (Q10 c)', () => {
    it('preselects the shared #event-planning and joins it with target shared', async () => {
        const calls = serve(forumDiscordPreflight());
        renderForm();
        expect(await screen.findByRole('radio', { name: /Shared server forum/ })).toBeChecked();
        expect(screen.getByTestId('hub-forum-discord-ack')).toHaveAccessibleName(/#event-planning/);
        await tickAndTurnOn();
        await waitFor(() => expect(calls.puts).toEqual([{ mode: 'create', target: 'shared', ack: true }]));
    });
    it('defaults the own forum name to the hub and sends the edited name', async () => {
        const calls = serve(forumDiscordPreflight());
        renderForm();
        await pickOwn();
        const name = screen.getByTestId<HTMLInputElement>('hub-forum-discord-name');
        expect(name.value).toBe('saloon');
        expect(screen.getByTestId('hub-forum-discord-ack')).toHaveAccessibleName(/#saloon/);
        await userEvent.clear(name);
        await userEvent.type(name, 'base-raids');
        await tickAndTurnOn();
        await waitFor(() => expect(calls.puts).toEqual([{ mode: 'create', target: 'own', name: 'base-raids', ack: true }]));
    });
    it('disables a full shared forum, says why, and preselects the own channel', async () => {
        serve(forumDiscordPreflight({ shared: forumDiscordShared({ tagsUsed: 20, tagsFree: 0, sharedWith: 19 }) }));
        renderForm();
        const shared = await screen.findByRole('radio', { name: /Shared server forum/ });
        expect(shared).toBeDisabled();
        expect(screen.getByRole('radio', { name: /This hub’s own channel/ })).toBeChecked();
        expect(screen.getByText(/maximum of 20 tags/)).toBeInTheDocument();
    });
});

describe('Discord forum form — the acknowledgement follows the channel', () => {
    it('clears the tick when the admin switches target, mode or forum', async () => {
        serve(forumDiscordPreflight(), [
            forumDiscordChannel({ id: OWN_ID, name: 'raids', sharedWith: 0, missingPermissions: [] }),
            forumDiscordChannel({ id: '423456789012345678', name: 'ok-forum', sharedWith: 0, missingPermissions: [] }),
        ]);
        renderForm();
        const ack = await screen.findByTestId('hub-forum-discord-ack');
        const turnOn = screen.getByTestId('hub-forum-discord-turn-on');
        await userEvent.click(ack);
        expect(turnOn).toBeEnabled();
        await pickOwn();
        expect(ack).not.toBeChecked();
        expect(turnOn).toBeDisabled();
        await userEvent.click(ack);
        await userEvent.click(screen.getByRole('radio', { name: 'Use an existing forum' }));
        expect(ack).not.toBeChecked();
        const select = await screen.findByTestId('hub-forum-discord-channel');
        await userEvent.selectOptions(select, OWN_ID);
        await userEvent.click(ack);
        expect(turnOn).toBeEnabled();
        await userEvent.selectOptions(select, '423456789012345678');
        expect(ack).not.toBeChecked();
        expect(turnOn).toBeDisabled();
    });
    it('starts "Use an existing forum" with no forum picked and Turn on disabled', async () => {
        const calls = serve(forumDiscordPreflight(), [forumDiscordChannel({ id: OWN_ID, name: 'raids', sharedWith: 0, missingPermissions: [] })]);
        renderForm();
        await pickOwn();
        await userEvent.click(screen.getByRole('radio', { name: 'Use an existing forum' }));
        const select = await screen.findByTestId<HTMLSelectElement>('hub-forum-discord-channel');
        expect(select.value).toBe('');
        await userEvent.click(screen.getByTestId('hub-forum-discord-ack'));
        expect(screen.getByTestId('hub-forum-discord-turn-on')).toBeDisabled();
        await userEvent.selectOptions(select, OWN_ID);
        await tickAndTurnOn();
        await waitFor(() => expect(calls.puts).toEqual([{ mode: 'existing', channelId: OWN_ID, ack: true }]));
    });
});

describe('Discord forum form — permissions and the bot', () => {
    it('shows the picked forum\'s Missing once, on the preflight line, and blocks it', async () => {
        serve(forumDiscordPreflight(), [
            forumDiscordChannel({ id: OWN_ID, name: 'raids', sharedWith: 0, missingPermissions: ['Manage Webhooks'] }),
            forumDiscordChannel({ id: '423456789012345678', name: 'ok-forum', sharedWith: 0, missingPermissions: [] }),
        ]);
        renderForm();
        await pickOwn();
        await userEvent.click(screen.getByRole('radio', { name: 'Use an existing forum' }));
        const select = await screen.findByTestId('hub-forum-discord-channel');
        await userEvent.selectOptions(select, OWN_ID);
        expect(screen.getByTestId('hub-forum-discord-preflight')).toHaveTextContent(/Missing.*Manage Webhooks/);
        expect(screen.getAllByText('Missing')).toHaveLength(1);
        expect(screen.getAllByText(/The bot is missing Manage Webhooks/)).toHaveLength(1);
        expect(screen.queryByTestId('hub-forum-discord-option-status')).not.toBeInTheDocument();
        await userEvent.click(screen.getByTestId('hub-forum-discord-ack'));
        expect(screen.getByTestId('hub-forum-discord-turn-on')).toBeDisabled();
        await userEvent.selectOptions(select, '423456789012345678');
        expect(screen.getByTestId('hub-forum-discord-preflight')).toHaveTextContent('Ready');
        await userEvent.click(screen.getByTestId('hub-forum-discord-ack'));
        expect(screen.getByTestId('hub-forum-discord-turn-on')).toBeEnabled();
    });
    it('shows a Missing preflight line and blocks creating while the bot lacks a permission', async () => {
        serve(forumDiscordPreflight({ missingToCreate: ['Manage Channels'] }));
        renderForm();
        await pickOwn();
        expect(screen.getByTestId('hub-forum-discord-preflight')).toHaveTextContent(/Missing.*Manage Channels/);
        await userEvent.click(screen.getByTestId('hub-forum-discord-ack'));
        expect(screen.getByTestId('hub-forum-discord-turn-on')).toBeDisabled();
    });
    it('shows the bot offline, disables the form and never asks for the channel list', async () => {
        const calls = serve({ botOnline: false, missingToCreate: [], suggestedName: 'saloon', shared: null });
        renderForm();
        expect(await screen.findByTestId('hub-forum-discord-offline')).toHaveTextContent(/bot is offline/);
        expect(screen.getByTestId('hub-forum-discord-turn-on')).toBeDisabled();
        expect(calls.channelGets).toBe(0);
    });
});

describe('Discord forum form — bind errors', () => {
    it('explains a private forum (409 FORUM_DISCORD_CHANNEL_PRIVATE)', async () => {
        serve(forumDiscordPreflight(), [], refuse(409, { code: 'FORUM_DISCORD_CHANNEL_PRIVATE', message: 'x' }));
        renderForm();
        await tickAndTurnOn();
        expect(await screen.findByTestId('hub-forum-discord-bind-error')).toHaveTextContent('This forum is private in Discord');
    });
    it('shows a reserved own-forum name inline on the name field (400 FORUM_DISCORD_NAME_RESERVED)', async () => {
        serve(forumDiscordPreflight(), [], refuse(400, { code: 'FORUM_DISCORD_NAME_RESERVED', message: 'x' }));
        renderForm();
        await pickOwn();
        await tickAndTurnOn();
        await waitFor(() => expect(screen.getByTestId('hub-forum-discord-name')).toHaveAttribute('aria-invalid', 'true'));
        expect(screen.getByTestId('hub-forum-discord-name')).toHaveAccessibleDescription(/#event-planning is the shared forum/);
        expect(screen.queryByTestId('hub-forum-discord-bind-error')).not.toBeInTheDocument();
    });
    it.each([
        [409, { code: 'FORUM_DISCORD_TAG_LIMIT', message: 'x' }, /maximum of 20 tags/],
        [422, { code: 'FORUM_DISCORD_MISSING_PERMS', message: 'x', missing: ['ManageWebhooks'] }, /missing Manage Webhooks/],
        [503, { code: 'DISCORD_BOT_OFFLINE', message: 'x' }, /bot is offline/],
    ])('renders %i %o as plain words', async (status, body, text) => {
        serve(forumDiscordPreflight(), [], refuse(status, body));
        renderForm();
        await tickAndTurnOn();
        expect(await screen.findByTestId('hub-forum-discord-bind-error')).toHaveTextContent(text);
    });
});
