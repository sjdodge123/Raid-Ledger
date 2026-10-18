/**
 * ROK-1831 — "Hide this hub": admins only (`PATCH /guilds/:id/hidden`, AdminGuard).
 * A hidden hub answers 404 to everyone but staff; the admin Pelican row's
 * Community hub switch shows the same state. A Leader who is not an admin sees
 * the switch disabled with the reason in its hint line (settings-rows rule).
 */
import type { JSX } from 'react';
import type { GuildPage } from '@raid-ledger/contract';
import { isAdmin, useAuth } from '../../../hooks/use-auth';
import { HIDE_HINT_ADMIN, HIDE_HINT_NOT_ADMIN, useSetHubHidden } from './use-set-hub-hidden';
import { SettingsSwitchRow } from './settings-rows';

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
