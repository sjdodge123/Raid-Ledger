/**
 * ROK-1814 — TanStack Query hooks for the crest editor. The editor state key
 * extends `guildPageKey`, so every write's page invalidation refreshes it too;
 * writes also refresh every query that embeds a `GuildSummary.crest` (my hubs,
 * character guild badges, hub directories).
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { GuildCrestEditorState, SetGuildCrest } from '@raid-ledger/contract';
import { useViewerCacheScope } from '../../../hooks/use-auth';
import { guildPageKey } from '../api/use-guild';
import {
    deleteGuildCrestUpload, fetchGuildCrest, postGuildCrestFromGallery, postGuildCrestUpload, putGuildCrest,
} from './guild-crest-api';
import { shrinkCrestForUpload } from './crest-upload-shrink';

type CrestMutation<V> = UseMutationResult<GuildCrestEditorState, Error, V>;

/** The editor state's key prefix (viewer scope appended by the query). */
export function guildCrestKey(guildId: number): readonly unknown[] {
    return [...guildPageKey(guildId), 'crest'] as const;
}

/** Queries whose payloads embed `GuildSummary.crest`. */
const CREST_CARRIER_KEYS: readonly (readonly unknown[])[] = [['plugins', 'wow', 'guilds'], ['game-hubs'], ['hubs-directory']];

/** Editors only, and only while the picker is open. */
export function useGuildCrestEditor(guildId: number, enabled: boolean): UseQueryResult<GuildCrestEditorState, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...guildCrestKey(guildId), viewer],
        queryFn: () => fetchGuildCrest(guildId),
        enabled: enabled && guildId > 0,
        retry: false,
    });
}

function useCrestWrite<V>(guildId: number, write: (vars: V) => Promise<GuildCrestEditorState>): CrestMutation<V> {
    const qc = useQueryClient();
    return useMutation<GuildCrestEditorState, Error, V>({
        mutationFn: write,
        onSuccess: () => Promise.all([guildPageKey(guildId), ...CREST_CARRIER_KEYS].map((queryKey) => qc.invalidateQueries({ queryKey }))),
    });
}

/** `PUT` — show a preset, the stored upload, or none. */
export function useSetGuildCrest(guildId: number): CrestMutation<SetGuildCrest> {
    return useCrestWrite(guildId, (body: SetGuildCrest) => putGuildCrest(guildId, body));
}

/** Pre-shrinks to ≤1024 px / 1 MiB (Q5), then uploads; the upload becomes the active crest. */
export function useUploadGuildCrest(guildId: number): CrestMutation<File> {
    return useCrestWrite(guildId, async (file: File) => postGuildCrestUpload(guildId, await shrinkCrestForUpload(file)));
}

/** Operator ruling Q1 — copy a gallery picture into the crest store. */
export function usePickGuildCrestFromGallery(guildId: number): CrestMutation<number> {
    return useCrestWrite(guildId, (mediaId: number) => postGuildCrestFromGallery(guildId, { mediaId }));
}

/** Staff only — delete the stored upload (moderation, Q7). */
export function useRemoveGuildCrestUpload(guildId: number): CrestMutation<void> {
    return useCrestWrite(guildId, () => deleteGuildCrestUpload(guildId));
}
