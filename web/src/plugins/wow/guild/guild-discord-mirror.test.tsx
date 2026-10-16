/**
 * ROK-1788 (S4) — the Overview Discord mirror card: every D9 state renders
 * inside the card, non-editors see nothing while unbound, and the card shows
 * the newest 3 messages with the embed block and the Open-in-Discord link.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GuildDiscordMirrorDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { discordMessage, okMirror } from '../../../test/mocks/guild-discord-handlers';
import { GuildDiscordMirror } from './guild-discord-mirror';

const URL = 'http://localhost:3000/plugins/wow/guilds/7/discord';

function serve(mirror: GuildDiscordMirrorDto): { served: () => boolean } {
    let hit = false;
    server.use(http.get(URL, () => { hit = true; return HttpResponse.json(mirror); }));
    return { served: () => hit };
}

function renderCard(canEdit: boolean): void {
    renderWithProviders(<GuildDiscordMirror guildId={7} canEdit={canEdit} />);
}

describe('GuildDiscordMirror — ok', () => {
    it('shows only the newest 3 of the fetched messages, oldest first', async () => {
        serve(okMirror([1, 2, 3, 4, 5].map((n) => discordMessage(n))));
        renderCard(false);
        const list = await screen.findByTestId('guild-discord-messages');
        const rows = within(list).getAllByTestId('thread-message-row');
        expect(rows.map((r) => within(r).getByText(/^Message number/).textContent)).toEqual(['Message number 3', 'Message number 4', 'Message number 5']);
        expect(screen.getByRole('heading', { name: '#announcements' })).toBeInTheDocument();
    });

    it('names the bot\'s server in the blurb (approved copy)', async () => {
        serve(okMirror([discordMessage(1)], undefined, 'Keepers HQ'));
        renderCard(false);
        await screen.findByRole('heading', { name: '#announcements' });
        expect(screen.getByText(/^Latest from/).textContent).toBe('Latest from the Keepers HQ Discord');
    });

    it('falls back to "the community Discord" when the server name is unknown', async () => {
        serve(okMirror([discordMessage(1)]));
        renderCard(false);
        await screen.findByRole('heading', { name: '#announcements' });
        expect(screen.getByText(/^Latest from/).textContent).toBe('Latest from the community Discord');
    });

    it('links out to the channel in a new tab and says it is read-only', async () => {
        serve(okMirror([discordMessage(1)]));
        renderCard(false);
        const link = await screen.findByTestId('guild-discord-open');
        expect(link).toHaveAttribute('href', 'https://discord.com/channels/333333333333333333/111111111111111111');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(screen.getByText(/Read-only · reply in Discord/)).toBeInTheDocument();
    });

    it('renders the embed title and description inside the message row', async () => {
        serve(okMirror([discordMessage(1, { content: '', embed: { title: 'Raid tonight', description: 'Molten Core 8pm' } })]));
        renderCard(false);
        const embed = await screen.findByTestId('guild-discord-embed');
        expect(embed).toHaveTextContent('Raid tonight');
        expect(embed).toHaveTextContent('Molten Core 8pm');
        expect(screen.getByTestId('thread-message-row')).toContainElement(embed);
    });

    it('shows an in-card empty state when the channel has no messages', async () => {
        serve(okMirror([]));
        renderCard(false);
        expect(await screen.findByTestId('guild-discord-state-empty')).toHaveTextContent('No messages in #announcements yet.');
        expect(screen.getByTestId('guild-discord-open')).toBeInTheDocument();
    });
});

describe('GuildDiscordMirror — unset', () => {
    it('renders nothing for a non-editor', async () => {
        const { served } = serve({ state: 'unset' });
        renderCard(false);
        await waitFor(() => expect(served(), 'the mirror must have been requested').toBe(true));
        await waitFor(() => expect(screen.queryByTestId('guild-discord-mirror'), 'a non-editor must not see an unbound card').toBeNull());
        expect(screen.queryByTestId('guild-discord-state-unset')).toBeNull();
    });

    it('prompts an editor to choose a channel, with no Change button', async () => {
        serve({ state: 'unset' });
        renderCard(true);
        expect(await screen.findByTestId('guild-discord-state-unset')).toHaveTextContent('Pick a Discord channel');
        expect(screen.getByTestId('guild-discord-choose')).toBeInTheDocument();
        expect(screen.queryByTestId('guild-discord-change')).toBeNull();
    });
});

describe('GuildDiscordMirror — degraded states stay inside the card', () => {
    it('bot down → quiet disconnected state', async () => {
        serve({ state: 'disconnected', channelId: '111111111111111111' });
        renderCard(false);
        const state = await screen.findByTestId('guild-discord-state-disconnected');
        expect(state).toHaveTextContent('Discord isn’t connected right now');
        expect(screen.getByTestId('guild-discord-mirror')).toContainElement(state);
    });

    it('access lost → warning banner naming the channel; editors can change it', async () => {
        serve({ state: 'no-access', channelId: '111111111111111111', channelName: 'announcements' });
        renderCard(true);
        expect(await screen.findByTestId('guild-discord-state-no-access')).toHaveTextContent('Raid Ledger can no longer read #announcements.');
        expect(screen.getByTestId('guild-discord-change')).toBeInTheDocument();
    });

    it('access lost → a non-editor gets the banner but no Change button', async () => {
        serve({ state: 'no-access', channelId: '111111111111111111', channelName: null });
        renderCard(false);
        expect(await screen.findByTestId('guild-discord-state-no-access')).toHaveTextContent('Raid Ledger can no longer read this channel.');
        expect(screen.queryByTestId('guild-discord-change')).toBeNull();
    });

    it('channel deleted → gone banner', async () => {
        serve({ state: 'gone', channelId: '111111111111111111', channelName: 'old-news' });
        renderCard(false);
        expect(await screen.findByTestId('guild-discord-state-gone')).toHaveTextContent('#old-news no longer exists in Discord.');
    });

    it('a failed request renders an in-card error, not an error page', async () => {
        server.use(http.get(URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        renderCard(false);
        const error = await screen.findByTestId('guild-discord-error');
        expect(screen.getByTestId('guild-discord-mirror')).toContainElement(error);
    });
});
