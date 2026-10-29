/**
 * ROK-1950 — rename a hub (`PATCH /guilds/:id/name`). A string renames it; on a
 * server hub `null` drops the Raid Ledger name so it follows the Pelican
 * server's name again. Every surface that shows the name refetches after.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { HubRenameDto } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { httpStatusOf } from '../../../lib/api/api-error';
import { toast } from '../../../lib/toast';
import { invalidateHubName } from '../community/invalidate-hub-membership';

/**
 * User-facing copy for a failed rename. 400/409 carry the server's own copy
 * (name rules, "already exists", "server is gone", "WoW names come from the
 * game"); 403/404 messages are guard internals, so they get plain words.
 */
export function renameErrorCopy(err: Error): string {
    const status = httpStatusOf(err);
    if (status === 403) return 'Only the hub’s Leader or staff can rename it.';
    if (status === 404) return 'This hub isn’t active, so it can’t be renamed.';
    return err.message || 'Couldn’t rename the hub. Try again.';
}

/**
 * The rename mutation for one hub; its variable is the new name (`null` = reset
 * a server hub to its server's name, or a WoW guild to its in-game name).
 */
export function useHubRename(
    hubId: number,
    resetToast = 'Name reset to the server’s',
): UseMutationResult<unknown, Error, HubRenameDto['name']> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (name: HubRenameDto['name']) => fetchApi(`/guilds/${hubId}/name`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
        }),
        onSuccess: (_data, name) => { toast.success(name === null ? resetToast : 'Hub renamed'); },
        onError: (err) => { toast.error(renameErrorCopy(err)); },
        onSettled: () => invalidateHubName(qc, hubId),
    });
}
