/**
 * ROK-1831 — "Hide this hub": admins only (`PATCH /guilds/:id/hidden`, AdminGuard).
 * A hidden hub answers 404 to everyone but staff; the admin Pelican row's
 * Community hub switch shows the same state. A Leader who is not an admin sees
 * the switch disabled with the reason in its hint line (settings-rows rule).
 */
import type { JSX } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HubHideSchema, type GuildPage } from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { isAdmin, useAuth } from '../../../hooks/use-auth';
import { toast } from '../../../lib/toast';
import { guildPageKey } from '../api/use-guild';
import { SettingsSwitchRow } from './settings-rows';

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

/** The Visibility section's one row. */
export function HideHubRow({ page }: { page: GuildPage }): JSX.Element {
    const { user } = useAuth();
    const admin = isAdmin(user);
    const mutation = useSetHubHidden(page.guild.id);
    const checked = mutation.isPending ? mutation.variables : page.guild.hidden === true;
    return (
        <SettingsSwitchRow label="Hide this hub" hint={admin ? HIDE_HINT_ADMIN : HIDE_HINT_NOT_ADMIN}
            checked={checked} disabled={!admin || mutation.isPending}
            onChange={(hidden) => mutation.mutate(hidden)} testId="guild-settings-hide-hub" />
    );
}
