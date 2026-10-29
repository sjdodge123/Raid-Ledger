/**
 * ROK-1958 Q9 — staff are view-only on a hub they have not joined. Staff
 * resolve as ladder `leader` on every hub, so the role alone cannot tell a
 * member from non-member staff; a community hub's `viewerJoined` can.
 */
import type { GuildPage } from '@raid-ledger/contract';

/** The viewer joined this hub (claims, campaigns and saves need membership). */
export function isBg3HubMember(page: Pick<GuildPage, 'viewer' | 'community'>): boolean {
    if (page.community) return page.community.viewerJoined;
    return page.viewer.role !== 'visitor';
}
