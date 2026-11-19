/** ROK-2099 — reads and export download for the admin addon-errors API (S3). */
import {
    AddonErrorDetailSchema,
    AddonErrorGroupPageSchema,
    type AddonErrorDetailDto,
    type AddonErrorGroupPageDto,
    type AddonErrorsExportFormat,
    type AddonErrorsFiltersDto,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { fetchWithAuth } from '../../../lib/api/fetch-api';
import { filenameFromDisposition } from '../../../hooks/use-logs';

export const ADDON_ERRORS_API = '/admin/plugins/blizzard/addon-errors';

/** `?addon=…&page=…` with empty values left out ('' when nothing is set). */
export function addonErrorsQuery(filters: AddonErrorsFiltersDto, extra: Record<string, string> = {}): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, ...extra })) {
        if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const query = params.toString();
    return query ? `?${query}` : '';
}

export function fetchAddonErrorGroups(filters: AddonErrorsFiltersDto, page: number): Promise<AddonErrorGroupPageDto> {
    const query = addonErrorsQuery(filters, { page: String(page) });
    return fetchApi(`${ADDON_ERRORS_API}${query}`, {}, AddonErrorGroupPageSchema);
}

export function fetchAddonErrorDetail(signature: string): Promise<AddonErrorDetailDto> {
    return fetchApi(`${ADDON_ERRORS_API}/${encodeURIComponent(signature)}`, {}, AddonErrorDetailSchema);
}

export function addonErrorsExportPath(filters: AddonErrorsFiltersDto, format: AddonErrorsExportFormat): string {
    return `${ADDON_ERRORS_API}/export${addonErrorsQuery(filters, { format })}`;
}

function saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/** Download the filtered export; the server names the file (`Content-Disposition`). */
export async function downloadAddonErrorsExport(
    filters: AddonErrorsFiltersDto, format: AddonErrorsExportFormat,
): Promise<void> {
    const response = await fetchWithAuth(addonErrorsExportPath(filters, format));
    if (!response.ok) throw new Error('Failed to export addon errors');
    const blob = await response.blob();
    saveBlob(blob, filenameFromDisposition(response.headers.get('Content-Disposition')) ?? `addon-errors.${format}`);
}
