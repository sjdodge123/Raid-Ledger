/**
 * ROK-2147 — the LedgerLink `char` section gains an optional `addons` list
 * (every installed addon folder). Additive: a char export without it is
 * unchanged v1; every entry is `.strict()`. Spec §3 / §7 AC1–2 (+ the
 * import-summary outcome, the read DTO and `folderName` on guild addons).
 */
import { describe, it, expect } from 'vitest';
import {
    ADDON_INSTALLED_MAX,
    ADDON_INSTALLED_NAME_MAX,
    ADDON_INSTALLED_TITLE_MAX,
    ADDON_INSTALLED_VERSION_MAX,
    AddonCharDataSchema,
    AddonCharImportSummarySchema,
    AddonInstalledListSchema,
    AddonInstalledSchema,
    CharacterInstalledAddonsResponseSchema,
    CreateGuildAddonSchema,
    GuildAddonSchema,
    PinnedAddonSchema,
    UpdateGuildAddonSchema,
} from '../index.js';

const entry = { name: 'WeakAuras', title: 'WeakAuras', version: '5.19.2', loaded: true };
const charData = { gear: [], talents: { configId: 7, nodes: [] }, lockouts: [] };
const ok = (e: unknown) => AddonInstalledSchema.safeParse(e).success;
const list = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Addon${i}`, loaded: true }));

describe('AddonInstalledSchema — wire entry (ROK-2147 §3)', () => {
    it('pins the caps from the spec', () => {
        expect([
            ADDON_INSTALLED_MAX, ADDON_INSTALLED_NAME_MAX,
            ADDON_INSTALLED_TITLE_MAX, ADDON_INSTALLED_VERSION_MAX,
        ]).toEqual([500, 64, 128, 32]);
    });

    it('accepts a full entry and one with only name + loaded', () => {
        expect(ok(entry)).toBe(true);
        expect(ok({ name: 'Questie', loaded: false })).toBe(true);
    });

    it('requires name (non-empty) and loaded', () => {
        expect(ok({ ...entry, name: '' })).toBe(false);
        expect(ok({ title: 'x', loaded: true })).toBe(false);
        expect(ok({ name: 'Questie' })).toBe(false);
        expect(ok({ name: 'Questie', loaded: 'yes' })).toBe(false);
    });

    it('rejects each string one past its cap, accepts it at the cap', () => {
        const at = { name: 'n'.repeat(64), title: 't'.repeat(128), version: 'v'.repeat(32), loaded: true };
        expect(ok(at)).toBe(true);
        expect(ok({ ...at, name: 'n'.repeat(65) })).toBe(false);
        expect(ok({ ...at, title: 't'.repeat(129) })).toBe(false);
        expect(ok({ ...at, version: 'v'.repeat(33) })).toBe(false);
    });

    it('is strict — an unknown key rejects the entry', () => {
        expect(ok({ ...entry, enabled: true })).toBe(false);
    });
});

describe('AddonInstalledListSchema', () => {
    it('accepts [] and exactly 500 entries; rejects 501', () => {
        expect(AddonInstalledListSchema.safeParse([]).success).toBe(true);
        expect(AddonInstalledListSchema.safeParse(list(500)).success).toBe(true);
        expect(AddonInstalledListSchema.safeParse(list(501)).success).toBe(false);
    });
});

describe('AddonCharDataSchema — data.addons is optional and additive', () => {
    it('an old char export without addons still parses, and gains no key', () => {
        const parsed = AddonCharDataSchema.parse(charData);
        expect(parsed).not.toHaveProperty('addons');
    });

    it('a char export with addons parses and keeps the list', () => {
        const parsed = AddonCharDataSchema.parse({ ...charData, addons: [entry] });
        expect(parsed.addons).toEqual([entry]);
    });

    it('an over-cap or malformed list rejects the whole data block', () => {
        expect(AddonCharDataSchema.safeParse({ ...charData, addons: list(501) }).success).toBe(false);
        expect(AddonCharDataSchema.safeParse({ ...charData, addons: {} }).success).toBe(false);
    });
});

describe('import summary + read DTO (ROK-2147)', () => {
    const summary = { gearCount: 2, avgIlvl: 80, talentNodes: 1, lockouts: 0 };

    it('char summary addons outcome is optional; status is closed', () => {
        expect(AddonCharImportSummarySchema.safeParse(summary).success).toBe(true);
        const withAddons = { ...summary, addons: { status: 'stored', count: 6 } };
        expect(AddonCharImportSummarySchema.safeParse(withAddons).success).toBe(true);
        const bad = { ...summary, addons: { status: 'rejected', count: 6 } };
        expect(AddonCharImportSummarySchema.safeParse(bad).success).toBe(false);
    });

    it('response: not visible = installed null; visible carries nullable title/version', () => {
        const hidden = { visible: false, installed: null };
        expect(CharacterInstalledAddonsResponseSchema.safeParse(hidden).success).toBe(true);
        const shown = {
            visible: true,
            installed: {
                addons: [{ name: 'Questie', title: null, version: null, loaded: true }],
                capturedAt: '2026-11-09T10:00:00.000Z',
            },
        };
        expect(CharacterInstalledAddonsResponseSchema.safeParse(shown).success).toBe(true);
        const missingTitle = { ...shown, installed: { ...shown.installed, addons: [{ name: 'Q', version: null, loaded: true }] } };
        expect(CharacterInstalledAddonsResponseSchema.safeParse(missingTitle).success).toBe(false);
    });
});

describe('folderName on guild addons (ROK-2147 D4)', () => {
    const pinned = { name: 'LedgerLink', url: 'https://github.com/x/y', note: null, requirement: 'required', flavors: [] };

    it('a stored pinned addon without folderName still parses (additive)', () => {
        expect(PinnedAddonSchema.safeParse(pinned).success).toBe(true);
        expect(PinnedAddonSchema.safeParse({ ...pinned, folderName: 'LedgerLink' }).success).toBe(true);
    });

    it('create/update accept a folder name, null clears, bad characters and >64 reject', () => {
        const url = 'https://www.curseforge.com/wow/addons/details';
        expect(CreateGuildAddonSchema.safeParse({ url }).success).toBe(true);
        expect(CreateGuildAddonSchema.parse({ url, folderName: '  Details ' }).folderName).toBe('Details');
        expect(UpdateGuildAddonSchema.safeParse({ folderName: null }).success).toBe(true);
        expect(UpdateGuildAddonSchema.safeParse({ folderName: 'DBM/Core' }).success).toBe(false);
        expect(UpdateGuildAddonSchema.safeParse({ folderName: '   ' }).success).toBe(false);
        expect(UpdateGuildAddonSchema.safeParse({ folderName: 'x'.repeat(65) }).success).toBe(false);
    });

    it('GuildAddon response carries folderName as nullable, required key', () => {
        const addon = {
            id: 1, guildId: 1, source: 'curseforge', slugOrUrl: 'details', url: 'https://x.test',
            displayName: 'Details', note: null, requirement: 'optional', flavor: null,
            sortOrder: 0, createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
        };
        expect(GuildAddonSchema.safeParse({ ...addon, folderName: null }).success).toBe(true);
        expect(GuildAddonSchema.safeParse(addon).success).toBe(false);
    });
});
