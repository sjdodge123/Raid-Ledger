/**
 * ROK-1788 (S4) — the editor-only channel picker: private channels hidden
 * until opted in, the acknowledgement gates Save on a private choice, the
 * PUT body, Remove, and server refusals (400 / 403 / 409) shown inline.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildDiscordChannelListDto, GuildDiscordMirrorDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { PRIVATE_CHANNEL, PUBLIC_CHANNEL, okMirror } from '../../../test/mocks/guild-discord-handlers';
import { GuildDiscordMirror } from './guild-discord-mirror';

const BASE = 'http://localhost:3000/plugins/wow/guilds/7/discord';
const LIST: GuildDiscordChannelListDto = { connected: true, channels: [PUBLIC_CHANNEL, PRIVATE_CHANNEL] };

interface Call { method: string; body: unknown }
let calls: Call[] = [];

function serve(mirror: GuildDiscordMirrorDto, list: GuildDiscordChannelListDto = LIST): void {
    server.use(
        http.get(BASE, () => HttpResponse.json(mirror)),
        http.get(`${BASE}/channels`, () => HttpResponse.json(list)),
        http.put(`${BASE}/channel`, async ({ request }) => {
            calls.push({ method: 'PUT', body: await request.json() });
            return HttpResponse.json(okMirror([]));
        }),
        http.delete(`${BASE}/channel`, () => { calls.push({ method: 'DELETE', body: null }); return new HttpResponse(null, { status: 204 }); }),
    );
}

async function openPicker(mirror: GuildDiscordMirrorDto = { state: 'unset' }, list?: GuildDiscordChannelListDto): Promise<void> {
    serve(mirror, list);
    renderWithProviders(<GuildDiscordMirror guildId={7} canEdit />);
    const trigger = await screen.findByTestId(mirror.state === 'unset' ? 'guild-discord-choose' : 'guild-discord-change');
    await userEvent.click(trigger);
    await screen.findByTestId('guild-discord-picker-body');
}

function optionValues(): string[] {
    const select = screen.getByTestId('guild-discord-channel-select');
    return Array.from(select.querySelectorAll('option')).map((o) => o.getAttribute('value') ?? '');
}

beforeEach(() => { calls = []; });

describe('GuildDiscordPicker — private channels', () => {
    it('hides private channels until "Show private channels" is ticked', async () => {
        await openPicker();
        await screen.findByTestId('guild-discord-channel-select');
        expect(optionValues(), 'private channels must start hidden').toEqual(['', PUBLIC_CHANNEL.id]);
        await userEvent.click(screen.getByTestId('guild-discord-show-private'));
        expect(optionValues()).toEqual(['', PUBLIC_CHANNEL.id, PRIVATE_CHANNEL.id]);
    });

    it('needs the acknowledgement before Save, then sends privateAck:true', async () => {
        await openPicker();
        await userEvent.click(await screen.findByTestId('guild-discord-show-private'));
        await userEvent.selectOptions(screen.getByTestId('guild-discord-channel-select'), PRIVATE_CHANNEL.id);
        expect(screen.getByTestId('guild-discord-save'), 'Save must wait for the acknowledgement').toBeDisabled();
        await userEvent.click(screen.getByTestId('guild-discord-private-ack'));
        expect(screen.getByTestId('guild-discord-save')).toBeEnabled();
        await userEvent.click(screen.getByTestId('guild-discord-save'));
        await waitFor(() => expect(calls).toEqual([{ method: 'PUT', body: { channelId: PRIVATE_CHANNEL.id, privateAck: true } }]));
    });

    it('a public choice saves without an acknowledgement or privateAck field', async () => {
        await openPicker();
        await userEvent.selectOptions(await screen.findByTestId('guild-discord-channel-select'), PUBLIC_CHANNEL.id);
        expect(screen.queryByTestId('guild-discord-private-ack')).toBeNull();
        await userEvent.click(screen.getByTestId('guild-discord-save'));
        await waitFor(() => expect(calls).toEqual([{ method: 'PUT', body: { channelId: PUBLIC_CHANNEL.id } }]));
        await waitFor(() => expect(screen.queryByTestId('guild-discord-picker-body'), 'Save closes the picker').toBeNull());
    });
});

describe('GuildDiscordPicker — server name', () => {
    it('the hint names the bot\'s server (Q7)', async () => {
        await openPicker({ state: 'unset' }, { ...LIST, serverName: 'Keepers HQ' });
        await screen.findByTestId('guild-discord-channel-select');
        expect(screen.getByText(/^Channels in/).textContent).toBe('Channels in the Keepers HQ Discord that Raid Ledger can read.');
    });

    it('falls back to "the community Discord" when the server name is unknown', async () => {
        await openPicker();
        await screen.findByTestId('guild-discord-channel-select');
        expect(screen.getByText(/^Channels in/).textContent).toBe('Channels in the community Discord that Raid Ledger can read.');
    });
});

describe('GuildDiscordPicker — server refusals show inline', () => {
    it.each([
        [400, 'Raid Ledger can’t read that channel'],
        [403, 'Your Discord account can’t see that channel'],
        [409, 'The Discord bot isn’t connected right now'],
    ])('a %i keeps the picker open and shows the server message', async (status, message) => {
        await openPicker();
        server.use(http.put(`${BASE}/channel`, () => HttpResponse.json({ message }, { status })));
        await userEvent.selectOptions(await screen.findByTestId('guild-discord-channel-select'), PUBLIC_CHANNEL.id);
        await userEvent.click(screen.getByTestId('guild-discord-save'));
        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(screen.getByTestId('guild-discord-picker-body')).toBeInTheDocument();
    });
});

describe('GuildDiscordPicker — binding and bot state', () => {
    it('Remove channel sends DELETE for a bound channel', async () => {
        await openPicker(okMirror([]));
        await userEvent.click(screen.getByTestId('guild-discord-remove'));
        await waitFor(() => expect(calls).toEqual([{ method: 'DELETE', body: null }]));
    });

    it('an unbound guild offers no Remove', async () => {
        await openPicker();
        expect(screen.queryByTestId('guild-discord-remove')).toBeNull();
    });

    it('a bound private channel stays selected without ticking Show private', async () => {
        await openPicker(okMirror([], PRIVATE_CHANNEL));
        await screen.findByTestId('guild-discord-channel-select');
        expect(screen.getByTestId('guild-discord-channel-select')).toHaveValue(PRIVATE_CHANNEL.id);
        expect(screen.getByTestId('guild-discord-save'), 'nothing changed yet').toBeDisabled();
    });

    it('bot down → the picker says so and offers no channel select', async () => {
        await openPicker({ state: 'unset' }, { connected: false, channels: [] });
        expect(await screen.findByTestId('guild-discord-picker-disconnected')).toBeInTheDocument();
        expect(screen.queryByTestId('guild-discord-channel-select')).toBeNull();
        expect(screen.getByTestId('guild-discord-save')).toBeDisabled();
    });
});
