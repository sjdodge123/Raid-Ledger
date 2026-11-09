/**
 * ROK-2151 — the staff claim banner's hooks: the per-session dismiss flag
 * (shared by the widget's `useVisible` probe and its body, D6) and the probe
 * itself (D1).
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useJoinGate } from './use-join-gate';
import { readClaimBannerDismissed, writeClaimBannerDismissed } from './wow-claim-banner.helpers';

const dismissListeners = new Set<() => void>();

/** The session dismiss flag for a guild, plus the × handler that sets it. */
export function useClaimBannerDismissed(guildId: number): [boolean, () => void] {
    const subscribe = useCallback((fn: () => void) => {
        dismissListeners.add(fn);
        return () => void dismissListeners.delete(fn);
    }, []);
    const dismissed = useSyncExternalStore(subscribe, () => readClaimBannerDismissed(guildId));
    const dismiss = useCallback(() => {
        writeClaimBannerDismissed(guildId);
        dismissListeners.forEach((fn) => fn());
    }, [guildId]);
    return [dismissed, dismiss];
}

/**
 * D1 — shown to a staff viewer the join gate answers (200 = claimable guild)
 * with `isMember: false`, until dismissed this session. The gate read is only
 * made for staff (D8); a 404 (not claimable) leaves `data` undefined.
 */
export function useForeverClaimBannerVisible({ page }: Pick<HubWidgetCtx, 'page'>): boolean {
    const guildId = page.guild.id;
    const isStaff = page.viewer.isStaff === true;
    const gate = useJoinGate(guildId, isStaff);
    const [dismissed] = useClaimBannerDismissed(guildId);
    return isStaff && gate.data?.viewer.isMember === false && !dismissed;
}
