/**
 * ROK-1933 Part 1 — the claim banner's hooks: the viewer's variant (derived
 * from the loaded character rows, D1) and the Overview dismiss flag, shared
 * between the widget's `useVisible` probe and its body.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { ValheimCharacterSummary } from '@raid-ledger/contract';
import { useAuth } from '../../../hooks/use-auth';
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

/** The viewer's banner variant for these rows (null = no banner). */
export function useClaimBannerVariant(rows: readonly ValheimCharacterSummary[], complete: boolean): ClaimBannerVariant | null {
    const { user } = useAuth();
    return claimBannerVariant({
        rows,
        complete,
        viewerId: user?.id ?? null,
        steamLinked: Boolean(user?.steamId),
    });
}

