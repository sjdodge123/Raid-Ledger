import { z } from 'zod';

// ============================================================
// LedgerLink v1 `char` → `data.addons` (ROK-2147, additive)
//
// Every addon folder installed in the exporter's client, as LedgerLink reads
// it from the client addon list. EVERY object is `.strict()` — an unknown key
// rejects the whole string. The addon truncates strings and the list to the
// caps before export; the server rejects anything over a cap. Absent block =
// no opinion (the server keeps what it stored); `[]` = nothing installed.
// ============================================================

/** Entries per export — module suites (DBM, ElvUI, BigWigs) reach 100–300. */
export const ADDON_INSTALLED_MAX = 500;
/** Folder name (`GetAddOnInfo` first return). */
export const ADDON_INSTALLED_NAME_MAX = 64;
/** `## Title` metadata; colour codes are stripped by the server sanitizer. */
export const ADDON_INSTALLED_TITLE_MAX = 128;
/** `## Version` metadata. */
export const ADDON_INSTALLED_VERSION_MAX = 32;

/** One installed addon folder. */
export const AddonInstalledSchema = z.object({
    name: z.string().min(1).max(ADDON_INSTALLED_NAME_MAX),
    title: z.string().max(ADDON_INSTALLED_TITLE_MAX).optional(),
    version: z.string().max(ADDON_INSTALLED_VERSION_MAX).optional(),
    /** Loaded this session (`C_AddOns.IsAddOnLoaded` / `IsAddOnLoaded`). */
    loaded: z.boolean(),
}).strict();
export type AddonInstalled = z.infer<typeof AddonInstalledSchema>;

/** `char` `data.addons` — loaded entries first, cut to `ADDON_INSTALLED_MAX`. */
export const AddonInstalledListSchema = z.array(AddonInstalledSchema).max(ADDON_INSTALLED_MAX);
export type AddonInstalledList = z.infer<typeof AddonInstalledListSchema>;

/** What an applied char import did with its installed-addon list (ROK-2147). */
export const AddonInstalledImportOutcomeSchema = z.object({
    /** `stored` = written; `unchanged` = same list; `stale` = an equal-or-newer export is stored. */
    status: z.enum(['stored', 'unchanged', 'stale']),
    /** Entries in the export after server-side de-duplication. */
    count: z.number().int().nonnegative(),
}).strict();
export type AddonInstalledImportOutcome = z.infer<typeof AddonInstalledImportOutcomeSchema>;

/** One stored installed addon as the read API returns it. */
export const CharacterInstalledAddonSchema = z.object({
    name: z.string(),
    title: z.string().nullable(),
    version: z.string().nullable(),
    loaded: z.boolean(),
}).strict();
export type CharacterInstalledAddon = z.infer<typeof CharacterInstalledAddonSchema>;

/** `GET /plugins/wow/characters/:id/installed-addons`. */
export const CharacterInstalledAddonsResponseSchema = z.object({
    /** Viewer is the owner or an officer (canEdit) of the character's guild. */
    visible: z.boolean(),
    /** Null when not visible, or visible but no export carried the block yet. */
    installed: z.object({
        addons: z.array(CharacterInstalledAddonSchema),
        capturedAt: z.string().datetime(),
    }).strict().nullable(),
}).strict();
export type CharacterInstalledAddonsResponse = z.infer<typeof CharacterInstalledAddonsResponseSchema>;
