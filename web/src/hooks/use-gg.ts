/**
 * TanStack Query hooks for "GG <year>" (ROK-2187). Snapshots are frozen, so
 * they stay fresh for the session.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { toast } from '../lib/toast';
import type { GgArchiveDto, GgPublicSummaryDto, GgShareStateDto } from '@raid-ledger/contract';
import { getGgArchive, getGgPublic, getGgYear, setGgShare, type GgOwnerSnapshot } from '../lib/api/gg-api';

const GG_KEY = ['gg'] as const;
const FROZEN = Infinity;

/** The viewer's snapshot for `year`. */
export function useGgYear(year: number | null): UseQueryResult<GgOwnerSnapshot> {
    return useQuery({
        queryKey: [...GG_KEY, 'year', year],
        queryFn: () => getGgYear(year ?? 0),
        enabled: year !== null,
        staleTime: FROZEN,
        retry: false,
    });
}

/** Years the viewer has a GG for. */
export function useGgArchive(): UseQueryResult<GgArchiveDto> {
    return useQuery({ queryKey: [...GG_KEY, 'archive'], queryFn: getGgArchive, staleTime: 60_000 });
}

/** The anonymous public summary for a share slug. */
export function useGgPublic(slug: string | undefined): UseQueryResult<GgPublicSummaryDto> {
    return useQuery({
        queryKey: [...GG_KEY, 'public', slug],
        queryFn: () => getGgPublic(slug ?? ''),
        enabled: !!slug,
        staleTime: FROZEN,
        retry: false,
    });
}

/** Toggle sharing for `year`; writes the new share state into the cached snapshot. */
export function useSetGgShare(year: number): UseMutationResult<GgShareStateDto, Error, boolean> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (shared: boolean) => setGgShare(year, { shared }),
        onSuccess: (share) => {
            qc.setQueryData<GgOwnerSnapshot>([...GG_KEY, 'year', year], (old) => (old ? { ...old, share } : old));
            void qc.invalidateQueries({ queryKey: [...GG_KEY, 'archive'] });
        },
        onError: (err: Error) => {
            toast.error(err.message || 'Could not change sharing');
        },
    });
}
