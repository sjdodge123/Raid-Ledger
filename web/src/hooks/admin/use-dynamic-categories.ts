/**
 * Admin hooks for LLM-generated dynamic discovery categories (ROK-567).
 *
 * Surface:
 *   - useListDynamicCategories(status) — GET /admin/discovery-categories?status=…
 *   - useApproveDynamicCategory()      — POST /admin/discovery-categories/:id/approve
 *   - useRejectDynamicCategory()       — POST /admin/discovery-categories/:id/reject
 *   - usePatchDynamicCategory()        — PATCH /admin/discovery-categories/:id
 *   - useRegenerateDynamicCategories() — POST /admin/discovery-categories/regenerate
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
    AdminCategoryListResponseDto,
    AdminCategoryPatchDto,
    DiscoveryCategorySuggestionDto,
    SuggestionStatus,
} from '@raid-ledger/contract';
import { getAuthToken } from '../use-auth';
import { adminFetch } from './admin-fetch';

const BASE_KEY = ['admin', 'discovery-categories'] as const;

function listKey(status: SuggestionStatus) {
    return [...BASE_KEY, 'list', status] as const;
}

/** List suggestions for a given status (pending | approved | rejected | expired). */
export function useListDynamicCategories(status: SuggestionStatus) {
    return useQuery<AdminCategoryListResponseDto>({
        queryKey: listKey(status),
        queryFn: () =>
            adminFetch(`/admin/discovery-categories?status=${status}`),
        enabled: !!getAuthToken(),
        staleTime: 30_000,
    });
}

function invalidateAllLists(qc: ReturnType<typeof useQueryClient>): void {
    void qc.invalidateQueries({ queryKey: BASE_KEY });
}

/** Approve a pending suggestion. */
export function useApproveDynamicCategory() {
    const qc = useQueryClient();
    return useMutation<DiscoveryCategorySuggestionDto, Error, string>({
        mutationFn: (id) =>
            adminFetch(
                `/admin/discovery-categories/${id}/approve`,
                { method: 'POST' },
                'Failed to approve suggestion',
            ),
        onSuccess: () => invalidateAllLists(qc),
    });
}

/** Reject a pending suggestion. `reason` is optional (v1 does not persist). */
export function useRejectDynamicCategory() {
    const qc = useQueryClient();
    return useMutation<
        DiscoveryCategorySuggestionDto,
        Error,
        { id: string; reason?: string }
    >({
        mutationFn: ({ id, reason }) =>
            adminFetch(
                `/admin/discovery-categories/${id}/reject`,
                {
                    method: 'POST',
                    body: JSON.stringify(reason ? { reason } : {}),
                },
                'Failed to reject suggestion',
            ),
        onSuccess: () => invalidateAllLists(qc),
    });
}

/** Patch a suggestion (name + description + sortOrder). */
export function usePatchDynamicCategory() {
    const qc = useQueryClient();
    return useMutation<
        DiscoveryCategorySuggestionDto,
        Error,
        { id: string; patch: AdminCategoryPatchDto }
    >({
        mutationFn: ({ id, patch }) =>
            adminFetch(
                `/admin/discovery-categories/${id}`,
                {
                    method: 'PATCH',
                    body: JSON.stringify(patch),
                },
                'Failed to update suggestion',
            ),
        onSuccess: () => invalidateAllLists(qc),
    });
}

export interface RegenerateResult {
    ok: true;
    inserted: number;
    expired: number;
}

/** Trigger a weekly regenerate on demand. Returns 503 when the feature flag is off. */
export function useRegenerateDynamicCategories() {
    const qc = useQueryClient();
    return useMutation<RegenerateResult, Error, void>({
        mutationFn: () =>
            adminFetch(
                `/admin/discovery-categories/regenerate`,
                { method: 'POST' },
                'Failed to regenerate suggestions',
            ),
        onSuccess: () => invalidateAllLists(qc),
    });
}
