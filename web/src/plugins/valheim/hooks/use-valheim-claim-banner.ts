/**
 * ROK-1933 Part 1 — the claim banner's variant hook (from the server's
 * `claim-status`, D1). The Characters tab banner is its one consumer; the
 * Overview widget it once also fed moved onto the core claim prompt (ROK-2153 S4).
 */
import { useAuth } from '../../../hooks/use-auth';
import { useValheimClaimStatus } from './use-valheim-claim-status';
import { claimBannerVariant, type ClaimBannerVariant } from '../hub/valheim-claim-banner.helpers';

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
