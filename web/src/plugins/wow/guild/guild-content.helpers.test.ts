/** ROK-1786 — rule line splitting, the Resources rule, the link preview and reorder ids. */
import { describe, it, expect } from 'vitest';
import type { GuildAddon } from '@raid-ledger/contract';
import { parseAddonUrl, previewAddonUrl } from './addon-url';
import { reorderedIds } from './addon-view';
import { moveItem, resourcesVisible, ruleLines } from './guild-content.helpers';

const stub = (id: number): GuildAddon => ({
    id, guildId: 1, source: 'url', slugOrUrl: `https://x.test/${id}`, url: `https://x.test/${id}`, displayName: `A${id}`, note: null,
    requirement: 'optional', flavor: id === 2 ? 'retail' : null, sortOrder: id, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
});

describe('guild content helpers', () => {
    it('ruleLines trims and drops blank lines', () => {
        expect(ruleLines(' a \r\n\n  \nb')).toEqual(['a', 'b']);
    });

    it('resourcesVisible: hidden only when empty and not editable', () => {
        expect(resourcesVisible(false, undefined, undefined)).toBe(false);
        expect(resourcesVisible(true, undefined, undefined)).toBe(true);
        expect(resourcesVisible(false, undefined, { pinned: [], addons: [stub(1)] })).toBe(true);
    });

    it('parseAddonUrl previews the known hosts and rejects non-http links', () => {
        expect(parseAddonUrl('https://www.curseforge.com/wow/addons/deadly-boss-mods')).toEqual({ name: 'Deadly Boss Mods', source: 'curseforge' });
        expect(parseAddonUrl('https://addons.wago.io/addons/weakauras-2')).toEqual({ name: 'Weakauras 2', source: 'wago' });
        expect(parseAddonUrl('https://github.com/sjdodge123/ledger-link.git')).toEqual({ name: 'Ledger Link', source: 'github' });
        expect(parseAddonUrl('https://www.curseforge.com/minecraft/mc-mods/x')).toBeNull();
        expect(parseAddonUrl('javascript:alert(1)')).toBeNull();
    });

    // Parity table — the SAME inputs as the server spec (`guild-addon-url.helpers.spec.ts`), since
    // the preview mirrors the server parser; includes cases an earlier client parser got wrong.
    it.each([
        ['https://www.curseforge.com/wow/other/details', null],
        ['https://addons.wago.io/weakauras', null],
        ['https://github.com/owner-only', null],
        ['https://example.com/addons/my-cool-addon', { name: 'My Cool Addon', source: 'url' }],
        ['https://GitHub.com/Owner/Repo.git', { name: 'Repo', source: 'github' }],
    ] as const)('previews %s exactly as the server parses it', (raw, expected) => {
        expect(parseAddonUrl(raw)).toEqual(expected);
    });

    it('previewAddonUrl carries the server rejection message', () => {
        expect(previewAddonUrl('https://www.curseforge.com/wow/other/details')).toEqual({
            ok: false, error: 'CurseForge links must look like curseforge.com/wow/addons/<name>',
        });
    });

    it('reorderedIds skips rows hidden by the flavor filter', () => {
        const all = [stub(1), stub(2), stub(3)];
        expect(reorderedIds(all, 1, 1, new Set([1, 3]))).toEqual([3, 2, 1]);
        expect(reorderedIds(all, 1, -1, new Set([1, 3]))).toBeNull();
        expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    });
});
