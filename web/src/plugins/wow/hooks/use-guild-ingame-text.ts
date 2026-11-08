/**
 * ROK-2136 — the guild in-game text (Message of the Day + Guild Information)
 * data layer: the per-hub query key and options, the card's `useVisible`
 * probe, and the save mutation. Type-only contract imports and a dynamic
 * import of the api-client keep it light for the eagerly loaded probe and
 * header action (the session-note idiom, `hub-session-note-query.ts`). A save
 * stores the server's response verbatim, so each `updatedAt` keeps its
 * microseconds for the next `base*UpdatedAt` — never re-format it via `Date`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GuildIngameText, IngameTextFieldKey, PutGuildIngameText } from '@raid-ledger/contract';
import type { GuildGameTextAction } from '../api-client';
import type { HubWidgetCtx } from '../../hub-game-widgets';

export const guildIngameTextKey = (guildId: number) => ['wow-guild-ingame-text', guildId] as const;

/** `useQuery` options for one hub's text; idle until a guild id is known. A 403/404 is not retried. */
export function guildIngameTextQuery(guildId: number) {
    return {
        queryKey: guildIngameTextKey(guildId),
        queryFn: async (): Promise<GuildIngameText> =>
            (await import('../api-client')).fetchGuildIngameText(guildId),
        enabled: guildId > 0,
        retry: false,
        staleTime: 30_000,
    };
}

/** `fresh` (the editor dialog only): refetch on mount so a save never starts from a stale base. */
export function useGuildIngameText(guildId: number, { fresh = false }: { fresh?: boolean } = {}) {
    return useQuery({ ...guildIngameTextQuery(guildId), ...(fresh ? { refetchOnMount: 'always' as const } : {}) });
}

/** The card's probe: editors always (for the "Add guild text" hint); members once a field is set; hidden on 403/404. */
export function useGuildTextVisible({ page }: HubWidgetCtx): boolean {
    const { data } = useQuery(guildIngameTextQuery(page.guild.id));
    if (data === undefined) return false;
    return data.motd !== null || data.info !== null || data.viewer.canEdit;
}

/** ROK-2137 — editors: Adopt (use the in-game text) or Push (keep the hub text) on one field. */
export function useGuildIngameGameAction(guildId: number, field: IngameTextFieldKey) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: async (action: GuildGameTextAction): Promise<GuildIngameText> =>
            (await import('../api-client')).postGuildIngameGameAction(guildId, field, action),
        // The response is the full DTO: store it, so the card updates without a refetch flash.
        onSuccess: (data) => client.setQueryData(guildIngameTextKey(guildId), data),
    });
}

/** Editors: save both fields. The 409 body (`ingameText`) is read by the dialog. */
export function useSaveGuildIngameText(guildId: number) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: async (body: PutGuildIngameText): Promise<GuildIngameText> =>
            (await import('../api-client')).putGuildIngameText(guildId, body),
        onSuccess: (data) => client.setQueryData(guildIngameTextKey(guildId), data),
    });
}
