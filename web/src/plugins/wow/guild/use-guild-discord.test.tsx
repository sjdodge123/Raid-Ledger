/**
 * ROK-1788 D11 — the mirror refetches every 60s only while the tab is
 * visible; plus the pure helpers behind the card and picker.
 */
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PRIVATE_CHANNEL, PUBLIC_CHANNEL, discordMessage } from '../../../test/mocks/guild-discord-handlers';
import { canSaveChoice, latestMessages, visibleChannels } from './guild-discord.helpers';
import { GUILD_DISCORD_REFRESH_MS, guildDiscordKey, useGuildDiscord } from './use-guild-discord';

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
