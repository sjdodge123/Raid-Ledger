/**
 * ROK-1788 D11 — the mirror refetches every 60s only while the tab is
 * visible; plus the pure helpers behind the card and picker.
 */
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { buildHubPostComposer } from '../../../test/factories/hub-posts';
import { useHubPostComposer } from '../posts/use-hub-posts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PRIVATE_CHANNEL, PUBLIC_CHANNEL, discordMessage } from '../../../test/mocks/guild-discord-handlers';
import { canSaveChoice, latestMessages, visibleChannels } from './guild-discord.helpers';
import {
    GUILD_DISCORD_REFRESH_MS, guildDiscordKey, useClearGuildDiscordChannel, useGuildDiscord, useSetGuildDiscordChannel,
} from './use-guild-discord';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useViewerCacheScope: () => 1,
}));

describe('useGuildDiscord refresh', () => {
    it('polls every 60s, never in a background tab', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
        const { result } = renderHook(() => useGuildDiscord(7), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        const query = client.getQueryCache().find({ queryKey: [...guildDiscordKey(7), 1] });
        expect(query?.options).toMatchObject({ refetchInterval: GUILD_DISCORD_REFRESH_MS, refetchIntervalInBackground: false, staleTime: GUILD_DISCORD_REFRESH_MS });
        expect(GUILD_DISCORD_REFRESH_MS).toBe(60_000);
    });
});

/** Mount the composer query beside both channel mutations; count composer GETs. */
function mountComposerWithMutations() {
    let composerGets = 0;
    server.use(
        http.get('http://localhost:3000/guilds/7/posts/composer', () => {
            composerGets++;
            return HttpResponse.json(buildHubPostComposer());
        }),
        http.put('http://localhost:3000/guilds/7/discord/channel', () => HttpResponse.json({ state: 'unset' })),
        http.delete('http://localhost:3000/guilds/7/discord/channel', () => new HttpResponse(null, { status: 204 })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const hook = renderHook(() => ({
        composer: useHubPostComposer(7, true),
        bind: useSetGuildDiscordChannel(7),
        unbind: useClearGuildDiscordChannel(7),
    }), { wrapper });
    return { hook, gets: () => composerGets };
}

describe('channel bind / unbind refresh the post composer (Codex r8)', () => {
    it('binding a channel refetches the composer query', async () => {
        const { hook, gets } = mountComposerWithMutations();
        await waitFor(() => expect(hook.result.current.composer.isSuccess).toBe(true));
        expect(gets()).toBe(1);
        await act(() => hook.result.current.bind.mutateAsync({ channelId: '900' }));
        await waitFor(() => expect(gets(), 'composer GETs after a bind').toBe(2));
    });

    it('unbinding a channel refetches the composer query', async () => {
        const { hook, gets } = mountComposerWithMutations();
        await waitFor(() => expect(hook.result.current.composer.isSuccess).toBe(true));
        await act(() => hook.result.current.unbind.mutateAsync());
        await waitFor(() => expect(gets(), 'composer GETs after an unbind').toBe(2));
    });
});

describe('guild-discord helpers', () => {
    it('latestMessages keeps the newest n, oldest first', () => {
        const ids = latestMessages([1, 2, 3, 4].map((n) => discordMessage(n))).map((m) => m.content);
        expect(ids).toEqual(['Message number 2', 'Message number 3', 'Message number 4']);
        expect(latestMessages([discordMessage(1)])).toHaveLength(1);
    });

    it('visibleChannels hides private unless opted in or currently chosen', () => {
        const all = [PUBLIC_CHANNEL, PRIVATE_CHANNEL];
        expect(visibleChannels(all, false)).toEqual([PUBLIC_CHANNEL]);
        expect(visibleChannels(all, true)).toEqual(all);
        expect(visibleChannels(all, false, PRIVATE_CHANNEL.id)).toEqual(all);
    });

    it('canSaveChoice needs a choice, and the ack for a private one', () => {
        expect(canSaveChoice(undefined, true)).toBe(false);
        expect(canSaveChoice(PUBLIC_CHANNEL, false)).toBe(true);
        expect(canSaveChoice(PRIVATE_CHANNEL, false)).toBe(false);
        expect(canSaveChoice(PRIVATE_CHANNEL, true)).toBe(true);
    });
});
