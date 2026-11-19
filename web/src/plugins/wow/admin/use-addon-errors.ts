/** ROK-2099 — TanStack Query hooks for the admin Addon errors page. */
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AddonErrorsExportFormat, AddonErrorsFiltersDto } from '@raid-ledger/contract';
import { toast } from '../../../lib/toast';
import { downloadAddonErrorsExport, fetchAddonErrorDetail, fetchAddonErrorGroups } from './addon-errors-api';

const KEY = ['admin', 'addon-errors'] as const;

/** One page of `(addon, message)` groups; the previous page stays visible while the next loads. */
export function useAddonErrorGroups(filters: AddonErrorsFiltersDto, page: number) {
    return useQuery({
        queryKey: [...KEY, 'groups', filters, page],
        queryFn: () => fetchAddonErrorGroups(filters, page),
        placeholderData: keepPreviousData,
        staleTime: 15_000,
    });
}

/** Occurrences (member, character, count, stack) of one group — fetched when its row opens. */
export function useAddonErrorDetail(signature: string) {
    return useQuery({
        queryKey: [...KEY, 'detail', signature],
        queryFn: () => fetchAddonErrorDetail(signature),
        staleTime: 15_000,
    });
}

/** Export download with the format in flight (`null` when idle); `filters` is read at click time. */
export function useAddonErrorsExport(filters: () => AddonErrorsFiltersDto) {
    const [busy, setBusy] = useState<AddonErrorsExportFormat | null>(null);
    const run = async (format: AddonErrorsExportFormat): Promise<void> => {
        setBusy(format);
        try {
            await downloadAddonErrorsExport(filters(), format);
        } catch {
            toast.error('Could not export addon errors');
        } finally {
            setBusy(null);
        }
    };
    return { busy, run };
}
