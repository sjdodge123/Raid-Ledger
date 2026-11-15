import { z } from 'zod';
import {
    AddonCharDataSchema,
    AddonExportSectionSchema,
    AddonGuildDataSchema,
    AddonRaidDataSchema,
    AddonRaidExportSchema,
    type AddonExportSection,
} from './wow-addon-export.schema.js';
import { AddonLootDataSchema } from './wow-addon-loot.schema.js';

// ============================================================
// LedgerLink v2 envelope (ROK-2184) — BREAKING vs v1.
//
// Signal: header `!RL2!<section>…` AND payload `schema: 2`. The char / guild
// / raid payloads are byte-identical in shape to v1 apart from `schema: 2`;
// the only new section is `loot`. No `bank` in v2 (ruling Q1 — a bank is v3).
// The v1 schemas in `wow-addon-export.schema.ts` / `ADDON_IMPORT_PAGE_RE` are
// FROZEN and keep meaning "v1"; everything v2 lives here, so a v1-only reader
// never changes behaviour. During the transition the server accepts both
// (`ADDON_EXPORT_ACCEPTED_VERSIONS`, ruling Q7); one paste = one version
// (a mixed `!RL1!`/`!RL2!` paste → `UNSUPPORTED_VERSION`, ruling Q6).
// ============================================================

/** Envelope version in a v2 `!RL2!` header. */
export const ADDON_EXPORT_V2_ENVELOPE_VERSION = 2;
/** Payload `schema` number inside a v2 JSON body. */
export const ADDON_EXPORT_V2_PAYLOAD_SCHEMA = 2;
/** Header versions the server accepts during the v1 → v2 transition. */
export const ADDON_EXPORT_ACCEPTED_VERSIONS = [1, 2] as const;
export type AddonExportVersion = (typeof ADDON_EXPORT_ACCEPTED_VERSIONS)[number];

export const AddonExportSectionV2Schema = z.enum(['char', 'guild', 'raid', 'loot']);
export type AddonExportSectionV2 = z.infer<typeof AddonExportSectionV2Schema>;

/** The section set each header version admits (v1 never carries `loot`). */
export const ADDON_EXPORT_SECTIONS_BY_VERSION: Readonly<
    Record<AddonExportVersion, readonly AddonExportSectionV2[]>
> = {
    1: AddonExportSectionSchema.options,
    2: AddonExportSectionV2Schema.options,
};

/** Only `guild` pages, in every version (`!RL2!loot-1of2!…` → `BAD_HEADER`). */
export const ADDON_PAGED_SECTIONS: readonly AddonExportSectionV2[] = ['guild'];

/**
 * Version-agnostic header grammar (spec D3). Groups: 1 version · 2 section ·
 * 3 page n · 4 page m · 5 base64 body. A match is NOT acceptance: check the
 * version with `isAddonExportVersion`, then the section with
 * `isAddonSectionInVersion` (`!RL1!loot!…` → `BAD_HEADER`).
 */
export const ADDON_IMPORT_PAGE_RE_V2 =
    /^!RL(\d+)!(char|guild|raid|loot)(?:-(\d+)of(\d+))?!([A-Za-z0-9+/]+={0,2})$/;

/** Max tokens in one v2 paste: 8 guild pages + char + raid + loot. */
export const ADDON_IMPORT_MAX_TOKENS_V2 = 11;
/** Max `loot` tokens in one paste (a second → `PAGES_INCOMPLETE`). */
export const ADDON_IMPORT_MAX_LOOT_TOKENS = 1;

export function isAddonExportVersion(version: number): version is AddonExportVersion {
    return ADDON_EXPORT_ACCEPTED_VERSIONS.some((v) => v === version);
}

/** True when `section` is admitted by header `version` (false for unknown versions). */
export function isAddonSectionInVersion(version: number, section: string): boolean {
    if (!isAddonExportVersion(version)) return false;
    return ADDON_EXPORT_SECTIONS_BY_VERSION[version].some((s) => s === section);
}

/** Narrow a v2 section name back to the v1 set (for reusing v1 apply paths). */
export function isAddonV1Section(section: AddonExportSectionV2): section is AddonExportSection {
    return AddonExportSectionSchema.options.some((s) => s === section);
}

// ---------- the v2 payload ----------

/** v1 envelope fields minus `schema`/`section`/`data`, re-used unchanged. */
const envelopeV2 = {
    ...AddonRaidExportSchema.pick({
        addonVersion: true,
        client: true,
        exportedAt: true,
        who: true,
    }).shape,
    schema: z.literal(ADDON_EXPORT_V2_PAYLOAD_SCHEMA),
};

export const AddonCharExportV2Schema = z.object({
    ...envelopeV2, section: z.literal('char'), data: AddonCharDataSchema,
}).strict();
export const AddonGuildExportV2Schema = z.object({
    ...envelopeV2, section: z.literal('guild'), data: AddonGuildDataSchema,
}).strict();
export const AddonRaidExportV2Schema = z.object({
    ...envelopeV2, section: z.literal('raid'), data: AddonRaidDataSchema,
}).strict();
export const AddonLootExportSchema = z.object({
    ...envelopeV2, section: z.literal('loot'), data: AddonLootDataSchema,
}).strict();

/** The decoded body of any `!RL2!` token. Source of `ledgerlink/v2/schema.json`. */
export const AddonExportV2Schema = z.discriminatedUnion('section', [
    AddonCharExportV2Schema,
    AddonGuildExportV2Schema,
    AddonRaidExportV2Schema,
    AddonLootExportSchema,
]);
export type AddonExportV2 = z.infer<typeof AddonExportV2Schema>;
export type AddonCharExportV2 = z.infer<typeof AddonCharExportV2Schema>;
export type AddonGuildExportV2 = z.infer<typeof AddonGuildExportV2Schema>;
export type AddonRaidExportV2 = z.infer<typeof AddonRaidExportV2Schema>;
export type AddonLootExport = z.infer<typeof AddonLootExportSchema>;
