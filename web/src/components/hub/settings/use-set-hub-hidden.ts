/** ROK-1831 — admin-only `PATCH /guilds/:id/hidden` for the settings sheet's Hide switch. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HubHideSchema } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { toast } from '../../../lib/toast';
import { guildPageKey } from '../api/use-guild';

export const HIDE_HINT_ADMIN = 'Only Raid Ledger admins and staff can open a hidden hub.';
export const HIDE_HINT_NOT_ADMIN = 'Only a Raid Ledger admin can hide or show this hub.';

/** PATCH the hub's hidden flag, then refetch the page (its `guild.hidden` drives the switch). */
export function useSetHubHidden(guildId: number) {
    const qc = useQueryClient();
    return useMutation<{ hidden: boolean }, Error, boolean>({
        mutationFn: (hidden) => fetchApi(`/guilds/${guildId}/hidden`, {
            method: 'PATCH', body: JSON.stringify({ hidden }),
        }, HubHideSchema),
        onError: () => { toast.error('Couldn’t change the hub’s visibility. Try again.'); },
        onSettled: () => qc.invalidateQueries({ queryKey: guildPageKey(guildId) }),
    });
}
