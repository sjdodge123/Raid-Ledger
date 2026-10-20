/**
 * ROK-1870 — the community-hub Join / Leave request and the optimistic patch
 * the game page card and the `/hubs` directory both apply to a hub row.
 */
import {
    CommunityHubJoinResponseSchema,
    type CommunityHubJoinResponse,
    type HubDirectoryEntry,
} from '@raid-ledger/contract';
import { fetchApi } from '../../lib/api/fetch-api';

/** `POST` (join) or `DELETE` (leave) `/hubs/:id/join`. */
export function requestHubJoin(hubId: number, join: boolean): Promise<CommunityHubJoinResponse> {
    return fetchApi(`/hubs/${hubId}/join`, { method: join ? 'POST' : 'DELETE' }, CommunityHubJoinResponseSchema);
}

/** The row as it looks once the viewer joined (or left); `memberCount` from the server when known. */
export function withJoin(entry: HubDirectoryEntry, join: boolean, memberCount?: number): HubDirectoryEntry {
    const viewer = join ? 'member' : 'not-member';
    const delta = join ? 1 : -1;
    return { ...entry, viewer, memberCount: memberCount ?? Math.max(0, entry.memberCount + delta) };
}

/** Whether the viewer is already in the hub (any live role). */
export function isHubMember(entry: HubDirectoryEntry): boolean {
    return entry.viewer === 'member' || entry.viewer === 'leader' || entry.viewer === 'officer';
}
