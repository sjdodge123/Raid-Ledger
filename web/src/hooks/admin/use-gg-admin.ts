/**
 * ROK-2187 — TanStack hooks behind the admin GG settings panel. Mutations
 * refresh the settings / mascot queries; errors surface as toasts in the
 * caller's `onError` (§4.8).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type {
    GgAdminDryRunDto, GgAdminSettingsDto, GgAdminSettingsUpdateDto,
    GgMascot, GgMascotOptionsDto, GgMascotSelectDto,
} from '@raid-ledger/contract';
import {
    getGgAdminSettings, getGgDryRun, getGgMascot, getGgMascotOptions,
    selectGgMascot, updateGgAdminSettings,
} from '../../lib/api/gg-admin-api';

const ROOT = ['admin', 'gg'] as const;
export const GG_SETTINGS_KEY = [...ROOT, 'settings'] as const;
export const GG_MASCOT_KEY = [...ROOT, 'mascot'] as const;

/** Delivery settings. */
export function useGgAdminSettings(): UseQueryResult<GgAdminSettingsDto> {
    return useQuery({ queryKey: [...GG_SETTINGS_KEY], queryFn: getGgAdminSettings });
}

/** Patch the delivery settings. */
export function useUpdateGgAdminSettings(): UseMutationResult<GgAdminSettingsDto, Error, GgAdminSettingsUpdateDto> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: updateGgAdminSettings,
        onSuccess: (data) => qc.setQueryData([...GG_SETTINGS_KEY], data),
    });
}

/** Dry-run counts for `year` — fetched only when the admin asks. */
export function useGgDryRun(year: number, enabled: boolean): UseQueryResult<GgAdminDryRunDto> {
    return useQuery({ queryKey: [...ROOT, 'dry-run', year], queryFn: () => getGgDryRun(year), enabled });
}

/** The saved mascot. */
export function useGgMascot(): UseQueryResult<GgMascot | null> {
    return useQuery({ queryKey: [...GG_MASCOT_KEY], queryFn: getGgMascot });
}

/** Guild emojis + sounds; fetched only once the admin opens "From Discord". */
export function useGgMascotOptions(enabled: boolean): UseQueryResult<GgMascotOptionsDto> {
    return useQuery({
        queryKey: [...GG_MASCOT_KEY, 'options'],
        queryFn: getGgMascotOptions,
        enabled,
        staleTime: 60_000,
        retry: false,
    });
}

/** Save / re-sync / remove the mascot. */
export function useSelectGgMascot(): UseMutationResult<GgMascot | null, Error, GgMascotSelectDto> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: selectGgMascot,
        onSuccess: (data) => {
            qc.setQueryData([...GG_MASCOT_KEY], data);
            void qc.invalidateQueries({ queryKey: [...GG_SETTINGS_KEY] });
        },
    });
}
