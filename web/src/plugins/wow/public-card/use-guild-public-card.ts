/**
 * ROK-1813 (D3/D10) — the editor side of the public recruiting card: read
 * whether it is on (and its slug), and flip it. `canEdit` only — the server
 * answers 403 otherwise. Keys extend `guildPageKey(guildId)` so a page
 * invalidation refreshes them too.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { GuildPublicCardSettingsSchema, type GuildPublicCardSettings } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { guildPageKey } from '../../../components/hub/api/use-guild';

const settingsUrl = (guildId: number): string => `/plugins/wow/guilds/${guildId}/public-card`;

/** Query key of the GET; a prefix-match of `guildPageKey(guildId)`. */
export function guildPublicCardKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'public-card'] as const;
}

/** `{enabled, slug}` for the hub's card; off until an editor turns it on. */
export function useGuildPublicCard(guildId: number, enabled = true): UseQueryResult<GuildPublicCardSettings, Error> {
    return useQuery({
        queryKey: guildPublicCardKey(guildId),
        queryFn: () => fetchApi(settingsUrl(guildId), {}, GuildPublicCardSettingsSchema),
        enabled: enabled && guildId > 0,
        staleTime: 60_000,
        retry: false,
    });
}

/** PATCH `{enabled}`; the answer (with the slug kept across off/on) replaces the cached read. */
export function useSetGuildPublicCard(guildId: number): UseMutationResult<GuildPublicCardSettings, Error, boolean> {
    const qc = useQueryClient();
    const key = guildPublicCardKey(guildId);
    return useMutation({
        mutationFn: (enabled: boolean) => fetchApi(settingsUrl(guildId), {
            method: 'PATCH', body: JSON.stringify({ enabled }),
        }, GuildPublicCardSettingsSchema),
        onSuccess: (data) => qc.setQueryData(key, data),
        onSettled: () => qc.invalidateQueries({ queryKey: key }),
    });
}
