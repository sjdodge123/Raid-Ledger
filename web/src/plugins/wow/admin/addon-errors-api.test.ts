/** ROK-2099 — export link + download, and the list query string. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuth = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/api/fetch-api', () => ({ fetchWithAuth }));

import { addonErrorsExportPath, addonErrorsQuery, downloadAddonErrorsExport } from './addon-errors-api';

describe('addon-errors api (ROK-2099)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('builds the export link with the filters and the format, empty values left out', () => {
        expect(addonErrorsExportPath({ addon: 'Questie', userId: 3 }, 'csv'))
            .toBe('/admin/plugins/blizzard/addon-errors/export?addon=Questie&userId=3&format=csv');
        expect(addonErrorsExportPath({}, 'json')).toBe('/admin/plugins/blizzard/addon-errors/export?format=json');
        expect(addonErrorsQuery({})).toBe('');
    });

    it('downloads the export under the server-chosen filename', async () => {
        fetchWithAuth.mockResolvedValue(new Response('a,b', { headers: { 'Content-Disposition': 'attachment; filename="addon-errors-2026.csv"' } }));
        const created = vi.fn(() => 'blob:x');
        Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            expect(this.download).toBe('addon-errors-2026.csv');
        });
        await downloadAddonErrorsExport({ q: 'nil' }, 'csv');
        expect(fetchWithAuth).toHaveBeenCalledWith('/admin/plugins/blizzard/addon-errors/export?q=nil&format=csv');
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('throws when the export request fails', async () => {
        fetchWithAuth.mockResolvedValue(new Response('no', { status: 403 }));
        await expect(downloadAddonErrorsExport({}, 'json')).rejects.toThrow('Failed to export addon errors');
    });
});
