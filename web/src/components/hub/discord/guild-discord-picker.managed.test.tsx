/**
 * ROK-1428 (W8 UI) — an auto-linked channel opens preselected with the
 * "Created by Raid Ledger for <Game>" hint; a manual binding has no hint;
 * choosing another channel drops the hint (the save makes it manual).
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildDiscordChannelOptionDto, GuildDiscordMirrorDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { PRIVATE_CHANNEL, PUBLIC_CHANNEL, okMirror } from '../../../test/mocks/guild-discord-handlers';
import { HubDiscordPickerMount } from './discord-picker-mount';

const OTHER: GuildDiscordChannelOptionDto = { ...PRIVATE_CHANNEL, id: '444444444444444444', name: 'lounge', visibility: 'public' };
const HINT = 'Created by Raid Ledger for BG3. Pick another channel to override.';

function serve(mirror: GuildDiscordMirrorDto): void {
    server.use(
        http.get('http://localhost:3000/guilds/7/discord', () => HttpResponse.json(mirror)),
        http.get('http://localhost:3000/guilds/7/discord/channels', () =>
            HttpResponse.json({ connected: true, channels: [PUBLIC_CHANNEL, OTHER] })),
    );
}

/** An `ok` mirror carrying the ROK-1428 source fields. */
function sourced(channelSource: 'auto' | 'manual', gameName: string | null): GuildDiscordMirrorDto {
    const base = okMirror([]);
    if (base.state !== 'ok') throw new Error('okMirror must be ok');
    return { ...base, channelSource, managedFor: gameName ? { gameId: 1, gameName } : null };
}

describe('GuildDiscordPicker managed hint (ROK-1428 W8)', () => {
    it('preselects the auto channel with the hint; picking another drops it', async () => {
        serve(sourced('auto', 'BG3'));
        renderWithProviders(<HubDiscordPickerMount guildId={7} onClose={() => {}} />);
        const select = await screen.findByTestId('guild-discord-channel-select');
        expect(select).toHaveValue(PUBLIC_CHANNEL.id);
        expect(screen.getByText(HINT)).toBeInTheDocument();
        await userEvent.selectOptions(select, OTHER.id);
        expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    });

    it('a manual binding shows no hint', async () => {
        serve(sourced('manual', null));
        renderWithProviders(<HubDiscordPickerMount guildId={7} onClose={() => {}} />);
        expect(await screen.findByTestId('guild-discord-channel-select')).toHaveValue(PUBLIC_CHANNEL.id);
        expect(screen.queryByTestId('guild-discord-managed-hint')).not.toBeInTheDocument();
    });
});
