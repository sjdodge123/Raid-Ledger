/**
 * ROK-1870 — the `/hubs` directory read (`GET /hubs`, cursor "Load more",
 * key `['hubs-directory', params]`), the URL <-> params mapping
 * (`?game=&q=&membership=&sort=`) and the optimistic inline Join.
 */
import {
    useInfiniteQuery, useMutation, useQueryClient,
    type InfiniteData, type UseInfiniteQueryResult, type UseMutationResult,
} from '@tanstack/react-query';
import {
    HubDirectoryPageSchema, type CommunityHubJoinResponse, type HubDirectoryPage, type HubDirectoryQuery,
} from '@raid-ledger/contract';
import { fetchApi } from '../lib/api/fetch-api';
import { toast } from '../lib/toast';
import { invalidateHubMembership } from '../components/hub/community/invalidate-hub-membership';
import { requestHubJoin, withJoin } from './game-detail/hub-join';

export type HubMembershipFilter = HubDirectoryQuery['membership'];
export type HubSort = HubDirectoryQuery['sort'];

export interface HubsDirectoryParams {
    gameId?: number | undefined;
    q?: string | undefined;
    membership: HubMembershipFilter;
    sort: HubSort;
}

const MEMBERSHIPS: readonly HubMembershipFilter[] = ['all', 'joined', 'not-joined'];
const SORTS: readonly HubSort[] = ['members', 'name', 'newest'];
type DirectoryData = InfiniteData<HubDirectoryPage, string>;

/** Query key for one filtered directory listing. */
export function hubsDirectoryKey(params: HubsDirectoryParams): readonly ['hubs-directory', HubsDirectoryParams] {
    return ['hubs-directory', params];
}

/** Read the filters from the page URL; unknown values fall back to the defaults. */
export function readDirectoryParams(search: URLSearchParams): HubsDirectoryParams {
    const game = Number(search.get('game'));
    const membership = MEMBERSHIPS.find((m) => m === search.get('membership')) ?? 'all';
    const sort = SORTS.find((s) => s === search.get('sort')) ?? 'members';
    const q = search.get('q')?.trim();
    return { gameId: Number.isInteger(game) && game > 0 ? game : undefined, q: q || undefined, membership, sort };
}

/** Write the filters back to the URL, omitting defaults. */
export function writeDirectoryParams(params: HubsDirectoryParams): URLSearchParams {
    const out = new URLSearchParams();
    if (params.gameId) out.set('game', String(params.gameId));
    if (params.q) out.set('q', params.q);
    if (params.membership !== 'all') out.set('membership', params.membership);
    if (params.sort !== 'members') out.set('sort', params.sort);
    return out;
}

/** Active filters for the funnel badge (search and sort excluded). */
export function directoryActiveCount(params: HubsDirectoryParams): number {
    return (params.gameId ? 1 : 0) + (params.membership !== 'all' ? 1 : 0);
}

function apiQuery(params: HubsDirectoryParams, cursor: string): string {
    const out = new URLSearchParams({ membership: params.membership, sort: params.sort });
    if (params.gameId) out.set('gameId', String(params.gameId));
    if (params.q) out.set('q', params.q);
    if (cursor) out.set('cursor', cursor);
    return out.toString();
}

/** The directory listing, one page per "Load more". */
export function useHubsDirectory(params: HubsDirectoryParams): UseInfiniteQueryResult<DirectoryData> {
    return useInfiniteQuery({
        queryKey: hubsDirectoryKey(params),
        queryFn: ({ pageParam }) => fetchApi(`/hubs?${apiQuery(params, pageParam)}`, {}, HubDirectoryPageSchema),
        initialPageParam: '',
        getNextPageParam: (last) => last.nextCursor ?? undefined,
    });
}

function patchDirectory(data: DirectoryData, hubId: number, memberCount?: number): DirectoryData {
    const pages = data.pages.map((p) => ({
        ...p, items: p.items.map((h) => (h.id === hubId ? withJoin(h, true, memberCount) : h)),
    }));
    return { ...data, pages };
}

interface JoinContext { previous: DirectoryData | undefined }

/** Optimistic inline Join from a directory card; rolls back + toasts on error. */
export function useJoinDirectoryHub(params: HubsDirectoryParams): UseMutationResult<CommunityHubJoinResponse, Error, number, JoinContext> {
    const qc = useQueryClient();
    const key = hubsDirectoryKey(params);
    return useMutation<CommunityHubJoinResponse, Error, number, JoinContext>({
        mutationFn: (hubId) => requestHubJoin(hubId, true),
        onMutate: async (hubId) => {
            await qc.cancelQueries({ queryKey: key });
            const previous = qc.getQueryData<DirectoryData>(key);
            if (previous) qc.setQueryData<DirectoryData>(key, patchDirectory(previous, hubId));
            return { previous };
        },
        onSuccess: (res, hubId) => qc.setQueryData<DirectoryData>(key, (d) => (d ? patchDirectory(d, hubId, res.memberCount) : d)),
        onError: (err, _hubId, ctx) => {
            if (ctx?.previous) qc.setQueryData(key, ctx.previous);
            toast.error(err.message);
        },
        onSettled: (_res, _err, hubId) => invalidateHubMembership(qc, hubId),
    });
}
