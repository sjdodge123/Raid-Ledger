/**
 * ROK-1933 Part 1 — the claim banner's hooks: the viewer's variant (from the
 * server's `claim-status`, D1) and the Overview dismiss flag, shared
 * between the widget's `useVisible` probe and its body.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useAuth } from '../../../hooks/use-auth';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useValheimClaimStatus } from './use-valheim-claim-status';
import {
    claimBannerVariant,
    readClaimBannerDismissed,
    writeClaimBannerDismissed,
    type ClaimBannerVariant,
} from '../hub/valheim-claim-banner.helpers';

const dismissListeners = new Set<() => void>();

/** The Overview dismiss flag for a server, shared by the widget probe and body. */
export function useClaimBannerDismissed(serverId: number): [boolean, () => void] {
    const subscribe = useCallback((fn: () => void) => {
        dismissListeners.add(fn);
        return () => void dismissListeners.delete(fn);
    }, []);
    const dismissed = useSyncExternalStore(subscribe, () => readClaimBannerDismissed(serverId));
    const dismiss = useCallback(() => {
        writeClaimBannerDismissed(serverId);
        dismissListeners.forEach((fn) => fn());
    }, [serverId]);
    return [dismissed, dismiss];
}

/** The viewer's banner variant on this server (null = no banner, or not known yet). */
export function useClaimBannerVariant(serverId: number): ClaimBannerVariant | null {
    const { user } = useAuth();
    const status = useValheimClaimStatus(serverId);
    return claimBannerVariant({
        status: status.data ?? null,
        viewerId: user?.id ?? null,
        steamLinked: Boolean(user?.steamId),
    });
}

/** The Overview card's `useVisible` probe: a banner to show and not dismissed here. */
export function useClaimBannerWidgetVisible(ctx: HubWidgetCtx): boolean {
    const serverId = ctx.page.server?.pelicanServerId ?? 0;
    const variant = useClaimBannerVariant(serverId);
    const [dismissed] = useClaimBannerDismissed(serverId);
    return serverId > 0 && variant !== null && !dismissed;
}
