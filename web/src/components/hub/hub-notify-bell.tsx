/**
 * ROK-1832 — the per-group notification bell on the hub hero, an adapter
 * feeding the shared `NotifyBell` from `useHubNotificationMute`. D11: only a
 * real member sees it — `viewer.role` member/officer/leader AND the page
 * carries `viewer.notificationsMuted` (the API omits it for non-members,
 * staff included).
 */
import type { JSX } from 'react';
import type { GuildPage, GuildViewerAccess } from '@raid-ledger/contract';
import { NotifyBell } from '../notifications/notify-bell';
import { useHubNotificationMute } from '../../hooks/use-hub-notification-mute';

export const HUB_NOTIFICATION_SETTINGS_HREF = '/profile/notifications#notif-hub_leader_post';
const HUB_MUTED_HINT = 'Leader posts and events tagged to this group. Muting keeps you in the group.';
const MEMBER_ROLES: ReadonlySet<GuildViewerAccess['role']> = new Set(['member', 'officer', 'leader']);

/** D11 — the viewer is a real member of this group. */
export function hubBellVisible(viewer: GuildViewerAccess): boolean {
    return MEMBER_ROLES.has(viewer.role) && viewer.notificationsMuted !== undefined;
}

function MemberBell({ page }: { page: GuildPage }): JSX.Element {
    const { muted, isReady, isPending, setMuted } = useHubNotificationMute(page);
    return (
        <NotifyBell subjectName={page.guild.name} muted={muted} isReady={isReady} isPending={isPending} onToggle={setMuted}
            settingsHref={HUB_NOTIFICATION_SETTINGS_HREF} testIdPrefix="hub-notify" mutedHint={HUB_MUTED_HINT} />
    );
}

/** The bell, or nothing for a visitor / staff non-member. */
export function HubNotifyBell({ page }: { page: GuildPage }): JSX.Element | null {
    return hubBellVisible(page.viewer) ? <MemberBell page={page} /> : null;
}
