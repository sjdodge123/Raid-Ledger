/**
 * ROK-1958 D-14 — BG3 hub queries. ONE snapshot query feeds Party + Where we
 * are and their probes. 403/404 never retry (the widgets hide, D-10).
 */
import { useInfiniteQuery, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { Bg3HubCampaignsResponse, Bg3MySavesResponse, Bg3SessionsResponse, Bg3SnapshotResponse } from '@raid-ledger/contract';
import {
    BG3_SESSIONS_PAGE_LIMIT,
    BG3_SESSIONS_WIDGET_LIMIT,
    fetchBg3Campaigns,
    fetchBg3MyUnassignedSaves,
    fetchBg3Sessions,
    fetchBg3Snapshot,
    isBg3AccessDenied,
} from '../api/bg3-api';
import { bg3Keys } from './bg3-keys';

const STALE_MS = 30_000;
const retry = (count: number, error: Error): boolean => !isBg3AccessDenied(error) && count < 2;

/** Campaigns + hub settings + `canEdit`. `enabled` false skips a visitor's pointless 403. */
export function useBg3Campaigns(hubId: number, enabled = true): UseQueryResult<Bg3HubCampaignsResponse> {
    return useQuery({
        queryKey: bg3Keys.campaigns(hubId),
        queryFn: () => fetchBg3Campaigns(hubId),
        enabled: enabled && hubId > 0,
        staleTime: STALE_MS,
        retry,
    });
}

/** Active-campaign snapshot; data `null` = no active campaign. */
export function useBg3Snapshot(hubId: number, enabled = true): UseQueryResult<Bg3SnapshotResponse | null> {
    return useQuery({
        queryKey: bg3Keys.snapshot(hubId),
        queryFn: () => fetchBg3Snapshot(hubId),
        enabled: enabled && hubId > 0,
        staleTime: STALE_MS,
        retry,
    });
}

/** The widget's newest sessions (first page, `limit` 5); idle without a campaign. */
export function useBg3Sessions(
    hubId: number,
    campaignId: number | null,
    limit: number = BG3_SESSIONS_WIDGET_LIMIT,
): UseQueryResult<Bg3SessionsResponse> {
    return useQuery({
        queryKey: [...bg3Keys.sessions(hubId, campaignId ?? 0, null), limit],
        queryFn: () => fetchBg3Sessions(hubId, campaignId ?? 0, null, limit),
        enabled: hubId > 0 && campaignId !== null,
        staleTime: STALE_MS,
        retry,
    });
}

/** Full history for the Campaign tab, paged by `nextCursor` ("Show more"). */
export function useBg3SessionPages(hubId: number, campaignId: number | null) {
    return useInfiniteQuery({
        queryKey: bg3Keys.sessionPages(hubId, campaignId ?? 0),
        queryFn: ({ pageParam }) => fetchBg3Sessions(hubId, campaignId ?? 0, pageParam, BG3_SESSIONS_PAGE_LIMIT),
        initialPageParam: null as string | null,
        getNextPageParam: (last) => last.nextCursor,
        enabled: hubId > 0 && campaignId !== null,
        staleTime: STALE_MS,
        retry,
    });
}

/** The caller's saves in no campaign (Add my saves sheet). */
export function useBg3MyUnassignedSaves(enabled = true): UseQueryResult<Bg3MySavesResponse> {
    return useQuery({
        queryKey: bg3Keys.myUnassignedSaves,
        queryFn: fetchBg3MyUnassignedSaves,
        enabled,
        staleTime: STALE_MS,
        retry,
    });
}
