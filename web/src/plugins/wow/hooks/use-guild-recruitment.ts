/**
 * ROK-1789 — the guild recruitment data layer: the per-hub query key and
 * options, the card's `useVisible` probe, and the save / clear mutations.
 * Type-only contract imports and a dynamic import of the endpoints keep it
 * light for the eagerly loaded probe and header action (guild-text idiom).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GuildRecruitmentView, PutGuildRecruitmentInput } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../hub-game-widgets';

export const guildRecruitmentKey = (guildId: number) => ['wow-guild-recruitment', guildId] as const;

/** `useQuery` options for one hub's recruitment; idle until a guild id is known. A 403/404 is not retried. */
export function guildRecruitmentQuery(guildId: number) {
    return {
        queryKey: guildRecruitmentKey(guildId),
        queryFn: async (): Promise<GuildRecruitmentView> =>
            (await import('../recruitment-api')).fetchGuildRecruitment(guildId),
        enabled: guildId > 0,
        retry: false,
        staleTime: 30_000,
    };
}

/** `fresh` (the editor dialog only): refetch on mount so an edit never starts from a stale view. */
export function useGuildRecruitment(guildId: number, { fresh = false }: { fresh?: boolean } = {}) {
    return useQuery({ ...guildRecruitmentQuery(guildId), ...(fresh ? { refetchOnMount: 'always' as const } : {}) });
}

/** The card's probe (A-D6): loaded AND (recruitment set OR the viewer can edit); hidden on 403/404. */
export function useRecruitmentVisible({ page }: HubWidgetCtx): boolean {
    const { data } = useQuery(guildRecruitmentQuery(page.guild.id));
    if (data === undefined) return false;
    return data.recruitment !== null || data.viewer.canEdit;
}

/** Editors: save the whole object; the response view replaces the cache, so the card updates without a reload (AC4). */
export function useSaveGuildRecruitment(guildId: number) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: async (body: PutGuildRecruitmentInput): Promise<GuildRecruitmentView> =>
            (await import('../recruitment-api')).putGuildRecruitment(guildId, body),
        onSuccess: (data) => client.setQueryData(guildRecruitmentKey(guildId), data),
    });
}

/** Editors: clear back to unset (AC7), then refetch the view (204 carries no body). */
export function useClearGuildRecruitment(guildId: number) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: async (): Promise<void> =>
            (await import('../recruitment-api')).deleteGuildRecruitment(guildId),
        onSuccess: () => client.invalidateQueries({ queryKey: guildRecruitmentKey(guildId) }),
    });
}
