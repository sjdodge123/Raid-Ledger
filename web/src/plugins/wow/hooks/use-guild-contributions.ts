/**
 * ROK-2148 — the Guild contributions card's data layer: the per-hub query and
 * the `useVisible` probe. Type-only contract imports and a dynamic api-client
 * import keep the eagerly loaded probe light (`use-guild-ingame-text.ts` idiom).
 */
import { useQuery } from '@tanstack/react-query';
import type { GuildContributionsDto } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../hub-game-widgets';

/** Under the hub-page prefix `['plugins', 'wow', 'guilds', id]`, so an addon import's `invalidateAllHubMemberships` refreshes the card (Codex P2). */
export const guildContributionsKey = (guildId: number) => ['plugins', 'wow', 'guilds', guildId, 'contributions'] as const;

/** `useQuery` options for one hub; idle until a guild id is known. A 403 is not retried. */
export function guildContributionsQuery(guildId: number) {
    return {
        queryKey: guildContributionsKey(guildId),
        queryFn: async (): Promise<GuildContributionsDto> =>
            (await import('../api-client')).fetchGuildContributions(guildId),
        enabled: guildId > 0,
        retry: false,
        staleTime: 60_000,
    };
}

export function useGuildContributions(guildId: number) {
    return useQuery(guildContributionsQuery(guildId));
}

/** The card's probe: shown once the read loads (empty DTO included); hidden on 403/404 or while loading. */
export function useContributionsVisible({ page }: HubWidgetCtx): boolean {
    const { data } = useGuildContributions(page.guild.id);
    return data !== undefined;
}
